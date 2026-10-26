import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PersonaProposalSchema,PersonaCandidateRevisionSchema,PersonaStageSchema,PersonaEntryRefSchema,PersonaRequestIdSchema,ContextItemSchema,redactJson,PersonaTrialSelectInputSchema,PersonaTrialAdmissionInputSchema,PersonaTrialCompletionInputSchema,PersonaAdoptionDecisionSchema,PersonaPublishInputSchema,PersonaAdoptionReviewSchema } from '@dafeiyu/contracts';
import type { PersonaAccess,PersonaSourceRef,PersonaCandidate,PersonaStage,PreparedPersona,PreparedPersonaEntry,PreparedPersonaTrialEntry,PersonaSourceEvidence,SourceDependency,Json } from '@dafeiyu/contracts';
import { personaDigest,personaScope,sourceKey,uniqueSources } from './persona-digest.js';
import { PersonaTrialStore } from './persona-trials.js';
import { readPersonaProof } from './persona-evidence.js';
import { PersonaAdoptionStore,PersonaAdoptionReviewRequestSchema } from './persona-adoptions.js';
import { PERSONA_ADOPTION_POLICY_VERSION } from './persona-adoption-policy.js';

export interface PersonaMaterial {text:string;dependencies:PersonaSourceRef[];rootSources:string[];evidence?:PersonaSourceEvidence}
export type PersonaResolver=(access:PersonaAccess,ref:PersonaSourceRef)=>PersonaMaterial|null;
const control=z.strictObject({requestId:PersonaRequestIdSchema,id:z.uuid(),expectedVersion:z.number().int().positive(),reason:z.string().trim().min(1).max(1000)});
const reviewSchema=control.extend({state:z.enum(['held','trial','rejected'])});
const selectSchema=z.strictObject({requestId:PersonaRequestIdSchema,expectedSelectionVersion:z.number().int().nonnegative(),entries:z.array(PersonaEntryRefSchema).max(32)});
const selectionSchema=z.strictObject({schemaVersion:z.literal(1),entries:z.array(PersonaEntryRefSchema).max(128)});
const policyVersion=personaDigest({policy:'explicit-persona-v1',automaticInference:false,scopeExpansion:false});
const string=(raw:unknown)=>z.string().parse(raw);

