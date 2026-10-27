import { Context, Service } from '@deepseek-ai/cordis';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { z } from 'zod';
import { PhaseTimeoutsSchema } from '@dafeiyu/contracts';
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import { API_VERSION, MessageSchema, ObservationSchema, conversationKey,ToolFeedbackSchema,FeedbackMetaSchema,FeedbackWitnessSchema,FEEDBACK_RETIRED_TEXT,FeedbackCaptureError } from '@dafeiyu/contracts';
import type { FeedbackDelivery } from '@dafeiyu/contracts';
import type { ActionCapability, ActionContext, OperationScope, Extension, ExtensionHandle, Json, PendingMessage, PersonaSnapshot, Receipt, Reply } from '@dafeiyu/contracts';
import { Journal, eventFor } from '@dafeiyu/journal';
import { DshRuntime, DshRunError } from './runtime.js';
import {renderConversationRecovery,decidePendingReplies} from './conversation-recovery.js';
import type { BoundAction,ActionResult } from './runtime.js';
import { ContextCoordinator,contextConfigSchema } from './context.js';
import type { ContextRequest } from '@dafeiyu/contracts';
import { CORE_VERSION } from './version.js';
import { capsuleSchema } from './compaction-runtime.js';
import type { CompactionBinding } from './compaction-runtime.js';
import { fragmentCapsuleSchema } from './summary-fragments.js';
import { MemoryObservationSchema,ObservationSourceReadSchema,ObservationSourceChangeSchema } from '@dafeiyu/contracts';
import type { Conversation,ObservationAuthority } from '@dafeiyu/contracts';
import { TaskCoordinator,bindTaskProvider,bindTaskMemoryProvider,bindExpressionProvider } from './task-coordinator.js';
import { TaskDelivery } from './task-delivery.js';
import { prepareReplySources,prepareCapturedReplySources } from './reply-sources.js';
import type { MessageTaskBinding } from '@dafeiyu/contracts';
import type { NativeExpressionPort } from '@dafeiyu/contracts';
import type { MediaPort,MediaAccess,MediaSourceProvider,MediaAssetRef,MediaReplyAccess } from '@dafeiyu/contracts';
import { MediaAcquireSchema,MediaReadSchema,MediaAssetRefSchema } from '@dafeiyu/contracts';
import { NativeTaskDelivery,NATIVE_RENDER_ATTEMPTS } from './native-task-delivery.js';
import { LifecycleModeSchema, ServiceGate } from '@dafeiyu/contracts';
import type { ExtensionV3, ExtensionHandleV3 } from '@dafeiyu/contracts';
import { CapabilityRegistryV3 } from './registry-v3.js';
import { ExecutionCoordinator,ExecutionOptionsSchema } from './execution-coordinator.js';
import type { ExecutionOptions } from './execution-coordinator.js';
import { RuntimeStore,runtimeHash } from './runtime-store.js';
import { RunScheduler } from './run-scheduler.js';
import { ConversationRuns } from './conversation-run.js';
import { readFoundation } from './foundation.js';
import { PersonaRuntime } from './persona-runtime.js';
import { renderPublicProgress } from './target-renderer.js';
import type { PersonaTrialCompletionStatus } from './persona-runtime.js';
export type { PersonaTrialCompletionStatus } from './persona-runtime.js';
export { readFoundation } from './foundation.js';
export { initializeCoreStorage } from './storage-initialization.js';
import type { StoredRun } from './runtime-store.js';
import type { TaskRepositoryPort,ExecutionContextV3,WakeAuthorityProvider,MemoryGrowthProvider,PersonaProvider,ExecutionMemoryPort } from '@dafeiyu/contracts';
import { ResourceProofSchema,CapabilityObservationSchema,CapabilitySelectionSchema,ConversationSchema,ExecutionScopeSchema } from '@dafeiyu/contracts';
import type { CapabilityObservationPort,PersonaAccess,PersonaSourceRef,SourceDependency,TimelineScope } from '@dafeiyu/contracts';
export type { ExecutionOptions } from './execution-coordinator.js';
export { EXECUTION_MESSAGE_SOURCE } from './native-runtime.js';
export type { CompactionBinding } from './compaction-runtime.js';
export { readCompactionEvents } from './compaction-runtime.js';
export { readProvenance } from './provenance.js';
export { readSummaryArtifacts,resolveFragmentView,resolveFragmentProof,summarySelectionState,expandedFragmentProof,activeFragments,fragmentDependencies } from './summary-fragments.js';

export const name = 'dafeiyu-core';
export const inject = ['agents', 'sessions', 'sessionPersistence', 'tools', 'systemPrompt','llm'];
const ConfigSchema = z.strictObject({
  agentId: z.string().min(1).max(100), dataDir: z.string().min(1), personaFile: z.string().min(1),
  provider: z.string().min(1), model: z.string().min(1),
  reasoningEffort: z.string().min(1).optional(),
  lifecycleMode: LifecycleModeSchema.default('legacy'),
  turnTimeoutMs: z.number().int().min(50).max(3_600_000).default(600_000),
  deliveryTimeoutMs: z.number().int().min(50).max(60_000).default(30_000),
  phaseTimeouts:PhaseTimeoutsSchema,
  context:contextConfigSchema.default({maxBytes:16000,requestMaxBytes:1000000,outputReserveBytes:16000,prepareTimeoutMs:5000,regions:{}}),
});
export type Config = z.input<typeof ConfigSchema>;
interface Registered { extension: Extension; controller: AbortController; active: boolean }
declare module '@deepseek-ai/cordis' { interface Context { dafeiyu: DafeiyuService } }

