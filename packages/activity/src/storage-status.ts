import {join} from 'node:path';
import {inspectDatabase,hasTables,metadataMatches,countPendingEvents} from '@dafeiyu/journal';
import type {StorageIdentity} from '@dafeiyu/journal';
import {ACTIVITY_APPLICATION_ID,ACTIVITY_SCHEMA_VERSION,ACTIVITY_TABLES} from './store.js';
export function inspectActivityStorage(file:string,identity?:StorageIdentity){return inspectDatabase(file,{applicationId:ACTIVITY_APPLICATION_ID,version:ACTIVITY_SCHEMA_VERSION,validate:db=>hasTables(db,ACTIVITY_TABLES),identity:(db,who)=>metadataMatches(db,'activity_metadata',who)},identity);}
export function pendingActivityEvents(directory:string){return countPendingEvents(join(directory,'activity.sqlite'),{activity_outbox:'acknowledged'});}
