import { readFileSync,writeFileSync,mkdirSync,readdirSync,statSync,lstatSync,linkSync,unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DshResultReadSchema,DshResultReadBatchSchema,redactJson } from '@dafeiyu/contracts';
import type { Json,DshResultRead,DshResultReadBatch,Conversation } from '@dafeiyu/contracts';

const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const savedSchema=z.strictObject({schemaVersion:z.literal(1),taskId:z.uuid(),scene:z.json(),result:z.json(),hash:z.string().length(64)});
const envelopeSchema=z.object({isError:z.boolean().optional(),effect:z.enum(['none','confirmed','unknown']).optional(),value:z.json().optional(),processing:z.json().optional(),handoff:z.json().optional()});
interface TextIndex {total:number;blocks:number[]}
function indexText(value:string):TextIndex{const blocks:number[]=[];let total=0,offset=0;for(const char of value){if(total%1024===0)blocks.push(offset);total++;offset+=char.length;}return {total,blocks};}
function textSlice(value:string,index:TextIndex,offset:number,limit:number){
  if(offset>=index.total)return {text:'',end:index.total};
  let position=index.blocks[Math.floor(offset/1024)]??0,at=Math.floor(offset/1024)*1024;
  while(at<offset){position+=(value.codePointAt(position)??0)>0xffff?2:1;at++;}
  const start=position,end=Math.min(index.total,offset+limit);
  while(at<end){position+=(value.codePointAt(position)??0)>0xffff?2:1;at++;}return {text:value.slice(start,position),end};
}
function prepare(saved:z.infer<typeof savedSchema>){
  const envelope=envelopeSchema.safeParse(saved.result);let value:Json=envelope.success&&envelope.data.value!==undefined?envelope.data.value:saved.result,encoding='json';
  if(typeof value==='string'&&/^[\s]*[\[{]/u.test(value))try{
    const parsed:unknown=JSON.parse(value,(_key:string,child:unknown,context?:{source?:string})=>typeof child==='number'&&context?.source?context.source:child);
    if(parsed!==null&&typeof parsed==='object'){value=z.json().parse(parsed);encoding='json-text-numbers-preserved';}
  }catch{/* Non-JSON tool text remains explicitly paged text. */}
  return {envelope,value,encoding,textIndexes:new Map<string,TextIndex>()};
}
/** Immutable, sanitized task results. A page contains whole JSON values or explicit child handles. */
export class DshResultStore {
  private readonly cache=new Map<string,{stamp:string;bytes:number;saved:z.infer<typeof savedSchema>;prepared:ReturnType<typeof prepare>}>();
  private readonly counters={diskLoads:0,cacheHits:0};
  diagnostics(){return {...this.counters,cachedResults:this.cache.size,cachedBytes:[...this.cache.values()].reduce((sum,row)=>sum+row.bytes,0)};}
  constructor(private readonly directory:string){mkdirSync(directory,{recursive:true});}
  private file(id:string,taskId:string){return join(this.directory,z.uuid().parse(taskId)+'.'+z.uuid().parse(id)+'.result.json');}
  available(taskId:string,scene:Conversation|null,id:string):boolean{try{const {saved}=this.load(this.file(id,taskId));return saved.taskId===taskId&&digest(saved.scene)===digest(scene);}catch{return false;}}
  private identity(file:string){const value=lstatSync(file,{bigint:true});if(!value.isFile()||value.isSymbolicLink())throw new Error('SCOPE_DENIED');return {stamp:[value.dev,value.ino,value.size,value.mtimeNs,value.ctimeNs].join(':'),bytes:Number(value.size)};}
  private load(file:string){
    const before=this.identity(file),old=this.cache.get(file);
    if(old?.stamp===before.stamp){this.cache.delete(file);this.cache.set(file,old);this.counters.cacheHits++;return old;}
    this.cache.delete(file);if(before.bytes>4*1024*1024)throw new Error('SCOPE_DENIED');
    const saved=savedSchema.parse(JSON.parse(readFileSync(file,'utf8')));this.counters.diskLoads++;
    if(this.identity(file).stamp!==before.stamp||saved.hash!==digest(saved.result))throw new Error('SCOPE_DENIED');
    while(this.cache.size>=8||[...this.cache.values()].reduce((sum,row)=>sum+row.bytes,before.bytes)>8*1024*1024)this.cache.delete(this.cache.keys().next().value!);
    const loaded={...before,saved,prepared:prepare(saved)};this.cache.set(file,loaded);return loaded;
  }
  save(id:string,taskId:string,scene:Conversation|null,result:Json){const safe=redactJson(result).value,body={schemaVersion:1,taskId,scene:z.json().parse(scene),result:safe,hash:digest(safe)};
    const bytes=Buffer.byteLength(JSON.stringify(body)),files=readdirSync(this.directory).filter(name=>name.endsWith('.result.json')),sizes=files.map(name=>({name,bytes:statSync(join(this.directory,name)).size}));
    if(bytes>4*1024*1024||sizes.filter(file=>file.name.startsWith(taskId+'.')).reduce((n,file)=>n+file.bytes,bytes)>64*1024*1024||sizes.reduce((n,file)=>n+file.bytes,bytes)>2*1024**3)throw new Error('DSH_RESULT_STORAGE_LIMIT');
    const target=this.file(id,taskId),temp=target+'.'+randomUUID()+'.tmp';
    writeFileSync(temp,JSON.stringify(savedSchema.parse(body)),{flag:'wx'});
    try{linkSync(temp,target);}finally{unlinkSync(temp);} // Atomic exclusive publication; an existing receipt is never overwritten.
  }
  read(taskId:string,scene:Conversation|null,raw:DshResultRead):Json {
    const input=DshResultReadSchema.parse(raw);let loaded:ReturnType<DshResultStore['load']>;try{loaded=this.load(this.file(input.resultId,taskId));}catch{throw new Error('SCOPE_DENIED');}
    const {saved,prepared:{envelope,encoding}}=loaded;
    if(saved.taskId!==taskId||digest(saved.scene)!==digest(scene))throw new Error('SCOPE_DENIED');
    let value=loaded.prepared.value;
    // The immutable tree was validated on load; own-property traversal cannot introduce a non-JSON value.
    for(const key of input.path){if(value===null||typeof value!=='object'||!Object.hasOwn(value,key))throw new Error('DSH_RESULT_PATH_INVALID');value=Reflect.get(value,key) as Json;}
    const textIndex=(text:string,path:string[])=>{const key=JSON.stringify(path),indexes=loaded.prepared.textIndexes,old=indexes.get(key);if(old)return old;
      if(indexes.size>=128)indexes.delete(indexes.keys().next().value!);const index=indexText(text);indexes.set(key,index);return index;};
    const next=(offset:number,path=input.path)=>({resultId:input.resultId,path,offset,limit:input.limit});
    const describe=(v:Json,path:string[],inlineBytes:number):Json=>{
      if(Buffer.byteLength(JSON.stringify(v))<=inlineBytes)return {value:v};
      return {kind:typeof v==='string'?'text':Array.isArray(v)?'array':'object',size:typeof v==='string'?textIndex(v,path).total:Array.isArray(v)?v.length:Object.keys(v??{}).length,
        ...(typeof v==='string'?{preview:textSlice(v,textIndex(v,path),0,160).text}:!Array.isArray(v)&&v!==null&&typeof v==='object'?{keys:Object.keys(v).slice(0,24)}:{}),read:next(0,path)};
    };
    let view:Json;
    if(typeof value==='string'){const index=textIndex(value,input.path),part=textSlice(value,index,input.offset,input.limit);view={kind:'text',text:part.text,coverage:{start:input.offset,end:part.end,total:index.total,complete:input.offset===0&&part.end===index.total},next:part.end<index.total?next(part.end):null};}
    else if(value!==null&&typeof value==='object'){
      const entries=Object.entries(value),items:Json[]=[],unread:Json[]=[];let index=input.offset,bytes=0;
      const budget=Math.max(1600,input.limit*3);
      for(;index<entries.length;index++){const [key,child]=entries[index]!,description=z.record(z.string(),z.json()).parse(describe(child,[...input.path,key],Math.max(1600,Math.min(12000,budget-bytes-100)))),entry:Json={key,...description},size=Buffer.byteLength(JSON.stringify(entry));
        if(items.length&&bytes+size>budget)break;items.push(entry);bytes+=size;if(description.read)unread.push(description.read);if(items.length>=32){index++;break;}}
      const listedComplete=input.offset===0&&index===entries.length;
      view={kind:Array.isArray(value)?'array':'object',entries:items,coverage:{start:input.offset,end:index,total:entries.length,listedComplete,complete:listedComplete&&unread.length===0},
        ...(unread.length?{unread,note:'已列出字段不等于读完正文；这些子节点尚未展开。沿unread中的读取入口继续，不重新执行原工具。'}:{}),next:index<entries.length?next(index):null};
    }else view={kind:'value',value,coverage:{complete:true},next:null};
    return z.json().parse({resultId:input.resultId,path:input.path,read:input,encoding,execution:{isError:envelope.success?envelope.data.isError??false:false,effect:envelope.success?envelope.data.effect??'unknown':'unknown',receiptId:input.resultId},...(envelope.success&&envelope.data.processing?{processing:envelope.data.processing}:{}),...(envelope.success&&envelope.data.handoff?{handoff:envelope.data.handoff}:{}),view});
  }
  readBatch(taskId:string,scene:Conversation|null,raw:DshResultReadBatch,guard:()=>void):Json{
    const input=DshResultReadBatchSchema.parse(raw),items=input.reads.map(request=>{
      guard();try{return {request,status:'ok',page:this.read(taskId,scene,request)};}catch(error){return {request,status:'failed',code:error instanceof Error&&error.message==='DSH_RESULT_PATH_INVALID'?'DSH_RESULT_PATH_INVALID':'SCOPE_DENIED'};}
    });guard();const value=z.json().parse({kind:'archived-result-batch',items,complete:items.every(item=>item.status==='ok'),note:'每页覆盖分别计算；成功回查不等于读完整份归档，也没有重执行原工具。'});
    if(Buffer.byteLength(JSON.stringify(value))>128000)throw new Error('DSH_RESULT_BATCH_CAPACITY');return value;
  }
}