/** Owns a logical persona and its independent conversations; extensions own platform-specific work. */
export class DafeiyuService extends Service {
  private expressionPreferences:{read:NonNullable<MemoryGrowthProvider['expressionPreferences']>}|undefined;
  private nativeTaskDelivery:NativeTaskDelivery|undefined;
  phaseTimeouts(){return this.config.phaseTimeouts;}
  private closedNativeDelivery:ReturnType<RuntimeStore['nativeDeliveries']['counts']>|null=null;
  deliverMessageTaskResult(runId:string){if(!this.nativeTaskDelivery)throw new Error('DEPENDENCY_UNAVAILABLE');return this.nativeTaskDelivery.request(runId);}
  messageTaskDeliveryStatus(runId:string){return this.runStore?.nativeDeliveries.status(runId)??null;}
  taskDeliveryBusy(){return !!this.nativeTaskDelivery?.pending;}
  reconcileCapabilityChange(raw:unknown){if(!this.executions||this.taskDeliveryBusy())return {accepted:false,resumedRunId:null};return this.executions.reconcileCapabilityChange(raw);}
  private nativeExpressionPort:NativeExpressionPort|undefined;
  private mediaPort:MediaPort|undefined;
  private readonly mediaReplyAccesses=new WeakSet<MediaReplyAccess>();
  bindNativeExpression(port:NativeExpressionPort){if(this.nativeExpressionPort)throw new Error('DUPLICATE_PROVIDER');const bound=Object.freeze({...(port.signal?{signal:port.signal}:{}),ready:port.ready.bind(port),prepare:port.prepare.bind(port),open:port.open.bind(port),withdraw:port.withdraw.bind(port),verify:port.verify.bind(port)});this.nativeExpressionPort=bound;return ()=>{if(this.nativeExpressionPort===bound)this.nativeExpressionPort=undefined;};}
  bindMedia(port:MediaPort){if(this.mediaPort)throw new Error('DUPLICATE_PROVIDER');const bound:MediaPort=Object.freeze({ready:port.ready.bind(port),registerProvider:port.registerProvider.bind(port),acquire:port.acquire.bind(port),inspect:port.inspect.bind(port),read:port.read.bind(port),...(port.voice?{voice:port.voice.bind(port)}:{}),...(port.voiceCurrent?{voiceCurrent:port.voiceCurrent.bind(port)}:{}),
    ...(port.imageOriginal?{imageOriginal:port.imageOriginal.bind(port)}:{}),...(port.prepareReply?{prepareReply:port.prepareReply.bind(port)}:{}),...(port.replyDraft?{replyDraft:port.replyDraft.bind(port)}:{}),...(port.finalizeReply?{finalizeReply:port.finalizeReply.bind(port)}:{}),...(port.readReplyPart?{readReplyPart:port.readReplyPart.bind(port)}:{}),...(port.validateReply?{validateReply:port.validateReply.bind(port)}:{}),...(port.settleReply?{settleReply:port.settleReply.bind(port)}:{}),...(port.releaseReply?{releaseReply:port.releaseReply.bind(port)}:{}),...(port.nativeMaterial?{nativeMaterial:port.nativeMaterial.bind(port)}:{}),...(port.observedMaterial?{observedMaterial:port.observedMaterial.bind(port)}:{})});
    this.mediaPort=bound;return ()=>{if(this.mediaPort===bound)this.mediaPort=undefined;};}
  registerMediaProvider(provider:MediaSourceProvider){if(!this.mediaPort)throw new Error('MEDIA_NOT_CONFIGURED');return this.mediaPort.registerProvider(provider);}
  mediaAccess(context:ExecutionContextV3,owner:string,raw:unknown):MediaAccess {
    const origin=ResourceProofSchema.parse(raw),fingerprint=createHash('sha256').update(JSON.stringify(origin)).digest('hex'),execution=this.personaAccess(context,owner,'read');
    const guard=()=>{execution.guard();this.authorizeCapabilityResource(context,owner,origin.scene);if(createHash('sha256').update(JSON.stringify(origin)).digest('hex')!==fingerprint||!this.capabilityResourceCurrent(origin))throw new Error('MEDIA_SOURCE_STALE');};
    guard();return Object.freeze({execution,origin,guard});
  }
  acquireMedia(context:ExecutionContextV3,owner:string,input:unknown){this.executionAuthority(context,owner);if(!this.mediaPort?.ready())throw new Error('MEDIA_NOT_CONFIGURED');return this.mediaPort.acquire(context,owner,MediaAcquireSchema.parse(input));}
  inspectMedia(context:ExecutionContextV3,owner:string,ref:MediaAssetRef){this.executionAuthority(context,owner);if(!this.mediaPort?.ready())throw new Error('MEDIA_NOT_CONFIGURED');return this.mediaPort.inspect(context,owner,MediaAssetRefSchema.parse(ref));}
  readMedia(context:ExecutionContextV3,owner:string,input:unknown){this.executionAuthority(context,owner);if(!this.mediaPort?.ready())throw new Error('MEDIA_NOT_CONFIGURED');return this.mediaPort.read(context,owner,MediaReadSchema.parse(input));}
  originalImage(context:ExecutionContextV3,owner:string,exposureId:string){this.executionAuthority(context,owner);if(!this.mediaPort?.ready()||!this.mediaPort.imageOriginal)throw new Error('MEDIA_NOT_CONFIGURED');return this.mediaPort.imageOriginal(context,owner,z.uuid().parse(exposureId));}
  prepareReplyMedia(context:ExecutionContextV3,owner:string,input:unknown){this.executionAuthority(context,owner);if(!this.mediaPort?.ready()||!this.mediaPort.prepareReply)throw new Error('MEDIA_NOT_CONFIGURED');return this.mediaPort.prepareReply(context,input,owner);}
  mediaVoiceEvidence(context:ExecutionContextV3,owner:string,exposureId:string){this.executionAuthority(context,owner);if(!this.mediaPort?.ready()||!this.mediaPort.voice)throw new Error('MEDIA_VOICE_NOT_CONFIGURED');return this.mediaPort.voice(context,owner,z.uuid().parse(exposureId));}
  mediaVoiceCurrent(evidence:import('@dafeiyu/contracts').MediaVoiceEvidence){return this.mediaPort?.ready()===true&&this.mediaPort.voiceCurrent?.(evidence)===true;}
  captureMediaReplyAuthority(context:ExecutionContextV3,owner:string,payloadHash:string){if(!this.executions)throw new Error('EXECUTION_NOT_CONFIGURED');return this.executions.captureMediaReply(context,owner,payloadHash,this.personaAccess(context,owner,'local-write'));}
  async prepareMediaReplyAccess(authority:unknown,reply:Reply,signal:AbortSignal):Promise<MediaReplyAccess>{if(!this.executions)throw new Error('EXECUTION_NOT_CONFIGURED');signal=AbortSignal.any([signal,this.controller.signal]);const facts=this.executions.mediaReplyFacts(authority),run=facts.run;
    if(run.definition.origin.kind!=='message')return this.prepareNativeMediaReplyAccess(facts,reply,signal);
    if(reply.taskResult)throw new Error('DELIVERY_BINDING_CONFLICT');
    const item=this.journal.get(run.definition.origin.inboundId),source=this.extensions.get(item.extensionId);
    if(!run.result||reply.id!==item.id+':reply'||reply.sourceMessageId!==item.message.id||runtimeHash(reply.conversation)!==runtimeHash(item.message.conversation)||createHash('sha256').update(reply.text).digest('hex')!==run.result.textHash)throw new Error('DELIVERY_BINDING_CONFLICT');
    const completed=this.journal.events(item.route).findLast(event=>event.traceId===item.id&&event.type==='turn.completed');let captured:Awaited<ReturnType<typeof prepareCapturedReplySources>>|undefined,final:Awaited<ReturnType<typeof prepareReplySources>>|undefined,allocated:MediaReplyAccess|undefined;
    try{captured=await prepareCapturedReplySources(this.config.agentId,item,facts.body.dependencies,this.contexts,()=>this.compactionBinding(),signal);
      final=await prepareReplySources(this.ctx,this.config.agentId,item,completed?.sources??[],this.contexts,()=>this.compactionBinding(),signal);
      const expiresAt=new Date(Date.parse(run.updatedAt)+900000).toISOString(),target=Object.freeze({...item.message.conversation}),text=reply.text;
      let access:MediaReplyAccess,released=false,resourcesReleased=false;const releaseResources=()=>{if(resourcesReleased)return;resourcesReleased=true;captured!.release();final!.release();};
      const release=()=>{if(released)return;released=true;signal.removeEventListener('abort',releaseResources);this.mediaReplyAccesses.delete(access);releaseResources();};
      const guard=()=>{signal.throwIfAborted();this.controller.signal.throwIfAborted();if(resourcesReleased||!this.mediaReplyAccesses.has(access)||!source?.active||this.fatal||Date.parse(expiresAt)<=Date.now())throw new Error('MEDIA_REPLY_ACCESS_EXPIRED');
        facts.guard();this.validateRunPersona(run);captured!.guard();final!.guard();};
      const scopeGuard=()=>{signal.throwIfAborted();if(!this.mediaReplyAccesses.has(access))throw new Error('SCOPE_DENIED');facts.guard();};
      access=Object.freeze({execution:Object.freeze({...facts.execution,view:Object.freeze({...facts.execution.view,signal}),guard:scopeGuard}),authority:facts.authority,payloadHash:facts.body.payloadHash,replyId:reply.id,text,target,sourceMessageId:item.message.id,inboundId:item.id,anchor:Object.freeze({kind:'reply' as const,inboundId:item.id}),expiresAt,guard,
        release});allocated=access;
      this.mediaReplyAccesses.add(access);signal.addEventListener('abort',releaseResources,{once:true});if(signal.aborted)releaseResources();guard();return access;
    }catch(error){if(allocated)allocated.release();else{captured?.release();final?.release();}throw error;}
  }
  validateMediaReplyAccess(access:MediaReplyAccess){if(!this.mediaReplyAccesses.has(access))throw new Error('SCOPE_DENIED');access.guard();}
  ownsMediaReplyAccess(access:MediaReplyAccess){return this.mediaReplyAccesses.has(access);}
  private targetPersona(item:PendingMessage,id:string,signal:AbortSignal,guard:()=>void){const foundation=this.persona(),scope={kind:'conversation' as const,agentId:this.config.agentId,route:item.route};
    const access:PersonaAccess={view:{runId:id,taskId:null,scope,origin:{kind:'message',inboundId:item.id,conversation:item.message.conversation},signal},producer:'core-target-persona',operationId:id,startedEventId:null,intentVersion:0,motivation:{kind:'conversation-invitation',basis:[`task-result:${item.id}`]},inputs:[],admittedSources:[],guard};
    const target=this.personas.prepareTarget(access),provider=this.expressionPreferences,expression=provider?.read(item.message.conversation)??[],expressionHash=runtimeHash(expression);return {text:foundation.text,foundationHash:foundation.version,stamp:runtimeHash([target.stamp,expressionHash]),items:[...target.items,...expression],guard:()=>{if(this.persona().version!==foundation.version||this.expressionPreferences!==provider||runtimeHash(provider?.read(item.message.conversation)??[])!==expressionHash)throw new Error('SOURCE_STALE');target.guard();}};}
  private async prepareNativeMediaReplyAccess(facts:ReturnType<ExecutionCoordinator['mediaReplyFacts']>,reply:Reply,signal:AbortSignal):Promise<MediaReplyAccess>{
    const native=await this.executions!.nativeResultAccess(facts.run.id),row=this.runStore!.nativeDeliveries.get(facts.run.id),provider=this.nativeExpressionPort;
    if(!row?.material||!row.renderRef||!provider?.ready()||!native.media||row.material.mediaStamp!==native.media.sourceStamp||!['ready','sending'].includes(row.state)||reply.id!=='native-delivery:'+row.id||!reply.taskResult||runtimeHash(reply.taskResult)!==runtimeHash(row.anchor)||runtimeHash(native.anchor)!==runtimeHash(row.anchor)||runtimeHash(reply.conversation)!==runtimeHash(row.anchor.target))throw new Error('DELIVERY_BINDING_CONFLICT');
    const item=this.journal.get(row.anchor.inboundId),text=this.runStore!.nativeDeliveries.verifyCredential(facts.run.id);if(text!==reply.text||reply.sourceMessageId!==item.message.id)throw new Error('DELIVERY_BODY_MISMATCH');
    this.validateNativeMediaReplyAuthority(facts.authority,native);const packet=provider.open(native,row.material.packetId);if(packet.sourceStamp!==row.material.sourceStamp||runtimeHash(packet.media)!==runtimeHash(native.media))throw new Error('SOURCE_STALE');
    // Full task evidence is checked above and by NativeTaskDelivery before each external part.
    // Byte readers keep the live scope, media-root fences and immutable approved credential,
    // instead of rebuilding every task dependency for each local read or nested guard.
    const basis=()=>{signal.throwIfAborted();facts.guard();native.execution.guard();const current=this.runStore!.nativeDeliveries.get(facts.run.id);
      if(this.nativeExpressionPort!==provider||!provider.ready()||current?.material?.sourceStamp!==packet.sourceStamp||this.runStore!.nativeDeliveries.verifyCredential(facts.run.id)!==text||!current||!['ready','sending'].includes(current.state))throw new Error('SOURCE_STALE');};
    const persona=this.targetPersona(item,row.id,signal,basis);if(persona.stamp!==row.material.personaHash||persona.foundationHash!==row.material.foundationHash||runtimeHash(this.analysisModelRoute())!==row.material.modelHash)throw new Error('SOURCE_STALE');
    let access:MediaReplyAccess,checking=false;const guard=()=>{if(checking)throw new Error('MEDIA_REPLY_AUTHORITY_CYCLE');checking=true;try{if(!this.mediaReplyAccesses.has(access)||Date.parse(native.anchor.expiresAt)<=Date.now())throw new Error('MEDIA_REPLY_ACCESS_EXPIRED');persona.guard();}finally{checking=false;}};
    const scopeGuard=()=>{signal.throwIfAborted();if(!this.mediaReplyAccesses.has(access))throw new Error('SCOPE_DENIED');facts.guard();native.execution.guard();};
    access=Object.freeze({execution:Object.freeze({...native.execution,view:Object.freeze({...native.execution.view,signal}),guard:scopeGuard}),authority:facts.authority,payloadHash:facts.body.payloadHash,replyId:reply.id,text,target:Object.freeze({...row.anchor.target}),sourceMessageId:item.message.id,inboundId:item.id,anchor:row.anchor,expiresAt:row.anchor.expiresAt,approvedMedia:native.media,guard,release:()=>{this.mediaReplyAccesses.delete(access);}});
    this.mediaReplyAccesses.add(access);try{guard();return access;}catch(error){access.release();throw error;}
  }
  validateNativeMediaReplyAuthority(authority:unknown,access:import('@dafeiyu/contracts').NativeExpressionAccess){if(!this.executions)throw new Error('EXECUTION_NOT_CONFIGURED');access.guard();const facts=this.executions.mediaReplyFacts(authority),actual=this.executions.describeMessageResult(facts.run.id);
    if(facts.run.definition.scope.kind!=='task'||runtimeHash(facts.run.definition.scope)!==runtimeHash(access.execution.view.scope)||!actual||runtimeHash(actual.anchor)!==runtimeHash(access.anchor))throw new Error('SCOPE_DENIED');
    if(facts.body.dependencies.length&&!access.execution.validateHistory?.(facts.body.dependencies)||facts.body.sources.some(source=>!this.executionMemoryPort?.validate(access.execution,source)))throw new Error('SOURCE_STALE');
    facts.guard();return facts.body.payloadHash;
  }
  nativeMediaObservedMaterial(access:PersonaAccess,source:PersonaSourceRef,target:Conversation,view:string){return this.mediaPort?.ready()?this.mediaPort.observedMaterial?.(access,source,target,view)??null:null;}
  nativeMediaTargetMaterial(access:import('@dafeiyu/contracts').NativeExpressionAccess){return this.mediaPort?.ready()?this.mediaPort.nativeMaterial?.(access)??null:null;}
  async prepareMessageTaskExpression(runId:string){if(!this.executions||!this.nativeExpressionPort?.ready())throw new Error('DEPENDENCY_UNAVAILABLE');const port=this.nativeExpressionPort,access=await this.executions.nativeResultAccess(runId);if(port!==this.nativeExpressionPort)throw new Error('DEPENDENCY_UNAVAILABLE');return port.prepare(access);}
  async openMessageTaskExpression(runId:string,packetId:string){if(!this.executions||!this.nativeExpressionPort?.ready())throw new Error('DEPENDENCY_UNAVAILABLE');return this.nativeExpressionPort.open(await this.executions.nativeResultAccess(runId),packetId);}
  async withdrawMessageTaskExpression(runId:string,packetId:string,version:number){if(!this.executions||!this.nativeExpressionPort?.ready())throw new Error('DEPENDENCY_UNAVAILABLE');return this.nativeExpressionPort.withdraw(await this.executions.nativeResultAccess(runId),packetId,version);}
  readonly journal: Journal;
  private readonly config: z.output<typeof ConfigSchema>;
  private readonly runtime: DshRuntime;
  private readonly contexts:ContextCoordinator;
  private readonly personas:PersonaRuntime;
  private readonly taskCoordinator:TaskCoordinator;
  private readonly taskDelivery:TaskDelivery;
  private readonly extensions = new Map<string, Registered>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly scheduled = new Set<string>();
  private readonly actionScopes = new WeakMap<ActionContext, OperationScope>();
  private readonly controller = new AbortController();
  private fatal: string | null = null;
  private closing: Promise<void> | null = null;
  private closed = false;
  private readonly gate = new ServiceGate();
  private admissionHeld=false;
  private readonly readyListeners = new Set<() => void>();
  private readonly registryV3 = new CapabilityRegistryV3();
  private repositoryPort:TaskRepositoryPort|undefined;
  private executionMemoryPort:ExecutionMemoryPort|undefined;
  private capabilityObservationPort:CapabilityObservationPort|undefined;
  private executions:ExecutionCoordinator|undefined;
  private runStore:RuntimeStore|undefined;
  private scheduler:RunScheduler|undefined;
  private executionRecovered=false;
  private conversationRuns:ConversationRuns|undefined;

