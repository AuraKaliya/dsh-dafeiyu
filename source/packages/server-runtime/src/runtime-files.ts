import { createHash } from 'node:crypto';
import { lstatSync,readFileSync,realpathSync } from 'node:fs';
import { isAbsolute,join,parse,relative,resolve,sep } from 'node:path';
import { z } from 'zod';

export const RuntimeHashSchema=z.string().regex(/^[a-f0-9]{64}$/);
export const RuntimePathSchema=z.string().min(1).max(2000).refine(value=>isAbsolute(value)&&!/^[/\\]{2}/.test(value)&&!value.split(/[/\\]/).some(part=>part==='..'||part==='.'),'An absolute local path is required');
export function runtimeCheck(value:unknown,code:string):asserts value {if(!value)throw new Error(code);}
function canonical(value:unknown):unknown {
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,part])=>[key,canonical(part)]));
  return value;
}
export const runtimeDigest=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const runtimeBytesHash=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');
export function runtimeFreeze<T>(value:T):T {if(value&&typeof value==='object'){Object.values(value).forEach(runtimeFreeze);Object.freeze(value);}return value;}
const normalized=(path:string)=>process.platform==='win32'?resolve(path).toLowerCase():resolve(path);
export function runtimePathIdentity(raw:string,kind:'directory'|'file'):string {
  const absolute=resolve(RuntimePathSchema.parse(raw)),root=parse(absolute).root;let current=root;
  for(const part of relative(root,absolute).split(sep).filter(Boolean)){
    current=join(current,part);const entry=lstatSync(current,{bigint:true});runtimeCheck(!entry.isSymbolicLink(),'RUNTIME_PATH_LINK_DENIED');
    if(current!==absolute)runtimeCheck(entry.isDirectory(),'RUNTIME_PATH_INVALID');
  }
  const entry=lstatSync(absolute,{bigint:true});runtimeCheck(kind==='directory'?entry.isDirectory():entry.isFile()&&entry.nlink===1n,'RUNTIME_PATH_INVALID');
  runtimeCheck(normalized(realpathSync.native(absolute))===normalized(absolute),'RUNTIME_PATH_LINK_DENIED');
  return runtimeDigest({path:normalized(absolute),dev:String(entry.dev),ino:String(entry.ino)});
}
export function readRuntimeJson<T>(file:string,schema:z.ZodType<T>,expectedHash?:string):T {
  const identity=runtimePathIdentity(file,'file'),info=lstatSync(file,{bigint:true});runtimeCheck(info.size>0n&&info.size<=262144n,'RUNTIME_DOCUMENT_INVALID');
  const bytes=readFileSync(file);runtimeCheck(runtimePathIdentity(file,'file')===identity&&(expectedHash===undefined||runtimeBytesHash(bytes)===expectedHash),'RUNTIME_FILE_CHANGED');
  try{return schema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown);}catch{throw new Error('RUNTIME_DOCUMENT_INVALID');}
}
