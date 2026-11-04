import { DatabaseSync } from 'node:sqlite';
import { existsSync,mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { matchesSchema } from '@dafeiyu/journal';
import { ownerAlive } from '@dafeiyu/journal/owner-identity';
import { createStorageSchema,createStorageSchemaV2,createStorageSchemaV3,createStorageSchemaV4,addIntentReceiptsSchema,addActivitySharesSchema } from './storage-schema.js';
import {addModelUsageSchema} from './usage-ledger.js';
import { RUNTIME_APPLICATION_ID,RUNTIME_SCHEMA_VERSION,runtimeHash } from './runtime-store.js';
import type { RuntimeIdentity } from './runtime-store.js';

function contents(db:DatabaseSync,names?:readonly string[]){
  const tables=names??db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>String(row.name));
  return tables.map(table=>{const rows=db.prepare(`SELECT * FROM "${table.replaceAll('"','""')}"`).all();
    return {table,count:rows.length,hash:runtimeHash(rows.map(row=>runtimeHash(row)).sort())};});
}

/** Explicit additive upgrades preserve all prior execution and delivery evidence. */
export function inspectRuntimeMigration(file:string,identity:RuntimeIdentity){
  if(!existsSync(file))return {state:'missing' as const,version:0,identityMatches:false,integrity:false,activeOwner:false};
  const db=new DatabaseSync(file,{readOnly:true});try{
    const version=Number(db.prepare('PRAGMA user_version').get()?.user_version),app=Number(db.prepare('PRAGMA application_id').get()?.application_id);
    const integrity=db.prepare('PRAGMA integrity_check').get()?.integrity_check==='ok';
    const known=app===RUNTIME_APPLICATION_ID&&[1,2,3,4,RUNTIME_SCHEMA_VERSION].includes(version)&&matchesSchema(db,version===RUNTIME_SCHEMA_VERSION?createStorageSchema:version===4?createStorageSchemaV4:version===3?createStorageSchemaV3:createStorageSchemaV2);
    let identityMatches=false,activeOwner=false;
    if(known){const row=db.prepare('SELECT body FROM runtime_metadata WHERE singleton=1').get();identityMatches=!!row&&runtimeHash(JSON.parse(String(row.body)))===runtimeHash(identity);
      const owner=db.prepare('SELECT pid,nonce FROM runtime_ownership WHERE singleton=1').get();activeOwner=!!owner&&ownerAlive(Number(owner.pid),{nonce:String(owner.nonce)});}
    return {state:!known?'unsupported' as const:version===RUNTIME_SCHEMA_VERSION?'current' as const:'upgradable' as const,version,integrity,identityMatches,activeOwner};
  }finally{db.close();}
}
export function migrateRuntimeStorage(file:string,identity:RuntimeIdentity,backup:string){
  const before=inspectRuntimeMigration(file,identity);
  if(before.state==='missing')return {migrated:false,version:0,backup:null};
  if(!before.integrity||before.state==='unsupported')throw new Error('RUNTIME_MIGRATION_UNSUPPORTED');
  if(!before.identityMatches)throw new Error('RUNTIME_IDENTITY_MISMATCH');
  if(before.activeOwner)throw new Error('RUNTIME_ALREADY_OWNED');
  if(before.state==='current')return {migrated:false,version:before.version,backup:null};
  if(existsSync(backup))throw new Error('RUNTIME_BACKUP_EXISTS');mkdirSync(dirname(backup),{recursive:true});
  const db=new DatabaseSync(file);let verified:ReturnType<typeof contents>=[];try{
    const original=contents(db);
    db.prepare('VACUUM INTO ?').run(backup);
    const copied=inspectRuntimeMigration(backup,identity);if(!copied.integrity||!copied.identityMatches)throw new Error('RUNTIME_BACKUP_INVALID');
    const copy=new DatabaseSync(backup,{readOnly:true});try{if(runtimeHash(contents(copy))!==runtimeHash(original))throw new Error('RUNTIME_BACKUP_CONTENT_MISMATCH');}finally{copy.close();}
    db.exec('BEGIN IMMEDIATE');try{
      const current=inspectRuntimeMigration(file,identity);if(current.activeOwner||!current.identityMatches||current.version!==before.version)throw new Error('RUNTIME_MIGRATION_CHANGED');
      if(before.version<3)addIntentReceiptsSchema(db);if(before.version<4)addActivitySharesSchema(db);addModelUsageSchema(db);verified=contents(db,original.map(row=>row.table));
      if(runtimeHash(verified)!==runtimeHash(original))throw new Error('RUNTIME_MIGRATION_CONTENT_MISMATCH');
      db.exec(`PRAGMA user_version=${RUNTIME_SCHEMA_VERSION};COMMIT;`);
    }catch(error){db.exec('ROLLBACK');throw error;}
  }finally{db.close();}
  const after=inspectRuntimeMigration(file,identity);if(after.state!=='current'||!after.integrity||!after.identityMatches)throw new Error('RUNTIME_MIGRATION_VERIFY_FAILED');
  return {migrated:true,version:after.version,backup,verified};
}
