import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { ActionOutcomeSchema,ContextItemSchema,ExecutionScopeSchema,MemoryBoundarySchema,PersonaCandidateRevisionSchema,PersonaSourceRefSchema,PersonaSourceEvidenceSchema,PersonaSourceNatureSchema,SourceDependencySchema,PersonaTrialAdmissionSchema,PersonaTrialSelectionSchema,PersonaAdoptionDecisionSchema,PersonaStageSchema,boundaryAllows } from '@dafeiyu/contracts';
import type { ExecutionScope,PersonaSourceRef,PersonaSourceEvidence,SourceDependency } from '@dafeiyu/contracts';
import { runtimeHash } from '@dafeiyu/core/runtime-store';
import { revisionSchema } from '../../packages/memory/lib/types.js';
import { boundaryDigest } from '../../packages/memory/lib/boundary.js';
import { sha256 } from './catalog.ts';

const scopeKey=(scope:ExecutionScope)=>scope.kind==='task'?scope.scopeKey:scope.route;
const sourceFields={text:z.string(),scope:ExecutionScopeSchema,runId:z.uuid(),producer:z.string(),operationId:z.string(),dependencies:z.array(PersonaSourceRefSchema),rootSources:z.array(z.string())};
const sourceBody=z.discriminatedUnion('schemaVersion',[
  z.strictObject({...sourceFields,schemaVersion:z.literal(1),kind:z.literal('self-report')}),
  z.strictObject({...sourceFields,schemaVersion:z.literal(2),kind:z.enum(['primary','digest','self-report']),history:z.array(SourceDependencySchema),nature:PersonaSourceNatureSchema.optional(),
    occurredAt:z.iso.datetime({offset:true}),resource:z.string(),coverage:z.array(z.string()),completeness:z.enum(['complete','partial','unknown'])}),
]);
interface Material {text:string;evidence:PersonaSourceEvidence}

