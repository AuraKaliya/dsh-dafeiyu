import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ExecutionRequestSchema,ResumeRunSchema,WakeRequestSchema,RunControlSchema,ProducerSchema,taskScopeKey,HostConfigSchema,TaskUpdateSchema,redactJson,RunOriginSchema } from '@dafeiyu/contracts';
import type { TaskRepositoryPort,TaskRef,RunRef,RunOrigin,ExecutionContextV3,ExecutionGrant,ExecutionInput,WakeAuthorityProvider,PersonaSnapshot,HostConfig,Json } from '@dafeiyu/contracts';
import type { Journal } from '@dafeiyu/journal';
import { RuntimeStore,runtimeHash } from './runtime-store.js';
import type { StoredRun } from './runtime-store.js';
import type { DshRuntime } from './runtime.js';
import type { CapabilityRegistryV3,BoundActionV3 } from './registry-v3.js';
import type { RunScheduler } from './run-scheduler.js';
import type { NativeAction } from './execution-frame.js';
import { CORE_VERSION } from './version.js';

export const ExecutionOptionsSchema=z.strictObject({profileId:ProducerSchema,createStore:z.boolean().default(false),
  policies:HostConfigSchema.shape.authorityPolicies,maxPendingRuns:z.number().int().min(1).max(1000).default(100),
  maxConcurrentRuns:z.number().int().min(1).max(16).default(2)});
export type ExecutionOptions=z.input<typeof ExecutionOptionsSchema>;
interface Dependencies {
  agentId:string;store:RuntimeStore;journal:Journal;runtime:DshRuntime;registry:CapabilityRegistryV3;scheduler:RunScheduler;
  options:z.output<typeof ExecutionOptionsSchema>;repository:()=>TaskRepositoryPort|undefined;
  accepting:()=>boolean;assertAccepting:()=>void;persona:()=>PersonaSnapshot;model:HostConfig['modelRoutes']['chat'];
  turnTimeoutMs:number;context:{requestMaxBytes:number;outputReserveBytes:number};signal:AbortSignal;
}
interface Active {controller:AbortController;mode:'cancel'|'pause'|null}
type Request=z.output<typeof ExecutionRequestSchema>;
const savedSchema=z.strictObject({kind:z.literal('execution'),input:ExecutionRequestSchema,origin:RunOriginSchema,parentRunId:z.uuid().nullable(),checkpointId:z.uuid().nullable()});

