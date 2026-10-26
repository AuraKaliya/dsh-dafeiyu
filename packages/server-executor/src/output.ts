import { StringDecoder } from 'node:string_decoder';
import { redactContent } from '@dafeiyu/contracts';
import { executorHash } from './types.js';

export type ExecutorVisibleEvent={type:'session';sessionId:string}|{type:'status';phase:string;turn:number|null;step:number|null}|
  {type:'tool_call';callHash:string;tool:string}|{type:'tool_result';callHash:string;status:'error'|'completed'};
export interface ExecutorVisibleOutput {
  schemaVersion:1;sessionId:string|null;final:{kind:'executor-self-report';text:string;redacted:boolean;truncated:boolean}|null;
  events:readonly ExecutorVisibleEvent[];counts:{stdoutBytes:number;stderrBytes:number;toolCalls:number;toolResults:number;discarded:number};gaps:readonly string[];
}
const index=(value:unknown):number|null=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
const safeId=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z0-9._:-]{1,200}$/.test(value);

/** The raw stream is never archived. Thinking, tool payloads, intermediate text and stderr content are discarded. */
export class ExecutorOutputCollector {
  private readonly decoder=new StringDecoder('utf8');
  private readonly maxLineBytes:number;
  private readonly maxFinalBytes:number;
  private readonly maxEvents:number;
  private buffer='';
  private dropping=false;
  private ended=false;
  private readonly events:ExecutorVisibleEvent[]=[];
  private readonly gaps=new Set<string>();
  private readonly counts={stdoutBytes:0,stderrBytes:0,toolCalls:0,toolResults:0,discarded:0};
  private sessionId:string|null=null;
  private final:ExecutorVisibleOutput['final']=null;
  constructor(options:{maxLineBytes?:number;maxFinalBytes?:number;maxEvents?:number}={}){
    this.maxLineBytes=options.maxLineBytes??512*1024;this.maxFinalBytes=options.maxFinalBytes??256*1024;this.maxEvents=options.maxEvents??256;
    for(const n of [this.maxLineBytes,this.maxFinalBytes,this.maxEvents])if(!Number.isSafeInteger(n)||n<1)throw new Error('EXECUTOR_OUTPUT_BOUND_INVALID');
    if(this.maxLineBytes>8*1024*1024||this.maxFinalBytes>this.maxLineBytes||this.maxEvents>4096)throw new Error('EXECUTOR_OUTPUT_BOUND_INVALID');
  }
  stdout(chunk:Uint8Array):void{if(this.ended)throw new Error('EXECUTOR_OUTPUT_CLOSED');this.counts.stdoutBytes+=chunk.byteLength;this.consume(this.decoder.write(Buffer.from(chunk)));}
  stderr(chunk:Uint8Array):void{this.counts.stderrBytes+=chunk.byteLength;}
  private consume(text:string):void{
    let offset=0;while(offset<text.length){const newline=text.indexOf('\n',offset),end=newline<0?text.length:newline,part=text.slice(offset,end);
      if(!this.dropping){if(Buffer.byteLength(this.buffer)+Buffer.byteLength(part)>this.maxLineBytes){this.buffer='';this.dropping=true;this.gaps.add('EXECUTOR_OUTPUT_LINE_TOO_LARGE');}
        else this.buffer+=part;}
      if(newline<0)return;
      if(this.dropping){this.counts.discarded++;this.dropping=false;}else this.line(this.buffer);this.buffer='';offset=newline+1;
    }
  }
  private append(event:ExecutorVisibleEvent):void{if(this.events.length<this.maxEvents)this.events.push(event);else this.gaps.add('EXECUTOR_TRACE_TRUNCATED');}
  private line(text:string):void{
    if(!text.trim())return;let raw:unknown;try{raw=JSON.parse(text);}catch{this.gaps.add('EXECUTOR_OUTPUT_INVALID_JSON');this.counts.discarded++;return;}
    if(!raw||typeof raw!=='object'||Array.isArray(raw)){this.gaps.add('EXECUTOR_OUTPUT_UNCLASSIFIED');this.counts.discarded++;return;}
    const value=raw as Record<string,unknown>;
    if(value.type==='thinking'||value.type==='text'){this.counts.discarded++;return;}
    if(value.type==='session'&&safeId(value.sessionId)){
      if(this.sessionId!==null&&this.sessionId!==value.sessionId){this.gaps.add('EXECUTOR_SESSION_CONFLICT');return;}
      this.sessionId=value.sessionId;this.append({type:'session',sessionId:value.sessionId});return;
    }
    if(value.type==='status'&&typeof value.phase==='string'&&['turn_start','step_start','step_end','turn_end'].includes(value.phase)){
      this.append({type:'status',phase:value.phase,turn:index(value.turn),step:index(value.step)});return;
    }
    if(value.type==='tool_call'&&safeId(value.callId)&&safeId(value.tool)){
      this.counts.toolCalls++;this.append({type:'tool_call',callHash:executorHash(value.callId),tool:value.tool});return;
    }
    if(value.type==='tool_result'&&safeId(value.callId)&&(value.status==='completed'||value.status==='error')){
      this.counts.toolResults++;this.append({type:'tool_result',callHash:executorHash(value.callId),status:value.status});return;
    }
    if(value.type==='final'&&typeof value.text==='string'){
      if(this.final!==null){this.gaps.add('EXECUTOR_FINAL_CONFLICT');return;}const redacted=redactContent(value.text),bytes=Buffer.from(redacted.value),truncated=bytes.length>this.maxFinalBytes;
      this.final={kind:'executor-self-report',text:truncated?bytes.subarray(0,this.maxFinalBytes).toString('utf8'):redacted.value,redacted:redacted.redacted,truncated};
      if(truncated)this.gaps.add('EXECUTOR_FINAL_TRUNCATED');return;
    }
    this.counts.discarded++;this.gaps.add('EXECUTOR_OUTPUT_UNCLASSIFIED');
  }
  finish():ExecutorVisibleOutput{if(!this.ended){this.consume(this.decoder.end());if(this.buffer&&!this.dropping)this.line(this.buffer);this.buffer='';this.ended=true;}
    return structuredClone({schemaVersion:1,sessionId:this.sessionId,final:this.final,events:this.events,counts:this.counts,gaps:[...this.gaps]});}
}
