import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdir,mkdtemp,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  taskScopeKey,ExecutionScopeSchema,PersonaCandidateRevisionV2Schema,PersonaTrialSelectionSchema,PersonaTrialAdmissionSchema,
  PersonaTrialAdmissionInputSchema,PersonaTrialOutcomeSchema,PersonaTrialCompletionInputSchema,PersonaAdoptionReviewSchema,
  PersonaAdoptionDecisionSchema,PersonaSourceEvidenceSchema,PersonaManifestSchema,ContextItemSchema,PersonaStageSchema,
} from '@dafeiyu/contracts';
import { runtimeHash } from '@dafeiyu/core/runtime-store';
import { PERSONA_ADOPTION_POLICY } from '../../packages/memory/lib/persona-evidence.js';
import { PERSONA_ADOPTION_POLICY_VERSION } from '../../packages/memory/lib/persona-adoption-policy.js';
import { capturePersonaBaseline } from '../../scripts/evaluation/persona-proof.ts';
import { sha256 } from '../../scripts/evaluation/catalog.ts';

export interface ProofFixtureOptions {
  held?:boolean;established?:boolean;missingReceipt?:boolean;missingManifestEntry?:boolean;changedVisibleResult?:boolean;
  wrongScope?:boolean;wrongHash?:boolean;wrongCandidateVersion?:boolean;managementReceipt?:boolean;newLegacy?:boolean;
  sourceMissing?:boolean;sourceWithdrawn?:boolean;candidateWithdrawn?:boolean;unknownEffect?:boolean;noLimitations?:boolean;
}
/** Offline audit samples only: these deliberately constructed rows are never real trial or acceptance evidence. */
export async function personaProofFixture(options:ProofFixtureOptions={}){
  const root=await mkdtemp(join(tmpdir(),'persona-proof-synthetic-'));await mkdir(join(root,'core'));await mkdir(join(root,'memory'));
  const memory=new DatabaseSync(join(root,'memory/memory.sqlite')),runtime=new DatabaseSync(join(root,'core/runtime.sqlite'));
  memory.exec([
    'CREATE TABLE persona_candidates(id TEXT PRIMARY KEY,agent_id TEXT,version INTEGER,state TEXT)',
    'CREATE TABLE persona_candidate_revisions(id TEXT,version INTEGER,body TEXT,body_hash TEXT,PRIMARY KEY(id,version))',
    'CREATE TABLE persona_profiles(agent_id TEXT,revision INTEGER)',
    'CREATE TABLE persona_profile_revisions(agent_id TEXT,revision INTEGER,body TEXT,body_hash TEXT)',
    'CREATE TABLE growth_revisions(agent_id TEXT,scope_key TEXT,version INTEGER,body TEXT)',
    'CREATE TABLE growth_selections(agent_id TEXT,scope_key TEXT,version INTEGER,body TEXT)',
    'CREATE TABLE persona_trial_selection_revisions(agent_id TEXT,scope_key TEXT,version INTEGER,body TEXT,body_hash TEXT)',
    'CREATE TABLE persona_trial_selection_entries(agent_id TEXT,scope_key TEXT,selection_version INTEGER,candidate_id TEXT,candidate_version INTEGER,body TEXT,body_hash TEXT)',
    'CREATE TABLE persona_trial_admissions(id TEXT,agent_id TEXT,scope_key TEXT,run_id TEXT,candidate_id TEXT,candidate_version INTEGER,body TEXT,body_hash TEXT)',
    'CREATE TABLE persona_trial_outcomes(id TEXT,agent_id TEXT,scope_key TEXT,run_id TEXT,admission_id TEXT,body TEXT,body_hash TEXT)',
    'CREATE TABLE persona_adoption_reviews(id TEXT,agent_id TEXT,scope_key TEXT,run_id TEXT,candidate_id TEXT,candidate_version INTEGER,body TEXT,body_hash TEXT)',
    'CREATE TABLE persona_adoption_decisions(id TEXT,agent_id TEXT,scope_key TEXT,review_id TEXT,candidate_id TEXT,candidate_version INTEGER,body TEXT,body_hash TEXT)',
    'CREATE TABLE persona_adoption_review_outcomes(review_id TEXT,outcome_id TEXT)',
    'CREATE TABLE persona_outbox(ordinal INTEGER PRIMARY KEY,body TEXT)',
    'CREATE TABLE execution_sources(id TEXT,scope_key TEXT,run_id TEXT,producer TEXT,body TEXT,content_hash TEXT,state_version INTEGER,deleted INTEGER)',
    'CREATE TABLE execution_memory_outbox(ordinal INTEGER PRIMARY KEY,body TEXT)',
  ].join(';'));
  runtime.exec([
    'CREATE TABLE runtime_ownership(singleton INTEGER,pid INTEGER,nonce TEXT)',
    'CREATE TABLE runs(id TEXT,definition TEXT,state TEXT,snapshot TEXT,result TEXT)',
    'CREATE TABLE run_operations(ordinal INTEGER PRIMARY KEY,id TEXT,run_id TEXT,action TEXT,state TEXT,outcome TEXT)',
    'CREATE TABLE run_inputs(run_id TEXT,input_id TEXT,body TEXT)',
    'CREATE TABLE run_persona_manifests(run_id TEXT,body TEXT,body_hash TEXT)',
    'CREATE TABLE runtime_outbox(ordinal INTEGER PRIMARY KEY,id TEXT,body TEXT)',
  ].join(';'));
  const baseline=capturePersonaBaseline(root),agentId='evaluation-proof-fixture',taskId=randomUUID(),scope=ExecutionScopeSchema.parse({kind:'task',agentId,taskId,scopeKey:taskScopeKey(agentId,taskId)}),
    scopeKey=taskScopeKey(agentId,taskId),preparationRun=randomUUID(),trialRun=randomUUID(),publicationRun=randomUUID(),sourceOperation=randomUUID(),useOperation=randomUUID(),publishOperation=randomUUID(),candidateId=randomUUID(),sourceId=randomUUID(),
    at=(minute:number)=>'2026-10-26T01:'+String(minute).padStart(2,'0')+':00.000Z',content='公开虚构资料：蓝灯记录仅支持本次局部文字练习。',visible='本次练习先核对了局部资料，并保留未知范围。',
    ref={kind:'execution-source' as const,id:sourceId,agentId,scopeKey,version:1,contentHash:options.wrongHash?'e'.repeat(64):sha256(content)},
    evidence=PersonaSourceEvidenceSchema.parse({source:ref,nature:'synthetic',coverage:['公开虚构文字练习'],completeness:'partial',roots:[{key:'synthetic:'+sourceId,nature:'synthetic'}]});
  const insert=(db:DatabaseSync,table:string,values:Record<string,string|number|null>)=>db.prepare('INSERT INTO '+table+'('+Object.keys(values).join(',')+') VALUES('+Object.keys(values).map(()=>'?').join(',')+')').run(...Object.values(values));
  const record=(table:string,body:{id:string},extra:Record<string,string|number|null>={})=>{insert(memory,table,{id:body.id,agent_id:agentId,scope_key:scopeKey,...extra,body:JSON.stringify(body),body_hash:runtimeHash(body)});return {id:body.id,hash:runtimeHash(body)};};
  const input=(runId:string,id:string,body:unknown)=>insert(runtime,'run_inputs',{run_id:runId,input_id:id,body:JSON.stringify(body)});
  const event=(runId:string,type:string,time:string,id=randomUUID())=>{insert(runtime,'runtime_outbox',{id,body:JSON.stringify({id,runId,type,at:time,data:{}})});return id;};
  const personaEvent=(type:string,data:unknown,time:string,runId=publicationRun,operationId=publishOperation)=>insert(memory,'persona_outbox',{body:JSON.stringify({id:randomUUID(),type,scope,runId,operationId,producer:'synthetic-fixture',at:time,data})});
  const operationOutcome={status:'succeeded',effects:'confirmed',completeness:'complete',data:{fixture:'synthetic-only'},sources:[],receipts:[]};
  insert(runtime,'run_operations',{id:sourceOperation,run_id:preparationRun,action:'fixture_observe',state:'finished',outcome:JSON.stringify(operationOutcome)});
  if(!options.sourceMissing)insert(memory,'execution_sources',{id:sourceId,scope_key:scopeKey,run_id:preparationRun,producer:'synthetic-fixture',state_version:options.sourceWithdrawn?2:1,deleted:options.sourceWithdrawn?1:0,content_hash:sha256(content),
    body:JSON.stringify({schemaVersion:2,kind:'primary',nature:'synthetic',text:content,scope,runId:preparationRun,operationId:sourceOperation,producer:'synthetic-fixture',dependencies:[],history:[],rootSources:['synthetic:'+sourceId],coverage:evidence.coverage,completeness:'partial',occurredAt:at(0),resource:'fixture:synthetic-proof'})});
  insert(memory,'execution_memory_outbox',{body:JSON.stringify({type:'execution.observation.recorded',scope,at:at(0),data:{sourceId,version:1}})});
  if(options.sourceWithdrawn)insert(memory,'execution_memory_outbox',{body:JSON.stringify({type:'execution.source.deleted',scope,at:at(8),data:{id:sourceId,version:2}})});
  const original=PersonaCandidateRevisionV2Schema.parse({schemaVersion:2,id:candidateId,agentId,version:1,state:'proposed',kind:'value-application',maturity:'tentative',adoption:null,
    contentRef:ref,supports:[ref],counters:[],dependencies:[ref],rootSources:['synthetic:'+sourceId],scope,motivation:{kind:'maintenance',basis:['synthetic-evaluation']},
    applicability:'仅限本次公开虚构文字练习',reason:'有限的暂定认识',runId:preparationRun,producer:'synthetic-fixture',createdAt:at(0),policyVersion:'a'.repeat(64)}),
    trial=PersonaCandidateRevisionV2Schema.parse({...original,version:2,state:'trial'});
  const writeCandidate=(body:typeof original)=>insert(memory,'persona_candidate_revisions',{id:body.id,version:body.version,body:JSON.stringify(body),body_hash:runtimeHash(body)});
  writeCandidate(original);writeCandidate(trial);personaEvent('persona.proposed',{id:candidateId,version:1},at(0),preparationRun,sourceOperation);personaEvent('persona.reviewed',{id:candidateId,version:2,state:'trial'},at(1),preparationRun,sourceOperation);
  const candidate={id:candidateId,version:options.wrongCandidateVersion?1:2},selection=PersonaTrialSelectionSchema.parse({schemaVersion:1,agentId,scope,version:1,entries:[{candidate,applicability:trial.applicability,exitConditions:['来源失效时退出']}],
    runId:preparationRun,producer:'synthetic-fixture',createdAt:at(1),policyVersion:PERSONA_ADOPTION_POLICY}),selectionRef={agentId,scopeKey,version:1,hash:runtimeHash(selection)};
  insert(memory,'persona_trial_selection_revisions',{agent_id:agentId,scope_key:scopeKey,version:1,body:JSON.stringify(selection),body_hash:runtimeHash(selection)});
  insert(memory,'persona_trial_selection_entries',{agent_id:agentId,scope_key:scopeKey,selection_version:1,candidate_id:candidateId,candidate_version:candidate.version,body:JSON.stringify(selection.entries[0]),body_hash:runtimeHash(selection.entries[0])});
  const projectionText=JSON.stringify({kind:'stage-persona-trial',projection:'trial',maturity:'tentative',category:trial.kind,content,applicability:trial.applicability,exitConditions:selection.entries[0]!.exitConditions,reason:trial.reason,
    evidence:[{nature:evidence.nature,completeness:evidence.completeness,coverage:evidence.coverage}],omittedEvidence:0,instructionAuthority:false,notice:'合成审计样本，不是真实试行。'});
  const item=ContextItemSchema.parse({id:'persona-trial:'+candidateId,version:'2:1',text:projectionText,expiresAt:'9999-12-31T23:59:59.999Z',sources:[{ref:'dafeiyu:persona-trial:'+candidateId,version:'2:1',hash:runtimeHash({text:projectionText,dependencies:trial.dependencies,selection:selectionRef})}]}),
    model={provider:'fixture',model:'synthetic'},baseManifest={schemaVersion:2,agentId,foundationHash:'a'.repeat(64),foundationIdentity:'b'.repeat(64),stageRevision:0,selectionVersion:0,stageStatus:'selected',entries:[],continuityCheckpointId:null,
      policyVersion:'c'.repeat(64),modelRouteHash:runtimeHash(model),assemblyVersion:'2',trialSelectionVersion:1,trialEntries:[],omittedTrials:0},
    manifest=PersonaManifestSchema.parse({...baseManifest,runId:trialRun,trialEntries:options.missingManifestEntry?[]:[{projection:'trial',maturity:'tentative',candidate,contentRef:ref,dependencies:[ref],trialSelection:selectionRef,projectionHash:runtimeHash(item)}]}),
    admissionInput=PersonaTrialAdmissionInputSchema.parse({schemaVersion:1,agentId,scope,runId:trialRun,manifestHash:runtimeHash(manifest),trialSelectionVersion:1,admittedAt:at(2),
      entries:[{candidate,selection:selectionRef,contentRef:ref,dependencies:[ref],projectionHash:runtimeHash(item),sourceEvidence:[evidence]}]});
  // Strict records have no model-facing entries envelope.
  const {entries:_entries,...admissionCommon}=admissionInput;
  const actualAdmission=PersonaTrialAdmissionSchema.parse({...admissionCommon,...admissionInput.entries[0],id:randomUUID(),policyVersion:PERSONA_ADOPTION_POLICY});
  const admissionRef=record('persona_trial_admissions',actualAdmission,{run_id:trialRun,candidate_id:candidateId,candidate_version:candidate.version});
  input(trialRun,'persona-trial:admission-input',admissionInput);input(trialRun,'persona-trial:admission-receipt',{inputHash:runtimeHash(admissionInput),admissions:[admissionRef]});
  input(trialRun,'context:'+runtimeHash({kind:'context',agentId,route:scopeKey,owner:'memory',region:'growth',id:item.id,version:item.version,hash:sha256(JSON.stringify([item.text,item.sources]))}),{owner:'memory',region:'growth',item});
  input(trialRun,'native-program',{schemaVersion:1,epoch:1,inputHash:'d'.repeat(64),sources:[ref],continuity:null,authorities:[]});input(trialRun,'result-sources',[]);
  const useOutcome={...operationOutcome,...(options.unknownEffect?{status:'unknown',effects:'unknown',completeness:'unknown'}:{})},action=options.managementReceipt?'dafeiyu_persona_status':'fixture_apply',
    visibleResult=options.managementReceipt?JSON.stringify({completeness:useOutcome.completeness,data:useOutcome.data,effects:useOutcome.effects,receipts:[],sources:[],status:useOutcome.status}):visible,
    textHash=sha256(visibleResult),sessionId='synthetic-trial-'+trialRun,result={sessionId,messageSeq:1,turnEndSeq:2,textHash},
    terminal={state:'completed',result};
  event(trialRun,'run.running',at(2));const closedEventId=event(trialRun,'run.completed',at(3));insert(runtime,'run_operations',{id:useOperation,run_id:trialRun,action,state:'finished',outcome:JSON.stringify(useOutcome)});
  const completion=PersonaTrialCompletionInputSchema.parse({schemaVersion:1,agentId,scope,runId:trialRun,terminal,closedAt:at(3),closedEventId,
    operations:[{id:useOperation,action,status:useOutcome.status,effects:useOutcome.effects,completeness:useOutcome.completeness,outcomeHash:runtimeHash(useOutcome)}],sources:[ref],sourceEvidence:[evidence],gaps:[]}),
    outcome=PersonaTrialOutcomeSchema.parse({...completion,id:randomUUID(),admission:admissionRef,candidate,selection:selectionRef,policyVersion:PERSONA_ADOPTION_POLICY}),
    outcomeRef=record('persona_trial_outcomes',outcome,{run_id:trialRun,admission_id:admissionRef.id});
  if(!options.missingReceipt)input(trialRun,'persona-trial:completion-receipt',{inputHash:runtimeHash(completion),closedEventId,outcomes:[outcomeRef]});
  const otherTask=randomUUID(),reviewScope=options.wrongScope?{kind:'task',agentId,taskId:otherTask,scopeKey:taskScopeKey(agentId,otherTask)}:scope,
    review=PersonaAdoptionReviewSchema.parse({schemaVersion:1,id:randomUUID(),agentId,scope:reviewScope,runId:publicationRun,producer:'synthetic-fixture',createdAt:at(4),policyVersion:PERSONA_ADOPTION_POLICY_VERSION,motivation:trial.motivation,candidate,trialOutcomes:[outcomeRef],
      counterCheck:{status:'unknown',reason:'没有新的真实反证观察'},conclusionScope:trial.applicability,targetMaturity:options.established?'established':'tentative',limitations:options.noLimitations?[]:['只覆盖合成文字，真实效果与反证仍未知。'],reason:'仅记录有限认识',supports:[ref],counters:[],dependencies:[ref],sourceEvidence:[evidence]}),
    reviewRef=record('persona_adoption_reviews',review,{run_id:publicationRun,candidate_id:candidateId,candidate_version:candidate.version}),
    decision=PersonaAdoptionDecisionSchema.parse({schemaVersion:1,id:randomUUID(),review:reviewRef,candidate,agentId,scope,policyVersion:PERSONA_ADOPTION_POLICY_VERSION,checkedAt:at(5),eligibility:options.held?'held':'allowed',reasons:options.held?['coverage-insufficient']:[],
      dependencyHash:runtimeHash({dependencies:review.dependencies,sourceEvidence:review.sourceEvidence}),stageRevision:0,selectionVersion:0,trialSelectionVersion:1,targetMaturity:review.targetMaturity}),
    decisionRef=record('persona_adoption_decisions',decision,{review_id:review.id,candidate_id:candidateId,candidate_version:candidate.version});
  insert(memory,'persona_adoption_review_outcomes',{review_id:review.id,outcome_id:outcome.id});
  const adopted=PersonaCandidateRevisionV2Schema.parse({...trial,version:3,state:'adopted',maturity:review.targetMaturity,adoption:{review:reviewRef,decision:decisionRef},policyVersion:PERSONA_ADOPTION_POLICY_VERSION}),adoptedRef={id:candidateId,version:3};
  if(options.newLegacy){const {maturity:_maturity,adoption:_adoption,...legacy}=adopted;const body={...legacy,schemaVersion:1};insert(memory,'persona_candidate_revisions',{id:candidateId,version:3,body:JSON.stringify(body),body_hash:runtimeHash(body)});}else writeCandidate(adopted);
  insert(memory,'persona_candidates',{id:candidateId,agent_id:agentId,version:options.candidateWithdrawn?4:3,state:options.candidateWithdrawn?'withdrawn':'adopted'});
  const stage=PersonaStageSchema.parse({schemaVersion:1,agentId,revision:1,entries:[adoptedRef],createdAt:at(5),policyVersion:PERSONA_ADOPTION_POLICY_VERSION});
  insert(memory,'persona_profiles',{agent_id:agentId,revision:options.candidateWithdrawn?2:1});insert(memory,'persona_profile_revisions',{agent_id:agentId,revision:1,body:JSON.stringify(stage),body_hash:runtimeHash(stage)});
  insert(memory,'growth_revisions',{agent_id:agentId,scope_key:scopeKey,version:1,body:JSON.stringify({schemaVersion:1,entries:[adoptedRef]})});
  insert(memory,'growth_selections',{agent_id:agentId,scope_key:scopeKey,version:options.candidateWithdrawn?2:1,body:JSON.stringify({schemaVersion:1,entries:options.candidateWithdrawn?[]:[adoptedRef]})});
  const removed={...selection,version:2,entries:[],runId:publicationRun,createdAt:at(5)};insert(memory,'persona_trial_selection_revisions',{agent_id:agentId,scope_key:scopeKey,version:2,body:JSON.stringify(removed),body_hash:runtimeHash(removed)});
  const publication={stageRevision:1,selectionVersion:1,entries:[adoptedRef]};personaEvent('persona.published',publication,at(5));
  insert(runtime,'run_operations',{id:publishOperation,run_id:publicationRun,action:'dafeiyu_persona_publish',state:'finished',outcome:JSON.stringify({...operationOutcome,data:publication})});
  if(options.candidateWithdrawn){writeCandidate({...adopted,version:4,state:'withdrawn'});const withdrawnStage={...stage,revision:2,entries:[]};insert(memory,'persona_profile_revisions',{agent_id:agentId,revision:2,body:JSON.stringify(withdrawnStage),body_hash:runtimeHash(withdrawnStage)});
    insert(memory,'growth_revisions',{agent_id:agentId,scope_key:scopeKey,version:2,body:JSON.stringify({schemaVersion:1,entries:[]})});personaEvent('persona.withdrawn',{id:candidateId,version:4},at(9));}
  for(const id of [preparationRun,trialRun,publicationRun]){const snapshot={sessionId:id===trialRun?sessionId:'synthetic-'+id,personaVersion:'a'.repeat(64),model,registryVersion:'a'.repeat(64),authorityVersion:'a'.repeat(64),inputs:[]};
    insert(runtime,'runs',{id,definition:JSON.stringify({scope,taskId,intentVersion:1}),state:'completed',snapshot:JSON.stringify(snapshot),result:id===trialRun?JSON.stringify(result):null});
    const body=id===trialRun?manifest:PersonaManifestSchema.parse({...baseManifest,runId:id,stageStatus:'empty'});insert(runtime,'run_persona_manifests',{run_id:id,body:JSON.stringify(body),body_hash:runtimeHash(body)});}
  memory.close();runtime.close();
  const session=join(root,'sessions',sessionId);await mkdir(session,{recursive:true});await writeFile(join(session,'session.v4.jsonl'),[
    {type:'assistant/message',seq:1,data:{turn:1,message:{content:[{type:'text',text:options.changedVisibleResult?'被替换的可见答复':visibleResult}]}}},
    {type:'turn/end',seq:2,data:{turn:1,reason:{kind:'completed'}}},
  ].map(event=>JSON.stringify(event)).join('\n')+'\n');
  return {root,baseline,scope,consumerRunId:publicationRun,candidateId,sourceId,trialRun,ref};
}