/** Durable acceptance and authority; DSH remains the sole model loop. */
export class ExecutionCoordinator {
  private readonly refs=new WeakMap<RunRef,{producer:string;id:string}>();
  private readonly tasks=new WeakMap<TaskRef,{producer:string;id:string}>();
  private readonly grants=new WeakMap<ExecutionContextV3,{action:BoundActionV3;runId:string;guard:()=>void}>();
  private readonly active=new Map<string,Active>();
  private readonly queued=new Map<string,Promise<void>>();
  private readonly taskQueues=new Map<string,Promise<void>>();
  private readonly wakes=new Map<string,WakeAuthorityProvider>();
  private failure:string|null=null;
  constructor(private readonly d:Dependencies){}
  private repository(){const value=this.d.repository();if(!value)throw new Error('DEPENDENCY_UNAVAILABLE');return value;}
  private policy(producer:string,id:string){const value=this.d.options.policies.find(p=>p.id===id&&p.producers.includes(producer));if(!value)throw new Error('SCOPE_DENIED');return value;}
  private ref(producer:string,run:StoredRun){const reference=Object.freeze({id:run.id});this.refs.set(reference,{producer,id:run.id});return reference;}
  private taskRef(producer:string,id:string){const ref=Object.freeze({id});this.tasks.set(ref,{producer,id});return ref;}
  private resolve(producer:string,ref:RunRef){const authority=this.refs.get(ref);if(authority?.producer!==producer)throw new Error('SCOPE_DENIED');return this.d.store.get(authority.id);}
  private resolveTask(producer:string,ref:TaskRef){const authority=this.tasks.get(ref);if(authority?.producer!==producer)throw new Error('SCOPE_DENIED');return authority.id;}
  producer(raw:string){const producer=ProducerSchema.parse(raw);
    if(!this.d.options.policies.some(policy=>policy.producers.includes(producer)))throw new Error('SCOPE_DENIED');
    return Object.freeze({
      submitTask:(raw:unknown,task?:TaskRef)=>{const input=ExecutionRequestSchema.parse(raw);if('taskId'in input&&(!task||this.resolveTask(producer,task)!==input.taskId))throw new Error('SCOPE_DENIED');return this.submit(producer,input);},
      openTask:(id:string)=>{this.d.assertAccepting();this.repository().readState(this.d.agentId,z.uuid().parse(id));return this.taskRef(producer,id);},
      updateTask:(ref:TaskRef,input:unknown)=>{this.d.assertAccepting();return this.repository().update(this.d.agentId,this.resolveTask(producer,ref),TaskUpdateSchema.parse(input));},
      restoreRun:(id:string)=>{const run=this.d.store.get(id);if(this.d.store.request(run.requestKey).producer!==producer)throw new Error('SCOPE_DENIED');return this.ref(producer,run);},
      status:(ref:RunRef)=>this.status(this.resolve(producer,ref)),
      readResult:async(ref:RunRef)=>{const run=this.resolve(producer,ref);if(run.state!=='completed'||!run.result)return null;
        const guard=()=>{const task=this.repository().readState(this.d.agentId,run.definition.taskId!),saved=savedSchema.parse(this.d.store.request(run.requestKey).payload),policy=this.policy(producer,run.definition.policyId);
          if(task.epoch!==run.definition.intentVersion)throw new Error('SOURCE_STALE');const inputs=this.repository().readSelectedInputs(this.d.agentId,task.id,saved.input.inputRefs,policy.sourceRules);
          if(runtimeHash(inputs.map(input=>({id:input.id,version:input.version,hash:runtimeHash([input.contentHash,input.proofHash]),scopeKey:input.scopeKey})))!==runtimeHash(run.snapshot?.inputs))throw new Error('SOURCE_STALE');};
        guard();const text=await this.d.runtime.readResult(run.result);guard();return text;},
      cancel:(ref:RunRef,input:unknown)=>this.control(producer,this.resolve(producer,ref),input,'cancel'),
      pause:(ref:RunRef,input:unknown)=>this.control(producer,this.resolve(producer,ref),input,'pause'),
      resume:(ref:TaskRef,raw:unknown)=>{this.d.assertAccepting();const input=ResumeRunSchema.parse(raw);
        if(this.resolveTask(producer,ref)!==input.taskId)throw new Error('SCOPE_DENIED');const parent=this.d.store.get(input.parentRunId);
        if(this.d.store.request(parent.requestKey).producer!==producer||parent.definition.taskId!==input.taskId)throw new Error('SCOPE_DENIED');
        if(this.d.store.operations(parent.id).some(op=>op.state==='unknown'||op.outcome?.effects==='unknown'))throw new Error('OPERATION_UNCERTAIN');
        this.d.store.readCheckpoint(parent.id,input.checkpointId);
        const {parentRunId,checkpointId,...request}=input;
        return this.submit(producer,request,{kind:'continuation',parentRunId,checkpointId},parentRunId,checkpointId);},
      acceptWake:(raw:unknown,task:TaskRef)=>{const input=WakeRequestSchema.parse(raw),{origin,...request}=input;if(this.resolveTask(producer,task)!==input.taskId)throw new Error('SCOPE_DENIED');
        if(origin.producerId!==producer||request.requestId!==origin.occurrenceId)throw new Error('SCOPE_DENIED');
        return this.submit(producer,request,origin);},
    });
  }
  bindWake(provider:WakeAuthorityProvider):()=>void{const producer=ProducerSchema.parse(provider.producerId);if(this.wakes.has(producer))throw new Error('DUPLICATE_PROVIDER');
    const bound={producerId:producer,validate:provider.validate.bind(provider)};this.wakes.set(producer,bound);return ()=>{if(this.wakes.get(producer)===bound)this.wakes.delete(producer);};}
  private submit(producer:string,input:Request,origin:RunOrigin={kind:'native',producerId:producer,requestId:input.requestId},parentRunId:string|null=null,checkpointId:string|null=null){
    this.d.assertAccepting();this.policy(producer,input.policyId);
    if(!this.repository().ready())throw new Error('DEPENDENCY_UNAVAILABLE');
    const old=this.d.store.findRequest(producer,input.requestId);
    if(!old&&this.d.store.list(['accepted','queued','running','cancelling']).length>=this.d.options.maxPendingRuns)throw new Error('CAPACITY_EXCEEDED');
    const payload=savedSchema.parse({kind:'execution',input,origin,parentRunId,checkpointId});
    if(redactJson(z.json().parse(payload)).redacted)throw new Error('PRIVATE_INPUT_REJECTED');
    // Validate fresh requests before accepting any state. Repeats are checked against the durable body first.
    if(!old){if('taskId'in input){const task=this.repository().readState(this.d.agentId,input.taskId);
        if(task.version!==input.expectedVersion)throw new Error('VERSION_CONFLICT');if(task.status!=='active')throw new Error('TASK_NOT_ACTIVE');
        this.repository().readSelectedInputs(this.d.agentId,task.id,input.inputRefs,this.policy(producer,input.policyId).sourceRules);
        if(origin.kind==='wake'&&!this.wakes.get(producer)?.validate(origin,task))throw new Error('WAKE_NOT_AUTHORIZED');
      }else if(input.inputRefs.length)throw new Error('SOURCE_STALE');}
    const request=this.d.store.prepareRequest(producer,input.requestId,payload),run=this.accept(request.id);
    this.flushEvents();this.schedule(run);
    return {task:this.taskRef(producer,run.definition.taskId!),run:this.ref(producer,run),state:run.state};
  }
  private accept(requestId:string):StoredRun{
    const request=this.d.store.request(requestId);if(request.runId)return this.d.store.get(request.runId);
    const saved=savedSchema.parse(request.payload),input=saved.input;let taskId=request.taskId;
    if(!taskId){taskId='taskId'in input?input.taskId:this.repository().findRequest(this.d.agentId,`execution:${request.id}`)??this.repository().create(this.d.agentId,{requestId:`execution:${request.id}`,title:input.title,goal:input.goal});this.d.store.bindTask(request.id,taskId);}
    const task=this.repository().readState(this.d.agentId,taskId);
    const definition={taskId,scope:{kind:'task' as const,agentId:this.d.agentId,taskId,scopeKey:taskScopeKey(this.d.agentId,taskId)},origin:saved.origin,intentVersion:task.epoch,policyId:input.policyId,parentRunId:saved.parentRunId};
    const run=saved.origin.kind==='wake'?this.d.store.acceptWake(request.id,definition):this.d.store.acceptRun(request.id,definition);
    if(task.status!=='active'||('taskId'in input&&task.version!==input.expectedVersion))return this.d.store.transition(run.id,run.version,'failed','TASK_NOT_ACTIVE');
    return run;
  }
  recover():void{this.d.store.recover();for(const request of this.d.store.pendingRequests())if(savedSchema.safeParse(request.payload).success)this.accept(request.id);this.flushEvents();}
  activate():void{for(const run of this.d.store.list(['accepted','queued']))if(run.definition.scope.kind==='task')this.schedule(run);}
  private status(run:StoredRun){return {id:run.id,taskId:run.definition.taskId,state:run.state,version:run.version,result:run.result,error:run.error,
    checkpoints:this.d.store.checkpoints(run.id),operations:this.d.store.operations(run.id).map(op=>({id:op.id,action:op.action,state:op.state,status:op.outcome?.status??null,effects:op.outcome?.effects??null,receipts:op.outcome?.receipts??[]}))};}
  private control(producer:string,run:StoredRun,raw:unknown,mode:'cancel'|'pause'){
    const input=RunControlSchema.parse(raw),request=this.d.store.prepareRequest(`control:${producer}`,input.requestId,{kind:'control',runId:run.id,mode,...input});
    if(request.runId)return this.status(this.d.store.get(request.runId));
    const active=this.active.get(run.id);
    if(mode==='pause'&&!active)throw new Error('RUN_NOT_RUNNING');
    const next=this.d.store.control(run.id,request.id,input.expectedVersion,active?'cancelling':'cancelled');
    if(active){active.mode=mode;active.controller.abort();}this.flushEvents();return this.status(next);
  }
  private schedule(run:StoredRun):void{
    if(!['accepted','queued'].includes(run.state)||this.queued.has(run.id))return;
    const taskId=run.definition.taskId!;const previous=this.taskQueues.get(taskId)??Promise.resolve();
    const work=previous.then(()=>this.process(run.id)).catch(()=>{this.failure='PERSISTENCE_FAILED';}).finally(()=>{this.queued.delete(run.id);if(this.taskQueues.get(taskId)===work)this.taskQueues.delete(taskId);});
    this.queued.set(run.id,work);this.taskQueues.set(taskId,work);
  }
  private async process(id:string):Promise<void>{
    const release=await this.d.scheduler.acquire(false);
    try{if(!this.d.accepting()||this.failure)return;let run=this.d.store.get(id);if(!['accepted','queued'].includes(run.state))return;
      const controller=new AbortController(),entry:Active={controller,mode:null};this.active.set(id,entry);
      try{
        if(run.state==='accepted')run=this.d.store.transition(id,run.version,'queued');
        const request=this.d.store.request(run.requestKey),saved=savedSchema.parse(request.payload),policy=this.policy(request.producer,run.definition.policyId),repository=this.repository();
        const task=repository.readState(this.d.agentId,run.definition.taskId!);
        if(task.epoch!==run.definition.intentVersion||task.status!=='active')throw new Error('TASK_NOT_ACTIVE');
        if(run.definition.origin.kind==='wake'&&!this.wakes.get(request.producer)?.validate(run.definition.origin,task))throw new Error('WAKE_NOT_AUTHORIZED');
        const inputs=repository.readSelectedInputs(this.d.agentId,task.id,saved.input.inputRefs,policy.sourceRules),inputHash=runtimeHash(inputs),authorityVersion=runtimeHash(policy);
        const actions=this.d.registry.actions().filter(action=>policy.actions.includes(action.id)&&action.effects!=='external-write'&&(action.effects!=='local-write'||policy.allowLocalWrite));
        const registryVersion=runtimeHash(actions.map(action=>[action.id,action.owner,action.version,action.input,action.effects]));
        const sessionId=this.d.store.session(runtimeHash({task:task.id,epoch:task.epoch,authorityVersion,inputHash,registryVersion})),persona=this.d.persona();
        const signal=AbortSignal.any([this.d.signal,controller.signal,...actions.map(action=>action.signal),AbortSignal.timeout(this.d.turnTimeoutMs)]);
        const guard=()=>{signal.throwIfAborted();if(!repository.ready()||this.d.repository()!==repository)throw new Error('DEPENDENCY_UNAVAILABLE');
          const current=repository.readState(this.d.agentId,task.id);if(current.epoch!==task.epoch||current.status!=='active')throw new Error('TASK_NOT_ACTIVE');
          if(run.definition.origin.kind==='wake'&&!this.wakes.get(request.producer)?.validate(run.definition.origin,current))throw new Error('WAKE_NOT_AUTHORIZED');
          if(runtimeHash(repository.readSelectedInputs(this.d.agentId,task.id,saved.input.inputRefs,policy.sourceRules))!==inputHash)throw new Error('SOURCE_STALE');
          if(actions.some(action=>!action.active()))throw new Error('DEPENDENCY_UNAVAILABLE');};
        run=this.d.store.start(id,run.version,{sessionId,personaVersion:persona.version,model:this.d.model,registryVersion,authorityVersion,
          inputs:inputs.map(input=>({id:input.id,version:input.version,hash:runtimeHash([input.contentHash,input.proofHash]),scopeKey:input.scopeKey}))});
        this.d.store.checkpoint(id,{kind:'run-start',intentVersion:task.epoch});this.flushEvents();
        const view=Object.freeze({runId:id,taskId:task.id,scope:Object.freeze({...run.definition.scope}),origin:Object.freeze({...run.definition.origin}),signal});
        const bound=actions.map(action=>this.bindAction(run,action,signal,guard));
        const result=await this.d.runtime.runExecution({mode:'task',sessionId,view,persona,goal:task.goal,inputs,actions:bound,guard,...this.d.context});
        guard();run=this.d.store.get(id);this.d.store.complete(id,run.version,result.resultRef);
      }catch(error){run=this.d.store.get(id);
        if(entry.mode==='pause'&&run.state==='cancelling'&&!this.d.store.operations(id).some(op=>op.state==='started'||op.state==='unknown'||op.outcome?.effects==='unknown')){
          this.d.store.checkpoint(id,{kind:'paused',operations:this.d.store.operations(id).map(op=>op.id)});this.d.store.transition(id,run.version,'waiting');
        }else if(entry.mode==='cancel'&&run.state==='cancelling'&&!this.d.store.operations(id).some(op=>op.state==='started'||op.state==='unknown'||op.outcome?.effects==='unknown'))this.d.store.transition(id,run.version,'cancelled');
        else if(['queued','running','cancelling'].includes(run.state))this.d.store.transition(id,run.version,run.state==='queued'?'failed':this.d.signal.aborted||entry.mode?'interrupted':'failed',safeCode(error));
      }finally{this.active.delete(id);this.flushEvents();}
    }finally{release();}
  }
  private bindAction(run:StoredRun,action:BoundActionV3,signal:AbortSignal,guard:()=>void):NativeAction{
    return {definition:action,execute:async(raw,callId,toolSignal)=>{
      guard();const input=action.validateInput(raw);
      if(action.effects!=='read'&&run.definition.parentRunId){let parentId:string|null=run.definition.parentRunId;
        const fingerprint=runtimeHash({action:action.id,plugin:action.owner,pluginVersion:action.version,input});
        while(parentId){const parent=this.d.store.get(parentId);if(this.d.store.operations(parentId).some(op=>op.fingerprint===fingerprint&&op.outcome?.effects==='confirmed'))throw new Error('OPERATION_ALREADY_CONFIRMED');parentId=parent.definition.parentRunId;}}
      const operation=this.d.store.beginOperation(run.id,callId,action.id,action.owner,action.version,input);
      if(operation.state==='finished'&&operation.outcome)return z.json().parse(operation.outcome);if(operation.state==='unknown')throw new Error('OPERATION_UNCERTAIN');
      if(operation.reused)throw new Error('OPERATION_IN_PROGRESS');
      const grant=Object.freeze({id:randomUUID()}) as ExecutionGrant;
      const context:ExecutionContextV3=Object.freeze({agentId:this.d.agentId,taskId:run.definition.taskId,runId:run.id,operationId:operation.id,
        origin:freezeOrigin(run.definition.origin),scope:Object.freeze({...run.definition.scope}),intentVersion:run.definition.intentVersion,grant,signal:AbortSignal.any([signal,toolSignal,action.signal])});
      this.grants.set(context,{action,runId:run.id,guard});this.flushEvents();
      try{const outcome=await action.execute(input,context);
        // Sources are only accepted through the source port (added with execution memory in 1E).
        if(outcome.sources.length)throw new Error('SOURCE_STALE');
        this.d.store.finishOperation(operation.id,outcome);this.flushEvents();guard();return z.json().parse(outcome);
      }catch(error){if(this.d.store.operation(operation.id).state==='started')this.d.store.finishOperation(operation.id,{status:'unknown',effects:action.effects==='read'?'none':'unknown',completeness:'unknown',data:null,sources:[],receipts:[],errorCode:safeCode(error)});
        throw new Error(safeCode(error));
      }finally{this.grants.delete(context);this.flushEvents();}
    }};
  }
  conversationActions(run:StoredRun,producer:string,signal:AbortSignal,guard:()=>void):NativeAction[]{
    const policy=this.d.options.policies.find(policy=>policy.id==='conversation'&&policy.producers.includes(producer));if(!policy)return [];
    return this.d.registry.actions().filter(action=>!action.requiresTask&&policy.actions.includes(action.id)&&action.effects!=='external-write'&&(action.effects!=='local-write'||policy.allowLocalWrite))
      .map(action=>this.bindAction(run,action,signal,()=>{signal.throwIfAborted();guard();if(!action.active()||this.d.store.get(run.id).state!=='running')throw new Error('SCOPE_DENIED');}));
  }
  conversationSnapshot(producer:string){const policy=this.d.options.policies.find(policy=>policy.id==='conversation'&&policy.producers.includes(producer));
    return {policyId:policy?.id??'conversation-v2',authority:policy??null,actions:this.d.registry.actions()
      .filter(action=>policy?.actions.includes(action.id)&&!action.requiresTask&&action.effects!=='external-write'&&(action.effects!=='local-write'||policy.allowLocalWrite))
      .map(action=>({id:action.id,owner:action.owner,version:action.version,input:action.input,effects:action.effects}))};}
  authority(context:ExecutionContextV3,pluginId:string){const grant=this.grants.get(context);
    if(!grant||grant.action.owner!==pluginId||!grant.action.active()||this.d.store.get(grant.runId).state!=='running')throw new Error('SCOPE_DENIED');grant.guard();return context;
  }
  flushEvents():void{for(const event of this.d.store.outbox()){
    const run=this.d.store.get(event.runId);if(run.definition.scope.kind!=='task')continue;
    const operation=typeof event.data.operationId==='string'?this.d.store.operation(event.data.operationId):null;
    const prior=this.d.journal.executionEvents(this.d.agentId,run.definition.taskId!).filter(item=>item.runId===run.id&&item.id!==event.id).at(-1);
    this.d.journal.appendExecutionOnce({agentId:this.d.agentId,taskId:run.definition.taskId!,runId:run.id,route:run.definition.scope.scopeKey,traceId:run.id,
      operationId:operation?.id??run.id,causedBy:operation&&event.type!=='operation.started'?operation.startedEventId:prior?.id??null,
      type:event.type,plugin:operation?.plugin??'core',pluginVersion:operation?.pluginVersion??CORE_VERSION,occurredAt:event.at,sources:[],data:event.data},event.id);
    this.d.store.acknowledgeEvent(event.id);
  }}
  async whenIdle(){while(this.queued.size)await Promise.all([...this.queued.values()]);if(this.failure)throw new Error(this.failure);}
  get health(){return {active:this.active.size,queued:this.queued.size,error:this.failure};}
}
function safeCode(error:unknown):string{return error instanceof Error&&/^[A-Z0-9_]{1,100}$/.test(error.message)?error.message:'EXECUTION_FAILED';}
function freezeOrigin(raw:RunOrigin):RunOrigin{const origin=RunOriginSchema.parse(raw);if(origin.kind==='message')Object.freeze(origin.conversation);return Object.freeze(origin);}
