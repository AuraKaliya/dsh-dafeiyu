import {inspectAdditiveMigration,migrateAdditionalTables} from '@dafeiyu/journal';
import type {MigrationIdentity,AdditiveMigration} from '@dafeiyu/journal';
import {ACTIVITY_APPLICATION_ID,ACTIVITY_SCHEMA_VERSION,createActivityStorageSchema} from './store.js';
import {createAdmissionSchema} from './admission.js';
const plan:AdditiveMigration={code:'ACTIVITY',applicationId:ACTIVITY_APPLICATION_ID,from:2,to:ACTIVITY_SCHEMA_VERSION,metadataTable:'activity_metadata',legacy:db=>createActivityStorageSchema(db,false),current:createActivityStorageSchema,upgrade:createAdmissionSchema};
export const inspectActivityMigration=(file:string,identity:MigrationIdentity)=>inspectAdditiveMigration(file,identity,plan);
export const migrateActivityStorage=(file:string,identity:MigrationIdentity,backup:string)=>migrateAdditionalTables(file,identity,backup,plan);
