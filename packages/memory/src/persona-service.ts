import type { Context } from '@deepseek-ai/cordis';
import type { PersonaAccess,PersonaSourceRef,ActionCapabilityV3,ExecutionContextV3 } from '@dafeiyu/contracts';
import { PersonaSourceRefSchema,PersonaKindSchema,PersonaRequestIdSchema,ExecutionScopeSchema,RunOriginSchema } from '@dafeiyu/contracts';
import { z } from 'zod';
import type { MemoryStore } from './store.js';
import type { TaskWorkspace } from './task-workspace.js';
import type { PersonaMaterial } from './persona-store.js';
import { PersonaStore } from './persona-store.js';
import { ExecutionSources } from './execution-sources.js';
import { personaDigest,sourceKey } from './persona-digest.js';
import { MEMORY_VERSION } from './types.js';

const auditSchema=z.strictObject({id:z.uuid(),type:z.string(),scope:ExecutionScopeSchema,runId:z.uuid(),origin:RunOriginSchema,operationId:z.string(),causedBy:z.string().nullable(),producer:z.string(),at:z.iso.datetime(),data:z.record(z.string(),z.json())});
const proposal=z.strictObject({requestId:PersonaRequestIdSchema,kind:PersonaKindSchema,text:z.string().trim().min(1).max(8000),sources:z.array(z.string().max(300)).max(16).default([]),
  counters:z.array(z.string().max(300)).max(16).default([]),applicability:z.string().trim().min(1).max(1000),reason:z.string().trim().min(1).max(1000)});
