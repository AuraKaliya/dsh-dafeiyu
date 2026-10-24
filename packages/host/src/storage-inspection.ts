import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { inspectJournal } from '@dafeiyu/journal';
import { RUNTIME_APPLICATION_ID, RuntimeIdentitySchema } from '@dafeiyu/core/runtime-store';
import type { RuntimeIdentity } from '@dafeiyu/core/runtime-store';
import { MEMORY_APPLICATION_ID } from '@dafeiyu/memory/store';
import { inspectQqSchema } from '@dafeiyu/channel-qq';

export type StorageKind='journal'|'memory'|'runtime'|'delivery'|'analysis'|'working'|'feedback'|'retrieval'|'qq'|'query';
const definitions:Record<Exclude<StorageKind,'journal'|'qq'>,{app:number;versions:readonly number[];tables:readonly string[]}>= {
  query:{app:1146308689,versions:[8],tables:['search_state','persisted_sessions','persisted_docs']},
  memory:{app:MEMORY_APPLICATION_ID,versions:[1,2,3,4,5,6,7,8,9],tables:['memory_items','memory_revisions','dependencies','outbox','requests']},
  runtime:{app:RUNTIME_APPLICATION_ID,versions:[1,2],tables:['runtime_metadata','runtime_ownership','execution_requests','runs','run_operations','runtime_outbox']},
  delivery:{app:0x44464433,versions:[1],tables:['deliveries','events']},
  analysis:{app:0x44464131,versions:[1],tables:['jobs','ownership','audit_outbox']},
  working:{app:0x44465731,versions:[1],tables:['states','revisions','requests','outbox']},
  feedback:{app:0x44464631,versions:[1],tables:['archives','states','requests','events','outbox']},
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
    if(kind==='runtime'&&supported&&version>=2)supported=tables.has('run_persona_manifests');
    if(kind==='memory'&&supported){
      const stages:Record<number,readonly string[]>={2:['memory_boundaries','memory_schema_migrations'],3:['observation_sources','observation_activities','observation_contributions','observation_source_requests'],
        4:['task_workspaces','task_revisions','task_members','task_selections','task_links','task_jobs','task_slots','task_requests','task_observations'],
        5:['task_memory_policies','task_memory_policy_revisions','task_memory_grants','task_memory_requests','task_memory_hits'],6:['expression_policies','expression_policy_revisions','expression_requests','expression_packets','expression_jobs'],
        7:['execution_scopes','execution_sources','execution_observations','execution_contributions','growth_selections','growth_revisions','growth_requests','task_execution_results','execution_memory_requests','execution_memory_outbox'],
        8:['persona_candidates','persona_candidate_revisions','persona_profiles','persona_profile_revisions','persona_dependencies','persona_requests','persona_outbox','continuity_checkpoints','task_intent_events'],
        9:['capability_observations','capability_selections']};
      supported=Object.entries(stages).every(([stage,names])=>version<Number(stage)||names.every(name=>tables.has(name)));
    }
    const integrity=Object.values(db.prepare('PRAGMA quick_check').get()??{})[0]==='ok'&&db.prepare('PRAGMA foreign_key_check').get()===undefined;
    return {kind,exists:true,version,applicationId,supported,activeOwner,integrity,identityMatches};
  }catch{return {kind,exists:true,version:-1,applicationId:-1,supported:false,activeOwner:false,integrity:false,identityMatches:false};}
  finally{db?.close();}
}
