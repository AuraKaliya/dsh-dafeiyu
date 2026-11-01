import type { StreamChunk } from '@deepseek-ai/dsh-llm';
import { redactContent,redactJson } from '@dafeiyu/contracts';
import { z } from 'zod';
import type {Json} from '@dafeiyu/contracts';

export interface RejectedModelInput {readonly tool:string;readonly fields:readonly string[];readonly reason?:'private-field'|'invalid-json'}
function changedFields(before:Json,after:Json,path='$'):string[]{
  if(JSON.stringify(before)===JSON.stringify(after))return [];
  if(before&&after&&typeof before==='object'&&typeof after==='object'&&!Array.isArray(before)&&!Array.isArray(after))
    return Object.keys(before).flatMap(key=>changedFields(before[key]!,after[key]??null,path+'.'+redactContent(key).value.slice(0,100))).slice(0,16);
  if(Array.isArray(before)&&Array.isArray(after))return before.flatMap((value,index)=>changedFields(value,after[index]??null,`${path}[${index}]`)).slice(0,16);
  return [path];
}

/** Only public content reaches DSH JSONL; transport reasoning and replay stay out. */
export async function* visibleStream(input:AsyncIterable<StreamChunk>,onRejected?:(event:RejectedModelInput)=>void):AsyncIterable<StreamChunk>{
  const visible=new Map<number,{index:number;kind:'text'|'tool-call'}>(),seen=new Set<number>();
  for await(const chunk of input){
    if(chunk.type==='block-start'){
      if(seen.has(chunk.index))throw new Error('INVALID_MODEL_STREAM');seen.add(chunk.index);
      if(chunk.blockType==='reasoning')continue;
      if(chunk.blockType!=='text'&&chunk.blockType!=='tool-call')throw new Error('MODEL_PERSISTENCE_POLICY_UNSUPPORTED');
      const entry={index:visible.size,kind:chunk.blockType};visible.set(chunk.index,entry);
      yield {type:'block-start',index:entry.index,blockType:entry.kind};
    }else if(chunk.type==='reasoning-delta'){continue;
    }else if(chunk.type==='text-delta'||chunk.type==='tool-call-delta'){
      const entry=visible.get(chunk.index);if(!entry||entry.kind!==(chunk.type==='text-delta'?'text':'tool-call'))throw new Error('INVALID_MODEL_STREAM');
      // Commit public text/arguments as a complete block, so a known secret split across
      // deltas cannot reach the persistent transcript before inspection.
    }else if(chunk.type==='block-end'){
      if(chunk.block.type==='reasoning')continue;const entry=visible.get(chunk.index);
      if(!entry||chunk.block.type!==entry.kind)throw new Error('INVALID_MODEL_STREAM');
      if(chunk.block.type==='text'){const text=redactContent(chunk.block.text).value;yield {type:'text-delta',index:entry.index,text};yield {type:'block-end',index:entry.index,block:{type:'text',text}};}
      else if(chunk.block.type==='tool-call'){
        let args;try{args=z.json().parse(JSON.parse(chunk.block.arguments));}catch{
          onRejected?.({tool:redactContent(chunk.block.name).value,fields:['$'],reason:'invalid-json'});
          yield {type:'finish',reason:{kind:'error',failure:{code:'INVALID_MODEL_ARGUMENTS',message:'Tool arguments were not valid JSON; no calls from this attempt were dispatched.'}}};return;}
        const safe=redactJson(args);
        if(safe.redacted){onRejected?.({tool:chunk.block.name,fields:changedFields(args,safe.value)});
          yield {type:'finish',reason:{kind:'error',failure:{code:'PRIVATE_INPUT_REJECTED',message:'Tool arguments included a restricted field; no calls from this attempt were dispatched.'}}};return;}
        yield {type:'tool-call-delta',index:entry.index,id:chunk.block.id,name:chunk.block.name,argumentsDelta:chunk.block.arguments};
        yield {type:'block-end',index:entry.index,block:{type:'tool-call',id:chunk.block.id,name:chunk.block.name,arguments:chunk.block.arguments}};
      }
    }else if(chunk.type==='usage')yield {type:'usage',usage:chunk.usage};
    else {const reason=chunk.reason;if(reason.kind==='error'||reason.kind==='aborted'){
      const code=reason.failure.code.toUpperCase(),status=reason.failure.status;
      yield {type:'finish',reason:{kind:reason.kind,failure:{code:/^[A-Z][A-Z0-9_]{0,63}$/.test(code)?code:'MODEL_INCOMPLETE',message:'Model did not complete',
        ...(typeof status==='number'&&Number.isInteger(status)&&status>=100&&status<600?{status}:{})}}};
    }else yield {type:'finish',reason};}
  }
}