const control={requestId:PersonaRequestIdSchema,id:z.uuid(),expectedVersion:z.number().int().positive(),reason:z.string().trim().min(1).max(1000)};
export class PersonaService {
  private readonly store:PersonaStore;
  private readonly sources:ExecutionSources;
  private readonly resolving=new Set<string>();
  private readonly unbind:()=>void;
  private readonly handle:ReturnType<Context['dafeiyu']['registerExtensionV3']>;
  constructor(private readonly ctx:Context,private readonly memory:MemoryStore,private readonly tasks:TaskWorkspace,private readonly agentId:string,private readonly ready:()=>boolean){
    this.sources=memory.executionSources((access,ref)=>this.resolve(access,ref));this.store=memory.personaStore((access,ref)=>this.resolve(access,ref));
    this.unbind=ctx.dafeiyu.bindPersonaProvider({ready,prepare:access=>this.store.prepare(access),validate:(access,entry)=>this.ready()&&this.store.validate(access,entry)});
    try{this.handle=ctx.dafeiyu.registerExtensionV3({protocolVersion:3,id:'memory-persona',version:MEMORY_VERSION,agentId,requires:['persona.stage-state.v1'],lifecycleReady:ready,actions:this.actions()});}
    catch(error){this.unbind();throw error;}
  }
  private resolve(access:PersonaAccess,ref:PersonaSourceRef):PersonaMaterial|null{
    access.guard();if(!this.ready()||ref.agentId!==this.agentId||access.view.scope.agentId!==this.agentId)return null;
    const key=`${access.view.runId}:${sourceKey(ref)}`;if(this.resolving.has(key)||this.resolving.size>=64)return null;this.resolving.add(key);
    try{
      if(ref.kind==='execution-source')return this.sources.open(access,ref);
      if(access.view.scope.kind==='task'){
        const input=access.inputs.find(input=>input.sourceRef&&personaDigest(input.sourceRef)===personaDigest(ref));
        return input?{text:input.text,dependencies:[ref],rootSources:input.rootSources??[sourceKey(ref)]}:null;
      }
      if(ref.scopeKey!==access.view.scope.route||ref.authorization||ref.range||ref.selectionId)return null;const scope={agentId:this.agentId,route:ref.scopeKey};
      const memory=this.memory.read(scope,ref.id,'normal',ref.revision,'expression');if(!memory||memory.version!==ref.version||memory.contentHash!==ref.contentHash)return null;
      const proof=this.tasks.memoryProof(scope,ref.id,ref.revision,ref.version,ref.contentHash);if(!proof||proof.kind!=='memory')return null;
      const dependencies=proof.ancestors.map(parent=>PersonaSourceRefSchema.parse({kind:'memory',agentId:this.agentId,scopeKey:ref.scopeKey,...parent}));
      return {text:memory.content,dependencies,rootSources:[...new Set(proof.fences.map(fence=>JSON.stringify(['timeline',this.agentId,ref.scopeKey,this.ctx.dafeiyuTimeline.archivedSourceIdentity(scope,fence.ref)??fence.ref])))]};
    }catch{return null;}finally{this.resolving.delete(key);}
  }
  private access(context:ExecutionContextV3,pluginId:string,write:boolean){if(!this.ready())throw new Error('DEPENDENCY_UNAVAILABLE');return this.ctx.dafeiyu.personaAccess(context,pluginId,write?'local-write':'read');}
  propose(context:ExecutionContextV3,raw:unknown,pluginId='memory-persona'){
    const access=this.access(context,pluginId,true),input=proposal.parse(raw);
    const resolveKey=(key:string)=>{const ref=access.inputs.find(input=>input.id===key)?.sourceRef;
      if(!ref||!this.resolve(access,ref))throw new Error('SOURCE_NOT_EXPOSED');return ref;};
    const supports=input.sources.map(resolveKey),counters=input.counters.map(resolveKey);
    try{return this.memory.atomic(()=>{const contentRef=this.sources.selfReport(access,`persona:${personaDigest(input.requestId)}`,input.text,[...supports,...counters]);
      return this.store.propose(access,{requestId:input.requestId,kind:input.kind,contentRef,supports,counters,applicability:input.applicability,reason:input.reason});});}finally{this.flush();}
  }
  /** Trusted program adapter: references are still checked against the live execution scope. */
  proposeReference(context:ExecutionContextV3,raw:unknown,pluginId:string){try{return this.store.propose(this.access(context,pluginId,true),raw);}finally{this.flush();}}
  review(context:ExecutionContextV3,raw:unknown,pluginId='memory-persona'){try{return this.store.review(this.access(context,pluginId,true),raw);}finally{this.flush();}}
  publish(context:ExecutionContextV3,raw:unknown,pluginId='memory-persona'){try{return this.store.publish(this.access(context,pluginId,true),raw);}finally{this.flush();}}
  select(context:ExecutionContextV3,raw:unknown,pluginId='memory-persona'){try{return this.store.select(this.access(context,pluginId,true),raw);}finally{this.flush();}}
  withdraw(context:ExecutionContextV3,raw:unknown,pluginId='memory-persona'){try{return this.store.withdraw(this.access(context,pluginId,true),raw);}finally{this.flush();}}
  status(context:ExecutionContextV3,pluginId='memory-persona'){return this.store.status(this.access(context,pluginId,false));}
  private actions():ActionCapabilityV3[]{
    const make=(id:string,description:string,inputSchema:z.ZodType,write:boolean,execute:(context:ExecutionContextV3,input:unknown)=>unknown,requiresTask=false):ActionCapabilityV3=>({id,version:'1',description,inputSchema,outputSchema:z.json(),effects:write?'local-write':'read',requiresTask,
      execute:async(input,context)=>{try{return {status:'succeeded',effects:write?'confirmed':'none',completeness:'complete',data:z.json().parse(execute(context,input)),sources:[],receipts:[]};}
        catch(error){const code=error instanceof z.ZodError?'INVALID_INPUT':error instanceof Error?error.message:'';
          if(!['INVALID_INPUT','IDEMPOTENCY_CONFLICT','VERSION_CONFLICT','SOURCE_STALE','SCOPE_DENIED','SOURCE_NOT_EXPOSED','INSUFFICIENT_EVIDENCE','PRIVATE_INPUT_REJECTED','PERSONA_TRANSITION_FORBIDDEN','PERSONA_REVIEW_REQUIRED','TASK_REQUIRED','TASK_NOT_ACTIVE','DEPENDENCY_UNAVAILABLE'].includes(code))throw error;
          return {status:'failed',effects:'none',completeness:'unknown',data:null,sources:[],receipts:[],errorCode:code};}}});
    return [
      make('dafeiyu_persona_propose','提出当前大肥鱼的暂定认识。text是自述，不代表世界事实。sources/counters仅引用本轮已提供的task-link输入；状态不直接改变底色或稳定偏好。',proposal,true,(context,input)=>this.propose(context,input),true),
      make('dafeiyu_persona_review','明确复核自己的候选。trial表示试行，held表示仍需比较，rejected表示不采用；不能靠评分直接证明成长。',z.strictObject({...control,state:z.enum(['held','trial','rejected'])}),true,(context,input)=>this.review(context,input)),
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
    return this.sources.drainOutbox(append)+this.store.drainOutbox(append);
  }
  close(){this.handle.dispose();this.unbind();}
}
