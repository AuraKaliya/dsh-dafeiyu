import {join} from 'node:path';
import {inspectDatabase,hasTables,metadataMatches,countPendingEvents} from '@dafeiyu/journal';
import type {StorageIdentity} from '@dafeiyu/journal';
import {BILI_APPLICATION_ID,BILI_SCHEMA_VERSION,BILI_TABLES} from './store.js';
export function inspectBiliStorage(file:string,identity?:StorageIdentity){return inspectDatabase(file,{applicationId:BILI_APPLICATION_ID,version:BILI_SCHEMA_VERSION,validate:db=>hasTables(db,BILI_TABLES),identity:(db,who)=>metadataMatches(db,'bili_metadata',who)},identity);}
export function pendingBiliEvents(directory:string){return countPendingEvents(join(directory,'bilibili.sqlite'),{bili_outbox:'delivered'});}
