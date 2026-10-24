import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ExecutionRequestSchema,ResumeRunSchema,WakeRequestSchema,RunControlSchema,ProducerSchema,taskScopeKey,HostConfigSchema,TaskUpdateSchema,redactJson,RunOriginSchema,MotivationSchema,ContextItemSchema,ContinuityCheckpointSchema } from '@dafeiyu/contracts';
import type { TaskRepositoryPort,TaskRef,RunRef,RunOrigin,ExecutionContextV3,ExecutionGrant,ExecutionInput,WakeAuthorityProvider,HostConfig,Json,PersonaAccess,Conversation } from '@dafeiyu/contracts';
import type { PersonaRuntime,RunPersona } from './persona-runtime.js';
import type { FoundationSnapshot } from './foundation.js';
import { foundationManifest } from './persona-manifest.js';
import type { Journal } from '@dafeiyu/journal';
import { RuntimeStore,runtimeHash } from './runtime-store.js';
import type { StoredRun } from './runtime-store.js';
import type { DshRuntime } from './runtime.js';
import type { CapabilityRegistryV3,BoundActionV3 } from './registry-v3.js';
import type { RunScheduler } from './run-scheduler.js';
import type { NativeAction } from './execution-frame.js';
import { CORE_VERSION } from './version.js';
import type { ExecutionMemoryPort,ExecutionToolReceipt,Motivation,SourceDependency } from '@dafeiyu/contracts';
import { SourceDependencySchema } from '@dafeiyu/contracts';
import { MessageTaskSubmitSchema,MessageTaskStatusSchema,MessageTaskSourceSchema } from '@dafeiyu/contracts';
import type { MessageTaskBinding,MessageTaskSource } from '@dafeiyu/contracts';
import { ExecutionEvidence } from './execution-evidence.js';
import type { NativeContext } from './execution-evidence.js';

export const ExecutionOptionsSchema=z.strictObject({profileId:ProducerSchema,createStore:z.boolean().default(false),
  policies:HostConfigSchema.shape.authorityPolicies,maxPendingRuns:z.number().int().min(1).max(1000).default(100),
  maxConcurrentRuns:z.number().int().min(1).max(16).default(2)});
export type ExecutionOptions=z.input<typeof ExecutionOptionsSchema>;
interface Dependencies {
  agentId:string;store:RuntimeStore;journal:Journal;runtime:DshRuntime;registry:CapabilityRegistryV3;scheduler:RunScheduler;
  options:z.output<typeof ExecutionOptionsSchema>;repository:()=>TaskRepositoryPort|undefined;
  personas:PersonaRuntime;
  memory:()=>ExecutionMemoryPort|undefined;
  accepting:()=>boolean;assertAccepting:()=>void;persona:()=>FoundationSnapshot;model:HostConfig['modelRoutes']['chat'];
  turnTimeoutMs:number;context:{requestMaxBytes:number;outputReserveBytes:number;maxBytes:number;prepareTimeoutMs:number};signal:AbortSignal;
  projectConversation?:()=>Promise<void>;
}
interface Active {controller:AbortController;mode:'cancel'|'pause'|null}
type Request=z.output<typeof ExecutionRequestSchema>;
const savedSchema=z.strictObject({kind:z.literal('execution'),input:ExecutionRequestSchema,origin:RunOriginSchema,parentRunId:z.uuid().nullable(),checkpointId:z.uuid().nullable(),motivation:MotivationSchema.optional(),messageSource:MessageTaskSourceSchema.optional()});

