import {DatabaseSync} from 'node:sqlite';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {inspectDatabase,matchesSchema,metadataMatches,countPendingEvents} from '@dafeiyu/journal';
import type {StorageIdentity} from '@dafeiyu/journal';
import {createStorageSchema} from './storage-schema.js';
import {RUNTIME_APPLICATION_ID,RUNTIME_SCHEMA_VERSION} from './runtime-store.js';

export function inspectRuntimeStorage(file:string,identity?:StorageIdentity){return inspectDatabase(file,{applicationId:RUNTIME_APPLICATION_ID,version:RUNTIME_SCHEMA_VERSION,validate:db=>matchesSchema(db,createStorageSchema),identity:(db,who)=>metadataMatches(db,'runtime_metadata',who),ownerTable:'runtime_ownership'},identity);}
export function pendingRuntimeEvents(directory:string){return countPendingEvents(join(directory,'runtime.sqlite'),{runtime_outbox:'delivered'});}
export function pendingProducerWork(directory:string,producer:string,deliverResults:boolean){
  const file=join(directory,'runtime.sqlite');if(!existsSync(file))return false;const db=new DatabaseSync(file,{readOnly:true});
  try{return !!db.prepare("SELECT 1 FROM runs r JOIN execution_requests q ON q.id=r.request_key LEFT JOIN native_deliveries d ON d.run_id=r.id WHERE q.producer=? AND (r.state IN ('accepted','queued','running','cancelling') OR d.state IN ('accepted','rendering','verifying','ready','sending') OR (r.state IN ('completed','waiting') AND d.id IS NULL AND ?=1)) LIMIT 1").get(producer,deliverResults?1:0);}finally{db.close();}
}
