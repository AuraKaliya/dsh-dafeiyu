import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {matchesSchema} from './storage-inspection.js';
import {ownerAlive} from './owner-identity.js';

export interface AdditiveMigration {
  readonly code:string;readonly applicationId:number;readonly from:number;readonly to:number;readonly metadataTable:string;
  legacy(db:DatabaseSync):void;current(db:DatabaseSync):void;upgrade(db:DatabaseSync):void;
}
export interface MigrationIdentity {readonly agentId:string;readonly profileId:string}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value,(_key,item)=>typeof item==='bigint'?String(item):item)).digest('hex');
function contents(db:DatabaseSync,tables?:readonly string[]){return (tables??db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>String(r.name))).map(table=>{
  const rows=db.prepare(`SELECT * FROM "${table.replaceAll('"','""')}"`).all();return {table,count:rows.length,hash:hash(rows.map(hash).sort())};});}
function liveRuntime(file:string){const runtime=join(dirname(file),'runtime.sqlite');if(!existsSync(runtime))return false;
  const db=new DatabaseSync(runtime,{readOnly:true});try{const row=db.prepare('SELECT pid,nonce FROM runtime_ownership WHERE singleton=1').get();return !!row&&ownerAlive(Number(row.pid),{nonce:String(row.nonce)});}finally{db.close();}}

export function inspectAdditiveMigration(file:string,identity:MigrationIdentity,plan:AdditiveMigration){
  if(!existsSync(file))return {state:'missing' as const,version:0,integrity:false,identityMatches:false,activeOwner:false};
  const db=new DatabaseSync(file,{readOnly:true});try{
    const version=Number(db.prepare('PRAGMA user_version').get()?.user_version),application=Number(db.prepare('PRAGMA application_id').get()?.application_id);
    const integrity=db.prepare('PRAGMA integrity_check').get()?.integrity_check==='ok';
    const known=application===plan.applicationId&&[plan.from,plan.to].includes(version)&&matchesSchema(db,version===plan.to?plan.current:plan.legacy);
    const row=known?db.prepare(`SELECT body FROM "${plan.metadataTable}" LIMIT 1`).get():null;
    const stored:unknown=row?JSON.parse(String(row.body)):null;
    const identityMatches=!!stored&&typeof stored==='object'&&'agentId'in stored&&'profileId'in stored&&stored.agentId===identity.agentId&&stored.profileId===identity.profileId;
    return {state:!known?'unsupported' as const:version===plan.to?'current' as const:'upgradable' as const,version,integrity,identityMatches,activeOwner:liveRuntime(file)};
  }finally{db.close();}
}

/** Caller also owns the installation directory lease. Existing row bytes and identities are preserved. */
export function migrateAdditionalTables(file:string,identity:MigrationIdentity,backup:string,plan:AdditiveMigration){
  const before=inspectAdditiveMigration(file,identity,plan),fail=(suffix:string):never=>{throw new Error(plan.code+'_'+suffix);};
  if(before.state==='missing')return {migrated:false,version:0,backup:null,verified:[]};
  if(!before.integrity||before.state==='unsupported')fail('MIGRATION_UNSUPPORTED');if(!before.identityMatches)fail('IDENTITY_MISMATCH');if(before.activeOwner)fail('ALREADY_OWNED');
  if(before.state==='current')return {migrated:false,version:before.version,backup:null,verified:[]};
  if(existsSync(backup))fail('BACKUP_EXISTS');mkdirSync(dirname(backup),{recursive:true});
  const db=new DatabaseSync(file);let verified:ReturnType<typeof contents>=[];
  try{const original=contents(db);db.prepare('VACUUM INTO ?').run(backup);
    const copy=new DatabaseSync(backup,{readOnly:true});try{if(copy.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok'||hash(contents(copy))!==hash(original))fail('BACKUP_INVALID');}finally{copy.close();}
    db.exec('BEGIN IMMEDIATE');try{const current=inspectAdditiveMigration(file,identity,plan);if(current.version!==before.version||current.activeOwner||!current.identityMatches)fail('MIGRATION_CHANGED');
      plan.upgrade(db);verified=contents(db,original.map(row=>row.table));if(hash(verified)!==hash(original))fail('MIGRATION_CONTENT_MISMATCH');
      if(!matchesSchema(db,plan.current))fail('MIGRATION_SHAPE_MISMATCH');db.exec(`PRAGMA user_version=${plan.to};COMMIT;`);
    }catch(error){db.exec('ROLLBACK');throw error;}
  }finally{db.close();}
  const after=inspectAdditiveMigration(file,identity,plan);if(after.state!=='current'||!after.identityMatches||!after.integrity)fail('MIGRATION_VERIFY_FAILED');
  return {migrated:true,version:after.version,backup,verified};
}
