import {join} from 'node:path';
import {inspectDatabase,hasTables,metadataMatches,countPendingEvents} from '@dafeiyu/journal';
import type {StorageIdentity} from '@dafeiyu/journal';
import {MEDIA_APPLICATION_ID,MEDIA_SCHEMA_VERSION,MEDIA_TABLES} from './store.js';
export function inspectMediaStorage(file:string,identity?:StorageIdentity){return inspectDatabase(file,{applicationId:MEDIA_APPLICATION_ID,version:MEDIA_SCHEMA_VERSION,validate:db=>hasTables(db,MEDIA_TABLES),identity:(db,who)=>metadataMatches(db,'media_metadata',who)},identity);}
export function pendingMediaEvents(directory:string){return countPendingEvents(join(directory,'media.sqlite'),{media_outbox:'delivered'});}