/** Closed evaluation evidence only. Unsupported authority families are explicit failures, never assumed valid. */
export class ClosedPersonaSources {
  private readonly checking=new Set<string>();
  private readonly materials=new Map<string,Material>();
  private readonly memory:DatabaseSync;
  private readonly runtime:DatabaseSync;
  private readonly scope:ExecutionScope;
  private readonly consumerRunId:string;
  private readonly asOf:string|undefined;
  constructor(memory:DatabaseSync,runtime:DatabaseSync,scope:ExecutionScope,consumerRunId:string,asOf?:string){this.memory=memory;this.runtime=runtime;this.scope=scope;this.consumerRunId=consumerRunId;this.asOf=asOf;}
  private fail(code:string):never{throw new Error(code);}
  private input(runId:string,id:string):unknown{const row=this.runtime.prepare('SELECT body FROM run_inputs WHERE run_id=? AND input_id=?').get(runId,id);return row?JSON.parse(String(row.body)):null;}
  private run(runId:string){const row=this.runtime.prepare('SELECT definition,state FROM runs WHERE id=?').get(runId);if(!row)this.fail('EVALUATION_SOURCE_RUN_MISSING');
    const definition=z.object({scope:ExecutionScopeSchema,taskId:z.uuid(),intentVersion:z.number().int().positive()}).parse(JSON.parse(String(row.definition)));
    if(runtimeHash(definition.scope)!==runtimeHash(this.scope))this.fail('EVALUATION_SOURCE_SCOPE_MISMATCH');return {definition,state:String(row.state)};}
  private material(raw:PersonaSourceRef):Material{
    const ref=PersonaSourceRefSchema.parse(raw),key=runtimeHash(ref),cached=this.materials.get(key);if(cached)return cached;
    if(ref.agentId!==this.scope.agentId||ref.scopeKey!==scopeKey(this.scope))this.fail('EVALUATION_SOURCE_SCOPE_MISMATCH');
    if(this.checking.has(key)||this.checking.size>=128)this.fail('EVALUATION_SOURCE_CYCLE');this.checking.add(key);
    try{
      const material=ref.kind==='execution-source'?this.execution(ref):this.memoryItem(ref);this.materials.set(key,material);return material;
    }finally{this.checking.delete(key);}
  }
  private execution(ref:Extract<PersonaSourceRef,{kind:'execution-source'}>):Material{
    const row=this.memory.prepare('SELECT * FROM execution_sources WHERE id=? AND scope_key=?').get(ref.id,ref.scopeKey);
    if(!row)this.fail('EVALUATION_SOURCE_TYPE_UNSUPPORTED');if(row.content_hash!==ref.contentHash)this.fail('EVALUATION_SOURCE_HASH_MISMATCH');
    if(this.asOf)this.sourceStateAt(ref,Number(row.state_version),Number(row.deleted));
    else if(row.deleted!==0||row.state_version!==ref.version)this.fail('EVALUATION_SOURCE_STALE');
    const body=sourceBody.parse(JSON.parse(String(row.body)));if(runtimeHash(body.scope)!==runtimeHash(this.scope)||sha256(body.text)!==ref.contentHash||row.run_id!==body.runId||row.producer!==body.producer)this.fail('EVALUATION_SOURCE_HASH_MISMATCH');
    this.run(body.runId);const operation=this.runtime.prepare('SELECT state,outcome,run_id FROM run_operations WHERE id=?').get(body.operationId);
    if(!operation||operation.run_id!==body.runId||operation.state!=='finished')this.fail('EVALUATION_SOURCE_OPERATION_UNFINISHED');
    const outcome=ActionOutcomeSchema.parse(JSON.parse(String(operation.outcome)));if(!['succeeded','partial'].includes(outcome.status))this.fail('EVALUATION_SOURCE_OPERATION_UNFINISHED');
    if(body.schemaVersion===2)for(const dependency of body.history)this.history(dependency);
    const parents=body.dependencies.map(dependency=>this.material(dependency)),roots=new Map<string,PersonaSourceEvidence['nature']>();
    for(const parent of parents)for(const root of parent.evidence.roots){const previous=roots.get(root.key);roots.set(root.key,previous&&previous!==root.nature?'unknown':root.nature);}
    const nature=body.kind==='self-report'?'self-report':body.kind==='digest'?'derived':body.schemaVersion===2?body.nature??'unknown':'unknown';
    return {text:body.text,evidence:PersonaSourceEvidenceSchema.parse({source:ref,nature,coverage:body.schemaVersion===2?body.coverage:[],completeness:body.schemaVersion===2?body.completeness:'unknown',roots:[...new Set(body.rootSources)].map(key=>({key,nature:roots.get(key)??nature}))})};
  }
  private sourceStateAt(ref:Extract<PersonaSourceRef,{kind:'execution-source'}>,headVersion:number,headDeleted:number):void{
    let version=0,deleted=1,selectedVersion=0,selectedDeleted=1,lastAt=0;
    const events=this.memory.prepare("SELECT body FROM execution_memory_outbox WHERE json_extract(body,'$.data.sourceId')=? OR json_extract(body,'$.data.id')=? ORDER BY rowid").all(ref.id,ref.id);
    for(const row of events){const event=z.object({type:z.string(),scope:ExecutionScopeSchema,at:z.iso.datetime(),data:z.object({sourceId:z.string().optional(),id:z.string().optional(),version:z.number().int()})}).parse(JSON.parse(String(row.body)));
      if(!['execution.observation.recorded','execution.self-report.recorded','execution.source.deleted','execution.source.restored'].includes(event.type))continue;
      const at=Date.parse(event.at);if(runtimeHash(event.scope)!==runtimeHash(this.scope)||at<lastAt)this.fail('EVALUATION_SOURCE_HISTORY_INVALID');lastAt=at;
      if(event.type.endsWith('.recorded')){if(version!==0||event.data.version!==1)this.fail('EVALUATION_SOURCE_HISTORY_INVALID');version=1;deleted=0;}
      else{if(event.data.version!==version+1)this.fail('EVALUATION_SOURCE_HISTORY_INVALID');version=event.data.version;const next=event.type.endsWith('.deleted')?1:0;if(deleted===next)this.fail('EVALUATION_SOURCE_HISTORY_INVALID');deleted=next;}
      if(at<=Date.parse(this.asOf!)){selectedVersion=version;selectedDeleted=deleted;}
    }
    if(version!==headVersion||deleted!==headDeleted||selectedVersion!==ref.version||selectedDeleted!==0)this.fail('EVALUATION_SOURCE_STALE_AT_ADOPTION');
  }
  private memoryItem(ref:Extract<PersonaSourceRef,{kind:'memory'}>):Material{
    if(this.scope.kind!=='task'||ref.authorization||ref.range||ref.selectionId)this.fail('EVALUATION_SOURCE_TYPE_UNSUPPORTED');
    const row=this.memory.prepare('SELECT i.agent_id,i.route,i.version,i.head,i.deleted,r.body,b.body AS boundary,b.boundary_hash FROM memory_items i JOIN memory_revisions r ON r.id=i.id AND r.revision=? JOIN memory_boundaries b ON b.id=r.id AND b.revision=r.revision WHERE i.id=?').get(ref.revision,ref.id);
    if(!row||row.deleted!==0||row.agent_id!==ref.agentId||row.route!==ref.scopeKey||row.version!==ref.version||row.head!==ref.revision)this.fail('EVALUATION_SOURCE_STALE');
    const body=revisionSchema.parse(JSON.parse(String(row.body))),boundary=MemoryBoundarySchema.parse(JSON.parse(String(row.boundary)));
    const contentHash=runtimeHash({kind:body.kind,claimType:body.claimType,content:body.content,sources:body.sources,...(body.analysis?{analysis:body.analysis}:{})});
    if(body.id!==ref.id||body.revision!==ref.revision||body.contentHash!==ref.contentHash||contentHash!==ref.contentHash||boundaryDigest(boundary)!==row.boundary_hash||boundary.schemaVersion!==2||!boundaryAllows(boundary,{agentId:ref.agentId,route:ref.scopeKey},'internal'))this.fail('EVALUATION_SOURCE_HASH_MISMATCH');
    const contribution=this.memory.prepare('SELECT body FROM execution_contributions WHERE memory_id=?').get(ref.id);if(!contribution)this.fail('EVALUATION_SOURCE_TYPE_UNSUPPORTED');
    const linked=z.object({source:PersonaSourceRefSchema,dependency:PersonaSourceRefSchema.optional()}).parse(JSON.parse(String(contribution.body))),parent=this.material(linked.dependency??linked.source);
    for(const source of body.sources){if(source.kind!=='execution')this.fail('EVALUATION_SOURCE_TYPE_UNSUPPORTED');this.material({kind:'execution-source',id:z.uuid().parse(source.ref.slice('dafeiyu:execution-source:'.length)),agentId:ref.agentId,scopeKey:ref.scopeKey,version:source.version,contentHash:source.contentHash});}
    return {text:body.content,evidence:PersonaSourceEvidenceSchema.parse({source:ref,nature:'unknown',coverage:[],completeness:'unknown',roots:parent.evidence.roots.map(root=>({key:root.key,nature:'unknown'}))})};
  }
  private history(raw:SourceDependency):void{
    const dependency=SourceDependencySchema.parse(raw),key='history:'+runtimeHash(dependency);if(this.checking.has(key)||this.checking.size>=128)this.fail('EVALUATION_SOURCE_CYCLE');
    if(dependency.agentId!==this.scope.agentId||dependency.route!==scopeKey(this.scope))this.fail('EVALUATION_SOURCE_SCOPE_MISMATCH');this.checking.add(key);
    try{
      if(dependency.kind==='execution-source'){this.material(dependency.ref);return;}
      if(dependency.kind==='execution-input'){
        const run=this.run(dependency.runId),proof=z.object({schemaVersion:z.literal(1),epoch:z.number(),inputHash:z.string(),sources:z.array(PersonaSourceRefSchema),continuity:z.object({id:z.uuid(),hash:z.string()}).nullable(),authorities:z.array(z.unknown()).optional()}).parse(this.input(dependency.runId,'native-program'));
        if(proof.epoch!==run.definition.intentVersion||runtimeHash(proof)!==dependency.hash)this.fail('EVALUATION_SOURCE_INPUT_MISMATCH');
        if(proof.authorities?.length)this.fail('EVALUATION_SOURCE_AUTHORITY_UNSUPPORTED');proof.sources.forEach(ref=>this.material(ref));
        if(proof.continuity){const row=this.memory.prepare('SELECT body,body_hash FROM continuity_checkpoints WHERE id=?').get(proof.continuity.id);if(!row||row.body_hash!==proof.continuity.hash||runtimeHash(JSON.parse(String(row.body)))!==proof.continuity.hash)this.fail('EVALUATION_SOURCE_CHECKPOINT_MISMATCH');
          const checkpoint=z.object({runId:z.uuid(),scope:ExecutionScopeSchema,dependencies:z.array(PersonaSourceRefSchema),historyHash:z.string()}).parse(JSON.parse(String(row.body)));if(runtimeHash(checkpoint.scope)!==runtimeHash(this.scope))this.fail('EVALUATION_SOURCE_SCOPE_MISMATCH');checkpoint.dependencies.forEach(ref=>this.material(ref));
          const history=this.memory.prepare("SELECT body FROM persona_dependencies WHERE owner_kind='continuity-history' AND owner_id=? AND source_key='history'").get(checkpoint.runId);if(!history)this.fail('EVALUATION_SOURCE_CHECKPOINT_MISMATCH');const deps=z.array(SourceDependencySchema).parse(JSON.parse(String(history.body)));if(runtimeHash(deps)!==checkpoint.historyHash)this.fail('EVALUATION_SOURCE_CHECKPOINT_MISMATCH');deps.forEach(dep=>this.history(dep));}
        return;
      }
      if(dependency.kind==='execution-operation'){
        this.run(dependency.runId);const operation=this.runtime.prepare('SELECT run_id,state,outcome FROM run_operations WHERE id=?').get(dependency.operationId),input=this.input(dependency.runId,'operation-inputs:'+dependency.operationId);
        if(!operation||operation.run_id!==dependency.runId||operation.state!=='finished'||runtimeHash(JSON.parse(String(operation.outcome)))!==dependency.hash||input===null||runtimeHash(input)!==dependency.inputHash)this.fail('EVALUATION_SOURCE_OPERATION_MISMATCH');z.array(SourceDependencySchema).parse(input).forEach(dep=>this.history(dep));return;
      }
      if(dependency.kind==='context'){
        const row=this.runtime.prepare('SELECT run_id,body FROM run_inputs WHERE input_id=? ORDER BY rowid DESC LIMIT 1').get('context:'+runtimeHash(dependency));if(!row)this.fail('EVALUATION_SOURCE_CONTEXT_MISSING');this.run(String(row.run_id));
        const context=z.object({owner:z.string(),region:z.string(),item:ContextItemSchema}).parse(JSON.parse(String(row.body))),item=context.item;
        if(context.owner!==dependency.owner||context.region!==dependency.region||item.id!==dependency.id||item.version!==dependency.version||sha256(JSON.stringify([item.text,item.sources]))!==dependency.hash||Date.parse(item.expiresAt)<=Date.now())this.fail('EVALUATION_SOURCE_CONTEXT_CHANGED');
        if(context.owner==='memory'&&context.region==='execution'){
          const selected=z.object({source:PersonaSourceRefSchema,text:z.string()}).safeParse(JSON.parse(item.text));if(!selected.success)this.fail('EVALUATION_SOURCE_CONTEXT_UNSUPPORTED');
          const material=this.material(selected.data.source);if(material.text!==selected.data.text||item.id!==`execution:${selected.data.source.kind}:${runtimeHash(selected.data.source)}`||item.version!==String(selected.data.source.version))this.fail('EVALUATION_SOURCE_CONTEXT_CHANGED');return;
        }
        if(context.owner==='memory'&&context.region==='growth'){
          if(item.id==='persona:availability')return;
          const trial=/^persona-trial:([a-f0-9-]{36})$/.exec(item.id),adopted=/^persona:([a-f0-9-]{36})$/.exec(item.id),id=trial?.[1]??adopted?.[1];if(!id)this.fail('EVALUATION_SOURCE_CONTEXT_UNSUPPORTED');
          const version=Number(item.version.split(':')[0]),candidateRow=this.memory.prepare('SELECT c.version AS current_version,c.state AS current_state,r.body,r.body_hash FROM persona_candidates c JOIN persona_candidate_revisions r ON r.id=c.id AND r.version=? WHERE c.id=?').get(version,id);
          if(!candidateRow)this.fail('EVALUATION_SOURCE_STALE');const candidate=PersonaCandidateRevisionSchema.parse(JSON.parse(String(candidateRow.body)));
          if(candidate.id!==id||candidate.version!==version||runtimeHash(candidate)!==candidateRow.body_hash||runtimeHash(candidate.scope)!==runtimeHash(this.scope)||candidate.state!==(trial?'trial':'adopted'))this.fail('EVALUATION_SOURCE_STALE');
          const material=this.material(candidate.contentRef);candidate.dependencies.forEach(ref=>this.material(ref));
          const projected=z.object({kind:z.string(),content:z.string(),category:z.string(),applicability:z.string(),reason:z.string(),instructionAuthority:z.literal(false)}).parse(JSON.parse(item.text));
          if(projected.content!==material.text||projected.category!==candidate.kind||projected.applicability!==candidate.applicability||projected.reason!==candidate.reason)this.fail('EVALUATION_SOURCE_CONTEXT_CHANGED');
          if(trial){
            const selectionVersion=Number(item.version.split(':')[1]),selectedRow=this.memory.prepare('SELECT body,body_hash FROM persona_trial_selection_revisions WHERE agent_id=? AND scope_key=? AND version=?').get(this.scope.agentId,scopeKey(this.scope),selectionVersion);
            if(!selectedRow)this.fail('EVALUATION_SOURCE_STALE');const selection=PersonaTrialSelectionSchema.parse(JSON.parse(String(selectedRow.body))),selectionRef={agentId:this.scope.agentId,scopeKey:scopeKey(this.scope),version:selectionVersion,hash:String(selectedRow.body_hash)};
            if(runtimeHash(selection)!==selectedRow.body_hash||runtimeHash(selection.scope)!==runtimeHash(this.scope)||!selection.entries.some(entry=>entry.candidate.id===id&&entry.candidate.version===version))this.fail('EVALUATION_SOURCE_CONTEXT_CHANGED');
            const expectedSources=[{ref:`dafeiyu:persona-trial:${id}`,version:item.version,hash:runtimeHash({text:item.text,dependencies:candidate.dependencies,selection:selectionRef})}];
            if(projected.kind!=='stage-persona-trial'||runtimeHash(item.sources)!==runtimeHash(expectedSources))this.fail('EVALUATION_SOURCE_CONTEXT_CHANGED');
            const admissions=this.memory.prepare('SELECT body,body_hash FROM persona_trial_admissions WHERE agent_id=? AND scope_key=? AND candidate_id=? AND candidate_version=? AND selection_version=?').all(this.scope.agentId,scopeKey(this.scope),id,version,selectionVersion);
            if(!admissions.some(row=>{const admission=PersonaTrialAdmissionSchema.parse(JSON.parse(String(row.body)));return runtimeHash(admission)===row.body_hash&&admission.projectionHash===runtimeHash(item)&&(!this.asOf||Date.parse(admission.admittedAt)<=Date.parse(this.asOf));}))this.fail('EVALUATION_SOURCE_TRIAL_NOT_ADMITTED');
            const atVersion=this.asOf?this.personaVersionAt(id):Number(candidateRow.current_version);
            if(atVersion!==version||(!this.asOf&&candidateRow.current_state!=='trial'))this.checkPromotion(id,version,atVersion);
          }else{
            if(projected.kind!=='stage-persona'||runtimeHash(item.sources)!==runtimeHash([{ref:`dafeiyu:persona:${id}`,version:item.version,hash:runtimeHash({text:item.text,dependencies:candidate.dependencies})}]))this.fail('EVALUATION_SOURCE_CONTEXT_CHANGED');
            if((this.asOf?this.personaVersionAt(id):Number(candidateRow.current_version))!==version||!this.asOf&&candidateRow.current_state!=='adopted')this.fail('EVALUATION_SOURCE_STALE');
          }
          return;
        }
        this.fail('EVALUATION_SOURCE_CONTEXT_UNSUPPORTED');
      }
      if(dependency.kind==='ephemeral'&&dependency.traceId===this.consumerRunId)return;
      this.fail('EVALUATION_SOURCE_TYPE_UNSUPPORTED');
    }finally{this.checking.delete(key);}
  }
  private personaVersionAt(id:string):number{
    let version=0;for(const row of this.memory.prepare("SELECT body FROM persona_outbox WHERE json_extract(body,'$.data.id')=? OR json_extract(body,'$.type')='persona.published' ORDER BY ordinal").all(id)){
      const event=z.object({type:z.string(),scope:ExecutionScopeSchema,at:z.iso.datetime(),data:z.object({id:z.string().optional(),version:z.number().optional(),entries:z.array(z.object({id:z.string(),version:z.number()})).optional()})}).parse(JSON.parse(String(row.body)));
      if(runtimeHash(event.scope)!==runtimeHash(this.scope)||Date.parse(event.at)>Date.parse(this.asOf!))continue;
      const next=event.type==='persona.published'?event.data.entries?.find(entry=>entry.id===id)?.version:['persona.proposed','persona.reviewed','persona.withdrawn'].includes(event.type)&&event.data.id===id?event.data.version:undefined;
      if(next!==undefined){if(next<=version)this.fail('EVALUATION_SOURCE_HISTORY_INVALID');version=next;}
    }
    if(version)return version;
    const legacy=this.memory.prepare('SELECT body FROM persona_candidate_revisions WHERE id=? AND version=1').get(id);if(legacy&&PersonaCandidateRevisionSchema.parse(JSON.parse(String(legacy.body))).schemaVersion===1)return 1;
    this.fail('EVALUATION_SOURCE_HISTORY_INVALID');
  }
  private checkPromotion(id:string,trialVersion:number,currentVersion:number):void{
    const row=this.memory.prepare('SELECT body,body_hash FROM persona_candidate_revisions WHERE id=? AND version=?').get(id,currentVersion);
    if(!row)this.fail('EVALUATION_SOURCE_STALE');const candidate=PersonaCandidateRevisionSchema.parse(JSON.parse(String(row.body)));
    if(runtimeHash(candidate)!==row.body_hash||candidate.schemaVersion!==2||candidate.state!=='adopted'||candidate.version!==trialVersion+1||!candidate.adoption)this.fail('EVALUATION_SOURCE_STALE');
    const saved=this.memory.prepare('SELECT body,body_hash FROM persona_adoption_decisions WHERE id=? AND agent_id=? AND scope_key=?').get(candidate.adoption.decision.id,this.scope.agentId,scopeKey(this.scope));
    if(!saved||saved.body_hash!==candidate.adoption.decision.hash)this.fail('EVALUATION_SOURCE_STALE');const decision=PersonaAdoptionDecisionSchema.parse(JSON.parse(String(saved.body)));
    if(runtimeHash(decision)!==saved.body_hash||decision.eligibility!=='allowed'||decision.candidate.id!==id||decision.candidate.version!==trialVersion||runtimeHash(decision.review)!==runtimeHash(candidate.adoption.review))this.fail('EVALUATION_SOURCE_STALE');
    const stageRow=this.asOf?this.memory.prepare('SELECT body,body_hash FROM persona_profile_revisions WHERE agent_id=? AND revision=?').get(this.scope.agentId,decision.stageRevision+1)
      :this.memory.prepare('SELECT r.body,r.body_hash FROM persona_profiles p JOIN persona_profile_revisions r ON r.agent_id=p.agent_id AND r.revision=p.revision WHERE p.agent_id=?').get(this.scope.agentId);
    if(!stageRow)this.fail('EVALUATION_SOURCE_STALE');const stage=PersonaStageSchema.parse(JSON.parse(String(stageRow.body)));if(runtimeHash(stage)!==stageRow.body_hash||!stage.entries.some(entry=>entry.id===id&&entry.version===candidate.version))this.fail('EVALUATION_SOURCE_STALE');
  }
  inspect(ref:PersonaSourceRef){try{const value=this.material(ref);return {source:ref,current:true as const,text:value.text,evidence:value.evidence,error:null};}catch(error){return {source:ref,current:false as const,text:null,evidence:null,error:error instanceof Error&&/^EVALUATION_[A-Z_]+$/.test(error.message)?error.message:'EVALUATION_SOURCE_PROOF_INVALID'};}}
}
