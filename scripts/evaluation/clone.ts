import { DatabaseSync,backup } from 'node:sqlite';
import { readdir,mkdir,lstat,copyFile,readFile,realpath } from 'node:fs/promises';
import { constants,existsSync } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { join,relative,resolve,isAbsolute,sep } from 'node:path';
import { createHash } from 'node:crypto';
import { sha256 } from './catalog.ts';
const inside=(p:string,root:string)=>{const delta=relative(root,p);return !!delta&&delta!=='..'&&!delta.startsWith('..'+sep)&&!isAbsolute(delta);};
const quote=(s:string)=>'"'+s.replaceAll('"','""')+'"';
export function sameEvaluationFile(left:Pick<BigIntStats,'dev'|'ino'>,right:Pick<BigIntStats,'dev'|'ino'>):boolean{return left.dev===right.dev&&left.ino===right.ino;}
export function databaseFingerprint(file:string){const db=new DatabaseSync(file,{readOnly:true});try{if(Object.values(db.prepare('PRAGMA quick_check').get()??{})[0]!=='ok')throw new Error('EVALUATION_DATABASE_INVALID');
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r=>String(r.name));for(const name of ['ownership','runtime_ownership'])if(tables.includes(name)&&db.prepare(`SELECT 1 FROM ${quote(name)} LIMIT 1`).get())throw new Error('EVALUATION_BASELINE_OWNED');
  const digest=createHash('sha256');digest.update(JSON.stringify([db.prepare('PRAGMA user_version').get(),db.prepare('PRAGMA application_id').get(),db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all()]));
  for(const table of tables){digest.update(table);const stmt=db.prepare(`SELECT * FROM ${quote(table)} ORDER BY rowid`);stmt.setReadBigInts(true);for(const row of stmt.iterate())digest.update(JSON.stringify(row,(_k,v:unknown)=>typeof v==='bigint'?{integer:v.toString()}:v instanceof Uint8Array?{bytes:Buffer.from(v).toString('base64')}:v)+'\n');}return digest.digest('hex');
}finally{db.close();}}
export interface CloneFile {relative:string;kind:'sqlite'|'file';sourceHash:string;hash:string;logicalHash:string;bytes:number}
/** Closed profiles only. SQLite uses its backup API; other files are copied exclusively, never linked. */
export async function cloneEvaluationProfile(workspaceRoot:string,sourceRoot:string,targetRoot:string){const base=await realpath(workspaceRoot),source=resolve(sourceRoot),target=resolve(targetRoot);if(!inside(source,base)||!inside(target,base)||inside(target,source)||inside(source,target)||source===target||existsSync(target))throw new Error('EVALUATION_CLONE_PATH_DENIED');
  const sourceActual=await realpath(source);if(sourceActual!==source||!inside(sourceActual,base)||(await lstat(source)).isSymbolicLink())throw new Error('EVALUATION_LINK_DENIED');let cursor=target;while(cursor!==base){if(existsSync(cursor)&&(await lstat(cursor)).isSymbolicLink())throw new Error('EVALUATION_LINK_DENIED');const parent=resolve(cursor,'..');if(parent===cursor)throw new Error('EVALUATION_CLONE_PATH_DENIED');cursor=parent;}
  const entries:{relative:string;bytes:number}[]=[];let total=0;async function scan(folder:string){for(const entry of await readdir(folder,{withFileTypes:true})){const path=join(folder,entry.name),info=await lstat(path);if(info.isSymbolicLink())throw new Error('EVALUATION_LINK_DENIED');if(info.isDirectory())await scan(path);else if(info.isFile()){
    if(/-wal$/.test(entry.name)){if(info.size)throw new Error('EVALUATION_BASELINE_NOT_QUIESCENT');continue;}if(/-shm$/.test(entry.name))continue;total+=info.size;if(info.size>128*1024**2||total>512*1024**2||entries.length>=10000)throw new Error('EVALUATION_CLONE_SIZE_LIMIT');entries.push({relative:relative(source,path).split(sep).join('/'),bytes:info.size});}else throw new Error('EVALUATION_FILE_TYPE_DENIED');}}
  await scan(source);await mkdir(target,{recursive:true});const files:CloneFile[]=[];
  for(const entry of entries.sort((a,b)=>a.relative.localeCompare(b.relative))){const from=join(source,...entry.relative.split('/')),to=join(target,...entry.relative.split('/'));await mkdir(resolve(to,'..'),{recursive:true});const sourceHash=sha256(await readFile(from));let logicalHash:string,kind:'sqlite'|'file';
    if(entry.relative.endsWith('.sqlite')){kind='sqlite';logicalHash=databaseFingerprint(from);const db=new DatabaseSync(from,{readOnly:true});try{await backup(db,to);}finally{db.close();}if(databaseFingerprint(to)!==logicalHash)throw new Error('EVALUATION_BACKUP_MISMATCH');}else{kind='file';logicalHash=sourceHash;await copyFile(from,to,constants.COPYFILE_EXCL);}
    const actual=await lstat(to,{bigint:true}),original=await lstat(from,{bigint:true});if(actual.isSymbolicLink()||sameEvaluationFile(actual,original))throw new Error('EVALUATION_HARDLINK_DENIED');const hash=sha256(await readFile(to));if(kind==='file'&&hash!==sourceHash||sha256(await readFile(from))!==sourceHash)throw new Error('EVALUATION_BASELINE_CHANGED');files.push({...entry,kind,sourceHash,hash,logicalHash});}
  return {files,logicalHash:sha256(JSON.stringify(files.map(f=>({relative:f.relative,logicalHash:f.logicalHash})))),bytes:files.reduce((n,f)=>n+f.bytes,0)};
}
