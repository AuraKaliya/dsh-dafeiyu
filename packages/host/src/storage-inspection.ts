import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { inspectJournal } from '@dafeiyu/journal';
import { RUNTIME_APPLICATION_ID, RuntimeIdentitySchema } from '@dafeiyu/core/runtime-store';
import type { RuntimeIdentity } from '@dafeiyu/core/runtime-store';
import { MEMORY_APPLICATION_ID, PERSONA_ADOPTION_TABLES, verifyPersonaAdoptionSchema } from '@dafeiyu/memory/store';
import { inspectQqSchema } from '@dafeiyu/qq';
import { ACTIVITY_APPLICATION_ID,ACTIVITY_SCHEMA_VERSION,ACTIVITY_TABLES } from '@dafeiyu/activity/store';
import { MEDIA_APPLICATION_ID,MEDIA_TABLES } from '@dafeiyu/media';
import { BILI_APPLICATION_ID,BILI_TABLES } from '@dafeiyu/bilibili';
import { EXECUTOR_APPLICATION_ID,EXECUTOR_SCHEMA_VERSION } from '@dafeiyu/server-executor/store';
import { ExecutorIdentitySchema,executorHash } from '@dafeiyu/server-executor/types';
import { BILI_OWNER_APPLICATION_ID,BILI_OWNER_SCHEMA_VERSION,BILI_OWNER_TABLES,BiliOwnerIdentitySchema,inspectBiliOwnerStorage } from '@dafeiyu/bilibili/channel';

export type StorageKind='journal'|'memory'|'runtime'|'delivery'|'analysis'|'working'|'feedback'|'retrieval'|'qq'|'query'|'activity'|'media'|'bilibili'|'executor'|'bili-owner';
const definitions:Record<Exclude<StorageKind,'journal'|'qq'>,{app:number;versions:readonly number[];tables:readonly string[]}>= {
  query:{app:1146308689,versions:[8],tables:['search_state','persisted_sessions','persisted_docs']},
  memory:{app:MEMORY_APPLICATION_ID,versions:[1,2,3,4,5,6,7,8,9,10,11,12,13],tables:['memory_items','memory_revisions','dependencies','outbox','requests']},
  runtime:{app:RUNTIME_APPLICATION_ID,versions:[1,2,3,4],tables:['runtime_metadata','runtime_ownership','execution_requests','runs','run_operations','runtime_outbox']},
  delivery:{app:0x44464433,versions:[1],tables:['deliveries','events']},
  analysis:{app:0x44464131,versions:[1],tables:['jobs','ownership','audit_outbox']},
  working:{app:0x44465731,versions:[1],tables:['states','revisions','requests','outbox']},
  feedback:{app:0x44464631,versions:[1],tables:['archives','states','requests','events','outbox']},
  activity:{app:ACTIVITY_APPLICATION_ID,versions:[ACTIVITY_SCHEMA_VERSION],tables:ACTIVITY_TABLES},
  media:{app:MEDIA_APPLICATION_ID,versions:[1,2],tables:MEDIA_TABLES.filter(t=>!t.startsWith('media_reply_'))},
  bilibili:{app:BILI_APPLICATION_ID,versions:[1,2],tables:BILI_TABLES.filter(t=>!t.startsWith('bili_http_'))},
  executor:{app:EXECUTOR_APPLICATION_ID,versions:[EXECUTOR_SCHEMA_VERSION],tables:['executor_metadata','executor_clock','executor_jobs','executor_job_operations','executor_events','executor_receipts','executor_budget_links']},
  'bili-owner':{app:BILI_OWNER_APPLICATION_ID,versions:[BILI_OWNER_SCHEMA_VERSION],tables:BILI_OWNER_TABLES},
  retrieval:{app:0x44465232,versions:[1,2],tables:['chunks','snapshots','vector_cache']},
};
export interface StorageInspection {kind:StorageKind;exists:boolean;version:number;applicationId:number;supported:boolean;activeOwner:boolean;integrity:boolean;identityMatches:boolean}

