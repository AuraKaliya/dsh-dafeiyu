import type { Context } from '@deepseek-ai/cordis';
import type { PersonaAccess,PersonaSourceRef,ActionCapabilityV3,ExecutionContextV3 } from '@dafeiyu/contracts';
import { PersonaSourceRefSchema,PersonaKindSchema,PersonaRequestIdSchema,ExecutionScopeSchema,RunOriginSchema,ExecutionContributionSchema,TaskObjectionSchema,PersonaTrialSelectInputSchema } from '@dafeiyu/contracts';
import type { ExecutionMemoryPort } from '@dafeiyu/contracts';
import { z } from 'zod';
import type { MemoryStore } from './store.js';
import type { TaskWorkspace } from './task-workspace.js';
import type { PersonaMaterial } from './persona-store.js';
import { PersonaStore } from './persona-store.js';
import { ExecutionSources } from './execution-sources.js';
import { personaDigest,sourceKey } from './persona-digest.js';
import { MEMORY_VERSION } from './types.js';
import { MemoryCompaction } from './compaction.js';
import type { compactionConfigSchema } from './compaction.js';
import { evidenceSelectionSchema } from './execution-memory-state.js';
import type { ExecutionMemoryState } from './execution-memory-state.js';
import { personaScope,uniqueSources } from './persona-digest.js';
import type { ExperienceStore } from './experience-store.js';

const auditSchema=z.strictObject({id:z.uuid(),type:z.string(),scope:ExecutionScopeSchema,runId:z.uuid(),origin:RunOriginSchema,operationId:z.string(),causedBy:z.string().nullable(),producer:z.string(),at:z.iso.datetime(),data:z.record(z.string(),z.json())});
const proposal=z.strictObject({requestId:PersonaRequestIdSchema,kind:PersonaKindSchema,text:z.string().trim().min(1).max(8000),sources:z.array(z.string().max(300)).max(16).default([]),
  counters:z.array(z.string().max(300)).max(16).default([]),applicability:z.string().trim().min(1).max(1000),reason:z.string().trim().min(1).max(1000)});