/** One authority for candidate, stage and scene-selection changes. Bodies remain source references. */
export class PersonaStore {
  private readonly trials:PersonaTrialStore;
  private readonly adoptions:PersonaAdoptionStore;
  constructor(private readonly db:DatabaseSync,private readonly transaction:<T>(work:()=>T)=>T,private readonly resolve:PersonaResolver){
    this.trials=new PersonaTrialStore(db,resolve,{check:(access,candidate)=>this.checked(access,candidate),event:(access,type,data)=>this.event(access,type,data),promoted:(access,trial,current,requireSelection)=>this.promotedTrial(access,trial,current,requireSelection)});
    this.adoptions=new PersonaAdoptionStore(db,resolve,{versions:access=>({stageRevision:this.stage(access.view.scope.agentId).revision,selectionVersion:this.selection(access).version,trialSelectionVersion:this.trials.selection(access).version}),event:(access,type,data)=>this.event(access,type,data)});
  }
  private promotedTrial(access:PersonaAccess,trial:PersonaCandidate,current:PersonaCandidate,requireSelection=true):boolean {
    if(trial.state!=='trial'||current.schemaVersion!==2||current.state!=='adopted'||!current.adoption||current.id!==trial.id||current.version!==trial.version+1||
      personaDigest(current.contentRef)!==personaDigest(trial.contentRef)||current.applicability!==trial.applicability)return false;
    const decision=readPersonaProof(this.db,access,'persona_adoption_decisions',current.adoption.decision,PersonaAdoptionDecisionSchema);
    if(decision.eligibility!=='allowed'||decision.candidate.id!==trial.id||decision.candidate.version!==trial.version||personaDigest(decision.review)!==personaDigest(current.adoption.review))return false;
    if(!this.stage(current.agentId).entries.some(entry=>entry.id===current.id&&entry.version===current.version)||requireSelection&&!this.selection(access).entries.some(entry=>entry.id===current.id&&entry.version===current.version))return false;
    this.checked(access,trial);return true;
  }
  private request<T extends Json>(access:PersonaAccess,requestId:string,input:unknown,work:()=>T):T {
    access.guard();PersonaRequestIdSchema.parse(requestId);const payload=z.json().parse({scope:access.view.scope,input});
    if(redactJson(payload).redacted)throw new Error('PRIVATE_INPUT_REJECTED');const fingerprint=personaDigest(payload);
    return this.transaction(()=>{access.guard();const old=this.db.prepare('SELECT fingerprint,receipt FROM persona_requests WHERE agent_id=? AND producer=? AND request_id=?').get(access.view.scope.agentId,access.producer,requestId);
      if(old){if(old.fingerprint!==fingerprint)throw new Error('IDEMPOTENCY_CONFLICT');return JSON.parse(string(old.receipt)) as T;}
      const result=work();(access.commitGuard??access.guard)();this.db.prepare('INSERT INTO persona_requests VALUES(?,?,?,?,?)').run(access.view.scope.agentId,access.producer,requestId,fingerprint,JSON.stringify(result));return result;});
  }
  private event(access:PersonaAccess,type:string,data:Record<string,Json>){const id=randomUUID();this.db.prepare('INSERT INTO persona_outbox(id,body) VALUES(?,?)').run(id,JSON.stringify({id,type,scope:access.view.scope,runId:access.view.runId,
    origin:access.view.origin,operationId:access.operationId,causedBy:access.startedEventId,producer:access.producer,at:new Date().toISOString(),data}));}
  private candidate(access:PersonaAccess,id:string):PersonaCandidate{
    access.guard();const row=this.db.prepare('SELECT r.body,r.body_hash FROM persona_candidates c JOIN persona_candidate_revisions r ON r.id=c.id AND r.version=c.version WHERE c.id=? AND c.agent_id=?').get(id,access.view.scope.agentId);
    if(!row)throw new Error('SCOPE_DENIED');const value=PersonaCandidateRevisionSchema.parse(JSON.parse(string(row.body)));
    if(personaDigest(value)!==row.body_hash||personaScope(value.scope)!==personaScope(access.view.scope))throw new Error('SCOPE_DENIED');return value;
  }
  private checked(access:PersonaAccess,candidate:PersonaCandidate):PersonaMaterial{
    this.checkExperienceBasis(access,candidate.experienceBasis??[]);
    access.guard();for(const ref of candidate.dependencies)if(!this.resolve(access,ref))throw new Error('SOURCE_STALE');
    const material=this.resolve(access,candidate.contentRef);if(!material)throw new Error('SOURCE_STALE');return material;
  }
  private checkExperienceBasis(access:PersonaAccess,basis:NonNullable<PersonaCandidate['experienceBasis']>){
    for(const item of basis){const row=this.db.prepare('SELECT r.body FROM experience_items i JOIN experience_revisions r ON r.id=i.id AND r.version=i.version WHERE i.id=? AND i.agent_id=? AND i.scope_key=? AND i.state NOT IN (\'withdrawn\',\'rejected\')')
      .get(item.id,access.view.scope.agentId,personaScope(access.view.scope));
      const value=row?z.object({contentRef:z.object({id:z.uuid()}),taskEpoch:z.number()}).parse(JSON.parse(String(row.body))):null;
      if(!value||value.contentRef.id!==item.sourceId||value.taskEpoch!==item.taskEpoch||access.intentVersion!==item.taskEpoch)throw new Error('SOURCE_STALE');}
  }
  private writeCandidate(candidate:PersonaCandidate){const parsed=PersonaCandidateRevisionSchema.parse(candidate);
    this.db.prepare('UPDATE persona_candidates SET version=?,state=? WHERE id=? AND agent_id=?').run(parsed.version,parsed.state,parsed.id,parsed.agentId);
    this.db.prepare('INSERT INTO persona_candidate_revisions VALUES(?,?,?,?)').run(parsed.id,parsed.version,JSON.stringify(parsed),personaDigest(parsed));
    for(const ref of parsed.dependencies)this.db.prepare('INSERT INTO persona_dependencies VALUES(?,?,?,?,?)').run('candidate',parsed.id,parsed.version,sourceKey(ref),JSON.stringify(ref));
  }
  stage(agentId:string):PersonaStage{const row=this.db.prepare('SELECT r.body,r.body_hash FROM persona_profiles p JOIN persona_profile_revisions r ON p.agent_id=r.agent_id AND p.revision=r.revision WHERE p.agent_id=?').get(agentId);
    if(!row)return {schemaVersion:1,agentId,revision:0,entries:[],createdAt:new Date(0).toISOString(),policyVersion};const value=PersonaStageSchema.parse(JSON.parse(string(row.body)));if(personaDigest(value)!==row.body_hash)throw new Error('PERSONA_STATE_CORRUPT');return value;}
  private writeStage(stage:PersonaStage){const value=PersonaStageSchema.parse(stage);this.db.prepare('INSERT INTO persona_profiles VALUES(?,?) ON CONFLICT(agent_id) DO UPDATE SET revision=excluded.revision').run(value.agentId,value.revision);
    this.db.prepare('INSERT INTO persona_profile_revisions VALUES(?,?,?,?)').run(value.agentId,value.revision,JSON.stringify(value),personaDigest(value));}
  private selection(access:PersonaAccess){const row=this.db.prepare('SELECT version,body FROM growth_selections WHERE agent_id=? AND scope_key=?').get(access.view.scope.agentId,personaScope(access.view.scope));
    if(!row)return {version:0,entries:[] as z.infer<typeof PersonaEntryRefSchema>[],legacy:false};const parsed=selectionSchema.safeParse(JSON.parse(string(row.body)));
    return {version:Number(row.version),entries:parsed.success?parsed.data.entries:[],legacy:!parsed.success};}
  private writeSelection(access:PersonaAccess,entries:z.infer<typeof PersonaEntryRefSchema>[]){const current=this.selection(access),body=selectionSchema.parse({schemaVersion:1,entries});
    this.db.prepare('INSERT INTO growth_selections VALUES(?,?,?,?) ON CONFLICT(agent_id,scope_key) DO UPDATE SET version=excluded.version,body=excluded.body').run(access.view.scope.agentId,personaScope(access.view.scope),current.version+1,JSON.stringify(body));
    this.db.prepare('INSERT INTO growth_revisions VALUES(?,?,?,?)').run(access.view.scope.agentId,personaScope(access.view.scope),current.version+1,JSON.stringify(body));return current.version+1;}
  propose(access:PersonaAccess,raw:unknown){const input=PersonaProposalSchema.parse(raw);return this.request(access,input.requestId,{kind:'propose',input},()=>{
    this.checkExperienceBasis(access,input.experienceBasis??[]);
    const materials=[input.contentRef,...input.supports,...input.counters,...access.admittedSources,...access.inputs.flatMap(input=>input.sourceRef?[input.sourceRef]:[])].map(ref=>{const value=this.resolve(access,ref);if(!value)throw new Error('SOURCE_STALE');return {ref,...value};});
    if(['view','relationship','value-application'].includes(input.kind)&&!input.supports.length)throw new Error('INSUFFICIENT_EVIDENCE');
    const dependencies=uniqueSources(materials.flatMap(value=>[value.ref,...value.dependencies]));const id=randomUUID();
    const candidate=PersonaCandidateRevisionSchema.parse({schemaVersion:2,maturity:'tentative',adoption:null,id,agentId:access.view.scope.agentId,version:1,state:'proposed',kind:input.kind,contentRef:input.contentRef,supports:input.supports,counters:input.counters,
      dependencies,rootSources:[...new Set(materials.filter(value=>input.supports.some(ref=>sourceKey(ref)===sourceKey(value.ref))).flatMap(value=>value.rootSources))],scope:access.view.scope,motivation:access.motivation,
      applicability:input.applicability,reason:input.reason,runId:access.view.runId,producer:access.producer,createdAt:new Date().toISOString(),policyVersion:PERSONA_ADOPTION_POLICY_VERSION,...(input.experienceBasis?{experienceBasis:input.experienceBasis}:{})});
    this.db.prepare('INSERT INTO persona_candidates VALUES(?,?,?,?)').run(id,candidate.agentId,1,'proposed');this.writeCandidate(candidate);this.event(access,'persona.proposed',{id,version:1});return {id,version:1,state:'proposed'};
  });}
  review(access:PersonaAccess,raw:unknown){const input=reviewSchema.parse(raw);return this.request(access,input.requestId,{kind:'review',input},()=>{
    const current=this.candidate(access,input.id);if(current.version!==input.expectedVersion)throw new Error('VERSION_CONFLICT');if(!['proposed','held','trial'].includes(current.state))throw new Error('PERSONA_TRANSITION_FORBIDDEN');
    if(input.state==='trial')this.checked(access,current);const updated=PersonaCandidateRevisionSchema.parse({...current,schemaVersion:2,maturity:'tentative',adoption:null,version:current.version+1,state:input.state,reason:input.reason,policyVersion:PERSONA_ADOPTION_POLICY_VERSION});this.writeCandidate(updated);this.event(access,'persona.reviewed',{id:current.id,version:updated.version,state:updated.state});return {id:current.id,version:updated.version,state:updated.state};
  });}
  selectTrial(access:PersonaAccess,raw:unknown){const input=PersonaTrialSelectInputSchema.parse(raw);return this.request(access,input.requestId,{kind:'trial-select',input},()=>this.trials.select(access,input));}
  admitTrial(access:PersonaAccess,raw:unknown){const input=PersonaTrialAdmissionInputSchema.parse(raw);access.guard();return this.transaction(()=>{const refs=this.trials.admit(access,input);(access.commitGuard??access.guard)();return refs;});}
  completeTrial(access:PersonaAccess,raw:unknown){const input=PersonaTrialCompletionInputSchema.parse(raw);access.guard();return this.transaction(()=>{const refs=this.trials.complete(access,input);(access.commitGuard??access.guard)();return refs;});}
  validateHistoricalTrial(access:PersonaAccess,dependency:Extract<SourceDependency,{kind:'context'}>):boolean{return this.trials.historical(access,dependency);}
  reviewAdoption(access:PersonaAccess,raw:unknown){const input=PersonaAdoptionReviewRequestSchema.parse(raw);return this.request(access,input.requestId,{kind:'adoption-review',input},()=>this.adoptions.review(access,input));}
  publish(access:PersonaAccess,raw:unknown){const input=PersonaPublishInputSchema.parse(raw);return this.request(access,input.requestId,{kind:'publish',input},()=>{
    if(new Set(input.entries.map(entry=>entry.id)).size!==input.entries.length)throw new Error('INVALID_INPUT');const stage=this.stage(access.view.scope.agentId);if(stage.revision!==input.expectedStageVersion)throw new Error('VERSION_CONFLICT');
    const selection=this.selection(access),versions={stageRevision:stage.revision,selectionVersion:selection.version,trialSelectionVersion:this.trials.selection(access).version};
    // Validate the entire batch before writing anything; a preview Decision is never cached authority.
    const qualified=input.entries.map(entry=>{const current=this.candidate(access,entry.id);if(current.version!==entry.version)throw new Error('VERSION_CONFLICT');if(current.state!=='trial')throw new Error('PERSONA_REVIEW_REQUIRED');this.checked(access,current);
      if(!entry.review)throw new Error('PERSONA_ADOPTION_REVIEW_REQUIRED');const decision=this.adoptions.assess(access,current,entry.review,versions);
      if(decision.eligibility!=='allowed')throw new Error('PERSONA_ADOPTION_HELD');
      const review=readPersonaProof(this.db,access,'persona_adoption_reviews',entry.review,PersonaAdoptionReviewSchema);
      const rootSources=[...new Set(review.supports.flatMap(ref=>{const material=this.resolve(access,ref);if(!material)throw new Error('SOURCE_STALE');return material.rootSources;}))];
      const next=PersonaCandidateRevisionSchema.parse({...current,schemaVersion:2,version:current.version+1,state:'adopted',maturity:review.targetMaturity,
        adoption:{review:entry.review,decision:{id:decision.id,hash:personaDigest(decision)}},supports:review.supports,counters:review.counters,
        dependencies:uniqueSources([...current.dependencies,...review.dependencies]),rootSources,policyVersion:PERSONA_ADOPTION_POLICY_VERSION});
      return {next,decision};});
    const adopted=qualified.map(({next,decision})=>{this.adoptions.saveDecision(access,decision);this.writeCandidate(next);return {id:next.id,version:next.version};});
    const entries=[...stage.entries.filter(entry=>!adopted.some(next=>next.id===entry.id)),...adopted];const next={...stage,revision:stage.revision+1,entries,createdAt:new Date().toISOString(),policyVersion:PERSONA_ADOPTION_POLICY_VERSION};this.writeStage(next);
    const selected=[...selection.entries.filter(entry=>!adopted.some(next=>next.id===entry.id)),...adopted],selectionVersion=this.writeSelection(access,selected);
    this.trials.remove(access,adopted.map(entry=>entry.id));
    this.event(access,'persona.published',{stageRevision:next.revision,selectionVersion,entries:adopted});return {stageRevision:next.revision,selectionVersion,entries:adopted};
  });}
  select(access:PersonaAccess,raw:unknown){const input=selectSchema.parse(raw);return this.request(access,input.requestId,{kind:'select',input},()=>{
    const selection=this.selection(access),stage=this.stage(access.view.scope.agentId);if(selection.version!==input.expectedSelectionVersion)throw new Error('VERSION_CONFLICT');
    if(new Set(input.entries.map(entry=>entry.id)).size!==input.entries.length)throw new Error('INVALID_INPUT');
    for(const entry of input.entries){const current=this.candidate(access,entry.id);if(current.version!==entry.version||current.state!=='adopted'||!stage.entries.some(value=>value.id===entry.id&&value.version===entry.version))throw new Error('SOURCE_STALE');this.checked(access,current);this.adoptions.verifyAdopted(access,current);}
    const selectionVersion=this.writeSelection(access,input.entries);this.event(access,'persona.selected',{selectionVersion,count:input.entries.length});return {selectionVersion};
  });}
  withdraw(access:PersonaAccess,raw:unknown){const input=control.parse(raw);return this.request(access,input.requestId,{kind:'withdraw',input},()=>{
    const current=this.candidate(access,input.id);if(current.version!==input.expectedVersion)throw new Error('VERSION_CONFLICT');if(['withdrawn','superseded'].includes(current.state))throw new Error('PERSONA_TRANSITION_FORBIDDEN');
    const next={...current,version:current.version+1,state:'withdrawn' as const,reason:input.reason};this.writeCandidate(next);const stage=this.stage(access.view.scope.agentId);
    if(stage.entries.some(entry=>entry.id===current.id))this.writeStage({...stage,revision:stage.revision+1,entries:stage.entries.filter(entry=>entry.id!==current.id),createdAt:new Date().toISOString()});
    const selection=this.selection(access);if(selection.entries.some(entry=>entry.id===current.id))this.writeSelection(access,selection.entries.filter(entry=>entry.id!==current.id));this.trials.remove(access,[current.id]);this.event(access,'persona.withdrawn',{id:current.id,version:next.version});return {id:current.id,version:next.version,state:next.state};
  });}
  prepare(access:PersonaAccess):PreparedPersona{
    access.guard();const stage=this.stage(access.view.scope.agentId),selection=this.selection(access),entries:PreparedPersonaEntry[]=[];
    for(const entry of selection.entries){try{const candidate=this.candidate(access,entry.id);if(candidate.version!==entry.version||candidate.state!=='adopted'||!stage.entries.some(value=>value.id===entry.id&&value.version===entry.version))continue;
      this.adoptions.verifyAdopted(access,candidate);const material=this.checked(access,candidate),counterText=candidate.counters.map(ref=>this.resolve(access,ref)?.text??'来源不可用');
      const adoption=candidate.schemaVersion===2&&candidate.adoption?{basis:'reviewed' as const,maturity:candidate.maturity,...candidate.adoption}:{basis:'legacy-unclassified' as const,maturity:'legacy-unclassified' as const};
      const text=JSON.stringify({kind:'stage-persona',category:candidate.kind,content:material.text,applicability:candidate.applicability,reason:candidate.reason,counterEvidence:counterText,...(candidate.schemaVersion===2?{adoption}:{}),
        evidenceStatus:candidate.supports.length?'source-bound':'tentative-self-report',instructionAuthority:false});
      const item=ContextItemSchema.safeParse({id:`persona:${candidate.id}`,version:String(candidate.version),text,expiresAt:'9999-12-31T23:59:59.999Z',sources:[{ref:`dafeiyu:persona:${candidate.id}`,version:String(candidate.version),hash:personaDigest({text,dependencies:candidate.dependencies})}]});
      if(item.success)entries.push({candidate:entry,contentRef:candidate.contentRef,dependencies:candidate.dependencies,item:item.data,adoption});
    }catch{access.guard();}}
    const trial=this.trials.prepare(access);
    return {stageRevision:stage.revision,selectionVersion:selection.version,entries,omitted:selection.legacy?1:selection.entries.length-entries.length,trialSelectionVersion:trial.version,trialEntries:trial.entries,omittedTrials:trial.omitted};
  }
  validate(access:PersonaAccess,entry:PreparedPersonaEntry|PreparedPersonaTrialEntry):boolean{try{access.guard();const current=this.prepare(access);return [...current.entries,...(current.trialEntries??[])].some(value=>personaDigest(value)===personaDigest(entry));}catch{return false;}}
  status(access:PersonaAccess){access.guard();const selection=this.selection(access);const candidates=this.db.prepare('SELECT id FROM persona_candidates WHERE agent_id=? ORDER BY rowid').all(access.view.scope.agentId).flatMap(row=>{
      try{const value=this.candidate(access,string(row.id));let available=true;try{this.checked(access,value);if(value.state==='adopted')this.adoptions.verifyAdopted(access,value);}catch{available=false;}return [{id:value.id,version:value.version,state:value.state,kind:value.kind,applicability:value.applicability,maturity:value.schemaVersion===2?value.maturity:'legacy-unclassified',available}];}catch{return [];}});
    return {stageRevision:this.stage(access.view.scope.agentId).revision,selectionVersion:selection.version,legacySelection:selection.legacy,candidates,...this.trials.status(access)};}
  drainOutbox(append:(body:unknown,id:string)=>void){let pending=0;for(const row of this.db.prepare('SELECT id,body FROM persona_outbox WHERE delivered=0 ORDER BY ordinal').all()){
    try{append(JSON.parse(string(row.body)),string(row.id));this.db.prepare('UPDATE persona_outbox SET delivered=1 WHERE id=?').run(row.id!);}catch{pending++;break;}}return pending;}
}
