import { createHash } from 'node:crypto';
import { existsSync,lstatSync,realpathSync } from 'node:fs';
import { isAbsolute,join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { redactText } from '@dafeiyu/contracts';
import type { Json } from '@dafeiyu/contracts';

const localPath=z.string().min(1).max(4000).refine(value=>isAbsolute(value)&&!value.includes('\0')&&!/^\\\\|^\/\//.test(value));
export const ArchiveLocationSchema=z.strictObject({root:localPath,database:localPath});
export type ArchiveLocation=z.infer<typeof ArchiveLocationSchema>;
export interface FileIdentity {readonly dev:string;readonly ino:string}
export interface ArchiveIdentity {readonly root:FileIdentity;readonly directory:FileIdentity;readonly database:FileIdentity}
export function check(value:unknown,code:string):asserts value{if(!value)throw new Error(code);}
export const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
export const samePath=(a:string,b:string)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
export function archiveIdentity(raw:ArchiveLocation):ArchiveIdentity{
  const location=ArchiveLocationSchema.parse(raw),root=resolve(location.root),directory=join(root,'历史记录'),database=join(directory,'history.sqlite');
  check(samePath(location.root,root)&&samePath(location.database,database),'ARCHIVE_PATH_INVALID');
  const identities=[root,directory,database].map((file,index)=>{
    check(existsSync(file),'ARCHIVE_MISSING');const stat=lstatSync(file,{bigint:true});
    check(!stat.isSymbolicLink()&&samePath(realpathSync.native(file),file)&&(index===2?stat.isFile():stat.isDirectory()),'ARCHIVE_PATH_INVALID');
    check(index!==2||stat.size>=4096n,'ARCHIVE_TRUNCATED');check(index!==2||stat.nlink===1n,'ARCHIVE_PATH_INVALID');
    return {dev:stat.dev.toString(),ino:stat.ino.toString()};
  });
  return {root:identities[0]!,directory:identities[1]!,database:identities[2]!};
}
export function assertArchiveIdentity(location:ArchiveLocation,identity:ArchiveIdentity):void{check(JSON.stringify(archiveIdentity(location))===JSON.stringify(identity),'ARCHIVE_PATH_CHANGED');}
/** String URI is preserved by Node's ValidateDatabasePath; rw forbids creation even after a preflight race. */
export function existingArchiveUri(database:string,write:boolean):string{const uri=pathToFileURL(database);uri.searchParams.set('mode',write?'rw':'ro');return uri.href;}

const hidden=new Set(['reasoning','thinking','chainofthought','stream','replay','replaystate','signature']);
const normalize=(key:string)=>key.replace(/[_\s-]/g,'').toLowerCase();
const sensitive=/^(?:password|passwd|pwd|secret|clientsecret|apikey|apitoken|token|authtoken|accesstoken|refreshtoken|idtoken|authorization|proxyauthorization|cookie|setcookie|credentials|密码|口令)$/i;
export function sanitizeText(text:string,secrets:readonly string[]):string{let result=redactText(text).value;for(const secret of secrets)if(secret.length>=12)result=result.split(secret).join('[REDACTED]');return result;}
/** A structural visible-content filter, not a permission grant or a detector for all private prose. */
export function sanitizeJson(raw:unknown,secrets:readonly string[]):Json{
  const input=z.json().parse(raw);check(Buffer.byteLength(JSON.stringify(input))<=262144,'ARCHIVE_INPUT_TOO_LARGE');
  const visit=(value:Json,depth:number):Json=>{
    check(depth<=32,'ARCHIVE_INPUT_TOO_DEEP');
    if(typeof value==='string')return sanitizeText(value,secrets);
    if(Array.isArray(value))return value.filter(item=>!isHiddenBlock(item)).map(item=>visit(item,depth+1));
    if(value&&typeof value==='object'){
      if(isHiddenBlock(value))return null;
      return Object.fromEntries(Object.keys(value).sort().filter(key=>!hidden.has(normalize(key))).map(key=>[key,sensitive.test(normalize(key))?'[REDACTED]':visit(value[key]!,depth+1)]));
    }
    return value;
  };
  return visit(input,0);
}
function isHiddenBlock(value:Json):boolean{return !!value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.type==='string'&&hidden.has(normalize(value.type));}
export function objectValue(value:unknown):Record<string,Json>{return z.record(z.string(),z.json()).parse(value);}
export function freeze<T>(value:T):T{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