  constructor(ctx: Context, config: Config) {
    super(ctx, 'dafeiyu');
    this.config = ConfigSchema.parse(config);
    this.taskCoordinator=new TaskCoordinator(this.config.agentId,()=>[...this.extensions.values()].find(e=>e.active&&e.extension.taskWorkspaceProvider)?.extension.taskWorkspaceProvider,()=>this.assertOpen(),()=>[...this.extensions.values()].find(e=>e.active&&e.extension.taskMemoryProvider)?.extension.taskMemoryProvider,()=>[...this.extensions.values()].find(e=>e.active&&e.extension.taskExpressionProvider)?.extension.taskExpressionProvider,
      {submit:(task,input,signal,guard)=>{this.assertAccepting();return this.taskDelivery.submit(task,input,signal,guard);},status:(task,id)=>this.taskDelivery.status(task,id)});
    this.persona();
    this.journal = new Journal(resolve(this.config.dataDir, 'journal.sqlite'));
    this.contexts=new ContextCoordinator(this.config.agentId,this.journal,this.config.context);
    this.personas=new PersonaRuntime(this.config.context);
    this.runtime = new DshRuntime(ctx, { provider: this.config.provider, model: this.config.model,
      ...(this.config.reasoningEffort ? { reasoningEffort: ReasoningEffortId(this.config.reasoningEffort) } : {}) }, resolve(this.config.dataDir),this.contexts,
      (item,meta,text)=>this.feedbackViewCurrent({agentId:this.config.agentId,route:item.route,traceId:item.id},meta,text),this.config.agentId,()=>this.compactionBinding(),
      (frame,data,seqs)=>{const item=this.journal.get(frame.id);this.journal.append({...this.event(item,data.status==='sources-retired'?'context.sources.retired':data.status==='fragments-retired'?'context.summary.updated':'context.compaction.checked',data),sources:seqs.map(seq=>({kind:'session' as const,id:item.sessionId,seq,route:item.route}))});},this.config.lifecycleMode==='managed');
    try{this.taskDelivery=new TaskDelivery(resolve(this.config.dataDir,'delivery.sqlite'),{agentId:this.config.agentId,journal:this.journal,contexts:this.contexts,runtime:this.runtime,signal:this.controller.signal,
      turnTimeoutMs:this.config.turnTimeoutMs,deliveryTimeoutMs:this.config.deliveryTimeoutMs,assertOpen:()=>this.assertOpen(),persona:()=>this.persona(),model:()=>this.analysisModelRoute(),
      sourceTracking:()=>!!this.compactionBinding()?.provider.sources,
      provider:()=>[...this.extensions.values()].find(e=>e.active&&e.extension.taskExpressionProvider)?.extension.taskExpressionProvider,
      channel:item=>this.deliveryChannel(item),
      enqueue:(route,work)=>this.enqueueTaskDelivery(route,work)},true);}catch(error){this.journal.close();throw error;}
    this.contexts.register('core-delivery-recovery','1',[{id:'pending-replies',kind:'operational-fact',prepare:async request=>{
      const scope=this.contexts.scopeFor(request),current=this.journal.get(scope.traceId),facts=this.replyStateFacts(current);
      return facts.map(f=>({id:f.inboundId,version:runtimeHash(f),text:JSON.stringify(f),expiresAt:'9999-12-31T23:59:59.999Z',sources:[{ref:'dafeiyu:pending-reply:'+f.inboundId,version:'1',hash:runtimeHash(f)}]}));
    },validate:(request,item)=>{try{const current=this.journal.get(this.contexts.scopeFor(request).traceId);return this.replyStateFacts(current).some(f=>f.inboundId===item.id&&runtimeHash(f)===item.version);}catch{return false;}}}]);
    if(this.config.lifecycleMode==='legacy'){this.recover();this.activate();}
  }
  recover():void {
    this.assertOpen();
    if(this.gate.state==='recovered'||this.gate.active)return;
    if(this.gate.state!=='registered')throw new Error('SERVICE_LIFECYCLE_CONFLICT');
    if(this.executions&&!this.executionRecovered)throw new Error('EXECUTION_RECOVERY_REQUIRED');
    this.taskDelivery.recover();
    // Never replay work that may already have caused effects before a process died.
    for (const item of this.journal.list(['processing', 'sending'])) {
      this.journal.transition(item.id, item.state, 'uncertain', this.event(item, 'recovery.uncertain', { previousState: item.state }));
      const events = this.journal.events(item.route).filter(event => event.traceId === item.id);
      for (const operation of events.filter(event => event.type === 'operation.started')) {
        if (!events.some(event => event.operationId === operation.operationId && event.type !== 'operation.started')) {
          this.journal.append(eventFor(this.config.agentId, item, 'operation.unknown', operation.plugin,
            operation.pluginVersion, operation.operationId, operation.id, { reason: 'interrupted_before_result' }));
        }
      }
    }
    this.gate.recovered();
  }
  activate(options:{deferWork?:boolean;resumeMessages?:boolean;resumeExecutions?:boolean}={}):void {
    this.assertOpen();
    if(this.gate.active){if(this.admissionHeld&&!options.deferWork)this.releaseAdmission(options);return;}
    if([...this.extensions.values()].some(entry=>entry.extension.lifecycleReady&&!entry.extension.lifecycleReady()))throw new Error('DEPENDENCY_UNAVAILABLE');
    this.registryV3.checkReady(this.features());
    this.gate.activate();
    this.admissionHeld=true;if(!options.deferWork)this.releaseAdmission(options);
  }
  private releaseAdmission(options:{resumeMessages?:boolean;resumeExecutions?:boolean}):void {
    this.admissionHeld=false;
    try{for(const listener of this.readyListeners)listener();}catch(error){this.gate.quiesce();throw error;}
    if(options.resumeMessages!==false)for(const item of this.journal.list(['accepted','reply-ready']))if(this.extensions.get(item.extensionId)?.active)this.schedule(item);
    if(options.resumeExecutions!==false){this.executions?.activate();this.nativeTaskDelivery?.activate();}
  }
  onReady(listener:()=>void):()=>void {
    this.assertOpen();this.readyListeners.add(listener);if(this.accepting)listener();
    return ()=>{this.readyListeners.delete(listener);};
  }
  quiesce():void {this.gate.quiesce();}
  cancelRunning():void {this.quiesce();this.controller.abort();}
  get lifecycleState(){return this.gate.state;}
  private features(){return ['core.registration.v1','lifecycle.managed.v1','context.conversation.v1',...(this.repositoryPort?['task.repository.v1']:[]),...(this.executions?['execution.task.v1','execution.assessment.v1','execution.source-anchor.v1','execution.wake-ingress.v1','context.task.v1','execution.resource-scope.v1','execution.message-task.v1']:[]),...(this.nativeTaskDelivery?['delivery.task-result.v1','delivery.status-feedback.v1']:[]),...(this.executionMemoryPort?['memory.execution.v1','continuity.checkpoint.v1','task.intent.v1']:[]),...(this.capabilityObservationPort?['memory.capability-observation.v1']:[]),...(this.nativeExpressionPort?['memory.native-expression.v1']:[]),...(this.mediaPort?['media.assets.v1']:[]),...(this.personas.configured?['persona.stage-state.v1','persona.growth-selection.v1']:[])];}
  bindMessageTasks(binding:MessageTaskBinding){if(!this.executions)throw new Error('EXECUTION_NOT_CONFIGURED');const channel=this.extensions.get(binding.channelExtensionId);
    if(!channel?.active||!channel.extension.channels?.some(c=>c.channel===binding.channel&&c.account===binding.account))throw new Error('SCOPE_DENIED');
    return this.executions.bindMessageTasks({...binding,active:()=>channel.active&&binding.active()});}
  submitMessageTask(context:ExecutionContextV3,pluginId:string,input:unknown){if(!this.executions)throw new Error('EXECUTION_NOT_CONFIGURED');return this.executions.submitMessageTask(context,pluginId,input);}
  messageTaskStatus(context:ExecutionContextV3,pluginId:string,input:unknown){if(!this.executions)throw new Error('EXECUTION_NOT_CONFIGURED');const status=this.executions.messageTaskStatus(context,pluginId,input);return {...status,delivery:this.messageTaskDeliveryStatus(status.runId)};}
  controlMessageTask(context:ExecutionContextV3,pluginId:string,input:unknown){if(!this.executions)throw new Error('EXECUTION_NOT_CONFIGURED');return this.executions.controlMessageTask(context,pluginId,input);}
  capabilityManifest(){return {features:[...new Set([...this.features(),...this.registryV3.providedFeatures()])],actions:this.registryV3.actions().map(action=>({id:action.id,owner:action.owner,pluginVersion:action.pluginVersion,version:action.version,effects:action.effects,requiresTask:action.requiresTask}))};}
  get accepting(){return this.gate.active&&!this.admissionHeld&&!this.fatal&&!this.controller.signal.aborted&&this.dependenciesReady();}
  private dependenciesReady():boolean {
    try {
      if(this.executions&&(!this.repositoryPort?.ready()||this.executions.health.error)||!this.personas.ready)return false;
      if([...this.extensions.values()].some(entry=>entry.extension.lifecycleReady&&!entry.extension.lifecycleReady()))return false;
      this.registryV3.checkReady(this.features());return true;
    }catch{return false;}
  }
  private assertAccepting():void {this.assertOpen();this.gate.assertActive();if(this.admissionHeld)throw new Error('HOST_NOT_READY');if(!this.dependenciesReady())throw new Error('DEPENDENCY_UNAVAILABLE');}
  bindTaskRepository(port:TaskRepositoryPort):()=>void {
    this.assertOpen();if(this.repositoryPort)throw new Error('DUPLICATE_PROVIDER');const bound:TaskRepositoryPort=Object.freeze({ready:port.ready.bind(port),create:port.create.bind(port),findRequest:port.findRequest.bind(port),
      readState:port.readState.bind(port),readSelectedInputs:port.readSelectedInputs.bind(port),update:port.update.bind(port)});this.repositoryPort=bound;
    return ()=>{if(this.repositoryPort===bound)this.repositoryPort=undefined;};
  }
  bindGrowthProvider(provider:MemoryGrowthProvider):()=>void{this.assertOpen();const unbind=this.personas.bind(provider),unpin=this.contexts.pinRegion('memory:growth'),expression=provider.expressionPreferences?{read:provider.expressionPreferences.bind(provider)}:undefined;this.expressionPreferences=expression;return ()=>{unbind();unpin();if(this.expressionPreferences===expression)this.expressionPreferences=undefined;};}
  /** @deprecated Compatibility alias; both names bind the same single provider. */
  bindPersonaProvider(provider:PersonaProvider):()=>void{return this.bindGrowthProvider(provider);}
  assertPersonaTrialAuthority(authority:unknown,input:unknown):void{this.personas.assertTrialAuthority(authority,input);}
  personaTrialAccess(authority:unknown,input:unknown):PersonaAccess{const access=this.personas.trialAccess(authority,input);if(access.view.scope.kind==='task')return access;
    const scope={agentId:access.view.scope.agentId,route:access.view.scope.route},session=this.journal.sessionFor(scope),history=session?this.runtime.exposedDependencies(session):null,origin=access.view.origin;
    return Object.freeze({...access,historyTracked:history!==null,historyDependencies:history??[],validateHistory:(deps:readonly SourceDependency[])=>this.capabilityHistoryCurrent(scope,deps),resourceAllowed:(scene:Conversation)=>origin.kind==='message'&&runtimeHash(origin.conversation)===runtimeHash(scene)});
  }
  bindExecutionMemory(port:ExecutionMemoryPort):()=>void{this.assertOpen();if(this.executionMemoryPort)throw new Error('DUPLICATE_PROVIDER');
    const bound:ExecutionMemoryPort=Object.freeze({ready:port.ready.bind(port),...(port.resourceEpoch?{resourceEpoch:port.resourceEpoch.bind(port)}:{}),validate:port.validate.bind(port),operationSources:port.operationSources.bind(port),outcomeSources:port.outcomeSources.bind(port),
      prepareContext:port.prepareContext.bind(port),validateContext:port.validateContext.bind(port),captureContinuity:port.captureContinuity.bind(port),checkpoint:port.checkpoint.bind(port),bindResult:port.bindResult.bind(port),
      generation:port.generation.bind(port),acceptIntent:port.acceptIntent.bind(port),intent:port.intent.bind(port),resolveIntent:port.resolveIntent.bind(port),summarize:port.summarize.bind(port),
      ...(port.recordLifecycle?{recordLifecycle:port.recordLifecycle.bind(port)}:{}),
      ...(port.recordAssessment?{recordAssessment:port.recordAssessment.bind(port)}:{}),
      ...(port.compactionPolicy?{compactionPolicy:Object.freeze({...port.compactionPolicy})}:{}),...(port.summarizeFragments?{summarizeFragments:port.summarizeFragments.bind(port)}:{}),...(port.rewrite?{rewrite:port.rewrite.bind(port)}:{})});
    this.executionMemoryPort=bound;return ()=>{if(this.executionMemoryPort===bound)this.executionMemoryPort=undefined;};}
  personaAccess(context:ExecutionContextV3,pluginId:string,effect:'read'|'local-write'='read'):PersonaAccess {
    if(!this.executions)throw new Error('EXECUTION_NOT_CONFIGURED');const access=this.executions.personaAccess(context,pluginId,effect);
    if(context.scope.kind==='task')return access;
    const scope={agentId:context.agentId,route:context.scope.route},session=this.journal.sessionFor(scope),history=session?this.runtime.exposedDependencies(session):null;
    return {...access,historyTracked:history!==null,historyDependencies:history??[],validateHistory:deps=>this.capabilityHistoryCurrent(scope,deps),
      resourceAllowed:scene=>{try{this.executions!.authorizeResource(context,pluginId,scene);return true;}catch{return false;}}};
  }
  bindCapabilityObservations(port:CapabilityObservationPort):()=>void {
    this.assertOpen();if(this.capabilityObservationPort)throw new Error('DUPLICATE_PROVIDER');
    const bound=Object.freeze({ready:port.ready.bind(port),record:port.record.bind(port),select:port.select.bind(port),valid:port.valid.bind(port),...(port.mediaFence?{mediaFence:port.mediaFence.bind(port)}:{})});this.capabilityObservationPort=bound;
    return ()=>{if(this.capabilityObservationPort===bound)this.capabilityObservationPort=undefined;};
  }
  capabilityResources(context:ExecutionContextV3,pluginId:string):readonly Conversation[]{if(!this.executions)throw new Error('EXECUTION_NOT_CONFIGURED');return this.executions.resources(context,pluginId);}
  quoteReplySource(context:ExecutionContextV3,pluginId:string){if(!this.executions)throw new Error('EXECUTION_NOT_CONFIGURED');return this.executions.quoteReplySource(context,pluginId);}
  async deliverPublicProgress(context:ExecutionContextV3,pluginId:string,raw:unknown):Promise<import('@dafeiyu/contracts').DeliveryResult>{
    if(!this.runStore||!this.executions)throw new Error('EXECUTION_NOT_CONFIGURED');
    const input=z.strictObject({kind:z.enum(['intent','progress','blocked']),text:z.string().trim().min(1).max(1000)}).parse(raw),authority=this.authorizeExternalTask(context,pluginId);
    const source=this.quoteReplySource(context,pluginId),item=this.journal.get(source.inboundId),channel=this.deliveryChannel(item);
    if(!channel||item.message.conversation.channel!=='qq')throw new Error('DEPENDENCY_UNAVAILABLE');
    const facts=this.runStore.operations(context.runId).filter(operation=>operation.id!==context.operationId&&operation.state==='finished'&&operation.outcome?.effects!=='unknown'&&['succeeded','partial'].includes(operation.outcome?.status??'')&&!['qq_progress','dsh_tool_list'].includes(operation.action)).slice(-6);
    if(input.kind==='progress'&&!facts.length)throw new Error('PROGRESS_EVIDENCE_REQUIRED');
    const signal=AbortSignal.any([context.signal,channel.signal]),guard=()=>{signal.throwIfAborted();authority.guard();if(this.deliveryChannel(item)?.identity!==channel.identity)throw new Error('SOURCE_STALE');};guard();
    return this.enqueueTaskDelivery(item.route,async()=>{let invoked=false;try{guard();const persona=this.targetPersona(item,context.operationId,signal,guard),model={provider:this.config.provider,model:this.config.model,...(this.config.reasoningEffort?{reasoningEffort:ReasoningEffortId(this.config.reasoningEffort)}:{})};
      const result=await renderPublicProgress(this.ctx,model,this.config.dataDir,context.operationId,persona.text,persona.items,{target:item.message.conversation,taskId:context.taskId!,runId:context.runId,inboundId:item.id,question:authority.authorization.goal,taskState:'running',
        evidence:[{id:'intent',kind:'inference',text:JSON.stringify({requestedPublicFeedback:input,note:'仅公开反馈草稿，不是完成事实。'})},...facts.map((operation,index)=>({id:'P'+index,kind:'reported' as const,text:JSON.stringify({action:operation.action,outcome:operation.outcome}).slice(0,8000)}))]},signal,()=>{guard();persona.guard();},this.config.context.requestMaxBytes-this.config.context.outputReserveBytes);
      guard();persona.guard();const reply:Reply={id:'qq-progress:'+context.operationId,conversation:item.message.conversation,sourceMessageId:item.message.id,text:result.text};
      invoked=true;return await channel.capability.deliver(reply,signal,()=>{guard();persona.guard();});
      }catch{return {status:invoked?'unknown' as const:'not-sent' as const,code:invoked?'QQ_PROGRESS_RESULT_UNKNOWN':'QQ_PROGRESS_NOT_SENT'};}
    });
  }
  authorizeCapabilityResource(context:ExecutionContextV3,pluginId:string,raw:unknown):Conversation {
    if(!this.executions)throw new Error('EXECUTION_NOT_CONFIGURED');const scene=ConversationSchema.parse(raw);this.executions.authorizeResource(context,pluginId,scene);return scene;
  }
  capabilityResourceCurrent(raw:unknown):boolean {const proof=ResourceProofSchema.safeParse(raw);return proof.success&&this.registryV3.resourceCurrent(proof.data);}
  capabilityPublicView(raw:unknown,view:string):boolean {const proof=ResourceProofSchema.safeParse(raw);return proof.success&&this.registryV3.publicView(proof.data,view);}
  capabilityTargetView(raw:unknown,view:string,target:Conversation,scope:unknown){const proof=ResourceProofSchema.safeParse(raw),destination=ConversationSchema.safeParse(target),execution=ExecutionScopeSchema.safeParse(scope);
    return proof.success&&destination.success&&execution.success&&execution.data.agentId===this.config.agentId?this.registryV3.targetView(proof.data,view,destination.data,execution.data):null;}
  capabilityResourceEpoch(scope?:TimelineScope):string {return this.registryV3.resourceEpoch(scope);}
  capabilityResourceEpochWithout(providerId:string,scope?:TimelineScope):string {return this.registryV3.resourceEpoch(scope,providerId);}
  capabilityHistoryCurrent(scope:TimelineScope,deps:readonly SourceDependency[]):boolean {
    const session=this.journal.sessionFor(scope);return !!session&&this.runtime.summarySourcesCurrent(session,deps);
  }
  capabilityObservationCurrent(scope:TimelineScope,source:PersonaSourceRef,exposedHash?:string):boolean {
    return !!this.capabilityObservationPort?.ready()&&this.capabilityObservationPort.valid(scope,source,exposedHash);
  }
  mediaExpressionFence(access:PersonaAccess,target:Conversation,roots:readonly string[]){access.guard();const port=this.capabilityObservationPort;if(!port?.ready()||!port.mediaFence)throw new Error('DEPENDENCY_UNAVAILABLE');return port.mediaFence(access,target,roots);}
  recordCapabilityObservation(context:ExecutionContextV3,pluginId:string,raw:unknown,options?:{readonly inheritExecutionHistory:true}) {
    if(options!==undefined)z.strictObject({inheritExecutionHistory:z.literal(true)}).parse(options);
    const input=CapabilityObservationSchema.parse(raw);if(input.proof.provider!==pluginId)throw new Error('SCOPE_DENIED');
    const scene=this.authorizeCapabilityResource(context,pluginId,input.proof.scene),execution=this.personaAccess(context,pluginId);
    const port=this.capabilityObservationPort;if(!port?.ready())throw new Error('DEPENDENCY_UNAVAILABLE');
    const guard=()=>{execution.guard();this.authorizeCapabilityResource(context,pluginId,scene);if(this.capabilityObservationPort!==port||!port.ready()||!this.capabilityResourceCurrent(input.proof))throw new Error('SOURCE_STALE');};
    guard();return port.record({execution,scene,guard,...(options?.inheritExecutionHistory?{inheritExecutionHistory:true as const}:{})},input);
  }
  selectCapabilityObservation(context:ExecutionContextV3,pluginId:string,sceneInput:unknown,raw:unknown,actualView:string) {
    const scene=this.authorizeCapabilityResource(context,pluginId,sceneInput),execution=this.personaAccess(context,pluginId,'local-write'),input=CapabilitySelectionSchema.parse(raw);
    const port=this.capabilityObservationPort;if(!port?.ready())throw new Error('DEPENDENCY_UNAVAILABLE');
    const guard=()=>{execution.guard();this.authorizeCapabilityResource(context,pluginId,scene);if(this.capabilityObservationPort!==port||!port.ready())throw new Error('DEPENDENCY_UNAVAILABLE');};
    guard();return port.select({execution,scene,guard},input,actualView);
  }
  personaContext(request:ContextRequest){const scope=this.scopeForContext(request),id=this.runStore?.findRequest('conversation',scope.traceId)?.runId;const persona=id?this.personas.current(id):undefined;persona?.guard();return persona?.items??[];}
  configureExecution(raw:ExecutionOptions):void {
    this.assertOpen();if(this.config.lifecycleMode!=='managed'||this.gate.state!=='registered'||this.executions)throw new Error('SERVICE_LIFECYCLE_CONFLICT');
    const options=ExecutionOptionsSchema.parse(raw),store=new RuntimeStore(resolve(this.config.dataDir,'runtime.sqlite'),{agentId:this.config.agentId,profileId:options.profileId},{create:options.createStore,requirePersonaManifest:true});
    this.runStore=store;this.scheduler=new RunScheduler(options.maxConcurrentRuns);
    this.conversationRuns=new ConversationRuns(this.ctx,store,this.journal,this.config.agentId,run=>this.validateRunPersona(run));
    this.executions=new ExecutionCoordinator({agentId:this.config.agentId,store,journal:this.journal,runtime:this.runtime,registry:this.registryV3,scheduler:this.scheduler,options,personas:this.personas,
      repository:()=>this.repositoryPort,memory:()=>this.executionMemoryPort,accepting:()=>this.accepting,assertAccepting:()=>this.assertAccepting(),persona:()=>this.persona(),model:this.analysisModelRoute(),
      turnTimeoutMs:this.config.turnTimeoutMs,assessmentTimeoutMs:this.config.phaseTimeouts.assessment,context:this.config.context,signal:this.controller.signal,messageSignal:id=>this.messageProcessingSignal(id),media:()=>this.mediaPort,projectConversation:()=>this.conversationRuns!.project(),progress:id=>this.nativeTaskDelivery?.progress(id)??Promise.resolve(null),settled:id=>{if(this.runStore?.get(id).state==='failed')void this.nativeTaskDelivery?.progress(id).catch(()=>{});else void this.nativeTaskDelivery?.request(id,true).catch(()=>{});}});
    this.nativeTaskDelivery=new NativeTaskDelivery({ctx:this.ctx,store,contexts:this.contexts,cwd:this.config.dataDir,signal:this.controller.signal,timeoutMs:NATIVE_RENDER_ATTEMPTS*(this.config.phaseTimeouts.render+this.config.phaseTimeouts.verification)+this.config.deliveryTimeoutMs,sendTimeoutMs:this.config.deliveryTimeoutMs,
      describe:id=>this.executions!.describeMessageResult(id),access:id=>this.executions!.nativeResultAccess(id),expression:()=>this.nativeExpressionPort,accepting:()=>this.accepting,flush:()=>this.executions!.flushEvents(),
      feedbackSource:id=>this.executions!.feedbackSource(id),
      model:()=>({provider:this.config.provider,model:this.config.model,...(this.config.reasoningEffort?{reasoningEffort:ReasoningEffortId(this.config.reasoningEffort)}:{})}),
      channel:item=>this.deliveryChannel(item),
      enqueue:(route,work)=>this.enqueueTaskDelivery(route,work),acquire:()=>this.scheduler!.acquire(false),
      persona:(item,id,signal,guard)=>this.targetPersona(item,id,signal,guard),media:()=>this.mediaPort,mediaAccess:(authority,reply,signal)=>this.prepareMediaReplyAccess(authority,reply,signal),
    });
  }
  async recoverExecutions():Promise<void>{if(!this.executions)throw new Error('EXECUTION_NOT_CONFIGURED');if(this.gate.state!=='registered')throw new Error('SERVICE_LIFECYCLE_CONFLICT');this.executions.recover();await this.conversationRuns?.recover();this.executionRecovered=true;if(this.personas.ready)this.recoverPersonaTrials();}
  /** Replays only missing completion records after providers are ready; never starts a model or reconstructs admission. */
  recoverPersonaTrials():readonly PersonaTrialCompletionStatus[]{this.assertOpen();if(!this.runStore||!this.executions)throw new Error('EXECUTION_NOT_CONFIGURED');if(!this.personas.ready)throw new Error('DEPENDENCY_UNAVAILABLE');
    return this.runStore.list(['completed','failed','cancelled','interrupted']).flatMap(run=>{const binding=this.runStore!.personaBinding(run.id);if(binding.kind!=='bound'||binding.manifest.schemaVersion!==2||!binding.manifest.trialEntries.length)return [];
      try{return [this.personas.completeTrial(this.runStore!,run.id,this.executions!.trialInputs(run),this.controller.signal)];}
      catch(error){const code=error instanceof Error&&/^[A-Z][A-Z0-9_]{0,99}$/.test(error.message)?error.message:'PERSONA_TRIAL_RECOVERY_FAILED';this.runStore!.appendExecutionEvent(run.id,'persona.trial-completion-deferred',{code});return [{runId:run.id,status:'deferred' as const,outcomes:[],code}];}});
  }
  executionProducer(id:string,options?:unknown){if(!this.executions)throw new Error('EXECUTION_NOT_CONFIGURED');return this.executions.producer(id,options);}
  bindWakeAuthority(provider:WakeAuthorityProvider){if(!this.executions)throw new Error('EXECUTION_NOT_CONFIGURED');return this.executions.bindWake(provider);}
  bindExecutionLifecycle(owner:string,receive:(event:import('@dafeiyu/contracts').MaintenanceLifecycle)=>void){if(!this.executions)throw new Error('EXECUTION_NOT_CONFIGURED');return this.executions.bindLifecycle(owner,receive);}
  captureActivityAnchor(context:ExecutionContextV3,pluginId:string){if(!this.executions)throw new Error('EXECUTION_NOT_CONFIGURED');return this.executions.captureActivity(context,pluginId);}
  activityAnchorStatus(anchor:unknown){if(!this.executions)throw new Error('EXECUTION_NOT_CONFIGURED');return this.executions.activityAnchorStatus(anchor);}
  createMaintenanceAnchor(runId:string,taskId:string,epoch:number){if(!this.executions)throw new Error('EXECUTION_NOT_CONFIGURED');return this.executions.maintenanceAnchor(runId,taskId,epoch);}
  activityPressure(){return {...(this.scheduler?.status??{active:0,waiting:0,foregroundWaiting:0}),foregroundRuns:this.executions?.foregroundPending??0};}
  executionAuthority(context:ExecutionContextV3,pluginId:string){if(!this.executions)throw new Error('EXECUTION_NOT_CONFIGURED');return this.executions.authority(context,pluginId);}
  authorizeExternalTask(context:ExecutionContextV3,pluginId:string){if(!this.executions)throw new Error('EXECUTION_NOT_CONFIGURED');return this.executions.authorizeExternalTask(context,pluginId);}
  externalTaskSourceCurrent(authorization:unknown,pluginId:string):boolean{return this.executions?.externalTaskSourceCurrent(authorization,pluginId)??false;}
  explicitTaskInstruction(context:ExecutionContextV3,pluginId:string){if(!this.executions)throw new Error('EXECUTION_NOT_CONFIGURED');return this.executions.explicitTaskInstruction(context,pluginId);}
  executionEvents(context:ExecutionContextV3,pluginId:string){const authority=this.executionAuthority(context,pluginId);if(authority.scope.kind!=='task')throw new Error('UNSUPPORTED_EXECUTION_ORIGIN');return this.journal.executionEvents(authority.agentId,authority.scope.taskId);}
  registerExtensionV3(extension:ExtensionV3):ExtensionHandleV3 {
    this.assertOpen();
    const legacy=[...this.extensions.values()].map(entry=>entry.extension);
    const handle=this.registryV3.register(this.config.agentId,extension,{ids:legacy.map(value=>value.id),actions:legacy.flatMap(value=>(value.actions??[]).map(action=>action.name)),
      channels:legacy.flatMap(value=>(value.channels??[]).map(channel=>JSON.stringify([channel.channel,channel.account])))});
    let bridge:Registered|undefined;
    try{
      if(extension.channels?.length){
        const channels=extension.channels.map(channel=>({channel:channel.channel,account:channel.account,deliver:channel.deliver.bind(channel),
          ...(channel.processingSignal?{processingSignal:channel.processingSignal.bind(channel)}:{}),
          ...(channel.description?{description:channel.description}:{}),...(channel.taskDelivery?{taskDelivery:channel.taskDelivery}:{}),...(channel.deliveryValidation?{deliveryValidation:channel.deliveryValidation}:{}),...(channel.deliverTaskResult?{deliverTaskResult:channel.deliverTaskResult.bind(channel)}:{}),...(channel.mediaDelivery?{mediaDelivery:channel.mediaDelivery}:{}),...(channel.deliverMedia?{deliverMedia:channel.deliverMedia.bind(channel)}:{})}));
        bridge={active:true,controller:new AbortController(),extension:{apiVersion:2,id:extension.id,version:extension.version,agentId:extension.agentId,channels,
          ...(extension.lifecycleReady?{lifecycleReady:extension.lifecycleReady.bind(extension)}:{})}};
        this.extensions.set(extension.id,bridge);
      }
      if(this.gate.active)this.registryV3.checkReady(this.features());
    }catch(error){handle.dispose();if(bridge)this.extensions.delete(extension.id);throw error;}
    const registered=bridge;
    if(registered)for(const item of this.journal.list(['accepted','reply-ready']))if(item.extensionId===extension.id)this.schedule(item);
    if(this.accepting)this.executions?.activate();
    return Object.freeze({...(registered?{ingest:(raw:unknown):Receipt=>{
      this.assertAccepting();if(!registered.active)throw new Error('CAPABILITY_UNAVAILABLE');const message=MessageSchema.parse(raw);
      if(!registered.extension.channels?.some(channel=>channel.channel===message.conversation.channel&&channel.account===message.conversation.account))throw new Error('SCOPE_DENIED');
      const receipt=this.journal.accept(this.config.agentId,registered.extension.id,registered.extension.version,message),item=this.journal.get(receipt.id);
      if(item.state==='accepted'||item.state==='reply-ready')this.schedule(item);return receipt;
    }}:{}),dispose:()=>{handle.dispose();if(registered?.active){registered.active=false;registered.controller.abort();if(this.extensions.get(registered.extension.id)===registered)this.extensions.delete(registered.extension.id);}}});
  }
  private persona() {
    return readFoundation(this.config.personaFile);
  }
  private event(item: PendingMessage, type: string, data: Record<string, Json> = {}, causedBy: string | null = null) {
    return eventFor(this.config.agentId, item, type, '@dafeiyu/core', CORE_VERSION, item.id, causedBy, data);
  }
  private assertOpen(): void {
    if (this.controller.signal.aborted) throw new Error('Dafeiyu is closing');
    if (this.fatal) throw new Error(this.fatal);
  }
  /** Resolve an active invocation issued by this core. Model arguments cannot select a route or impersonate a context. */
  scopeFor(context: ActionContext): OperationScope {
    this.assertOpen();
    const scope = this.actionScopes.get(context);
    if (!scope) throw new Error('No active core-issued action context');
    context.signal.throwIfAborted();
    return scope;
  }
  scopeForContext(request:ContextRequest):OperationScope{this.assertOpen();return this.contexts.scopeFor(request);}
  /** Trusted coordinator API, deliberately not a model tool. */
  createTaskWorkspace(input:unknown){return this.taskCoordinator.create(input);}
  resumeTaskWorkspace(id:string){return this.taskCoordinator.resume(id);}
  setTaskMemoryPolicy(input:unknown){return this.taskCoordinator.policy(input);}
  setTaskExpressionPolicy(input:unknown){return this.taskCoordinator.expressionPolicy(input);}
  private feedbackEntry():Registered|undefined{return [...this.extensions.values()].find(e=>e.active&&e.extension.feedbackProvider);}
  private observationEntry():Registered|undefined{return [...this.extensions.values()].find(e=>e.active&&e.extension.memoryObservationProvider);}
  private observationAuthority(entry:Registered,conversation:Conversation,context?:ActionContext):ObservationAuthority {
    this.assertOpen();if(!entry.active)throw new Error('Extension is unregistered');
    const route=conversationKey(this.config.agentId,conversation);
    let taskId:string|null=null,ingressPluginId=entry.extension.id,agentTaskId:string|null=null;
    let parent:ObservationAuthority['parent'];
    if(context){
      const scope=this.scopeFor(context),event=this.journal.scopedEvent(scope,scope.startedEventId);
      if(scope.route!==route||event?.plugin!==entry.extension.id)throw new Error('Observation context does not belong to this capability');
      taskId=this.compactionBinding()?.provider.basis(scope).taskId??null;
      agentTaskId=[...this.extensions.values()].find(e=>e.active&&e.extension.taskWorkspaceProvider)?.extension.taskWorkspaceProvider?.current(scope)??null;
      if(agentTaskId)taskId=null;
      parent={traceId:scope.traceId,operationId:scope.operationId,eventId:scope.startedEventId};
      ingressPluginId=this.journal.get(scope.traceId).extensionId;
    }else if(!entry.extension.channels?.some(c=>c.channel===conversation.channel&&c.account===conversation.account))throw new Error('Observation requires an owned channel or live capability context');
    return {agentId:this.config.agentId,route,pluginId:entry.extension.id,pluginVersion:entry.extension.version,ingressPluginId,conversation:{...conversation},taskId,...(parent?{parent}:{}),...(agentTaskId?{agentTaskId}:{})};
  }
  private compactionBinding():CompactionBinding|undefined {
    const entry=[...this.extensions.values()].find(e=>e.active&&e.extension.compactionProvider);
    return entry?.extension.compactionProvider?{owner:entry.extension.id,version:entry.extension.version,provider:entry.extension.compactionProvider}:undefined;
  }
  /** Read-only source export gate for archived summary checkpoints. */
  compactionViewCurrent(scope:Pick<OperationScope,'agentId'|'route'|'traceId'>,text:string,compactionId:string):boolean {
    try {
      const parsed=JSON.parse(text);
      if(fragmentCapsuleSchema.safeParse(parsed).success)return scope.agentId===this.config.agentId&&this.runtime.fragmentViewCurrent(this.journal.sessionFor(scope)??'',compactionId,text);
      const capsule=capsuleSchema.parse(parsed),binding=this.compactionBinding();
      return !!binding&&scope.agentId===this.config.agentId&&capsule.agentId===scope.agentId&&capsule.route===scope.route
        &&capsule.owner===binding.owner&&(capsule.schemaVersion===2?this.runtime.summarySourcesCurrent(this.journal.sessionFor(scope)??'',capsule.dependencies!):capsule.epoch===binding.provider.basis(scope).epoch)
        &&this.runtime.summaryCommitted(this.journal.sessionFor(scope)??'',compactionId,text);
    }catch{return false;}
  }
  summaryReference(context:ActionContext,ref:string){const scope=this.scopeFor(context);return this.runtime.readSummaryReference(this.journal.sessionFor(scope)??'',ref);}
  historicalSourceCurrent(scope:Pick<OperationScope,'agentId'|'route'>,sessionId:string,seq:number):boolean{
    return scope.agentId===this.config.agentId&&this.journal.sessionFor(scope)===sessionId&&this.runtime.sourceCurrent(sessionId,seq);
  }
  feedbackViewCurrent(scope:Pick<OperationScope,'agentId'|'route'|'traceId'>,raw:unknown,text:string):boolean{
    const parsed=FeedbackMetaSchema.safeParse(raw);if(!parsed.success)return false;
    if(text===FEEDBACK_RETIRED_TEXT)return true;
    if(scope.agentId!==this.config.agentId||createHash('sha256').update(text).digest('hex')!==parsed.data.viewHash)return false;
    const entry=this.feedbackEntry();if(!entry||entry.extension.id!==parsed.data.owner)return false;
    try{return entry.extension.feedbackProvider!.validate(scope,parsed.data.witness);}catch{return false;}
  }
  /** Host-only durable authorization for read/analyze/commit work, never an ActionContext. */
  issueAnalysisGrant(context: ActionContext): string { return this.journal.issueAnalysisGrant(this.scopeFor(context),CORE_VERSION); }
  analysisScope(grantId: string): OperationScope {
    this.assertOpen();
    const scope = this.journal.analysisGrant(this.config.agentId,grantId);
    if (!scope || !this.journal.sessionFor(scope)) throw new Error('Analysis authorization unavailable');
    return Object.freeze(scope);
  }
  revokeAnalysisGrant(grantId: string): void { this.journal.revokeAnalysisGrant(this.config.agentId,grantId); }
  analysisModelRoute() {
    return Object.freeze({provider:this.config.provider,model:this.config.model,
      ...(this.config.reasoningEffort ? {reasoningEffort:this.config.reasoningEffort} : {})});
  }
  private recoveryModel(){return {provider:this.config.provider,model:this.config.model,...(this.config.reasoningEffort?{reasoningEffort:ReasoningEffortId(this.config.reasoningEffort)}:{})};}
  registerExtension(extension: Extension): ExtensionHandle {
    this.assertOpen();
    if (extension.apiVersion !== API_VERSION || extension.agentId !== this.config.agentId) throw new Error('Incompatible extension interface or agent binding');
    if (!/^[a-z][a-z0-9._-]{0,79}$/.test(extension.id) || !extension.version) throw new Error('Invalid extension identity');
    if (this.extensions.has(extension.id)||this.registryV3.hasId(extension.id)) throw new Error('Duplicate extension ID');
    const existing = [...this.extensions.values()].map(entry => entry.extension);
    const channelKeys = new Set([...existing.flatMap(ext => ext.channels ?? []).map(c => JSON.stringify([c.channel, c.account])),...this.registryV3.channelKeys()]);
    const actionNames = new Set([...existing.flatMap(ext => ext.actions ?? []).map(action => action.name),...this.registryV3.actionNames()]);
    for (const c of extension.channels ?? []) {
      if (c.processingSignal !== undefined && typeof c.processingSignal !== 'function') throw new Error('Invalid channel processing contract');
      if(c.taskDelivery!==undefined&&c.taskDelivery!=='simulated')throw new Error('Task delivery requires simulated capability');
      if(c.deliveryValidation!==undefined&&c.deliveryValidation!=='per-segment')throw new Error('Invalid delivery validation contract');
      if(c.deliverTaskResult!==undefined&&typeof c.deliverTaskResult!=='function')throw new Error('Invalid task result delivery contract');
      if(c.mediaDelivery!==undefined&&(c.mediaDelivery!=='parts-v1'||c.deliveryValidation!=='per-segment'||typeof c.deliverMedia!=='function')||c.deliverMedia!==undefined&&c.mediaDelivery!=='parts-v1')throw new Error('Invalid media delivery contract');
      const key = JSON.stringify([c.channel, c.account]);
      if (!c.channel || !c.account || channelKeys.has(key)) throw new Error('Duplicate or invalid channel/account');
      channelKeys.add(key);
    }
    for (const action of extension.actions ?? []) {
      if (!/^[a-z][a-z0-9_]{0,63}$/.test(action.name) || actionNames.has(action.name)) throw new Error('Duplicate or invalid action name');
      actionNames.add(action.name);
      if(action.feedback!==undefined&&!['structured-v1','archive-view'].includes(action.feedback))throw new Error('Invalid feedback contract');
      if(action.feedback==='archive-view'&&!extension.feedbackProvider)throw new Error('Archive views belong to their feedback provider');
    }
    if(extension.feedbackProvider&&this.feedbackEntry())throw new Error('Feedback provider already registered');
    if(extension.memoryObservationProvider&&this.observationEntry())throw new Error('Memory observation provider already registered');
    if(extension.taskWorkspaceProvider&&[...this.extensions.values()].some(e=>e.active&&e.extension.taskWorkspaceProvider))throw new Error('Task workspace provider already registered');
    if(extension.taskMemoryProvider&&[...this.extensions.values()].some(e=>e.active&&e.extension.taskMemoryProvider))throw new Error('Task memory provider already registered');
    if(extension.taskExpressionProvider&&[...this.extensions.values()].some(e=>e.active&&e.extension.taskExpressionProvider))throw new Error('Task expression provider already registered');
    if(extension.compactionProvider&&this.compactionBinding())throw new Error('Compaction provider already registered');
    if(extension.compactionProvider&&this.ctx.get('compaction'))throw new Error('Use one compaction writer per Dafeiyu host');
    // Snapshot registration metadata so caller-side mutations cannot change a running capability.
    extension = { ...extension,
      ...(extension.lifecycleReady?{lifecycleReady:extension.lifecycleReady.bind(extension)}:{}),
      channels: (extension.channels ?? []).map(channel => ({ channel: channel.channel, account: channel.account,
        ...(channel.deliveryProgress?{deliveryProgress:channel.deliveryProgress.bind(channel)}:{}),
        ...(channel.processingSignal?{processingSignal:channel.processingSignal.bind(channel)}:{}),
        ...(channel.taskDelivery?{taskDelivery:channel.taskDelivery}:{}),
        ...(channel.deliveryValidation?{deliveryValidation:channel.deliveryValidation}:{}),
        ...(channel.deliverTaskResult?{deliverTaskResult:channel.deliverTaskResult.bind(channel)}:{}),
        ...(channel.mediaDelivery?{mediaDelivery:channel.mediaDelivery}:{}),...(channel.deliverMedia?{deliverMedia:channel.deliverMedia.bind(channel)}:{}),
        ...(channel.description ? { description: channel.description } : {}),
        deliver: channel.deliver.bind(channel) })),
      actions: (extension.actions ?? []).map(action => ({ name: action.name, description: action.description,
        execute: action.execute.bind(action),
        ...(action.feedback?{feedback:action.feedback}:{}),
        fields: Object.fromEntries(Object.entries(action.fields).map(([key, field]) => [key, { ...field }])) })),
      ...(extension.feedbackProvider?{feedbackProvider:{capture:extension.feedbackProvider.capture.bind(extension.feedbackProvider),
        present:extension.feedbackProvider.present.bind(extension.feedbackProvider),validate:extension.feedbackProvider.validate.bind(extension.feedbackProvider)}}:{}),
      ...(extension.memoryObservationProvider?{memoryObservationProvider:{submit:extension.memoryObservationProvider.submit.bind(extension.memoryObservationProvider),
        open:extension.memoryObservationProvider.open.bind(extension.memoryObservationProvider),change:extension.memoryObservationProvider.change.bind(extension.memoryObservationProvider)}}:{}),
      ...(extension.taskWorkspaceProvider?{taskWorkspaceProvider:bindTaskProvider(extension.taskWorkspaceProvider)}:{}),
      ...(extension.taskMemoryProvider?{taskMemoryProvider:bindTaskMemoryProvider(extension.taskMemoryProvider)}:{}),
      ...(extension.taskExpressionProvider?{taskExpressionProvider:bindExpressionProvider(extension.taskExpressionProvider)}:{}),
      ...(extension.compactionProvider?{compactionProvider:{policy:Object.freeze({...extension.compactionProvider.policy}),
        ...(extension.compactionProvider.sources?{sources:{inbound:extension.compactionProvider.sources.inbound.bind(extension.compactionProvider.sources),
          context:extension.compactionProvider.sources.context.bind(extension.compactionProvider.sources),tool:extension.compactionProvider.sources.tool.bind(extension.compactionProvider.sources),
          validate:extension.compactionProvider.sources.validate.bind(extension.compactionProvider.sources)}}:{}),
        ...(extension.compactionProvider.summarizeFragments?{summarizeFragments:extension.compactionProvider.summarizeFragments.bind(extension.compactionProvider)}:{}),
        ...(extension.compactionProvider.rewrite?{rewrite:extension.compactionProvider.rewrite.bind(extension.compactionProvider)}:{}),
        basis:extension.compactionProvider.basis.bind(extension.compactionProvider),summarize:extension.compactionProvider.summarize.bind(extension.compactionProvider)}}:{}),
    };
    const registered: Registered = { extension, controller: new AbortController(), active: true };
    const unregisterContexts=this.contexts.register(extension.id,extension.version,extension.contexts??[]);
    this.extensions.set(extension.id, registered);
    for (const item of this.journal.list(['accepted', 'reply-ready'])) {
      if (item.extensionId === extension.id) this.schedule(item);
    }
    return {
      tasks:this.taskCoordinator.forExtension((conversation,context)=>this.observationAuthority(registered,conversation,context),()=>{this.assertOpen();if(!registered.active)throw new Error('Extension is unregistered');}),
      observeMemory:(raw,context)=>{
        const input=MemoryObservationSchema.parse(raw),authority=this.observationAuthority(registered,input.conversation,context),provider=this.observationEntry()?.extension.memoryObservationProvider;
        if(!provider)throw new Error('Memory observation provider unavailable');return provider.submit(authority,input);
      },
      openObservationSource:(raw,context)=>{
        const input=ObservationSourceReadSchema.parse(raw),authority=this.observationAuthority(registered,input.conversation,context),provider=this.observationEntry()?.extension.memoryObservationProvider;
        if(!provider)throw new Error('Memory observation provider unavailable');return provider.open(authority,input);
      },
      changeObservationSource:(raw,context)=>{
        const input=ObservationSourceChangeSchema.parse(raw),authority=this.observationAuthority(registered,input.conversation,context),provider=this.observationEntry()?.extension.memoryObservationProvider;
        if(!provider)throw new Error('Memory observation provider unavailable');return provider.change(authority,input);
      },
      observe: raw => {
        this.assertOpen();
        if (!registered.active) throw new Error('Extension is unregistered');
        const observed = ObservationSchema.parse(raw);
        if (!extension.channels?.some(channel => channel.channel === observed.conversation.channel && channel.account === observed.conversation.account)) throw new Error('Extension does not own this channel/account');
        const id = randomUUID();
        return this.journal.append({ agentId: this.config.agentId, route: conversationKey(this.config.agentId, observed.conversation),
          traceId: id, operationId: id, causedBy: null, type: observed.type, plugin: extension.id, pluginVersion: extension.version,
          occurredAt: new Date().toISOString(), sources: [], data: observed.data }).id;
      },
      ingest: (raw): Receipt => {
        this.assertAccepting();
        if (!registered.active) throw new Error('Extension is unregistered');
        const message = MessageSchema.parse(raw);
        if (!extension.channels?.some(c => c.channel === message.conversation.channel && c.account === message.conversation.account))
          throw new Error('Extension does not own this channel/account');
        const receipt = this.journal.accept(this.config.agentId, extension.id, extension.version, message);
        const item = this.journal.get(receipt.id);
        if (item.state === 'accepted' || item.state === 'reply-ready') this.schedule(item);
        return receipt;
      },
      dispose: () => {
        if (!registered.active) return;
        registered.active = false;
        unregisterContexts();
        registered.controller.abort();
        this.extensions.delete(extension.id);
      },
    };
  }
  private schedule(item: PendingMessage): void {
    if(!this.gate.active||this.admissionHeld)return;
    if (this.scheduled.has(item.id)) return;
    this.scheduled.add(item.id);
    const previous = this.queues.get(item.route) ?? Promise.resolve();
    const task = previous.then(() => this.process(item.id)).catch(() => {
      // A failed journal/checkpoint cannot be safely papered over with another send.
      this.fatal = 'Workflow storage failure; automatic processing stopped';
    }).finally(() => {
      this.scheduled.delete(item.id);
      if (this.queues.get(item.route) === task) this.queues.delete(item.route);
    });
    this.queues.set(item.route, task);
  }
  private enqueueTaskDelivery<T>(route:string,work:()=>Promise<T>):Promise<T>{
    this.assertAccepting();
    const previous=this.queues.get(route)??Promise.resolve();
    const result=previous.then(work);
    const queued=result.then(()=>{},()=>{this.fatal='Task delivery persistence failure; automatic processing stopped';}).finally(()=>{if(this.queues.get(route)===queued)this.queues.delete(route);});
    this.queues.set(route,queued);return result;
  }
  private async notifyConversationFailure(item:PendingMessage,failure:string){
    if(item.message.conversation.channel!=='qq'||!this.accepting||failure==='PERSISTENCE_FAILED'||this.journal.events(item.route).some(e=>e.traceId===item.id&&e.type==='recovery.notice.started'))return;
    const channel=this.deliveryChannel(item);if(!channel)return;
    const signal=AbortSignal.any([this.controller.signal,channel.signal,AbortSignal.timeout(60000)]),id=randomUUID();
    const guard=()=>{signal.throwIfAborted();if(!this.accepting||this.deliveryChannel(item)?.identity!==channel.identity||this.journal.messageRecalled({agentId:this.config.agentId,route:item.route},item.message.id))throw new Error('SOURCE_STALE');this.messageProcessingSignal(item.id)?.throwIfAborted();};
    try{guard();}catch{return;}
    const events=this.journal.events(item.route).filter(e=>e.traceId===item.id),operations=events.filter(e=>e.type==='operation.started').map(e=>({id:e.operationId,action:typeof e.data.action==='string'?e.data.action:'unknown',state:events.findLast(end=>end.operationId===e.operationId&&end.type!=='operation.started')?.type??'unknown'}));
    this.journal.append(this.event(item,'recovery.notice.started',{noticeId:id,code:failure,phase:'recovery'}));
    let text='【系统状态】刚才的处理未完成，进度和已有操作记录已保存；没有自动重做已执行的操作。',fallback=true,next='wait';
    try{const persona=this.targetPersona(item,id,signal,guard),renderSignal=AbortSignal.any([signal,AbortSignal.timeout(20000)]);
      const decision=await renderConversationRecovery(this.ctx,this.recoveryModel(),this.config.dataDir,id,persona.text,persona.items,{question:item.message.mainText??item.message.text,failureCode:failure,operations,originalTurn:'failed',automaticReplay:false},renderSignal,()=>{guard();persona.guard();});
      text=decision.message;next=decision.next;fallback=false;
    }catch{if(signal.aborted)return;}
    try{guard();}catch{return;}this.journal.append(this.event(item,'recovery.notice.prepared',{noticeId:id,next,fallback}));
    this.journal.append(this.event(item,'recovery.notice.sending',{noticeId:id}));
    try{const result=await channel.capability.deliver({id:`recovery-notice:${item.id}`,conversation:item.message.conversation,sourceMessageId:item.message.id,text},signal,guard);
      this.journal.append(this.event(item,'recovery.notice.'+result.status,{noticeId:id,...(result.status==='sent'?{receiptId:result.receiptId}:{code:result.code??'DELIVERY_INCOMPLETE'})}));
    }catch{this.journal.append(this.event(item,'recovery.notice.unknown',{noticeId:id}));}
  }
  private pendingReplyFacts(current:PendingMessage){
    const events=this.journal.events(current.route);
    return this.journal.list(['uncertain','reply-ready']).filter(old=>old.id!==current.id&&old.route===current.route&&old.message.sender.id===current.message.sender.id&&old.reply).slice(-6).flatMap(old=>{
      const progress=this.deliveryChannel(old)?.capability.deliveryProgress?.(old.reply!.id);if(!progress?.canResume||progress.unknown)return [];
      const decision=events.findLast(e=>e.traceId===old.id&&['delivery.resume-requested','delivery.superseded'].includes(e.type)),interruption=events.findLast(e=>e.traceId===old.id&&['delivery.unknown','delivery.not-sent'].includes(e.type));
      if(decision&&(!interruption||decision.seq>interruption.seq))return [];
      return [{inboundId:old.id,sourceMessageId:old.message.id,state:'awaiting-reply-decision',confirmed:progress.confirmed,pending:progress.pending,unknown:progress.unknown,meaning:'前一答复因新消息暂缓；已发部分有回执，剩余确定未发。当前核心可决定续发或由新的回答替代。'}];
    });
  }
  private replyStateFacts(current:PendingMessage){
    const pending=this.pendingReplyFacts(current),events=this.journal.events(current.route);
    const failures=this.journal.list(['failed']).filter(old=>old.id!==current.id&&old.route===current.route&&old.message.sender.id===current.message.sender.id).slice(-3).map(old=>{
      const failed=events.findLast(e=>e.traceId===old.id&&e.type==='turn.failed'),notice=events.findLast(e=>e.traceId===old.id&&/^recovery\.notice\.(sent|not-sent|unknown)$/.test(e.type));
      return {inboundId:old.id,sourceMessageId:old.message.id,state:'processing-failed',code:typeof failed?.data.code==='string'&&/^[A-Z0-9_]{1,100}$/.test(failed.data.code)?failed.data.code:'TURN_FAILED',notification:notice?.type??'unconfirmed',meaning:'此前这次处理没有完成。操作记录仍在，不能从失败推断所有动作均未执行，也不能自动重做旧动作。'};
    });
    return [...pending,...failures,...events.filter(e=>e.data.decisionSource===current.id&&['delivery.resume-requested','delivery.superseded'].includes(e.type)).slice(-6).map(e=>({inboundId:e.traceId,sourceMessageId:this.journal.get(e.traceId).message.id,state:e.type,meaning:e.type==='delivery.resume-requested'?'已选择续发并排队；尚不能推断已经送达。':'旧未发部分已由当前回答替代，已发回执保留。'}))];
  }
  private async decideRepliesBeforeTurn(current:PendingMessage,signal:AbortSignal){
    const pending=this.pendingReplyFacts(current);if(!pending.length||this.journal.events(current.route).some(e=>e.traceId===current.id&&e.type==='reply.decision.started'))return;
    this.journal.append(this.event(current,'reply.decision.started',{pending:pending.map(p=>p.inboundId)}));
    const stamp=runtimeHash(pending),guard=()=>{signal.throwIfAborted();this.messageProcessingSignal(current.id)?.throwIfAborted();if(stamp!==runtimeHash(this.pendingReplyFacts(current)))throw new Error('REPLY_STATE_CHANGED');};
    try{const persona=this.targetPersona(current,current.id,signal,guard),decision=await decidePendingReplies(this.ctx,this.recoveryModel(),this.config.dataDir,current.id,persona.text,persona.items,{incoming:current.message.mainText??current.message.text,pending:pending.map(p=>({...p,previousQuestion:this.journal.get(p.inboundId).message.mainText??this.journal.get(p.inboundId).message.text}))},AbortSignal.any([signal,AbortSignal.timeout(15000)]),()=>{guard();persona.guard();});
      guard();const ids=new Set(decision.decisions.map(d=>d.inboundId));if(ids.size!==pending.length||decision.decisions.length!==pending.length||pending.some(p=>!ids.has(p.inboundId)))throw new Error('REPLY_DECISION_SCOPE');
      this.journal.append(this.event(current,'reply.decision.prepared',{decisions:decision.decisions}));
      for(const choice of decision.decisions)if(choice.action!=='wait')this.resolvePendingReply(current,choice.inboundId,choice.action);
      this.journal.append(this.event(current,'reply.decision.completed',{decisions:decision.decisions}));
    }catch{signal.throwIfAborted();this.journal.append(this.event(current,'reply.decision.waiting',{code:'REPLY_DECISION_UNAVAILABLE',preserved:true}));}
  }
  private resolvePendingReply(current:PendingMessage,id:string,decision:'resume'|'supersede'){
    const old=this.journal.get(id);if(old.route!==current.route||old.message.sender.id!==current.message.sender.id||old.id===current.id)throw new Error('REPLY_SCOPE_DENIED');
    const duplicate=this.journal.events(current.route).findLast(e=>e.traceId===old.id&&e.type==='delivery.'+(decision==='resume'?'resume-requested':'superseded')&&e.data.decisionSource===current.id);
    if(duplicate)return {status:decision==='resume'?'queued':'superseded',inboundId:id,duplicate:true};
    if(!this.pendingReplyFacts(current).some(f=>f.inboundId===id))throw new Error('REPLY_NOT_RESUMABLE');
    this.journal.transition(id,old.state,decision==='resume'?'reply-ready':'handled',this.event(old,decision==='resume'?'delivery.resume-requested':'delivery.superseded',{decisionSource:current.id,decisionMessageId:current.message.id}));
    if(decision==='resume')this.schedule(this.journal.get(id));
    return {status:decision==='resume'?'queued':'superseded',inboundId:id,duplicate:false};
  }
  private replyRecoveryActions(item:PendingMessage):BoundAction[]{return (['resume','supersede'] as const).map(decision=>{
    const definition:ActionCapability={name:'dafeiyu_reply_'+decision,description:decision==='resume'?'选择续发同一发送者、同一会话前一答复的确定未发送部分。原已发部分不重发；程序重新校验来源后排队交付。':'选择由当前回答替代同一发送者、同一会话的旧答复剩余部分。保留已发回执及旧草稿，不再自动续发旧内容。',fields:{inboundId:{description:'pending-replies中程序提供的inboundId。',required:true}},execute:async()=>{throw new Error('CORE_DISPATCH_REQUIRED');}};
    return {definition,execute:async(raw,signal)=>{signal.throwIfAborted();this.messageProcessingSignal(item.id)?.throwIfAborted();const args=this.parseAction(definition,raw);return {value:this.resolvePendingReply(item,z.uuid().parse(args.inboundId),decision),feedback:null};}};
  });}
  private actions(item: PendingMessage, causedBy: string): BoundAction[] {
    const actions:BoundAction[]=[...this.extensions.values()].flatMap(entry => (entry.extension.actions ?? []).map(definition => ({
      definition,
      execute: async (raw: unknown, signal: AbortSignal): Promise<ActionResult> => {
        if (!entry.active) throw new Error('Capability unavailable');
        const args = this.parseAction(definition, raw);
        const operationId = randomUUID();
        const event = (type: string, parent: string) => eventFor(this.config.agentId, item, type,
          entry.extension.id, entry.extension.version, operationId, parent, { action: definition.name });
        const started = this.journal.append(event('operation.started', causedBy));
        const actionSignal = AbortSignal.any([signal, entry.controller.signal]);
        const actionContext: ActionContext = Object.freeze({ operationId, conversation: Object.freeze({ ...item.message.conversation }),
          sourceMessageId: item.message.id, signal: actionSignal });
        try {
          actionSignal.throwIfAborted();
          this.actionScopes.set(actionContext, Object.freeze({ agentId: this.config.agentId, route: item.route,
            traceId: item.id, operationId, startedEventId: started.id }));
          const feedbackEntry=definition.feedback?this.feedbackEntry():undefined;
          if(definition.feedback&&(!feedbackEntry||(definition.feedback==='archive-view'&&feedbackEntry!==entry)))throw new Error('Feedback provider unavailable before execution');
          let validated:Json,origin:'returned'|'exception'='returned';
          try{validated=z.json().parse(await definition.execute(args, actionContext));}
          catch(error){
            if(definition.feedback!=='structured-v1'||actionSignal.aborted)throw error;
            origin='exception';validated={schemaVersion:1,outcome:'unknown',effects:'unknown',completeness:'unknown',resourceVersion:'unknown',
              summary:'工具未返回可验证的结果；应核对副作用，不能直接重放。',diagnostics:[{code:'CAPABILITY_EXCEPTION',message:'原始异常不进入反馈或归档。'}],receipts:[],sourceRefs:[],data:null};
          }
          actionSignal.throwIfAborted();
          if(!definition.feedback){this.journal.append(event('operation.succeeded',started.id));return {value:validated,feedback:null};}
          const provider=feedbackEntry!.extension.feedbackProvider!;
          let delivery:FeedbackDelivery;
          if(definition.feedback==='structured-v1'){
            const report=ToolFeedbackSchema.safeParse(validated);
            const outcome=report.success?report.data.outcome:'unknown';
            this.journal.append(event(`operation.${outcome}`,started.id));
            try{
              if(!feedbackEntry!.active)throw new Error('Feedback provider unloaded');
              const captured=await provider.capture({context:actionContext,pluginId:entry.extension.id,pluginVersion:entry.extension.version,action:definition.name,origin},validated);
              delivery={value:z.json().parse(captured.value),witness:captured.witness===null?null:FeedbackWitnessSchema.parse(captured.witness)};
              if(delivery.witness&&(delivery.value===null||typeof delivery.value!=='object'||Array.isArray(delivery.value)))throw new Error('Invalid feedback delivery');
            }catch(error){
              actionSignal.throwIfAborted();
              delivery={value:{kind:'dafeiyu-tool-feedback',outcome,effects:report.success?report.data.effects:'unknown',
                completeness:report.success?report.data.completeness:'unknown',diagnosticCodes:report.success?report.data.diagnostics.map(d=>d.code):['INVALID_FEEDBACK_REPORT'],
                archiveStatus:'unavailable',fault:error instanceof FeedbackCaptureError?error.code:'FEEDBACK_ARCHIVE_UNAVAILABLE',untrustedEvidence:true,
                note:'归档未完成；工具可能已经产生副作用，不能因此重放。'},witness:null};
              this.journal.append(event('feedback.unavailable',started.id));
            }
          }else{delivery=provider.present(actionContext,validated);this.journal.append(event('operation.succeeded',started.id));}
          actionSignal.throwIfAborted();
          const value=z.json().parse(delivery.value);
          return {value,feedback:delivery.witness?{owner:feedbackEntry!.extension.id,witness:delivery.witness,viewHash:createHash('sha256').update(JSON.stringify(value)).digest('hex')}:null};
        } catch (error) {
          this.journal.append(event('operation.failed', started.id));
          // Do not propagate raw extension errors (which may contain credentials) into model context.
          throw new Error(signal.aborted || entry.controller.signal.aborted ? 'Capability cancelled; verify effects' : 'Capability failed; verify effects');
        } finally { this.actionScopes.delete(actionContext); }
      },
    })));
    return this.pendingReplyFacts(item).length?[...actions,...this.replyRecoveryActions(item)]:actions;
  }
  private parseAction(action: ActionCapability, raw: unknown): Record<string, string> {
    const fields = Object.fromEntries(Object.entries(action.fields).map(([key, field]) => [key,
      field.required ? z.string().max(32_000) : z.string().max(32_000).optional()]));
    const parsed = z.strictObject(fields).parse(raw);
    return Object.fromEntries(Object.entries(parsed).filter((pair): pair is [string, string] => typeof pair[1] === 'string'));
  }
  private async process(id: string): Promise<void> {
    const release=await this.scheduler?.acquire(true);
    try{await this.processMessage(id);}finally{try{const runId=this.runStore?.findRequest('conversation',id)?.runId;if(runId)this.personas.current(runId)?.dispose();}finally{release?.();}}
  }
  private messageProcessingSignal(id: string): AbortSignal | undefined {
    const item = this.journal.get(id), source = this.extensions.get(item.extensionId);
    if (!source?.active) throw new Error('DEPENDENCY_UNAVAILABLE');
    return source.extension.channels?.find(channel => channel.channel === item.message.conversation.channel
      && channel.account === item.message.conversation.account)?.processingSignal?.(item.message);
  }
  private deliveryChannel(item: PendingMessage) {
    const entry = this.extensions.get(item.extensionId), capability = entry?.extension.channels?.find(channel =>
      channel.channel === item.message.conversation.channel && channel.account === item.message.conversation.account);
    if (!entry?.active || !capability) return null;
    try {
      const access = capability.processingSignal?.(item.message); access?.throwIfAborted();
      return { identity: entry, id: entry.extension.id, version: entry.extension.version, capability,
        signal: access ? AbortSignal.any([entry.controller.signal, access]) : entry.controller.signal };
    } catch { return null; }
  }
  private validateRunPersona(run:StoredRun):void{const binding=this.runStore?.personaBinding(run.id);if(binding?.kind==='bound')this.personas.validateStored(run,binding.manifest,[],this.controller.signal,()=>this.controller.signal.throwIfAborted());}
  private async processMessage(id:string):Promise<void>{
    if (!this.accepting) return;
    let item = this.journal.get(id);
    const source = this.extensions.get(item.extensionId);
    if (!source?.active) return;
    const channel = source.extension.channels?.find(capability => capability.channel === item.message.conversation.channel && capability.account === item.message.conversation.account);
    if (item.state === 'accepted') {
      const accepted = this.journal.events(item.route).find(event => event.traceId === item.id && event.type === 'message.accepted');
      let started:import('@dafeiyu/contracts').EventRecord|undefined,run:StoredRun|undefined,result;
      try {
        const persona = this.persona();
        const access = this.messageProcessingSignal(id);
        const signal = AbortSignal.any([this.controller.signal, source.controller.signal, ...(access ? [access] : []), AbortSignal.timeout(this.config.turnTimeoutMs)]);
        signal.throwIfAborted();
        await this.decideRepliesBeforeTurn(item,signal);
        run=this.conversationRuns?.begin(item,persona,this.analysisModelRoute(),[...this.extensions.values()].map(entry=>({id:entry.extension.id,version:entry.extension.version})),this.executions?.conversationSnapshot(source.extension.id),
          record=>this.personas.prepare(record,persona,this.analysisModelRoute(),[],signal,()=>{signal.throwIfAborted();if(!source.active)throw new Error('DEPENDENCY_UNAVAILABLE');}).manifest);
        if(run&&this.runStore)this.personas.admitTrial(this.runStore,run.id,[],signal,()=>{signal.throwIfAborted();if(!source.active)throw new Error('DEPENDENCY_UNAVAILABLE');});
        started = this.journal.transition(item.id, 'accepted', 'processing', this.event(item, 'turn.started',run?{runId:run.id}:{}, accepted?.id ?? null));
        this.journal.append(this.event(item, 'persona.loaded', { version: persona.version }, started.id));
        const nativeActions=run?this.executions?.conversationActions(run,source.extension.id,signal,()=>{if(!source.active)throw new Error('DEPENDENCY_UNAVAILABLE');})??[]:[];
        const capabilityDescription=[channel?.description,this.executions?JSON.stringify(this.executions.messageCapabilities(item.message)):null].filter(Boolean).join('\n');
        const conversationActions=source.extension.id==='local-owner-tasks'?[]:this.actions(item,started.id);
        result = await this.runtime.run(item, persona, conversationActions, signal, capabilityDescription,undefined,nativeActions,()=>!!(run&&this.runStore?.operations(run.id).some(op=>(op.plugin==='qq-tasks'&&op.action==='qq_task_submit'||op.plugin==='local-owner-tasks'&&op.action==='local_owner_task_submit')&&op.state==='finished'&&op.outcome?.status==='succeeded'&&op.outcome.effects==='confirmed'))||!!(run&&this.mediaPort?.replyDraft?.(run.id)?.selected&&this.runStore?.operations(run.id).some(op=>op.action==='qq_sticker_use'&&op.plugin==='qq-stickers'&&op.state==='finished'&&op.outcome?.status==='succeeded'&&op.outcome.effects==='confirmed')));
        signal.throwIfAborted();
        if(run)this.personas.current(run.id)?.guard();
      } catch (error) {
        const failure=error instanceof DshRunError?error.code:'TURN_FAILED';
        if(run)this.conversationRuns?.fail(run,failure);
        if(run&&this.runStore)this.personas.completeTrial(this.runStore,run.id,[],this.controller.signal);
        await this.conversationRuns?.project();
        this.journal.transition(item.id, this.journal.get(item.id).state, 'failed', { ...this.event(item, 'turn.failed', { code: failure, phase:'execution', note: 'Earlier operations may have effects; no automatic replay' }, started?.id??null),
          sources: error instanceof DshRunError ? error.sources : [] });
        await this.notifyConversationFailure(item,failure);
        return;
      }
      if(run&&this.conversationRuns){this.conversationRuns.complete(run,item,result,started!.id);if(this.runStore)this.personas.completeTrial(this.runStore,run.id,[],this.controller.signal);await this.conversationRuns.project();}
      else{const reply: Reply = { id: `${item.id}:reply`, conversation: item.message.conversation, sourceMessageId: item.message.id, text: result.text };
        this.journal.transition(item.id, 'processing', 'reply-ready', { ...this.event(item, 'turn.completed', {}, started!.id), sources: result.sources }, reply);}
      item = this.journal.get(id);
    }
    if (item.state !== 'reply-ready' || !item.reply) return;
    const runId=this.runStore?.findRequest('conversation',item.id)?.runId;
    if(runId&&this.runStore){try{this.validateRunPersona(this.runStore.get(runId));}catch{this.journal.transition(item.id,'reply-ready','failed',this.event(item,'delivery.blocked',{code:'SOURCE_STALE'}));return;}}
    if (!channel || !source.active || this.controller.signal.aborted || this.fatal) return;
    const completed = this.journal.events(item.route).findLast(event => event.traceId === item.id && event.type === 'turn.completed');
    const deliveryOperation = randomUUID();
    const deliveryEvent = (type: string, data: Record<string, Json>, parent: string | null) =>
      eventFor(this.config.agentId, item, type, source.extension.id, source.extension.version, deliveryOperation, parent, data);
    const sending = this.journal.transition(id, 'reply-ready', 'sending', deliveryEvent('delivery.started', { replyId: item.reply.id }, completed?.id ?? null));
    let result,invoked=false,mediaSettlementPending=false;let release=()=>{};let mediaAccess:MediaReplyAccess|undefined,mediaManifestId:string|undefined,activeMedia:MediaPort|undefined;
    try {
      const signal=AbortSignal.any([this.controller.signal,source.controller.signal,AbortSignal.timeout(this.config.deliveryTimeoutMs)]);
      const evidence=channel.deliveryValidation==='per-segment'?await prepareReplySources(this.ctx,this.config.agentId,item,completed?.sources??[],this.contexts,()=>this.compactionBinding(),signal):{guard:()=>{},release:()=>{}};release=evidence.release;
      const authority=()=>{if(!source.active||this.fatal||this.journal.messageRecalled({agentId:this.config.agentId,route:item.route},item.message.id))throw new Error('SOURCE_STALE');
        if(runId&&this.runStore)this.validateRunPersona(this.runStore.get(runId));
        evidence.guard();};
      const mediaSelection=(op:{plugin:string;action:string})=>op.plugin==='media'&&op.action==='dafeiyu_media_reply'||op.plugin==='qq-stickers'&&op.action==='qq_sticker_use';
      authority();const mediaOperation=runId?this.runStore?.operations(runId).findLast(op=>mediaSelection(op)&&op.outcome?.status==='succeeded'&&op.outcome.effects==='confirmed'):undefined;
      const uncertainMedia=runId&&this.runStore?.operations(runId).some(op=>mediaSelection(op)&&(op.state==='unknown'||op.outcome?.effects==='unknown'));
      if(uncertainMedia)throw new Error('MEDIA_REPLY_OPERATION_UNCONFIRMED');
      const selection=mediaOperation?z.object({currentDraftId:z.uuid(),currentVersion:z.number().int().positive(),selected:z.number().int().nonnegative()}).parse(mediaOperation.outcome!.data):null;
      if(selection?.selected){
        activeMedia=this.mediaPort;if(!activeMedia?.ready()||!activeMedia.replyDraft||!activeMedia.finalizeReply||!activeMedia.readReplyPart||!activeMedia.validateReply||!activeMedia.settleReply||channel.mediaDelivery!=='parts-v1'||!channel.deliverMedia)throw new Error('MEDIA_DELIVERY_NOT_CONFIGURED');
        const draft=activeMedia.replyDraft(runId!);if(!draft||draft.id!==selection.currentDraftId||draft.version!==selection.currentVersion||draft.selected!==selection.selected)throw new Error('MEDIA_DRAFT_AUTHORITY_MISMATCH');
        mediaAccess=await this.prepareMediaReplyAccess(draft.authority,item.reply,signal);const manifest=await activeMedia.finalizeReply(mediaAccess);if(!manifest)throw new Error('MEDIA_DRAFT_AUTHORITY_MISMATCH');mediaManifestId=manifest.id;
        const guarded=()=>{authority();mediaAccess!.guard();if(this.mediaPort!==activeMedia||!activeMedia!.ready())throw new Error('SOURCE_STALE');activeMedia!.validateReply!(mediaAccess!,manifest.id);};guarded();invoked=true;
        result=await channel.deliverMedia(structuredClone({...item.reply,media:manifest}),signal,guarded,position=>{guarded();return activeMedia!.readReplyPart!(mediaAccess!,manifest.id,position);});
      }else{invoked=true;result = await channel.deliver(item.reply,signal,authority);}
      if (result.status === 'sent' && !result.receiptId) throw new Error('Missing transport receipt');
    } catch(error) { const code=error instanceof Error&&['MEDIA_DELIVERY_NOT_CONFIGURED','MEDIA_DRAFT_AUTHORITY_MISMATCH','MEDIA_REPLY_OPERATION_UNCONFIRMED','MEDIA_TARGET_DENIED','MEDIA_SIZE_LIMIT','MEDIA_BLOB_CORRUPT','MEDIA_TTS_NOT_CONFIGURED'].includes(error.message)?error.message:'SOURCE_STALE';
      result = invoked?{status:'unknown' as const,code:'DELIVERY_UNKNOWN'}:{status:'not-sent' as const,code}; }finally{
      try{const paused=result?.status==='unknown'&&channel?.deliveryProgress?.(item.reply.id)?.canResume===true;
        if(mediaAccess&&mediaManifestId&&activeMedia?.settleReply&&(result?.status==='sent'||result?.status==='unknown'&&!paused)){
        try{activeMedia.settleReply(mediaAccess,mediaManifestId,result.status==='sent'?'sent':'unknown');}catch{mediaSettlementPending=true;}
      }}finally{if(mediaAccess)activeMedia?.releaseReply?.(mediaAccess);mediaAccess?.release();release();}}
    const next = result.status === 'sent' ? 'delivered' : result.status === 'not-sent' ? ['QQ_MESSAGE_SEQUENCE_INVALID','DELIVERY_PLAN_INVALID','TEXT_SIZE_UNSUPPORTED','INVALID_TEXT_ENCODING'].includes(result.code)?'failed':'reply-ready' : 'uncertain';
    this.journal.transition(id, 'sending', next, deliveryEvent(`delivery.${result.status}`, result.status === 'sent' ? { receiptId: result.receiptId } : { code: result.code }, sending.id));
    if(mediaSettlementPending)this.journal.append(deliveryEvent('delivery.media-settlement-pending',{manifestId:mediaManifestId!,state:result.status},sending.id));
  }
  /** Explicit retry only for definitely-not-sent replies; never runs the model or replays tool operations. */
  retryDelivery(id: string): void {
    this.assertAccepting();
    const item = this.journal.get(id);
    if (item.state !== 'reply-ready') throw new Error('Only a definitely unsent reply may be retried');
    this.schedule(item);
  }
  getStatus() {
    return { agentId: this.config.agentId, state: this.fatal ? 'error' : this.controller.signal.aborted ? 'closed' : this.gate.active?(this.admissionHeld?'composing':this.dependenciesReady()?'ready':'degraded'):this.gate.state==='quiescing'?'draining':'composing',
      lifecycle:this.gate.state,error: this.fatal,execution:this.executions?.health??null,nativeDelivery:this.closed?this.closedNativeDelivery:this.runStore?.nativeDeliveries.counts()??null, extensions: [...new Set([...this.extensions.keys(),...this.registryV3.ids()])], queuedRoutes: this.queues.size,
      messages: this.closed ? [] : this.journal.list().map(item => ({ id: item.id, state: item.state, sessionId: item.sessionId })) };
  }
  async whenIdle(): Promise<void> {
    do{while(this.queues.size)await Promise.all([...this.queues.values()]);await this.executions?.whenIdle();await this.nativeTaskDelivery?.whenIdle();}while(this.queues.size||this.nativeTaskDelivery?.pending);
    if (this.fatal) throw new Error(this.fatal);
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.quiesce();this.readyListeners.clear();this.registryV3.close();
    this.controller.abort();
    this.closing = (async () => {
      try{await Promise.all([...this.queues.values()]);await this.executions?.whenIdle();await this.nativeTaskDelivery?.whenIdle();}
      finally{try { await this.runtime.close(); } finally {this.nativeTaskDelivery?.close();this.closedNativeDelivery=this.runStore?.nativeDeliveries.counts()??null;this.runStore?.close();this.taskDelivery.close();this.closed = true;this.gate.close(); this.journal.close(); }}
    })();
    return this.closing;
  }
}

/** DSH/Cordis lifecycle entry point. The installed host supplies all injected DSH services. */
export function apply(ctx: Context, config: Config): void {
  const core = new DafeiyuService(ctx, config);
  ctx.effect(() => () => core.close(), 'dafeiyu.close');
}
