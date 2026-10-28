import {inspectDatabase,hasTables,inspectJournalStorage} from '@dafeiyu/journal';
import type {DatabaseInspection,StorageIdentity} from '@dafeiyu/journal';
import {inspectRuntimeStorage} from '@dafeiyu/core';
import {inspectMemoryStorage} from '@dafeiyu/memory';
import {inspectQqStorage} from '@dafeiyu/qq';
import {inspectActivityStorage} from '@dafeiyu/activity';
import {inspectMediaStorage} from '@dafeiyu/media';
import {inspectBiliStorage} from '@dafeiyu/bilibili';
import {inspectOwnerStorage} from '@dafeiyu/bilibili/channel';
import {inspectExecutorStorage} from '@dafeiyu/server-executor';
export type StorageKind='journal'|'memory'|'runtime'|'analysis'|'working'|'retrieval'|'qq'|'query'|'activity'|'media'|'bilibili'|'executor'|'bili-owner';
export interface StorageInspection extends DatabaseInspection {kind:StorageKind}
const inspectors:Record<StorageKind,(file:string,identity?:StorageIdentity)=>DatabaseInspection>={
 journal:inspectJournalStorage,runtime:inspectRuntimeStorage,memory:(file,who)=>inspectMemoryStorage(file,'memory',who),analysis:file=>inspectMemoryStorage(file,'analysis'),working:file=>inspectMemoryStorage(file,'working'),retrieval:file=>inspectMemoryStorage(file,'retrieval'),
 qq:inspectQqStorage,activity:inspectActivityStorage,media:inspectMediaStorage,bilibili:inspectBiliStorage,executor:inspectExecutorStorage,'bili-owner':inspectOwnerStorage,
 query:file=>inspectDatabase(file,{applicationId:1146308689,version:8,validate:db=>hasTables(db,['search_state','persisted_sessions','persisted_docs'])})
};
/** The host routes inspection to storage owners; it knows no business table or column layout. */
export function inspectStorage(file:string,kind:StorageKind,identity?:StorageIdentity):StorageInspection{return {kind,...inspectors[kind](file,identity)};}