const control={requestId:PersonaRequestIdSchema,id:z.uuid(),expectedVersion:z.number().int().positive(),reason:z.string().trim().min(1).max(1000)};
export class PersonaService {
  readonly experiences:ExperienceStore;
  private readonly store:PersonaStore;
  private readonly sources:ExecutionSources;
  private readonly resolving=new Set<string>();
  private readonly unbind:()=>void;
  private readonly unbindExecution:()=>void;
  private readonly executionState:ExecutionMemoryState;
  private readonly executionHandle:ReturnType<Context['dafeiyu']['registerExtensionV3']>;
  private readonly handle:ReturnType<Context['dafeiyu']['registerExtensionV3']>;
  constructor(private readonly ctx:Context,private readonly memory:MemoryStore,private readonly tasks:TaskWorkspace,private readonly agentId:string,private readonly ready:()=>boolean,compaction?:z.input<typeof compactionConfigSchema>,maintenanceEnabled=false){
    this.experiences=memory.experienceStore((access,ref)=>this.resolve(access,ref));
    this.sources=memory.executionSources((access,ref)=>this.resolve(access,ref));this.store=memory.personaStore((access,ref)=>this.resolve(access,ref));
    this.executionState=memory.executionState(this.sources,(access,ref)=>this.resolve(access,ref));
    const compact=compaction?new MemoryCompaction(ctx,compaction,scope=>({epoch:String(memory.generation(scope)),taskId:null,versions:{memory:memory.generation(scope)}}),{inbound:()=>[],context:()=>[],tool:()=>[],validate:()=>false}):null;
    const port:ExecutionMemoryPort={ready,resourceEpoch:access=>ctx.dafeiyu.capabilityResourceEpoch({agentId:access.view.scope.agentId,route:personaScope(access.view.scope)}),validate:(access,ref)=>!!this.resolve(access,ref),
      ...(maintenanceEnabled?{recordLifecycle:(event:import('@dafeiyu/contracts').MaintenanceLifecycle)=>{this.experiences.recordLifecycle(event);}}:{}),
      operationSources:(access,id)=>uniqueSources([...this.sources.operationSources(access,id),...this.executionState.operationSources(access,id),...memory.capabilities.operationSources(access,id)]),
      outcomeSources:(access,refs)=>refs.map(ref=>{const source=this.sources.reference(access,ref.id)??memory.capabilities.reference({agentId,route:personaScope(access.view.scope)},ref.id);if(!source||source.scopeKey!==ref.scopeKey||source.version!==ref.version||source.contentHash!==ref.contentHash||!this.resolve(access,source))throw new Error('SOURCE_STALE');return source;}),
      prepareContext:access=>this.executionState.context(access),validateContext:(access,item)=>this.executionState.validateContext(access,item),
      captureContinuity:(access,checkpoint)=>{try{return this.executionState.capture(access,checkpoint);}finally{this.flush();}},checkpoint:(access,id,historical)=>this.executionState.checkpoint(access,id,historical),
      bindResult:(task,run,epoch,body)=>this.executionState.bindResult(task,run,epoch,body),generation:access=>this.executionState.generation(access),
      acceptIntent:access=>{try{this.executionState.acceptIntent(access);}finally{this.flush();}},intent:access=>this.executionState.intent(access),
      resolveIntent:(access,input)=>{try{return this.executionState.resolveIntent(access,input);}finally{this.flush();}},
      ...(compact?{compactionPolicy:compact.policy,summarize:compact.summarize.bind(compact),summarizeFragments:compact.summarizeFragments.bind(compact),rewrite:compact.rewrite.bind(compact)}:{summarize:async()=>{throw new Error('COMPACTION_NOT_CONFIGURED');}})};
    this.unbindExecution=ctx.dafeiyu.bindExecutionMemory(port);
    this.unbind=ctx.dafeiyu.bindPersonaProvider({ready,prepare:access=>this.store.prepare(access),validate:(access,entry)=>this.ready()&&this.store.validate(access,entry),
      validateHistoricalTrial:(access,dependency)=>this.ready()&&this.store.validateHistoricalTrial(access,dependency),
      trialAdmitted:(input,authority)=>{try{return this.store.admitTrial(ctx.dafeiyu.personaTrialAccess(authority,input),input);}finally{this.flush();}},
      completeTrial:(input,authority)=>{try{return this.store.completeTrial(ctx.dafeiyu.personaTrialAccess(authority,input),input);}finally{this.flush();}}});
    try{this.handle=ctx.dafeiyu.registerExtensionV3({protocolVersion:3,id:'memory-persona',version:MEMORY_VERSION,agentId,requires:['persona.stage-state.v1'],lifecycleReady:ready,actions:this.actions()});}
    catch(error){this.unbind();this.unbindExecution();throw error;}
    this.executionHandle=ctx.dafeiyu.registerExtensionV3({protocolVersion:3,id:'memory-execution',version:MEMORY_VERSION,agentId,requires:['memory.execution.v1'],lifecycleReady:ready,actions:this.executionActions()});
  }
  resolve(access:PersonaAccess,ref:PersonaSourceRef):PersonaMaterial|null{
    access.guard();if(!this.ready()||ref.agentId!==this.agentId||access.view.scope.agentId!==this.agentId)return null;
    const key=`${access.view.runId}:${sourceKey(ref)}`;if(this.resolving.has(key)||this.resolving.size>=64)return null;this.resolving.add(key);
    try{
      if(ref.kind==='execution-source')return this.experiences.sourceCurrent(access,ref)?this.memory.capabilities.material(access,ref)??this.sources.open(access,ref):null;
      if(access.view.scope.kind==='task'){
        if(ref.scopeKey===access.view.scope.scopeKey)return this.memory.capabilities.memoryMaterial(access,ref)??this.executionState.memoryMaterial(access,ref);
        const input=access.inputs.find(input=>input.sourceRef&&personaDigest(input.sourceRef)===personaDigest(ref));
        if(input)return {text:input.text,dependencies:[ref],rootSources:input.rootSources??[sourceKey(ref)]};
        const material=access.verifyMemorySource?.(ref);return material?{text:material.text,dependencies:[ref],rootSources:[...material.rootSources]}:null;
      }
      if(ref.scopeKey!==access.view.scope.route||ref.authorization||ref.range||ref.selectionId)return null;const scope={agentId:this.agentId,route:ref.scopeKey};
      const memory=this.memory.read(scope,ref.id,'normal',ref.revision,'expression');if(!memory||memory.version!==ref.version||memory.contentHash!==ref.contentHash)return null;
      const proof=this.tasks.memoryProof(scope,ref.id,ref.revision,ref.version,ref.contentHash);if(!proof||proof.kind!=='memory')return null;
      const dependencies=proof.ancestors.map(parent=>PersonaSourceRefSchema.parse({kind:'memory',agentId:this.agentId,scopeKey:ref.scopeKey,...parent}));
      return {text:memory.content,dependencies,rootSources:[...new Set(proof.fences.map(fence=>JSON.stringify(['timeline',this.agentId,ref.scopeKey,this.ctx.dafeiyuTimeline.archivedSourceIdentity(scope,fence.ref)??fence.ref])))]};
    }catch{return null;}finally{this.resolving.delete(key);}
  }
  private access(context:ExecutionContextV3,pluginId:string,write:boolean){if(!this.ready())throw new Error('DEPENDENCY_UNAVAILABLE');return this.ctx.dafeiyu.personaAccess(context,pluginId,write?'local-write':'read');}
  derive(access:PersonaAccess,requestId:string,text:string,refs:readonly PersonaSourceRef[]){return this.sources.selfReport(access,requestId,text,refs);}
  expose(access:PersonaAccess,ref:PersonaSourceRef){this.executionState.expose(access,ref);}
  proposeAnalyzed(access:PersonaAccess,input:unknown){return this.store.propose(access,input);}
  propose(context:ExecutionContextV3,raw:unknown,pluginId='memory-persona'){
    const access=this.access(context,pluginId,true),input=proposal.parse(raw);
    const resolveKey=(key:string)=>{const ref=access.inputs.find(input=>input.id===key)?.sourceRef??access.admittedSources.find(ref=>key===(ref.kind==='execution-source'?`execution-source:${ref.id}`:`memory:${ref.id}:${ref.revision}`));
      if(!ref||!this.resolve(access,ref))throw new Error('SOURCE_NOT_EXPOSED');return ref;};
    const supports=input.sources.map(resolveKey),counters=input.counters.map(resolveKey);
    try{return this.memory.atomic(()=>{const contentRef=this.sources.selfReport(access,`persona:${personaDigest(input.requestId)}`,input.text,[...supports,...counters]);
      return this.store.propose(access,{requestId:input.requestId,kind:input.kind,contentRef,supports,counters,applicability:input.applicability,reason:input.reason});});}finally{this.flush();}
  }
  /** Trusted program adapter: references are still checked against the live execution scope. */
  proposeReference(context:ExecutionContextV3,raw:unknown,pluginId:string){try{return this.store.propose(this.access(context,pluginId,true),raw);}finally{this.flush();}}
  review(context:ExecutionContextV3,raw:unknown,pluginId='memory-persona'){try{return this.store.review(this.access(context,pluginId,true),raw);}finally{this.flush();}}
  selectTrial(context:ExecutionContextV3,raw:unknown,pluginId='memory-persona'){try{return this.store.selectTrial(this.access(context,pluginId,true),raw);}finally{this.flush();}}
  publish(context:ExecutionContextV3,raw:unknown,pluginId='memory-persona'){try{return this.store.publish(this.access(context,pluginId,true),raw);}finally{this.flush();}}
  select(context:ExecutionContextV3,raw:unknown,pluginId='memory-persona'){try{return this.store.select(this.access(context,pluginId,true),raw);}finally{this.flush();}}
  withdraw(context:ExecutionContextV3,raw:unknown,pluginId='memory-persona'){try{return this.store.withdraw(this.access(context,pluginId,true),raw);}finally{this.flush();}}
  status(context:ExecutionContextV3,pluginId='memory-persona'){return this.store.status(this.access(context,pluginId,false));}
  recordObservation(context:ExecutionContextV3,raw:unknown,pluginId:string){try{return this.sources.observe(this.access(context,pluginId,false),raw);}finally{this.flush();}}
  openSource(context:ExecutionContextV3,raw:unknown,pluginId='memory-execution'){
    const input=z.strictObject({source:PersonaSourceRefSchema,offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(8000).default(2000)}).parse(raw),access=this.access(context,pluginId,false),material=this.resolve(access,input.source);
    if(!material)throw new Error('SOURCE_STALE');const chars=Array.from(material.text);if(input.offset>chars.length)throw new Error('INVALID_INPUT');const end=Math.min(chars.length,input.offset+input.limit);
    try{this.executionState.expose(access,input.source);const capability=this.memory.capabilities.reference({agentId:access.view.scope.agentId,route:personaScope(access.view.scope)},input.source.id);
      const meta=input.source.kind==='execution-source'&&!capability?this.sources.metadata(access,input.source):null;return {source:input.source,view:capability?'observation-metadata':'page',rawAvailable:!capability,text:chars.slice(input.offset,end).join(''),offset:input.offset,end,total:chars.length,nextOffset:end<chars.length?end:null,
      sourceKind:meta?.kind??'contribution',sourceCompleteness:meta?.schemaVersion===2?meta.completeness:'unknown',coverage:meta?.schemaVersion===2?meta.coverage:[],pageCompleteness:input.offset===0&&end===chars.length?'complete':'partial'};}finally{this.flush();}
  }
  contribute(context:ExecutionContextV3,raw:unknown,pluginId='memory-execution'){try{return this.executionState.contribute(this.access(context,pluginId,true),raw);}finally{this.flush();}}
  selectEvidence(context:ExecutionContextV3,raw:unknown,pluginId='memory-execution'){try{return this.executionState.select(this.access(context,pluginId,true),raw);}finally{this.flush();}}
  changeSource(context:ExecutionContextV3,raw:unknown,pluginId='memory-execution'){try{return this.sources.change(this.access(context,pluginId,true),raw);}finally{this.flush();}}
  changeContribution(context:ExecutionContextV3,raw:unknown,pluginId='memory-execution'){try{return this.executionState.changeContribution(this.access(context,pluginId,true),raw);}finally{this.flush();}}
  object(context:ExecutionContextV3,raw:unknown,pluginId='memory-execution'){try{return this.executionState.object(this.access(context,pluginId,true),raw);}finally{this.flush();}}
  intent(context:ExecutionContextV3,pluginId='memory-execution'){return this.executionState.intent(this.access(context,pluginId,false));}
  private executionActions():ActionCapabilityV3[]{
    const make=(id:string,description:string,schema:z.ZodType,write:boolean,execute:(context:ExecutionContextV3,input:unknown)=>unknown):ActionCapabilityV3=>({id,description,version:'1',inputSchema:schema,outputSchema:z.json(),effects:write?'local-write':'read',requiresTask:true,
      execute:async(input,context)=>{try{return {status:'succeeded',effects:write?'confirmed':'none',completeness:'complete',data:z.json().parse(execute(context,input)),sources:[],receipts:[]};}
      catch(error){const code=error instanceof z.ZodError?'INVALID_INPUT':error instanceof Error?error.message:'';
        if(!['INVALID_INPUT','IDEMPOTENCY_CONFLICT','VERSION_CONFLICT','SOURCE_STALE','SOURCE_STATE_CONFLICT','SCOPE_DENIED','TASK_NOT_ACTIVE','TASK_REQUIRED','PRIVATE_INPUT_REJECTED','CAPACITY_EXCEEDED','INVALID_OBJECTION','source_unavailable','version_conflict','idempotency_conflict'].includes(code))throw error;
        return {status:'failed',effects:'none',completeness:'unknown',data:null,sources:[],receipts:[],errorCode:code.toUpperCase()};}}});
    return [
      make('dafeiyu_execution_source_open','分页回查当前任务合法来源。返回覆盖范围和缺口，不能据此声称理解了未返回的内容。',z.strictObject({source:PersonaSourceRefSchema,offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(8000).default(2000)}),false,(c,i)=>this.openSource(c,i)),
      make('dafeiyu_execution_contribute','选择保存当前任务的观察原文、明确片段或推断摘要。内部任务可用，对外表达关闭；任务经历不等于个人偏好。',ExecutionContributionSchema,true,(c,i)=>this.contribute(c,i)),
      make('dafeiyu_execution_select','选择下轮要装入的精确证据版本，空数组清除选择；内容超预算时明确省略。',evidenceSelectionSchema,true,(c,i)=>this.selectEvidence(c,i)),
      make('dafeiyu_execution_source_state','逻辑删除或恢复来源；恢复产生新版本，旧证明不会复活。',z.strictObject({requestId:PersonaRequestIdSchema,id:z.uuid(),expectedVersion:z.number().int().positive(),deleted:z.boolean()}),true,(c,i)=>this.changeSource(c,i)),
      make('dafeiyu_execution_contribution_state','逻辑删除或恢复当前任务内部的记忆贡献；不改变源资料，也不恢复旧授权。',z.strictObject({requestId:PersonaRequestIdSchema,id:z.uuid(),expectedVersion:z.number().int().positive(),deleted:z.boolean(),reason:z.string().trim().min(1).max(500)}),true,(c,i)=>this.changeContribution(c,i)),
      make('dafeiyu_task_object','持久记录仍影响受托目标的异议。前提、信息或权限缺口尚未解决时，列出实际受影响的能力并设blocking；口头解释和部分交付不能代替登记。仅阻断这些步骤，独立可做部分继续；只有确实影响整个任务才让actions为空。先查询已有意图避免重复。偏好、方法建议不阻断，已经解决的可选探查失败不登记。不会擅自修改目标。',TaskObjectionSchema,true,(c,i)=>this.object(c,i)),
      make('dafeiyu_task_intent','查看当前任务的动机、异议和已解决记录。只有受信任务生产者能确认解决阻断异议。',z.strictObject({}),false,c=>this.intent(c)),
    ];
  }
  private actions():ActionCapabilityV3[]{
    const make=(id:string,description:string,inputSchema:z.ZodType,write:boolean,execute:(context:ExecutionContextV3,input:unknown)=>unknown,requiresTask=false):ActionCapabilityV3=>({id,version:'1',description,inputSchema,outputSchema:z.json(),effects:write?'local-write':'read',requiresTask,
      execute:async(input,context)=>{try{return {status:'succeeded',effects:write?'confirmed':'none',completeness:'complete',data:z.json().parse(execute(context,input)),sources:[],receipts:[]};}
        catch(error){const code=error instanceof z.ZodError?'INVALID_INPUT':error instanceof Error?error.message:'';
          if(!['INVALID_INPUT','IDEMPOTENCY_CONFLICT','VERSION_CONFLICT','SOURCE_STALE','SCOPE_DENIED','SOURCE_NOT_EXPOSED','INSUFFICIENT_EVIDENCE','PRIVATE_INPUT_REJECTED','PERSONA_TRANSITION_FORBIDDEN','PERSONA_REVIEW_REQUIRED','TASK_REQUIRED','TASK_NOT_ACTIVE','DEPENDENCY_UNAVAILABLE'].includes(code))throw error;
          return {status:'failed',effects:'none',completeness:'unknown',data:null,sources:[],receipts:[],errorCode:code};}}});
    return [
      make('dafeiyu_persona_propose','提出暂定认识。text是自述，不是世界事实。sources/counters只接受已曝光的task-link输入、execution-source:来源ID或memory:记忆ID:修订号。不会直接改变底色或稳定偏好。',proposal,true,(context,input)=>this.propose(context,input),true),
      make('dafeiyu_persona_review','明确复核自己的候选。trial表示试行，held表示仍需比较，rejected表示不采用；不能靠评分直接证明成长。',z.strictObject({...control,state:z.enum(['held','trial','rejected'])}),true,(context,input)=>this.review(context,input)),
      make('dafeiyu_persona_trial_select','选择下一轮实际使用的精确trial候选及适用、退出条件。它仍是暂定认识，不会成为已采用人格；空数组撤下本范围试行选择。实际使用和闭合结果由核心记录，不可自行声明完成试行。',PersonaTrialSelectInputSchema,true,(context,input)=>this.selectTrial(context,input)),
      make('dafeiyu_persona_publish','采用已试行的精确候选版本，并保留证据与反证。只修改本范围阶段选择，不改底色、任务或平台权限。',z.strictObject({requestId:PersonaRequestIdSchema,expectedStageVersion:z.number().int().nonnegative(),entries:z.array(z.strictObject({id:z.uuid(),version:z.number().int().positive()})).min(1).max(32)}),true,(context,input)=>this.publish(context,input)),
      make('dafeiyu_persona_select','选择当前场景中已经采用且仍有效的阶段条目；空数组明确撤下该场景的全部选择。',z.strictObject({requestId:PersonaRequestIdSchema,expectedSelectionVersion:z.number().int().nonnegative(),entries:z.array(z.strictObject({id:z.uuid(),version:z.number().int().positive()})).max(32)}),true,(context,input)=>this.select(context,input)),
      make('dafeiyu_persona_withdraw','撤下有版本的阶段认识，保留历史。后续不会通过恢复旧快照自动重新采用。',z.strictObject(control),true,(context,input)=>this.withdraw(context,input)),
      make('dafeiyu_persona_status','查看当前场景候选版本、可用性和选择版本；不读取其它场景正文。',z.strictObject({}),false,context=>this.status(context)),
    ];
  }
  flush(){const append=(raw:unknown,id:string)=>{const event=auditSchema.parse(raw),scope=event.scope;
    if(scope.agentId!==this.agentId)throw new Error('SCOPE_DENIED');
    if(scope.kind==='task')this.ctx.dafeiyu.journal.appendExecutionOnce({agentId:this.agentId,taskId:scope.taskId,runId:event.runId,route:scope.scopeKey,traceId:event.runId,operationId:event.operationId,causedBy:event.causedBy,
      type:event.type,plugin:'memory',pluginVersion:MEMORY_VERSION,occurredAt:event.at,sources:[],data:event.data},id);
    else{if(event.origin.kind!=='message')throw new Error('SCOPE_DENIED');this.ctx.dafeiyu.journal.appendOnce({agentId:this.agentId,route:scope.route,traceId:event.origin.inboundId,operationId:event.operationId,causedBy:event.causedBy,type:event.type,
      plugin:'memory',pluginVersion:MEMORY_VERSION,occurredAt:event.at,sources:[],data:event.data},id);}};
    return this.sources.drainOutbox(append)+this.store.drainOutbox(append)+this.memory.drainOutbox((event,id)=>{this.ctx.dafeiyu.journal.appendOnce(event,id);},(event,id)=>{this.ctx.dafeiyu.journal.appendExecutionOnce(event,id);});
  }
  close(){this.executionHandle.dispose();this.handle.dispose();this.unbind();this.unbindExecution();}
}
