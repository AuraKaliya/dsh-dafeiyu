import {inspectAdditiveMigration,migrateAdditionalTables} from '@dafeiyu/journal';
import type {MigrationIdentity,AdditiveMigration} from '@dafeiyu/journal';
import {MEDIA_APPLICATION_ID,MEDIA_SCHEMA_VERSION,createMediaStorageSchema} from './store.js';
import {createMediaDiagnosticSchema} from './diagnostics.js';
import {createMediaRecoverySchema} from './recovery.js';
import {existsSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
function planFor(file:string):AdditiveMigration{
  let version=0;if(existsSync(file)){const db=new DatabaseSync(file,{readOnly:true});try{version=Number(db.prepare('PRAGMA user_version').get()?.user_version);}finally{db.close();}}
  const from=version===2?2:3;
  return {code:'MEDIA',applicationId:MEDIA_APPLICATION_ID,from,to:MEDIA_SCHEMA_VERSION,metadataTable:'media_metadata',legacy:db=>createMediaStorageSchema(db,from===3,false),current:createMediaStorageSchema,
    upgrade:db=>{if(from===2)createMediaDiagnosticSchema(db);createMediaRecoverySchema(db);
      db.exec("INSERT INTO media_failure_scopes SELECT json_extract(body,'$.diagnosticId'),key,generation FROM media_health WHERE json_extract(body,'$.diagnosticId') IN (SELECT id FROM media_diagnostics)");}};
}
export const inspectMediaMigration=(file:string,identity:MigrationIdentity)=>inspectAdditiveMigration(file,identity,planFor(file));
export const migrateMediaStorage=(file:string,identity:MigrationIdentity,backup:string)=>migrateAdditionalTables(file,identity,backup,planFor(file));
