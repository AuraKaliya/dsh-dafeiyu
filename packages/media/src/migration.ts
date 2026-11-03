import {inspectAdditiveMigration,migrateAdditionalTables} from '@dafeiyu/journal';
import type {MigrationIdentity,AdditiveMigration} from '@dafeiyu/journal';
import {MEDIA_APPLICATION_ID,MEDIA_SCHEMA_VERSION,createMediaStorageSchema} from './store.js';
import {createMediaDiagnosticSchema} from './diagnostics.js';
const plan:AdditiveMigration={code:'MEDIA',applicationId:MEDIA_APPLICATION_ID,from:2,to:MEDIA_SCHEMA_VERSION,metadataTable:'media_metadata',legacy:db=>createMediaStorageSchema(db,false),current:createMediaStorageSchema,upgrade:createMediaDiagnosticSchema};
export const inspectMediaMigration=(file:string,identity:MigrationIdentity)=>inspectAdditiveMigration(file,identity,plan);
export const migrateMediaStorage=(file:string,identity:MigrationIdentity,backup:string)=>migrateAdditionalTables(file,identity,backup,plan);
