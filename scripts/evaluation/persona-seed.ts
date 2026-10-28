import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { readFile,writeFile,lstat,realpath } from 'node:fs/promises';
import { join,resolve,relative,isAbsolute,sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ExecutionScopeSchema,PersonaSourceRefSchema,PersonaCandidateRevisionV1Schema,PersonaStageSchema,PersonaKindSchema } from '@dafeiyu/contracts';
import type { ExecutionContextV3,PersonaSourceRef } from '@dafeiyu/contracts';
import { runtimeHash } from '@dafeiyu/core/runtime-store';
import {MEMORY_SCHEMA_VERSION} from '@dafeiyu/memory/store';
import type { EvaluationWorkspace } from './workspace.ts';
import { sha256 } from './catalog.ts';

const scopeSchema=ExecutionScopeSchema.refine(scope=>scope.kind==='task','Fixture seed requires a task');
const seedRequestSchema=z.strictObject({schemaVersion:z.literal(1),kind:z.literal('evaluation-legacy-persona-request'),seedId:z.uuid(),candidateId:z.uuid(),
  fixtureId:z.enum(['B04','B08','H03']),scope:scopeSchema,preparationRunId:z.uuid(),operationId:z.uuid(),contentRef:PersonaSourceRefSchema,
  personaKind:PersonaKindSchema,applicability:z.string().min(1).max(1000),reason:z.string().min(1).max(1000),createdAt:z.iso.datetime()});
const markerSchema=z.strictObject({schemaVersion:z.literal(1),kind:z.literal('evaluation-legacy-persona-seed'),seedId:z.uuid(),fixtureId:z.enum(['B04','B08','H03']),requestHash:z.string().length(64),
  candidate:z.strictObject({id:z.uuid(),version:z.literal(1),hash:z.string().length(64)}),stageHash:z.string().length(64),selectionHash:z.string().length(64),
  source:PersonaSourceRefSchema,adoptionBasis:z.literal('legacy-unclassified'),sourceNature:z.literal('synthetic'),realTrial:z.literal(false),paidCalls:z.literal(0)});
const requestFile='fixture/legacy-persona-request.json',markerFile='fixture/legacy-persona-seed.json';
const preferenceB08='目前暂定偏好舒缓自然观察，允许继续比较。';

/** Preparation records only a request; no production adoption gate is invoked or bypassed. */
export async function requestLegacyPersonaSeed(root:string,fixtureId:'B04'|'B08'|'H03',context:ExecutionContextV3,contentRef:PersonaSourceRef){
  if(context.scope.kind!=='task'||context.taskId!==context.scope.taskId)throw new Error('EVALUATION_SEED_SCOPE_INVALID');
  const request=seedRequestSchema.parse({schemaVersion:1,kind:'evaluation-legacy-persona-request',seedId:randomUUID(),candidateId:randomUUID(),fixtureId,
    scope:context.scope,preparationRunId:context.runId,operationId:context.operationId,contentRef,personaKind:'interest',
    applicability:'仅为公开虚构验收场景的legacy初始快照，不代表真实经历或新采用',reason:'冻结输入所需的虚构legacy v1初始偏好；没有真实试行或采用评审',createdAt:new Date().toISOString()});
  await writeFile(join(root,requestFile),JSON.stringify(request,null,2)+'\n',{flag:'wx'});return request.candidateId;
}

async function controlledProfile(workspace:EvaluationWorkspace,root:string){
  const base=resolve(workspace.root),target=resolve(root),delta=relative(base,target);
  if(!/^[dD]:[\\/]/.test(target)||!delta||delta.startsWith('..'+sep)||delta==='..'||isAbsolute(delta)||await realpath(base)!==base||await realpath(target)!==target)throw new Error('EVALUATION_SEED_PATH_DENIED');
  const local=delta.split(sep).join('/');if(!/^(?:cases\/[a-f0-9-]{36}(?:\/(?:profile|prep))?|p\/[a-f0-9-]{36}\/original)$/.test(local))throw new Error('EVALUATION_SEED_PATH_DENIED');
  let current=base;for(const part of delta.split(sep)){current=join(current,part);const stat=await lstat(current);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('EVALUATION_SEED_PATH_DENIED');}
  const marker=z.object({kind:z.literal('dafeiyu-evaluation-workspace-v1'),root:z.literal(base)}).parse(JSON.parse(await readFile(join(base,'workspace.json'),'utf8')));void marker;
  return {base,target,local};
}

