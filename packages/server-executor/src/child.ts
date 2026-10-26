import { randomUUID,createHash } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-llm';
import type { GenerateOptions } from '@deepseek-ai/dsh-llm';
import { ParentMessageSchema,ExecutorCallSchema,ExecutorSettlementSchema,ExecutorToolCallSchema,ExecutorToolReceiptSchema,normalizeExecutorUsage,executorError,EXECUTOR_IPC_VERSION } from './protocol.js';
import type { ParentMessage,ExecutorCall,ExecutorPermit,ExecutorSettlement,ExecutorIpcEndpoint,ExecutorRoute,ExecutorUsage,ExecutorToolCall,ExecutorToolReceipt } from './protocol.js';
import { ExecutorHashSchema } from './types.js';

type Binding=Extract<ParentMessage,{type:'bind'}>;
interface Pending {resolve:(message:ParentMessage)=>void;reject:(error:Error)=>void}
export class ExecutorChildBudgetClient {
  readonly signal:AbortSignal;
  private readonly abort=new AbortController();
  private readonly endpoint:ExecutorIpcEndpoint;
  private readonly profileHash:string;
  private readonly unsubscribe:()=>void;
  private readonly pending=new Map<string,Pending>();
  private binding:Binding|undefined;
  private active=false;
  private resolveBinding!:(binding:Binding)=>void;
  private rejectBinding!:(error:Error)=>void;
  private readonly readyPromise:Promise<Binding>;
  private timer:ReturnType<typeof setTimeout>|undefined;
  constructor(endpoint:ExecutorIpcEndpoint,profileHash:string){this.endpoint=endpoint;this.profileHash=ExecutorHashSchema.parse(profileHash);this.signal=this.abort.signal;
    this.readyPromise=new Promise((resolve,reject)=>{this.resolveBinding=resolve;this.rejectBinding=reject;});void this.readyPromise.catch(()=>{});
    this.unsubscribe=endpoint.subscribe(value=>this.message(value),()=>this.fail('EXECUTOR_PARENT_DISCONNECTED'));
    void endpoint.send({version:EXECUTOR_IPC_VERSION,type:'online',profileHash}).catch(()=>this.fail('EXECUTOR_IPC_SEND_FAILED'));
  }
  private fail(code:string):void{if(this.signal.aborted)return;const error=new Error(code);this.abort.abort(error);this.rejectBinding(error);for(const request of this.pending.values())request.reject(error);this.pending.clear();if(this.timer)clearTimeout(this.timer);}
  private message(raw:unknown):void{
    const parsed=ParentMessageSchema.safeParse(raw);if(!parsed.success){this.fail('EXECUTOR_IPC_PROTOCOL');return;}const message=parsed.data;
    if(message.type==='bind'){
      if(this.binding||message.profileHash!==this.profileHash||message.deadline<=Date.now()){this.fail('EXECUTOR_BINDING_MISMATCH');return;}
      this.binding=Object.freeze({...message,route:Object.freeze(message.route)});this.timer=setTimeout(()=>this.fail('EXECUTOR_DEADLINE'),Math.min(2147483647,message.deadline-Date.now()));
      void this.endpoint.send({version:1,type:'ready',jobId:message.jobId,nonce:message.nonce,profileHash:this.profileHash}).catch(()=>this.fail('EXECUTOR_IPC_SEND_FAILED'));return;
    }
    if(!this.binding||message.jobId!==this.binding.jobId||message.nonce!==this.binding.nonce){this.fail('EXECUTOR_BINDING_MISMATCH');return;}
    if(message.type==='cancel'){this.fail(message.code);return;}
    if(message.type==='active'){if(this.active){this.fail('EXECUTOR_IPC_REPLAY');return;}this.active=true;this.resolveBinding(this.binding);return;}
    const pending=this.pending.get(message.callId);if(!pending){this.fail('EXECUTOR_IPC_REPLAY');return;}this.pending.delete(message.callId);
    if(message.type==='denied')pending.reject(new Error(message.code));else pending.resolve(message);
    if(message.type==='settled'&&message.unknown)this.fail('EXECUTOR_USAGE_UNKNOWN');
  }
  async ready():Promise<{jobId:string;route:ExecutorRoute;deadline:number}>{const value=await this.readyPromise;return {jobId:value.jobId,route:value.route,deadline:value.deadline};}
  private async request(callId:string,body:object):Promise<ParentMessage>{
    const binding=await this.readyPromise;this.signal.throwIfAborted();if(this.pending.has(callId))throw new Error('EXECUTOR_CALL_INFLIGHT');
    return new Promise((resolve,reject)=>{this.pending.set(callId,{resolve,reject});void this.endpoint.send({version:1,jobId:binding.jobId,nonce:binding.nonce,...body}).catch(()=>this.fail('EXECUTOR_IPC_SEND_FAILED'));});
  }
  async reserve(raw:ExecutorCall):Promise<ExecutorPermit>{const call=ExecutorCallSchema.parse(raw),response=await this.request(call.callId,{type:'reserve',call});
    if(response.type!=='reserved'||response.callId!==call.callId)throw new Error('EXECUTOR_IPC_PROTOCOL');this.signal.throwIfAborted();return response.permit;}
  async settle(raw:ExecutorSettlement):Promise<{unknown:boolean}>{const settlement=ExecutorSettlementSchema.parse(raw),response=await this.request(settlement.callId,{type:'settle',settlement});
    if(response.type!=='settled'||response.callId!==settlement.callId)throw new Error('EXECUTOR_IPC_PROTOCOL');return {unknown:response.unknown};}
  async authorizeTool(raw:ExecutorToolCall):Promise<string>{const tool=ExecutorToolCallSchema.parse(raw),response=await this.request(tool.callId,{type:'tool-admit',tool});
    if(response.type!=='tool-permitted'||response.callId!==tool.callId)throw new Error('EXECUTOR_IPC_PROTOCOL');this.signal.throwIfAborted();return response.permitId;}
  async finishTool(raw:ExecutorToolReceipt):Promise<void>{const receipt=ExecutorToolReceiptSchema.parse(raw),response=await this.request(receipt.callId,{type:'tool-finish',receipt});
    if(response.type!=='tool-recorded'||response.callId!==receipt.callId)throw new Error('EXECUTOR_IPC_PROTOCOL');}
  async finish():Promise<void>{if(this.pending.size)throw new Error('EXECUTOR_CALL_INFLIGHT');const callId=randomUUID(),response=await this.request(callId,{type:'done',callId});
    if(response.type!=='finished')throw new Error('EXECUTOR_IPC_PROTOCOL');this.close();}
  close():void{this.fail('EXECUTOR_CHILD_CLOSED');this.unsubscribe();this.endpoint.disconnect();}
}
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');

