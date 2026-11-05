import {inspectAdditiveMigration,migrateAdditionalTables} from '@dafeiyu/journal';
import type {MigrationIdentity,AdditiveMigration} from '@dafeiyu/journal';
import {ACTIVITY_APPLICATION_ID,ACTIVITY_SCHEMA_VERSION,createActivityStorageSchema} from './store.js';
import {createAdmissionSchema} from './admission.js';
import {createRecoverySchema} from './recovery-store.js';
import {existsSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
function planFor(file:string):AdditiveMigration{
  let version=0;if(existsSync(file)){const db=new DatabaseSync(file,{readOnly:true});try{version=Number(db.prepare('PRAGMA user_version').get()?.user_version);}finally{db.close();}}
  const from=version===2?2:3;
  return {code:'ACTIVITY',applicationId:ACTIVITY_APPLICATION_ID,from,to:ACTIVITY_SCHEMA_VERSION,metadataTable:'activity_metadata',
    legacy:db=>createActivityStorageSchema(db,from===3,false),current:createActivityStorageSchema,
    upgrade:db=>{if(from===2)createAdmissionSchema(db);createRecoverySchema(db);}};
}
export const inspectActivityMigration=(file:string,identity:MigrationIdentity)=>inspectAdditiveMigration(file,identity,planFor(file));
export const migrateActivityStorage=(file:string,identity:MigrationIdentity,backup:string)=>migrateAdditionalTables(file,identity,backup,planFor(file));