/** Only new, closed evaluation profiles may receive an explicitly synthetic v1 initial snapshot. */
export async function seedLegacyPersonaFixture(workspace:EvaluationWorkspace,profileRoot:string){
  if(!existsSync(join(profileRoot,requestFile)))return null;
  const {target,local}=await controlledProfile(workspace,profileRoot),request=seedRequestSchema.parse(JSON.parse(await readFile(join(target,requestFile),'utf8')));
  if(request.scope.kind!=='task'||request.contentRef.kind!=='execution-source'||request.contentRef.agentId!==request.scope.agentId||request.contentRef.scopeKey!==request.scope.scopeKey)throw new Error('EVALUATION_SEED_SCOPE_INVALID');
  const attemptId=local.split('/')[1]!,caseInput=z.object({case:z.object({id:z.string(),sampleId:z.literal(request.fixtureId)})}).parse(JSON.parse(await readFile(join(workspace.root,'cases',attemptId,'case.json'),'utf8')));
  if(!workspace.config.cases.some(item=>item.id===caseInput.case.id))throw new Error('EVALUATION_SEED_FIXTURE_UNSUPPORTED');
  for(const file of ['memory/memory.sqlite','core/runtime.sqlite','core/journal.sqlite']){const path=join(target,file),stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||await realpath(path)!==resolve(path))throw new Error('EVALUATION_SEED_PATH_DENIED');}
  const requestHash=runtimeHash(request),memory=new DatabaseSync(join(target,'memory/memory.sqlite')),runtime=new DatabaseSync(join(target,'core/runtime.sqlite'),{readOnly:true}),journal=new DatabaseSync(join(target,'core/journal.sqlite'),{readOnly:true});
  let marker:z.infer<typeof markerSchema>;
  const idle=()=>{if(Number(runtime.prepare('SELECT count(*) AS n FROM runtime_ownership').get()?.n)!==0||Number(journal.prepare('SELECT count(*) AS n FROM ownership').get()?.n)!==0)throw new Error('EVALUATION_SEED_PROFILE_ACTIVE');};
  try{
    idle();memory.exec('PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000;');
    if(Number(memory.prepare('PRAGMA user_version').get()?.user_version)!==MEMORY_SCHEMA_VERSION)throw new Error('EVALUATION_SEED_SCHEMA_REQUIRED');
    const run=runtime.prepare('SELECT definition,state FROM runs WHERE id=?').get(request.preparationRunId),definition=run?z.object({scope:ExecutionScopeSchema,taskId:z.uuid()}).parse(JSON.parse(String(run.definition))):null;
    if(!run||run.state!=='completed'||runtimeHash(definition?.scope)!==runtimeHash(request.scope)||definition?.taskId!==request.scope.taskId||Number(runtime.prepare('SELECT count(*) AS n FROM runs').get()?.n)!==1)throw new Error('EVALUATION_SEED_PREPARATION_REQUIRED');
    const operation=runtime.prepare('SELECT action,state,outcome FROM run_operations WHERE id=? AND run_id=?').get(request.operationId,request.preparationRunId);
    if(!operation||!['evaluation_fixture_prepare','history_fixture_prepare'].includes(String(operation.action))||operation.state!=='finished'||z.object({effects:z.literal('confirmed')}).safeParse(JSON.parse(String(operation.outcome))).success!==true)throw new Error('EVALUATION_SEED_PREPARATION_REQUIRED');
    for(const table of ['persona_trial_admissions','persona_trial_outcomes','persona_adoption_reviews','persona_adoption_decisions'])if(Number(memory.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n)!==0)throw new Error('EVALUATION_SEED_PROOFS_ALREADY_EXIST');
    const row=memory.prepare('SELECT * FROM execution_sources WHERE id=?').get(request.contentRef.id);
    if(!row||row.scope_key!==request.contentRef.scopeKey||row.state_version!==request.contentRef.version||row.content_hash!==request.contentRef.contentHash||row.deleted!==0||row.run_id!==request.preparationRunId)throw new Error('EVALUATION_SEED_SOURCE_INVALID');
    const source=z.object({text:z.string(),scope:ExecutionScopeSchema,producer:z.enum(['evaluation-fixture','evaluation-history']),operationId:z.uuid(),dependencies:z.array(PersonaSourceRefSchema),rootSources:z.array(z.string()),nature:z.literal('synthetic')}).parse(JSON.parse(String(row.body)));
    if(sha256(source.text)!==request.contentRef.contentHash||runtimeHash(source.scope)!==runtimeHash(request.scope)||source.operationId!==request.operationId)throw new Error('EVALUATION_SEED_SOURCE_INVALID');
    const expected=request.fixtureId==='H03'?z.object({id:z.literal('H03'),history:z.array(z.string()).min(1)}).parse(JSON.parse(await readFile(join(target,'fixture/history.json'),'utf8'))).history[0]
      :z.object({entry:z.object({content:z.string()}).nullable()}).parse(JSON.parse(await readFile(join(target,'fixture/material.json'),'utf8'))).entry?.content??(request.fixtureId==='B08'?preferenceB08:null);
    if(expected!==source.text)throw new Error('EVALUATION_SEED_MATERIAL_CHANGED');
    const dependencies=[request.contentRef,...source.dependencies].filter((ref,index,refs)=>refs.findIndex(value=>runtimeHash(value)===runtimeHash(ref))===index),policyVersion=runtimeHash({policy:'evaluation-legacy-persona-fixture-v1',fixtureId:request.fixtureId,synthetic:true});
    for(const ref of dependencies){const dependency=ref.kind==='execution-source'?memory.prepare('SELECT body,scope_key,state_version,content_hash,deleted FROM execution_sources WHERE id=?').get(ref.id):null;
      if(!dependency||ref.agentId!==request.scope.agentId||ref.scopeKey!==request.scope.scopeKey||dependency.scope_key!==ref.scopeKey||dependency.state_version!==ref.version||dependency.content_hash!==ref.contentHash||dependency.deleted!==0||sha256(z.object({text:z.string()}).parse(JSON.parse(String(dependency.body))).text)!==ref.contentHash)throw new Error('EVALUATION_SEED_SOURCE_INVALID');}
    const candidate=PersonaCandidateRevisionV1Schema.parse({schemaVersion:1,id:request.candidateId,agentId:request.scope.agentId,version:1,state:'adopted',kind:request.personaKind,
      contentRef:request.contentRef,supports:[],counters:[],dependencies,rootSources:[],scope:request.scope,motivation:{kind:'maintenance',basis:['evaluation-legacy-fixture']},
      applicability:request.applicability,reason:request.reason,runId:request.preparationRunId,producer:'evaluation-legacy-fixture',createdAt:request.createdAt,policyVersion});
    const stage=PersonaStageSchema.parse({schemaVersion:1,agentId:request.scope.agentId,revision:1,entries:[{id:candidate.id,version:1}],createdAt:request.createdAt,policyVersion}),selection={schemaVersion:1,entries:stage.entries};
    marker=markerSchema.parse({schemaVersion:1,kind:'evaluation-legacy-persona-seed',seedId:request.seedId,fixtureId:request.fixtureId,requestHash,
      candidate:{id:candidate.id,version:1,hash:runtimeHash(candidate)},stageHash:runtimeHash(stage),selectionHash:runtimeHash(selection),source:request.contentRef,adoptionBasis:'legacy-unclassified',sourceNature:'synthetic',realTrial:false,paidCalls:0});
    const prior=memory.prepare('SELECT body,body_hash FROM persona_candidate_revisions WHERE id=? AND version=1').get(candidate.id);
    if(prior){
      const head=memory.prepare('SELECT version,state FROM persona_candidates WHERE id=?').get(candidate.id),savedStage=memory.prepare('SELECT body,body_hash FROM persona_profile_revisions WHERE agent_id=? AND revision=1').get(candidate.agentId),savedSelection=memory.prepare('SELECT body FROM growth_revisions WHERE agent_id=? AND scope_key=? AND version=1').get(candidate.agentId,request.scope.scopeKey);
      const stageHead=memory.prepare('SELECT revision FROM persona_profiles WHERE agent_id=?').get(candidate.agentId),selectionHead=memory.prepare('SELECT version,body FROM growth_selections WHERE agent_id=? AND scope_key=?').get(candidate.agentId,request.scope.scopeKey);
      if(prior.body_hash!==marker.candidate.hash||runtimeHash(JSON.parse(String(prior.body)))!==marker.candidate.hash||head?.version!==1||head.state!=='adopted'||savedStage?.body_hash!==marker.stageHash||runtimeHash(JSON.parse(String(savedStage.body)))!==marker.stageHash||stageHead?.revision!==1||!savedSelection||runtimeHash(JSON.parse(String(savedSelection.body)))!==marker.selectionHash||selectionHead?.version!==1||runtimeHash(JSON.parse(String(selectionHead.body)))!==marker.selectionHash||Number(memory.prepare('SELECT count(*) AS n FROM persona_candidates').get()?.n)!==1)throw new Error('EVALUATION_SEED_CONFLICT');
    }else{
      if(Number(memory.prepare('SELECT count(*) AS n FROM persona_candidates').get()?.n)||Number(memory.prepare('SELECT count(*) AS n FROM persona_profiles').get()?.n)||Number(memory.prepare('SELECT count(*) AS n FROM growth_selections').get()?.n))throw new Error('EVALUATION_SEED_INITIAL_STATE_REQUIRED');
      memory.exec('BEGIN IMMEDIATE');try{idle();
        memory.prepare('INSERT INTO persona_candidates VALUES(?,?,?,?)').run(candidate.id,candidate.agentId,1,'adopted');
        memory.prepare('INSERT INTO persona_candidate_revisions VALUES(?,?,?,?)').run(candidate.id,1,JSON.stringify(candidate),marker.candidate.hash);
        for(const ref of dependencies)memory.prepare('INSERT INTO persona_dependencies VALUES(?,?,?,?,?)').run('candidate',candidate.id,1,`${ref.kind}:${runtimeHash(ref)}`,JSON.stringify(ref));
        memory.prepare('INSERT INTO persona_profiles VALUES(?,?)').run(candidate.agentId,1);memory.prepare('INSERT INTO persona_profile_revisions VALUES(?,?,?,?)').run(candidate.agentId,1,JSON.stringify(stage),marker.stageHash);
        memory.prepare('INSERT INTO growth_selections VALUES(?,?,?,?)').run(candidate.agentId,request.scope.scopeKey,1,JSON.stringify(selection));memory.prepare('INSERT INTO growth_revisions VALUES(?,?,?,?)').run(candidate.agentId,request.scope.scopeKey,1,JSON.stringify(selection));
        idle();memory.exec('COMMIT');
      }catch(error){memory.exec('ROLLBACK');throw error;}
    }
  }finally{memory.close();runtime.close();journal.close();}
  const markerPath=join(target,markerFile);let artifact:{relative:string;hash:string};
  if(existsSync(markerPath)){const bytes=await readFile(markerPath),prior=markerSchema.parse(JSON.parse(bytes.toString()));if(runtimeHash(prior)!==runtimeHash(marker))throw new Error('EVALUATION_SEED_CONFLICT');artifact={relative:local+'/'+markerFile,hash:sha256(bytes)};}
  else artifact=await workspace.write(local+'/'+markerFile,JSON.stringify(marker,null,2)+'\n');
  const statePath=join(target,'fixture/state.json'),state=z.record(z.string(),z.json()).parse(JSON.parse(await readFile(statePath,'utf8')));
  if(request.fixtureId==='H03'){if(state.preferenceId!==null&&state.preferenceId!==request.candidateId)throw new Error('EVALUATION_SEED_CONFLICT');state.preferenceId=request.candidateId;}
  else{const facts=state.facts;if(!facts||typeof facts!=='object'||Array.isArray(facts)||facts.preferenceId!==null&&facts.preferenceId!==request.candidateId)throw new Error('EVALUATION_SEED_CONFLICT');facts.preferenceId=request.candidateId;}
  await writeFile(statePath,JSON.stringify(state));return {...artifact,marker};
}
