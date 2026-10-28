import {inspectDatabase,hasTables} from '@dafeiyu/journal';
import type {StorageIdentity} from '@dafeiyu/journal';
import {EXECUTOR_APPLICATION_ID,EXECUTOR_SCHEMA_VERSION} from './store.js';
import {ExecutorIdentitySchema,executorHash} from './types.js';
const tables=['executor_metadata','executor_clock','executor_jobs','executor_job_operations','executor_events','executor_receipts','executor_budget_links'];
export function inspectExecutorStorage(file:string,identity?:StorageIdentity){return inspectDatabase(file,{applicationId:EXECUTOR_APPLICATION_ID,version:EXECUTOR_SCHEMA_VERSION,
 validate:db=>{if(!hasTables(db,tables))return false;const names=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all().map(row=>String(row.name)));return ['executor_job_identity_immutable','executor_jobs_retain','executor_budget_identity_immutable','executor_budget_links_retain',...['executor_metadata','executor_job_operations','executor_events','executor_receipts'].flatMap(table=>[table+'_immutable',table+'_retain'])].every(name=>names.has(name));},
 identity:(db,who)=>{const row=db.prepare('SELECT body,body_hash FROM executor_metadata WHERE id=1').get(),body=ExecutorIdentitySchema.parse(JSON.parse(String(row?.body)));return body.agentId===who.agentId&&body.profileId===who.profileId&&executorHash(body)===row?.body_hash;}},identity);}