/** Metadata and integrity only. No service constructors, migrations or domain recovery are run. */
export function inspectStorage(file:string,kind:StorageKind,identity?:RuntimeIdentity):StorageInspection {
  if(!existsSync(file))return {kind,exists:false,version:0,applicationId:0,supported:true,activeOwner:false,integrity:true,identityMatches:true};
  let db:DatabaseSync|undefined;
  try{
    db=new DatabaseSync(file,{readOnly:true});
    const version=Number(db.prepare('PRAGMA user_version').get()?.user_version),applicationId=Number(db.prepare('PRAGMA application_id').get()?.application_id);
    const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>String(row.name)));
    const definition=kind==='journal'||kind==='qq'?null:definitions[kind];
    let supported=definition?applicationId===definition.app&&definition.versions.includes(version)&&definition.tables.every(table=>tables.has(table)):true;
    let activeOwner=false;
    if(kind==='qq')supported=inspectQqSchema(db).supported;
    if(kind==='journal'){const journal=inspectJournal(file);supported=journal.supported;activeOwner=journal.activeOwner;}
    else {
      const ownerTable=tables.has('runtime_ownership')?'runtime_ownership':tables.has('ownership')?'ownership':null;
      if(ownerTable){const owner=db.prepare(`SELECT pid FROM ${ownerTable} WHERE singleton=1`).get();if(owner){activeOwner=true;try{process.kill(Number(owner.pid),0);}catch(error){if(error instanceof Error&&'code'in error&&error.code==='ESRCH')activeOwner=false;}}}
    }
    let identityMatches=true;
    if(kind==='runtime'&&supported&&identity){const row=db.prepare('SELECT body FROM runtime_metadata WHERE singleton=1').get();
      const stored=RuntimeIdentitySchema.safeParse(JSON.parse(String(row?.body)));identityMatches=stored.success&&stored.data.agentId===identity.agentId&&stored.data.profileId===identity.profileId;}
    if(kind==='activity'&&supported&&identity){const row=db.prepare('SELECT body FROM activity_metadata WHERE id=1').get();const stored=RuntimeIdentitySchema.safeParse(JSON.parse(String(row?.body)));
      identityMatches=stored.success&&stored.data.agentId===identity.agentId&&stored.data.profileId===identity.profileId;}
    if(kind==='media'&&supported&&identity){const row=db.prepare('SELECT body FROM media_metadata WHERE id=1').get();const stored=RuntimeIdentitySchema.safeParse(JSON.parse(String(row?.body)));identityMatches=stored.success&&stored.data.agentId===identity.agentId&&stored.data.profileId===identity.profileId;}
    if(kind==='bilibili'&&supported){if(version>=2)supported=BILI_TABLES.every(t=>tables.has(t));if(identity){const row=db.prepare('SELECT body FROM bili_metadata WHERE id=1').get();const stored=RuntimeIdentitySchema.safeParse(JSON.parse(String(row?.body)));identityMatches=stored.success&&stored.data.agentId===identity.agentId&&stored.data.profileId===identity.profileId;}}
    if(kind==='bili-owner'&&supported){const row=db.prepare('SELECT body FROM bili_owner_binding WHERE id=1').get(),stored=BiliOwnerIdentitySchema.parse(JSON.parse(String(row?.body)));
      const inspection=inspectBiliOwnerStorage(file,identity?{...identity,accountUid:stored.accountUid,ownerUid:stored.ownerUid}:stored);
      supported=inspection.supported;identityMatches=inspection.identityMatches;}
    if(kind==='executor'&&supported){
      const row=db.prepare('SELECT body,body_hash FROM executor_metadata WHERE id=1').get(),stored=ExecutorIdentitySchema.safeParse(JSON.parse(String(row?.body)));
      identityMatches=stored.success&&executorHash(stored.data)===row?.body_hash&&(!identity||stored.data.agentId===identity.agentId&&stored.data.profileId===identity.profileId);
      for(const [table,columns]of Object.entries({executor_jobs:'id,scope_key,intent_version,request_id,fingerprint,body,body_hash,state,version,nonce_hash,process,cancel_requested,created_at,updated_at',
        executor_job_operations:'operation_id,job_id,run_id,fingerprint,body,body_hash',executor_events:'seq,id,job_id,version,type,body,body_hash',executor_receipts:'id,job_id,body,body_hash',
        executor_budget_links:'job_id,call_id,reservation_id,request_hash,state,settlement_hash',executor_clock:'id,last_seen'}))db.prepare(`SELECT ${columns} FROM ${table} LIMIT 0`).all();
      const triggers=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all().map(value=>String(value.name)));
      supported=['executor_job_identity_immutable','executor_jobs_retain','executor_budget_identity_immutable','executor_budget_links_retain',
        ...['executor_metadata','executor_job_operations','executor_events','executor_receipts'].flatMap(table=>[table+'_immutable',table+'_retain'])].every(name=>triggers.has(name));
    }
    if(kind==='media'&&supported&&version>=2)supported=MEDIA_TABLES.every(t=>tables.has(t));
    if(kind==='runtime'&&supported&&version>=2)supported=tables.has('run_persona_manifests');
    if(kind==='runtime'&&supported&&version>=3)supported=tables.has('native_deliveries');
    if(kind==='memory'&&supported){
      const stages:Record<number,readonly string[]>={2:['memory_boundaries','memory_schema_migrations'],3:['observation_sources','observation_activities','observation_contributions','observation_source_requests'],
        4:['task_workspaces','task_revisions','task_members','task_selections','task_links','task_jobs','task_slots','task_requests','task_observations'],
        5:['task_memory_policies','task_memory_policy_revisions','task_memory_grants','task_memory_requests','task_memory_hits'],6:['expression_policies','expression_policy_revisions','expression_requests','expression_packets','expression_jobs'],
        7:['execution_scopes','execution_sources','execution_observations','execution_contributions','growth_selections','growth_revisions','growth_requests','task_execution_results','execution_memory_requests','execution_memory_outbox'],
        8:['persona_candidates','persona_candidate_revisions','persona_profiles','persona_profile_revisions','persona_dependencies','persona_requests','persona_outbox','continuity_checkpoints','task_intent_events'],
        9:['capability_observations','capability_selections'],10:['native_expression_packets'],
        11:['experience_items','experience_revisions','experience_relations','maintenance_events','maintenance_requests','maintenance_receipts','maintenance_watermarks'],
        12:PERSONA_ADOPTION_TABLES};
      supported=Object.entries(stages).every(([stage,names])=>version<Number(stage)||names.every(name=>tables.has(name)));
      if(supported&&version>=13){try{for(const table of ['recent_self_states','recent_state_revisions','recent_state_requests','recent_state_publications'])db.prepare(`SELECT * FROM ${table} LIMIT 0`).all();}catch{supported=false;}}
      if(supported&&version>=12){try{verifyPersonaAdoptionSchema(db);}catch{supported=false;}}
    }
    const integrity=Object.values(db.prepare('PRAGMA quick_check').get()??{})[0]==='ok'&&db.prepare('PRAGMA foreign_key_check').get()===undefined;
    return {kind,exists:true,version,applicationId,supported,activeOwner,integrity,identityMatches};
  }catch{return {kind,exists:true,version:-1,applicationId:-1,supported:false,activeOwner:false,integrity:false,identityMatches:false};}
  finally{db?.close();}
}
