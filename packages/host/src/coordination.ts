import { DatabaseSync } from 'node:sqlite';
import { existsSync,mkdirSync } from 'node:fs';
import { dirname,join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { overlap } from './paths.js';
import type { HostResource } from './paths.js';

export const coordinationFile=()=>join(homedir(),'.dafeiyu','host-coordination.sqlite');
const resourceSchema=z.strictObject({path:z.string(),identity:z.string(),kind:z.enum(['directory','file'])});
const ownerSchema=z.strictObject({schemaVersion:z.literal(1),instanceId:z.uuid(),pid:z.number().int().positive(),profileId:z.string(),agentId:z.string(),resources:z.array(resourceSchema),startedAt:z.iso.datetime()});
export type HostOwner=z.infer<typeof ownerSchema>;
const app=0x44464831;
export function processAlive(pid:number){try{process.kill(pid,0);return true;}catch(error){return !(error instanceof Error&&'code'in error&&error.code==='ESRCH');}}
function check(db:DatabaseSync){if(db.prepare('PRAGMA application_id').get()?.application_id!==app||db.prepare('PRAGMA user_version').get()?.user_version!==1)throw new Error('HOST_COORDINATION_UNSUPPORTED');db.prepare('SELECT instance_id,body FROM owners LIMIT 0').all();}
export function owners(file=coordinationFile()):HostOwner[]{if(!existsSync(file))return [];const db=new DatabaseSync(file,{readOnly:true});try{check(db);return db.prepare('SELECT body FROM owners').all().map(row=>ownerSchema.parse(JSON.parse(String(row.body))));}finally{db.close();}}
export function conflict(resources:readonly HostResource[],file?:string){return owners(file).find(owner=>processAlive(owner.pid)&&owner.resources.some(a=>resources.some(b=>overlap(a,b))));}
export interface HostLease {readonly owner:HostOwner;release():void}
/** Serializes competing claims, including directory aliases and ancestor overlaps, without deleting data. */
export function claim(resources:readonly HostResource[],identity:{profileId:string;agentId:string},file=coordinationFile()):HostLease{
  mkdirSync(dirname(file),{recursive:true});const db=new DatabaseSync(file);let acquired=false;
  const owner=ownerSchema.parse({schemaVersion:1,instanceId:randomUUID(),pid:process.pid,...identity,resources,startedAt:new Date().toISOString()});
  try{db.exec('PRAGMA busy_timeout=5000;BEGIN IMMEDIATE');
    try{if(db.prepare('PRAGMA user_version').get()?.user_version===0&&db.prepare('PRAGMA application_id').get()?.application_id===0&&db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get()?.n===0){
      db.exec(`CREATE TABLE owners(instance_id TEXT PRIMARY KEY,body TEXT NOT NULL);PRAGMA application_id=${app};PRAGMA user_version=1;`);}
      check(db);for(const row of db.prepare('SELECT instance_id,body FROM owners').all()){
        const current=ownerSchema.parse(JSON.parse(String(row.body)));if(!processAlive(current.pid))db.prepare('DELETE FROM owners WHERE instance_id=?').run(row.instance_id!);
        else if(current.resources.some(a=>resources.some(b=>overlap(a,b))))throw new Error('HOST_ALREADY_OWNED');}
      db.prepare('INSERT INTO owners VALUES(?,?)').run(owner.instanceId,JSON.stringify(owner));db.exec('COMMIT');acquired=true;
    }catch(error){db.exec('ROLLBACK');throw error;}
  }finally{db.close();}
  return {owner,release(){if(!acquired)return;const db=new DatabaseSync(file);try{check(db);db.prepare('DELETE FROM owners WHERE instance_id=? AND json_extract(body,\'$.pid\')=?').run(owner.instanceId,process.pid);acquired=false;}finally{db.close();}}};
}