/** Durable acceptance and authority; DSH remains the sole model loop. */
export class ExecutionCoordinator {
  private readonly refs=new WeakMap<RunRef,{producer:string;id:string}>();
  private readonly tasks=new WeakMap<TaskRef,{producer:string;id:string}>();
  private readonly grants=new WeakMap<ExecutionContextV3,{action:BoundActionV3;runId:string;guard:()=>void;commitGuard:()=>void}>();
  private readonly active=new Map<string,Active>();
  private readonly queued=new Map<string,Promise<void>>();
  private readonly taskQueues=new Map<string,Promise<void>>();
  private readonly wakes=new Map<string,WakeAuthorityProvider>();
  private failure:string|null=null;
  private readonly evidence=new Map<string,ExecutionEvidence>();
  private readonly messageBindings=new Map<string,MessageTaskBinding>();
  constructor(private readonly d:Dependencies){d.personas.enrich=(access,run)=>{if(run.definition.scope.kind!=='task')return access;
    const scoped={...access,motivation:this.motivation(run),resourceAllowed:(scene:Conversation)=>this.allowedResource(run,scene)};return this.evidenceFor(run,scoped).access(scoped);};}
  private allowedResource(run:StoredRun,scene:Conversation):boolean {
    if(run.definition.origin.kind==='message')return runtimeHash(scene)===runtimeHash(this.d.journal.get(run.definition.origin.inboundId).message.conversation);
    if(run.definition.scope.kind!=='task')return false;
    const request=this.d.store.request(run.requestKey),policy=this.policy(request.producer,run.definition.policyId),source=savedSchema.parse(request.payload).messageSource;
    if(source){this.validateMessageSource(source);return source.resources.some(resource=>runtimeHash(resource)===runtimeHash(scene));}
    return policy.resources.some(resource=>runtimeHash(resource)===runtimeHash(scene));
  }
  resources(context:ExecutionContextV3,pluginId:string):readonly Conversation[]{this.authority(context,pluginId);const run=this.d.store.get(context.runId);
    if(run.definition.origin.kind==='message')return [this.d.journal.get(run.definition.origin.inboundId).message.conversation];
    const request=this.d.store.request(run.requestKey),source=savedSchema.parse(request.payload).messageSource;if(source)this.validateMessageSource(source);
    return (source?.resources??this.policy(request.producer,run.definition.policyId).resources).map(scene=>({...scene}));}
  bindMessageTasks(binding:MessageTaskBinding):()=>void{if(this.messageBindings.has(binding.id))throw new Error('DUPLICATE_PROVIDER');this.policy(binding.id,binding.policyId);
    const captured=Object.freeze({...binding,classify:binding.classify.bind(binding),active:binding.active.bind(binding)});this.messageBindings.set(binding.id,captured);return ()=>{if(this.messageBindings.get(binding.id)===captured)this.messageBindings.delete(binding.id);};}
  private messageBindingHash(binding:MessageTaskBinding){const {classify:_classify,active:_active,...identity}=binding;return runtimeHash({identity,policy:this.policy(binding.id,binding.policyId)});}
  private validateMessageSource(source:MessageTaskSource){const binding=this.messageBindings.get(source.bindingId),item=this.d.journal.get(source.inboundId);
    if(!binding?.active()||this.messageBindingHash(binding)!==source.authorityVersion||item.extensionId!==binding.channelExtensionId||item.message.conversation.channel!==binding.channel||item.message.conversation.account!==binding.account
      ||runtimeHash(item.message)!==source.messageHash||runtimeHash(item.message.conversation)!==runtimeHash(source.conversation)||source.kind==='explicit-task'&&item.message.sender.id!==binding.ownerId
      ||this.d.journal.messageRecalled({agentId:this.d.agentId,route:item.route},item.message.id))throw new Error('SOURCE_STALE');return {binding,item};}
  private messageAuthority(context:ExecutionContextV3,pluginId:string,write:boolean){this.authority(context,pluginId,write?'local-write':'read');
    const run=this.d.store.get(context.runId);if(run.definition.origin.kind!=='message')throw new Error('MESSAGE_REQUIRED');
    const item=this.d.journal.get(run.definition.origin.inboundId),binding=[...this.messageBindings.values()].find(binding=>binding.pluginId===pluginId&&binding.channelExtensionId===item.extensionId);
    if(!binding?.active()||item.message.conversation.channel!==binding.channel||item.message.conversation.account!==binding.account||item.message.mainText===undefined||!item.message.text.startsWith(item.message.mainText)
      ||this.d.journal.messageRecalled({agentId:this.d.agentId,route:item.route},item.message.id))throw new Error('SCOPE_DENIED');return {binding,item};}
  submitMessageTask(context:ExecutionContextV3,pluginId:string,raw:unknown){const {binding,item}=this.messageAuthority(context,pluginId,true),input=MessageTaskSubmitSchema.parse(raw),directive=binding.classify(item.message);
    if(input.kind==='explicit-task'&&(item.message.sender.id!==binding.ownerId||directive.kind!=='submit'))throw new Error('TASK_DIRECTIVE_REQUIRED');
    const resources=[...new Map([item.message.conversation,...(input.kind==='explicit-task'?this.policy(binding.id,binding.policyId).resources:[])].map(scene=>[runtimeHash(scene),scene])).values()];
    const source=MessageTaskSourceSchema.parse({schemaVersion:1,bindingId:binding.id,authorityVersion:this.messageBindingHash(binding),inboundId:item.id,messageHash:runtimeHash(item.message),conversation:item.message.conversation,kind:input.kind,resources});
    const request=ExecutionRequestSchema.parse({requestId:runtimeHash([item.id,input.requestId]),title:input.title,goal:input.kind==='explicit-task'?directive.text:input.goal,policyId:binding.policyId});
    this.validateMessageSource(source);const accepted=this.submit(binding.id,request,undefined,null,null,{kind:input.kind,basis:[`message:${item.id}`]},source);
    return {taskId:accepted.task.id,runId:accepted.run.id,state:accepted.state,motivation:input.kind,sourceInboundId:item.id};
  }
  messageTaskStatus(context:ExecutionContextV3,pluginId:string,raw:unknown){const {binding,item}=this.messageAuthority(context,pluginId,false),{taskId}=MessageTaskStatusSchema.parse(raw);
    const run=this.d.store.list().findLast(run=>{if(run.definition.taskId!==taskId)return false;const request=this.d.store.request(run.requestKey),saved=savedSchema.safeParse(request.payload);return request.producer===binding.id&&saved.success&&saved.data.messageSource&&runtimeHash(saved.data.messageSource.conversation)===runtimeHash(item.message.conversation);});
    if(!run)throw new Error('SCOPE_DENIED');const task=this.repository().readState(this.d.agentId,taskId);return {taskId,runId:run.id,state:run.state,version:run.version,taskVersion:task.version,intentVersion:task.epoch,title:task.title,goal:task.goal,motivation:this.motivation(run).kind};}
  authorizeResource(context:ExecutionContextV3,pluginId:string,scene:Conversation){this.authority(context,pluginId);if(!this.allowedResource(this.d.store.get(context.runId),scene))throw new Error('RESOURCE_SCOPE_DENIED');}
  private motivation(run:StoredRun):Motivation{return savedSchema.parse(this.d.store.request(run.requestKey).payload).motivation??{kind:'unknown',basis:[]};}
  private evidenceFor(run:StoredRun,access:PersonaAccess){const current=this.evidence.get(run.id);if(current)return current;const request=this.d.store.request(run.requestKey);
    const value=new ExecutionEvidence(run,this.d.store,this.d.memory,this.d.personas,this.d.registry,this.repository(),this.policy(request.producer,run.definition.policyId).sourceRules,access);this.evidence.set(run.id,value);return value;}
  private repository(){const value=this.d.repository();if(!value)throw new Error('DEPENDENCY_UNAVAILABLE');return value;}
  private policy(producer:string,id:string){const value=this.d.options.policies.find(p=>p.id===id&&p.producers.includes(producer));if(!value)throw new Error('SCOPE_DENIED');return value;}
  private ref(producer:string,run:StoredRun){const reference=Object.freeze({id:run.id});this.refs.set(reference,{producer,id:run.id});return reference;}
  private taskRef(producer:string,id:string){const ref=Object.freeze({id});this.tasks.set(ref,{producer,id});return ref;}
  private resolve(producer:string,ref:RunRef){const authority=this.refs.get(ref);if(authority?.producer!==producer)throw new Error('SCOPE_DENIED');return this.d.store.get(authority.id);}
  private resolveTask(producer:string,ref:TaskRef){const authority=this.tasks.get(ref);if(authority?.producer!==producer)throw new Error('SCOPE_DENIED');return authority.id;}
  producer(raw:string,options?:unknown){const producer=ProducerSchema.parse(raw),declared=z.strictObject({motivation:MotivationSchema}).optional().parse(options);
    if(!this.d.options.policies.some(policy=>policy.producers.includes(producer)))throw new Error('SCOPE_DENIED');
    return Object.freeze({
      submitTask:(raw:unknown,task?:TaskRef)=>{const input=ExecutionRequestSchema.parse(raw);if('taskId'in input&&(!task||this.resolveTask(producer,task)!==input.taskId))throw new Error('SCOPE_DENIED');return this.submit(producer,input,undefined,null,null,declared?.motivation);},
      openTask:(id:string)=>{this.d.assertAccepting();this.repository().readState(this.d.agentId,z.uuid().parse(id));return this.taskRef(producer,id);},
      updateTask:(ref:TaskRef,input:unknown)=>{this.d.assertAccepting();return this.repository().update(this.d.agentId,this.resolveTask(producer,ref),TaskUpdateSchema.parse(input));},
      resolveObjection:(ref:TaskRef,input:unknown)=>{this.d.assertAccepting();const taskId=this.resolveTask(producer,ref),task=this.repository().readState(this.d.agentId,taskId),port=this.d.memory();
        if(!port?.ready())throw new Error('DEPENDENCY_UNAVAILABLE');const run=this.d.store.list().findLast(run=>run.definition.taskId===taskId&&run.definition.intentVersion===task.epoch&&this.d.store.request(run.requestKey).producer===producer);if(!run)throw new Error('SCOPE_DENIED');
        const guard=()=>{this.d.assertAccepting();if(this.repository().readState(this.d.agentId,taskId).epoch!==task.epoch)throw new Error('TASK_NOT_ACTIVE');};
        return port.resolveIntent({...this.d.personas.access(run,this.inputsFor(run),this.d.signal,guard),producer:`producer:${producer}`,operationId:run.id},input);},
      restoreRun:(id:string)=>{const run=this.d.store.get(id);if(this.d.store.request(run.requestKey).producer!==producer)throw new Error('SCOPE_DENIED');return this.ref(producer,run);},
      status:(ref:RunRef)=>this.status(this.resolve(producer,ref)),
      readResult:async(ref:RunRef)=>{const run=this.resolve(producer,ref);if(run.state!=='completed'||!run.result)return null;
        const guard=()=>{const task=this.repository().readState(this.d.agentId,run.definition.taskId!),saved=savedSchema.parse(this.d.store.request(run.requestKey).payload),policy=this.policy(producer,run.definition.policyId);
          if(saved.messageSource)this.validateMessageSource(saved.messageSource);
          if(task.epoch!==run.definition.intentVersion)throw new Error('SOURCE_STALE');const inputs=this.repository().readSelectedInputs(this.d.agentId,task.id,saved.input.inputRefs,policy.sourceRules);
          if(runtimeHash(inputs.map(input=>({id:input.id,version:input.version,hash:runtimeHash([input.contentHash,input.proofHash]),scopeKey:input.scopeKey})))!==runtimeHash(run.snapshot?.inputs))throw new Error('SOURCE_STALE');};
        guard();const binding=this.d.store.personaBinding(run.id);if(binding.kind==='bound')this.d.personas.validateStored(run,binding.manifest,this.inputsFor(run),this.d.signal,guard);
        this.d.personas.access(run,this.inputsFor(run),this.d.signal,guard);
        const proof=this.d.store.readInput(run.id,'result-sources');if(proof&&!this.evidence.get(run.id)?.validate(z.array(SourceDependencySchema).parse(proof)))throw new Error('SOURCE_STALE');
        const text=await this.d.runtime.readResult(run.result);guard();if(binding.kind==='bound')this.d.personas.validateStored(run,binding.manifest,this.inputsFor(run),this.d.signal,guard);
        if(proof&&!this.evidence.get(run.id)?.validate(z.array(SourceDependencySchema).parse(proof)))throw new Error('SOURCE_STALE');return text;},
      cancel:(ref:RunRef,input:unknown)=>this.control(producer,this.resolve(producer,ref),input,'cancel'),
      pause:(ref:RunRef,input:unknown)=>this.control(producer,this.resolve(producer,ref),input,'pause'),
      resume:(ref:TaskRef,raw:unknown)=>{this.d.assertAccepting();const input=ResumeRunSchema.parse(raw);
        if(this.resolveTask(producer,ref)!==input.taskId)throw new Error('SCOPE_DENIED');const parent=this.d.store.get(input.parentRunId);
        if(this.d.store.request(parent.requestKey).producer!==producer||parent.definition.taskId!==input.taskId)throw new Error('SCOPE_DENIED');
        if(['accepted','queued','running','cancelling'].includes(parent.state))throw new Error('RUN_NOT_QUIESCENT');
        if(this.repository().readState(this.d.agentId,input.taskId).epoch!==parent.definition.intentVersion)throw new Error('TASK_NOT_ACTIVE');
        if(this.d.store.operations(parent.id).some(op=>op.state==='unknown'||op.outcome?.effects==='unknown'))throw new Error('OPERATION_UNCERTAIN');
        this.d.store.readCheckpoint(parent.id,input.checkpointId);
        const {parentRunId,checkpointId,...request}=input;
        return this.submit(producer,request,{kind:'continuation',parentRunId,checkpointId},parentRunId,checkpointId,declared?.motivation??this.motivation(parent));},
      acceptWake:(raw:unknown,task:TaskRef)=>{const input=WakeRequestSchema.parse(raw),{origin,...request}=input;if(this.resolveTask(producer,task)!==input.taskId)throw new Error('SCOPE_DENIED');
        if(origin.producerId!==producer||request.requestId!==origin.occurrenceId)throw new Error('SCOPE_DENIED');
        return this.submit(producer,request,origin,null,null,declared?.motivation??{kind:'unknown',basis:[]});},
    });
  }
  bindWake(provider:WakeAuthorityProvider):()=>void{const producer=ProducerSchema.parse(provider.producerId);if(this.wakes.has(producer))throw new Error('DUPLICATE_PROVIDER');
    const bound={producerId:producer,validate:provider.validate.bind(provider)};this.wakes.set(producer,bound);return ()=>{if(this.wakes.get(producer)===bound)this.wakes.delete(producer);};}
  private submit(producer:string,input:Request,origin:RunOrigin={kind:'native',producerId:producer,requestId:input.requestId},parentRunId:string|null=null,checkpointId:string|null=null,motivation?:Motivation,messageSource?:MessageTaskSource){
    this.d.assertAccepting();this.policy(producer,input.policyId);
    if(!this.repository().ready())throw new Error('DEPENDENCY_UNAVAILABLE');
    const old=this.d.store.findRequest(producer,input.requestId);
    if(!old&&this.d.store.list(['accepted','queued','running','cancelling']).length>=this.d.options.maxPendingRuns)throw new Error('CAPACITY_EXCEEDED');
    const oldMotivation=old?savedSchema.parse(old.payload).motivation:undefined;
    const payload=savedSchema.parse({kind:'execution',input,origin,parentRunId,checkpointId,...(!old||oldMotivation||motivation?{motivation:motivation??oldMotivation??{kind:'explicit-task',basis:['trusted-task-submission']}}:{}),...(messageSource?{messageSource}:{})});
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
      const controller=new AbortController(),entry:Active={controller,mode:null};this.active.set(id,entry);let runPersona:RunPersona|undefined;
      try{
        if(run.state==='accepted')run=this.d.store.transition(id,run.version,'queued');
        const request=this.d.store.request(run.requestKey),saved=savedSchema.parse(request.payload),policy=this.policy(request.producer,run.definition.policyId),repository=this.repository();
        if(saved.messageSource)this.validateMessageSource(saved.messageSource);
        const task=repository.readState(this.d.agentId,run.definition.taskId!);
        if(task.epoch!==run.definition.intentVersion||task.status!=='active')throw new Error('TASK_NOT_ACTIVE');
        if(run.definition.origin.kind==='wake'&&!this.wakes.get(request.producer)?.validate(run.definition.origin,task))throw new Error('WAKE_NOT_AUTHORIZED');
        const inputs=repository.readSelectedInputs(this.d.agentId,task.id,saved.input.inputRefs,policy.sourceRules),inputHash=runtimeHash(inputs),authorityVersion=runtimeHash(policy);
        const actions=this.d.registry.actions().filter(action=>policy.actions.includes(action.id)&&action.effects!=='external-write'&&(action.effects!=='local-write'||policy.allowLocalWrite));
        const contributors=this.d.registry.contributors(),memory=this.d.memory();if(memory&&!memory.ready())throw new Error('DEPENDENCY_UNAVAILABLE');
        const registryVersion=runtimeHash({actions:actions.map(action=>[action.id,action.owner,action.pluginVersion,action.version,action.input,action.effects]),contexts:contributors.map(entry=>[entry.owner,entry.version,entry.context.id])});
        const persona=this.d.persona();
        const signal=AbortSignal.any([this.d.signal,controller.signal,...actions.map(action=>action.signal),...contributors.map(entry=>entry.signal),AbortSignal.timeout(this.d.turnTimeoutMs)]);
        const guard=()=>{signal.throwIfAborted();if(!repository.ready()||this.d.repository()!==repository)throw new Error('DEPENDENCY_UNAVAILABLE');
          if(saved.messageSource)this.validateMessageSource(saved.messageSource);
          const current=repository.readState(this.d.agentId,task.id);if(current.epoch!==task.epoch||current.status!=='active')throw new Error('TASK_NOT_ACTIVE');
          if(run.definition.origin.kind==='wake'&&!this.wakes.get(request.producer)?.validate(run.definition.origin,current))throw new Error('WAKE_NOT_AUTHORIZED');
          if(runtimeHash(repository.readSelectedInputs(this.d.agentId,task.id,saved.input.inputRefs,policy.sourceRules))!==inputHash)throw new Error('SOURCE_STALE');
          if(this.d.memory()!==memory||memory&&!memory.ready()||actions.some(action=>!action.active())||contributors.some(entry=>!entry.active()))throw new Error('DEPENDENCY_UNAVAILABLE');};
        runPersona=this.d.personas.prepare(run,persona,this.d.model,inputs,signal,guard);
        const evidence=this.evidence.get(id)!,access=this.d.personas.access(run,inputs,signal,guard);
        memory?.acceptIntent({...access,producer:`producer:${request.producer}`});
        const prior=this.previousContinuity(run,access,persona.version);
        const sessionId=this.d.store.session(runtimeHash({task:task.id,epoch:task.epoch,authorityVersion,inputHash,registryVersion,persona:runPersona.projectionKey,executionHistory:1}));
        run=this.d.store.start(id,run.version,{sessionId,personaVersion:persona.version,model:this.d.model,registryVersion,authorityVersion,
          inputs:inputs.map(input=>({id:input.id,version:input.version,hash:runtimeHash([input.contentHash,input.proofHash]),scopeKey:input.scopeKey}))},{...runPersona.manifest,continuityCheckpointId:prior?.id??null});
        this.d.store.checkpoint(id,{kind:'run-start',intentVersion:task.epoch});this.flushEvents();
        const view=Object.freeze({runId:id,taskId:task.id,scope:Object.freeze({...run.definition.scope}),origin:Object.freeze({...run.definition.origin}),signal});
        const contexts:NativeContext[]=runPersona.items.map(item=>({owner:'memory',region:'growth',item}));let contextBytes=Buffer.byteLength(JSON.stringify(contexts),'utf8'),omitted=0;
        const add=(owner:string,region:string,item:unknown)=>{const parsed=ContextItemSchema.parse(item),bytes=Buffer.byteLength(JSON.stringify(parsed),'utf8');if(Date.parse(parsed.expiresAt)<=Date.now()||contextBytes+bytes>this.d.context.maxBytes){omitted++;return;}contextBytes+=bytes;contexts.push({owner,region,item:parsed});};
        for(const item of memory?.prepareContext(access)??[])add('memory','execution',item);
        for(const contributor of contributors){const prepared=await Promise.race([contributor.context.prepare(view),new Promise<never>((_resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('CONTEXT_PREPARE_TIMEOUT')),this.d.context.prepareTimeoutMs);timer.unref();})]);guard();
          for(const item of prepared)if(contributor.context.validate(view,item))add(contributor.owner,contributor.context.id,item);else omitted++;}
        evidence.setContexts(contexts);
        const intent=memory?.intent(access),program=z.json().parse({goal:task.goal,inputs,motivation:access.motivation,intent:intent??null,
          continuation:saved.parentRunId?{parentRunId:saved.parentRunId,checkpoint:this.d.store.readCheckpoint(saved.parentRunId,saved.checkpointId!),operations:this.d.store.operations(saved.parentRunId).map(op=>({id:op.id,action:op.action,state:op.state,status:op.outcome?.status??null,effects:op.outcome?.effects??null,receipts:op.outcome?.receipts??[]}))}:null,
          continuity:prior?{checkpointId:prior.id,previousRunId:prior.runId,sessionChanged:prior.sessionId!==sessionId,completedOperations:prior.completedOperations,unknownOperations:prior.unknownOperations,summary:prior.summary,gaps:prior.gaps}:null,
          gaps:[...(omitted?[`${omitted}项上下文未进入本轮，不能猜测其内容`]:[]),...(!prior?['未取得可核验接续检查点；不据此虚构过去']:[])]});
        evidence.recordInput(program,inputs.flatMap(input=>input.sourceRef?[input.sourceRef]:[]),prior?{id:prior.id,hash:runtimeHash(prior)}:null);
        const admittedGuard=()=>{guard();runPersona!.guard();if(!evidence.validate(evidence.exposed()))throw new Error('SOURCE_STALE');},bound=actions.map(action=>this.bindAction(run,action,signal,admittedGuard,guard));
        const result=await this.d.runtime.runExecution({mode:'task',sessionId,view,persona,personaItems:runPersona.items,goal:task.goal,inputs,actions:bound,guard:admittedGuard,program,contexts,evidence,
          audit:data=>{this.d.store.appendExecutionEvent(id,'execution.compaction',data);this.flushEvents();},
          checkpoint:(session,seq,deps,text)=>this.captureContinuity(run,access,session,seq,deps,text,omitted),...this.d.context});
        admittedGuard();run=this.d.store.get(id);this.d.store.bindInput(id,'result-sources',evidence.exposed());
        if(memory?.intent(access).blocking)this.d.store.transition(id,run.version,'waiting','TASK_OBJECTION_UNRESOLVED');else this.d.store.complete(id,run.version,result.resultRef);
      }catch(error){run=this.d.store.get(id);
        if(entry.mode==='pause'&&run.state==='cancelling'&&!this.d.store.operations(id).some(op=>op.state==='started'||op.state==='unknown'||op.outcome?.effects==='unknown')){
          this.d.store.checkpoint(id,{kind:'paused',operations:this.d.store.operations(id).map(op=>op.id)});this.d.store.transition(id,run.version,'waiting');
        }else if(entry.mode==='cancel'&&run.state==='cancelling'&&!this.d.store.operations(id).some(op=>op.state==='started'||op.state==='unknown'||op.outcome?.effects==='unknown'))this.d.store.transition(id,run.version,'cancelled');
        else if(['queued','running','cancelling'].includes(run.state))this.d.store.transition(id,run.version,run.state==='queued'?'failed':this.d.signal.aborted||entry.mode?'interrupted':'failed',safeCode(error));
      }finally{runPersona?.dispose();this.active.delete(id);this.evidence.delete(id);this.flushEvents();}
    }finally{release();}
  }
  private previousContinuity(run:StoredRun,access:PersonaAccess,foundationHash:string){const memory=this.d.memory();if(!memory)return null;
    for(const previous of this.d.store.list(['completed','waiting']).reverse()){
      if(previous.id===run.id||previous.definition.taskId!==run.definition.taskId||previous.definition.intentVersion!==run.definition.intentVersion)continue;
      const ref=z.object({id:z.uuid(),hash:z.string()}).safeParse(this.d.store.readInput(previous.id,'continuity-reference'));if(!ref.success)continue;
      const checkpoint=memory.checkpoint(access,ref.data.id);if(checkpoint&&runtimeHash(checkpoint)===ref.data.hash&&checkpoint.runId===previous.id&&checkpoint.foundationHash===foundationHash
        &&checkpoint.sessionId===previous.snapshot?.sessionId&&(!previous.result||checkpoint.throughSeq>=previous.result.turnEndSeq))return checkpoint;
    }return null;
  }
  private captureContinuity(run:StoredRun,access:PersonaAccess,sessionId:string,throughSeq:number,deps:readonly SourceDependency[],text:string,omitted:number){const memory=this.d.memory();if(!memory)return;
    const operations=this.d.store.operations(run.id),manifest=this.d.store.personaBinding(run.id);if(manifest.kind!=='bound')throw new Error('PERSONA_MANIFEST_CORRUPT');
    if(operations.some(op=>op.state==='started'))throw new Error('OPERATION_PENDING');const safe=redactJson({text});
    const checkpoint=ContinuityCheckpointSchema.parse({schemaVersion:1,id:run.id,agentId:this.d.agentId,runId:run.id,taskId:run.definition.taskId,taskEpoch:run.definition.intentVersion,scope:run.definition.scope,
      foundationHash:manifest.manifest.foundationHash,stageRevision:manifest.manifest.stageRevision,sessionId,throughSeq,dependencies:this.evidence.get(run.id)!.sourceRefs(deps),historyHash:runtimeHash(deps),intentEvents:memory.intent(access).events.map(event=>event.id),
      completedOperations:operations.filter(op=>op.state==='finished'&&['succeeded','partial'].includes(op.outcome?.status??'')).map(op=>op.id),
      unknownOperations:operations.filter(op=>op.state==='unknown'||op.outcome?.effects==='unknown'||op.outcome?.status==='unknown').map(op=>op.id),
      summary:!safe.redacted&&text.length<=1000?text:'本轮可见结果留在DSH归档，需按权限回查。',
      gaps:[...(safe.redacted||text.length>1000?['检查点未携带完整结果正文']:[]),...(omitted?[`${omitted}项上下文未装入`]:[]),...(memory.intent(access).blocking?['存在未解决的阻断异议，任务尚未完成']:[])],createdAt:new Date().toISOString()});
    const reference=memory.captureContinuity({...access,historyDependencies:deps},checkpoint);this.d.store.bindInput(run.id,'continuity-reference',reference);
    this.d.store.checkpoint(run.id,{kind:'continuity',checkpointId:reference.id,hash:reference.hash});this.d.store.appendExecutionEvent(run.id,'continuity.bound',{checkpointId:reference.id,hash:reference.hash});this.flushEvents();
  }
  private bindAction(run:StoredRun,action:BoundActionV3,signal:AbortSignal,guard:()=>void,commitGuard:()=>void=guard):NativeAction{
    const metadata=new WeakMap<object,ExecutionToolReceipt>();
    const result=(operationId:string,callId:string,raw:unknown)=>{const value=z.json().parse(raw);if(run.definition.scope.kind==='task'){
      const port=this.d.memory(),base=this.d.personas.access(run,this.inputsFor(run),signal,commitGuard),access={...base,operationId,producer:action.owner};
      const outcome=this.d.store.operation(operationId).outcome!,sources=[...(port?.operationSources(access,operationId)??[]),...(outcome.sources.length?(port?.outcomeSources(access,outcome.sources)??(()=>{throw new Error('SOURCE_STALE');})()):[])];
      const proof=this.d.store.readInput(run.id,`operation-inputs:${operationId}`),receipt:ExecutionToolReceipt={schemaVersion:1,runId:run.id,operationId,callId,outcomeHash:runtimeHash(outcome),inputHash:runtimeHash(proof),sources:[...new Map(sources.map(ref=>[runtimeHash(ref),ref])).values()]};
      this.d.store.bindInput(run.id,`operation-receipt:${operationId}`,receipt);if(value&&typeof value==='object')metadata.set(value,receipt);
    }return value;};
    return {definition:action,metadata:value=>value&&typeof value==='object'?metadata.get(value):undefined,execute:async(raw,callId,toolSignal)=>{
      guard();const input=action.validateInput(raw);
      if(action.effects!=='read'&&this.d.store.list().filter(value=>runtimeHash(value.definition.scope)===runtimeHash(run.definition.scope)).some(value=>this.d.store.operations(value.id).some(operation=>operation.plugin===action.owner&&(operation.state==='unknown'||operation.outcome?.effects==='unknown'))))throw new Error('OPERATION_UNCERTAIN');
      if(action.effects!=='read'&&run.definition.parentRunId){let parentId:string|null=run.definition.parentRunId;
        const fingerprint=runtimeHash({action:action.id,plugin:action.owner,pluginVersion:action.pluginVersion,actionVersion:action.version,input});
        while(parentId){const parent=this.d.store.get(parentId);if(this.d.store.operations(parentId).some(op=>op.fingerprint===fingerprint&&op.outcome?.effects==='confirmed'))throw new Error('OPERATION_ALREADY_CONFIRMED');parentId=parent.definition.parentRunId;}}
      const operation=this.d.store.beginOperation(run.id,callId,action.id,action.owner,action.pluginVersion,input,action.version);
      if(operation.state==='finished'&&operation.outcome)return result(operation.id,callId,operation.outcome);if(operation.state==='unknown')throw new Error('OPERATION_UNCERTAIN');
      if(operation.reused)throw new Error('OPERATION_IN_PROGRESS');
      this.d.store.bindInput(run.id,`operation-inputs:${operation.id}`,this.evidence.get(run.id)?.exposed()??[]);
      if(run.definition.scope.kind==='task'&&action.effects!=='read'&&action.id!=='dafeiyu_task_object'){
        const intent=this.d.memory()?.intent(this.d.personas.access(run,this.inputsFor(run),signal,commitGuard));
        if(intent?.events.some(event=>event.kind==='objection'&&event.blocking&&(!event.actions?.length||event.actions.includes(action.id))&&!intent.events.some(resolved=>resolved.kind==='resolved'&&resolved.resolves===event.id))){
          const outcome={status:'failed',effects:'none',completeness:'unknown',data:null,sources:[],receipts:[],errorCode:'TASK_OBJECTION_UNRESOLVED'};this.d.store.finishOperation(operation.id,outcome);this.flushEvents();return result(operation.id,callId,outcome);}
      }
      const grant=Object.freeze({id:randomUUID()}) as ExecutionGrant;
      const context:ExecutionContextV3=Object.freeze({agentId:this.d.agentId,taskId:run.definition.taskId,runId:run.id,operationId:operation.id,
        origin:freezeOrigin(run.definition.origin),scope:Object.freeze({...run.definition.scope}),intentVersion:run.definition.intentVersion,grant,signal:AbortSignal.any([signal,toolSignal,action.signal])});
      this.grants.set(context,{action,runId:run.id,guard,commitGuard});this.flushEvents();
      try{if(run.definition.scope.kind==='conversation')await this.d.projectConversation?.();guard();const outcome=await action.execute(input,context);
        this.d.store.finishOperation(operation.id,outcome);this.flushEvents();let value:Json;try{value=result(operation.id,callId,outcome);}catch(error){this.evidence.get(run.id)?.invalidate();throw error;}guard();return value;
      }catch(error){if(this.d.store.operation(operation.id).state==='started')this.d.store.finishOperation(operation.id,{status:'unknown',effects:action.effects==='read'?'none':'unknown',completeness:'unknown',data:null,sources:[],receipts:[],errorCode:safeCode(error)});
        throw new Error(safeCode(error));
      }finally{this.grants.delete(context);this.flushEvents();}
    }};
  }
  conversationActions(run:StoredRun,producer:string,signal:AbortSignal,guard:()=>void):NativeAction[]{
    const policy=this.d.options.policies.find(policy=>policy.id==='conversation'&&policy.producers.includes(producer));if(!policy)return [];
    return this.d.registry.actions().filter(action=>!action.requiresTask&&policy.actions.includes(action.id)&&action.effects!=='external-write'&&(action.effects!=='local-write'||policy.allowLocalWrite))
      .map(action=>{const base=()=>{signal.throwIfAborted();guard();if(!action.active()||this.d.store.get(run.id).state!=='running')throw new Error('SCOPE_DENIED');};return this.bindAction(run,action,signal,()=>{base();this.d.personas.current(run.id)?.guard();},base);});
  }
  conversationSnapshot(producer:string){const policy=this.d.options.policies.find(policy=>policy.id==='conversation'&&policy.producers.includes(producer));
    return {policyId:policy?.id??'conversation-v2',authority:policy??null,actions:this.d.registry.actions()
      .filter(action=>policy?.actions.includes(action.id)&&!action.requiresTask&&action.effects!=='external-write'&&(action.effects!=='local-write'||policy.allowLocalWrite))
      .map(action=>({id:action.id,owner:action.owner,version:action.version,input:action.input,effects:action.effects}))};}
  authority(context:ExecutionContextV3,pluginId:string,effect:'read'|'local-write'='read'){const grant=this.grants.get(context);
    if(!grant||grant.action.owner!==pluginId||!grant.action.active()||effect==='local-write'&&grant.action.effects!=='local-write'||this.d.store.get(grant.runId).state!=='running')throw new Error('SCOPE_DENIED');grant.guard();return context;
  }
  private inputsFor(run:StoredRun):ExecutionInput[]{if(!run.definition.taskId)return [];const request=this.d.store.request(run.requestKey),saved=savedSchema.parse(request.payload);return this.repository().readSelectedInputs(this.d.agentId,run.definition.taskId,saved.input.inputRefs,this.policy(request.producer,run.definition.policyId).sourceRules);}
  personaAccess(context:ExecutionContextV3,pluginId:string,effect:'read'|'local-write'):PersonaAccess{
    const grant=this.grants.get(context);this.authority(context,pluginId,effect);if(!grant||effect==='local-write'&&grant.action.effects!=='local-write')throw new Error('SCOPE_DENIED');
    const run=this.d.store.get(context.runId),prepared=this.d.personas.current(run.id);const guard=()=>{this.authority(context,pluginId,effect);prepared?.guard();};
    const commitGuard=()=>{context.signal.throwIfAborted();const current=this.grants.get(context);if(current!==grant||!grant.action.active()||this.d.store.get(run.id).state!=='running')throw new Error('SCOPE_DENIED');grant.commitGuard();};
    guard();return Object.freeze({...this.d.personas.access(run,this.inputsFor(run),context.signal,commitGuard),commitGuard,producer:pluginId,operationId:context.operationId,startedEventId:this.d.store.operation(context.operationId).startedEventId,
      admittedSources:[...(prepared?.manifest.entries.flatMap(entry=>[entry.contentRef,...entry.dependencies])??[]),...(this.evidence.get(run.id)?.sourceRefs()??[])]});
  }
  flushEvents():void{for(const event of this.d.store.outbox()){
    const run=this.d.store.get(event.runId);if(run.definition.scope.kind!=='task')continue;
    const operation=typeof event.data.operationId==='string'?this.d.store.operation(event.data.operationId):null;
    const prior=this.d.journal.executionEvents(this.d.agentId,run.definition.taskId!).filter(item=>item.runId===run.id&&item.id!==event.id).at(-1);
    this.d.journal.appendExecutionOnce({agentId:this.d.agentId,taskId:run.definition.taskId!,runId:run.id,route:run.definition.scope.scopeKey,traceId:run.id,
      operationId:operation?.id??run.id,causedBy:operation&&event.type!=='operation.started'?operation.startedEventId:prior?.id??null,
      type:event.type,plugin:operation?.plugin??'core',pluginVersion:operation?.pluginVersion??CORE_VERSION,occurredAt:event.at,sources:[],data:event.data},event.id);
    if(run.state==='completed'&&run.result)this.d.memory()?.bindResult(run.definition.taskId!,run.id,run.definition.intentVersion,{result:run.result,continuity:this.d.store.readInput(run.id,'continuity-reference')});
    this.d.store.acknowledgeEvent(event.id);
  }}
  async whenIdle(){while(this.queued.size)await Promise.all([...this.queued.values()]);if(this.failure)throw new Error(this.failure);}
  get health(){return {active:this.active.size,queued:this.queued.size,error:this.failure};}
}
function safeCode(error:unknown):string{return error instanceof Error&&/^[A-Z0-9_]{1,100}$/.test(error.message)?error.message:'EXECUTION_FAILED';}
function freezeOrigin(raw:RunOrigin):RunOrigin{const origin=RunOriginSchema.parse(raw);if(origin.kind==='message')Object.freeze(origin.conversation);return Object.freeze(origin);}