/** Mount globally in the dedicated child profile; no call count limit and no credentials in telemetry. */
export function installExecutorChildBilling(ctx:Context,client:ExecutorChildBudgetClient,cancelActive:()=>void,admitInput?:(options:GenerateOptions)=>void):()=>void{
  const cancelled=()=>cancelActive();client.signal.addEventListener('abort',cancelled,{once:true});
  const dispose=ctx.on('llm/stream',async function*(options,next){
    const {route}=await client.ready();client.signal.throwIfAborted();options.signal?.throwIfAborted();
    if(options.provider!==route.provider||options.model!==route.model)throw new Error('EXECUTOR_ROUTE_CHANGED');
    admitInput?.(options);
    const info=await ctx.llm.resolveModelInfo(options.provider,options.model,options.signal),output=options.maxTokens??info.defaultMaxTokens??route.contextWindow,
      effort=options.reasoningEffort??info.reasoning?.defaultEffort??null;
    if(info.context?.contextWindow!==route.contextWindow||effort!==route.reasoningEffort||!Number.isSafeInteger(output)||output<1||output>route.maxOutputTokens)throw new Error('EXECUTOR_ROUTE_CHANGED');
    const body=JSON.stringify({provider:options.provider,model:options.model,system:options.system??null,messages:options.messages,tools:options.tools??[],maxTokens:output,purpose:options.purpose??null,reasoningEffort:effort,temperature:options.temperature??null,stop:options.stop??null}),bytes=Buffer.byteLength(body);
    if(bytes>route.maxRequestBytes)throw new Error('EXECUTOR_REQUEST_TOO_LARGE');
    const callId=randomUUID(),start=Date.now(),permit=await client.reserve({callId,provider:options.provider,model:options.model,reasoningEffort:effort,requestHash:digest(body),sessionHash:digest(String(options.sessionId??'')),inputBound:route.contextWindow,outputBound:output,requestBytes:bytes,purpose:options.purpose??'task'});
    let usage:ExecutorUsage|null=null,finish:ExecutorSettlement['finish']='interrupted',error:string|null=null,complete=false,invalid=false;
    try{client.signal.throwIfAborted();for await(const chunk of next()){
      client.signal.throwIfAborted();if(chunk.type==='usage'){try{usage=normalizeExecutorUsage(chunk.usage);}catch{usage=null;invalid=true;error='EXECUTOR_USAGE_INVALID';}}
      if(chunk.type==='finish'){complete=true;finish=chunk.reason.kind;if(finish==='error'||finish==='aborted')error='EXECUTOR_MODEL_FAILED';}
      yield chunk;
    }}catch(caught){error??=executorError(caught,'EXECUTOR_STREAM_FAILED');throw new Error(error);}
    finally{if(!complete||invalid||finish==='error'||finish==='aborted')usage=null;
      await client.settle({callId,reservationId:permit.reservationId,usage,finish,durationMs:Math.max(0,Date.now()-start),error});}
  },{global:true});
  return ()=>{dispose();client.signal.removeEventListener('abort',cancelled);};
}
