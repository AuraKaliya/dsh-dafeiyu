import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { DshResultReadSchema,redactJson } from '@dafeiyu/contracts';
import type { Json,DshResultRead,Conversation } from '@dafeiyu/contracts';

const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const savedSchema=z.strictObject({schemaVersion:z.literal(1),taskId:z.uuid(),scene:z.json(),result:z.json(),hash:z.string().length(64)});
/** Immutable, sanitized task results. A page contains whole JSON values or explicit child handles. */
export class DshResultStore {
  constructor(private readonly directory:string){mkdirSync(directory,{recursive:true});}
  private file(id:string){return join(this.directory,z.uuid().parse(id)+'.result.json');}
  save(id:string,taskId:string,scene:Conversation|null,result:Json){const safe=redactJson(result).value,body={schemaVersion:1,taskId,scene:z.json().parse(scene),result:safe,hash:digest(safe)};
    if(Buffer.byteLength(JSON.stringify(body))>4*1024*1024)throw new Error('DSH_RESULT_STORAGE_LIMIT');writeFileSync(this.file(id),JSON.stringify(savedSchema.parse(body)),{flag:'wx'});}
  read(taskId:string,scene:Conversation|null,raw:DshResultRead):Json {
    const input=DshResultReadSchema.parse(raw),saved=savedSchema.parse(JSON.parse(readFileSync(this.file(input.resultId),'utf8')));
    if(saved.taskId!==taskId||digest(saved.scene)!==digest(scene)||saved.hash!==digest(saved.result))throw new Error('SCOPE_DENIED');
    const envelope=z.object({isError:z.boolean().optional(),effect:z.enum(['none','confirmed','unknown']).optional(),value:z.json().optional(),processing:z.json().optional()}).safeParse(saved.result);
    let value:Json=envelope.success&&envelope.data.value!==undefined?envelope.data.value:saved.result;
    for(const key of input.path){if(value===null||typeof value!=='object'||!Object.hasOwn(value,key))throw new Error('DSH_RESULT_PATH_INVALID');value=z.json().parse(Reflect.get(value,key));}
    const next=(offset:number,path=input.path)=>({resultId:input.resultId,path,offset,limit:input.limit});
    const describe=(v:Json,path:string[]):Json=>{
      if(Buffer.byteLength(JSON.stringify(v))<=1600)return {value:v};
      return {kind:typeof v==='string'?'text':Array.isArray(v)?'array':'object',size:typeof v==='string'?Array.from(v).length:Array.isArray(v)?v.length:Object.keys(v??{}).length,
        ...(typeof v==='string'?{preview:Array.from(v).slice(0,160).join('')}:!Array.isArray(v)&&v!==null&&typeof v==='object'?{keys:Object.keys(v).slice(0,24)}:{}),read:next(0,path)};
    };
    let view:Json;
    if(typeof value==='string'){const chars=Array.from(value),end=Math.min(chars.length,input.offset+input.limit);view={kind:'text',text:chars.slice(input.offset,end).join(''),coverage:{start:input.offset,end,total:chars.length,complete:input.offset===0&&end===chars.length},next:end<chars.length?next(end):null};}
    else if(value!==null&&typeof value==='object'){
      const entries=Object.entries(value),items:Json[]=[];let index=input.offset,bytes=0;
      for(;index<entries.length;index++){const [key,child]=entries[index]!,entry:Json={key,...z.record(z.string(),z.json()).parse(describe(child,[...input.path,key]))},size=Buffer.byteLength(JSON.stringify(entry));if(items.length&&bytes+size>input.limit*3)break;items.push(entry);bytes+=size;if(items.length>=32){index++;break;}}
      view={kind:Array.isArray(value)?'array':'object',entries:items,coverage:{start:input.offset,end:index,total:entries.length,complete:input.offset===0&&index===entries.length},next:index<entries.length?next(index):null};
    }else view={kind:'value',value,coverage:{complete:true},next:null};
    return z.json().parse({resultId:input.resultId,path:input.path,execution:{isError:envelope.success?envelope.data.isError??false:false,effect:envelope.success?envelope.data.effect??'unknown':'unknown',receiptId:input.resultId},...(envelope.success&&envelope.data.processing?{processing:envelope.data.processing}:{}),view});
  }
}
