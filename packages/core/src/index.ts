import {digestSource} from './source-records.js';
import {TaskDispositionSchema} from '@dafeiyu/contracts';
import {ConversationCoordinator} from './conversation-coordinator.js';
import {pendingRuntimeEvents,pendingProducerWork} from './storage-status.js';
import {ContextItemSchema} from '@dafeiyu/contracts';
import {situationContributor} from './situation-context.js';
import {inspectRequestCapacity} from './context-plan.js';
import { Context, Service } from '@deepseek-ai/cordis';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { z } from 'zod';
import { PhaseTimeoutsSchema } from '@dafeiyu/contracts';
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import { API_VERSION, MessageSchema, ObservationSchema, conversationKey } from '@dafeiyu/contracts';
import type { ConversationAccess, OperationScope, Json, PendingMessage, PersonaSnapshot, Receipt, Reply } from '@dafeiyu/contracts';
import { Journal, eventFor } from '@dafeiyu/journal';
import { DshRuntime, DshRunError } from './runtime.js';
import {renderConversationRecovery,decidePendingReplies} from './conversation-recovery.js';
import { ContextCoordinator,contextConfigSchema } from './context.js';
import type { ContextRequest } from '@dafeiyu/contracts';
import { CORE_VERSION } from './version.js';
import type { CompactionBinding } from './compaction-runtime.js';
import { fragmentCapsuleSchema } from './summary-fragments.js';
import { MemoryObservationSchema,ObservationSourceReadSchema,ObservationSourceChangeSchema } from '@dafeiyu/contracts';
import type { Conversation,ObservationAuthority } from '@dafeiyu/contracts';
import { prepareReplySources,prepareCapturedReplySources } from './reply-sources.js';
import type { MessageTaskBinding } from '@dafeiyu/contracts';
import type { NativeExpressionPort } from '@dafeiyu/contracts';
import type { MediaPort,MediaAccess,MediaSourceProvider,MediaAssetRef,MediaReplyAccess } from '@dafeiyu/contracts';
import { MediaAcquireSchema,MediaReadSchema,MediaAssetRefSchema } from '@dafeiyu/contracts';
import { NativeTaskDelivery,NATIVE_RENDER_ATTEMPTS } from './native-task-delivery.js';
import { ServiceGate } from '@dafeiyu/contracts';
import type { Extension, ExtensionHandle } from '@dafeiyu/contracts';
import { CapabilityRegistry } from './capability-registry.js';
import { ExecutionCoordinator,ExecutionOptionsSchema } from './execution-coordinator.js';
import type { ExecutionOptions } from './execution-coordinator.js';
import { RuntimeStore,runtimeHash } from './runtime-store.js';
import { RunScheduler } from './run-scheduler.js';
import { ConversationRuns } from './conversation-run.js';
import { readFoundation } from './foundation.js';
import { PersonaRuntime } from './persona-runtime.js';
import { HarnessRuntime,CAPABILITY_OWNER,CAPABILITY_QUERY } from './harness-runtime.js';
import { renderPublicProgress } from './target-renderer.js';
export { readFoundation } from './foundation.js';
export { initializeCoreStorage } from './storage-initialization.js';
import type { StoredRun } from './runtime-store.js';
import type { TaskRepositoryPort,ExecutionContext,WakeAuthorityProvider,MemoryGrowthProvider,ExecutionMemoryPort } from '@dafeiyu/contracts';
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
  turnTimeoutMs: z.number().int().min(50).max(3_600_000).default(600_000),
  deliveryTimeoutMs: z.number().int().min(50).max(60_000).default(30_000),
  phaseTimeouts:PhaseTimeoutsSchema,
  context:contextConfigSchema.prefault({}),
});
export type Config = z.input<typeof ConfigSchema>;
export type CoreRuntimeConfig=z.output<typeof ConfigSchema>;
interface Registered { extension: Extension; controller: AbortController; active: boolean }
declare module '@deepseek-ai/cordis' { interface Context { dafeiyu: DafeiyuService } }

/** Owns a logical persona and its independent conversations; extensions own platform-specific work. */
export class DafeiyuService extends Service {
  pendingEvents(){return pendingRuntimeEvents(this.config.dataDir);}
  pendingChannelWork(extension:string,producer:string,deliverResults:boolean){return this.journal.list(['accepted','processing','reply-ready','sending']).some(item=>item.extensionId===extension)||pendingProducerWork(this.config.dataDir,producer,deliverResults);}
  deliveryFact(inboundId:string){const item=this.journal.get(inboundId);return {sourceMessageId:item.message.id,target:item.message.conversation,state:item.state,reply:item.reply?{id:item.reply.id,textHash:createHash('sha256').update(item.reply.text).digest('hex')}:null};}

  private expressionPreferences:{read:NonNullable<MemoryGrowthProvider['expressionPreferences']>}|undefined;
  private nativeTaskDelivery:NativeTaskDelivery|undefined;
  /** Program-only provenance checks for Growth views; these methods return no source body. */
  captureRecentStateSources(context:ExecutionContext,owner:string):readonly SourceDependency[]{
    const access=this.personaAccess(context,owner,'local-write'),run=this.runStore?.get(context.runId);if(!run)throw new Error('SOURCE_STALE');access.guard();
    if(context.scope.kind==='task'){const input=this.runStore!.readInput(run.id,'native-program');z.object({inputHash:z.string()}).parse(input);
      return [{kind:'execution-input',agentId:context.agentId,route:context.scope.scopeKey,runId:run.id,hash:runtimeHash(input)}];}
    if(run.definition.origin.kind!=='message')throw new Error('MESSAGE_REQUIRED');const item=this.journal.get(run.definition.origin.inboundId),binding=this.compactionBinding();
    const sources=binding?.provider.sources?.inbound({agentId:context.agentId,route:context.scope.route,traceId:item.id},item.message.id)??[];
    if(!sources.length||sources.some(source=>source.kind==='unavailable'))throw new Error('SOURCE_STALE');return sources;
  }
  recentStateSourcesCurrent(runId:string,sources:readonly SourceDependency[]):boolean{
    try{const run=this.runStore?.get(runId);if(!run||!sources.length||sources.some(source=>source.agentId!==this.config.agentId))return false;
      if(run.definition.scope.kind==='task')return this.executions?.recentStateSourcesCurrent(runId,sources)??false;
      if(run.definition.origin.kind!=='message')return false;const item=this.journal.get(run.definition.origin.inboundId),binding=this.compactionBinding();
      const scope={agentId:this.config.agentId,route:run.definition.scope.route,traceId:item.id,sessionId:item.sessionId};
      return !!binding?.provider.sources&&sources.every(source=>binding.provider.sources!.validate(scope,source));
    }catch{return false;}
  }
  phaseTimeouts(){return this.config.phaseTimeouts;}
  registerHarnessSection(name:string){return this.runtime.registerHarnessSection(name);}
  originRecallScope(view:import('@dafeiyu/contracts').ExecutionView,owner:string){return this.executions?.originRecallScope(view,owner)??null;}
  originRecallCurrent(runId:string,scene:Conversation,stamp:string){return this.executions?.originRecallCurrent(runId,scene,stamp)??false;}
  contextBudget(){return this.config.context;}
  inspectContextRequest(options:import('@deepseek-ai/dsh-llm').GenerateOptions,maximum:number,reserve:number,known?:import('@deepseek-ai/dsh-llm').LlmResolvedModelInfo){return inspectRequestCapacity(this.ctx,options,maximum,reserve,known);}
  contextAssembly(){return this.config.context.assembly;}
  contextStatus(context:ConversationAccess,offset=0,limit=16):Json{const scope=this.scopeFor(context);return z.json().parse({plan:this.contexts.status(scope.route),responsibilities:(this.executions?.responsibilityFacts(context.conversation,offset,limit)??[]).map(row=>{row.guard();return row.data;}),offset,limit,nextOffset:offset+limit});}
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
  mediaAccess(context:ExecutionContext,owner:string,raw:unknown):MediaAccess {
    const origin=ResourceProofSchema.parse(raw),fingerprint=createHash('sha256').update(JSON.stringify(origin)).digest('hex'),execution=this.personaAccess(context,owner,'read');
    const guard=()=>{execution.guard();this.authorizeCapabilityResource(context,owner,origin.scene);if(createHash('sha256').update(JSON.stringify(origin)).digest('hex')!==fingerprint||!this.capabilityResourceCurrent(origin))throw new Error('MEDIA_SOURCE_STALE');};
    guard();return Object.freeze({execution,origin,guard});
  }
  acquireMedia(context:ExecutionContext,owner:string,input:unknown){this.executionAuthority(context,owner);if(!this.mediaPort?.ready())throw new Error('MEDIA_NOT_CONFIGURED');return this.mediaPort.acquire(context,owner,MediaAcquireSchema.parse(input));}
  inspectMedia(context:ExecutionContext,owner:string,ref:MediaAssetRef){this.executionAuthority(context,owner);if(!this.mediaPort?.ready())throw new Error('MEDIA_NOT_CONFIGURED');return this.mediaPort.inspect(context,owner,MediaAssetRefSchema.parse(ref));}
  readMedia(context:ExecutionContext,owner:string,input:unknown){this.executionAuthority(context,owner);if(!this.mediaPort?.ready())throw new Error('MEDIA_NOT_CONFIGURED');return this.mediaPort.read(context,owner,MediaReadSchema.parse(input));}
  originalImage(context:ExecutionContext,owner:string,exposureId:string){this.executionAuthority(context,owner);if(!this.mediaPort?.ready()||!this.mediaPort.imageOriginal)throw new Error('MEDIA_NOT_CONFIGURED');return this.mediaPort.imageOriginal(context,owner,z.uuid().parse(exposureId));}
  prepareReplyMedia(context:ExecutionContext,owner:string,input:unknown){this.executionAuthority(context,owner);if(!this.mediaPort?.ready()||!this.mediaPort.prepareReply)throw new Error('MEDIA_NOT_CONFIGURED');return this.mediaPort.prepareReply(context,input,owner);}
  mediaVoiceEvidence(context:ExecutionContext,owner:string,exposureId:string){this.executionAuthority(context,owner);if(!this.mediaPort?.ready()||!this.mediaPort.voice)throw new Error('MEDIA_VOICE_NOT_CONFIGURED');return this.mediaPort.voice(context,owner,z.uuid().parse(exposureId));}
  mediaVoiceCurrent(evidence:import('@dafeiyu/contracts').MediaVoiceEvidence){return this.mediaPort?.ready()===true&&this.mediaPort.voiceCurrent?.(evidence)===true;}
  captureMediaReplyAuthority(context:ExecutionContext,owner:string,payloadHash:string){if(!this.executions)throw new Error('EXECUTION_NOT_CONFIGURED');return this.executions.captureMediaReply(context,owner,payloadHash,this.personaAccess(context,owner,'local-write'));}
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
        facts.guard();this.conversations.validateRunPersona(run);captured!.guard();final!.guard();};
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
    const target=this.personas.prepareTarget(access),provider=this.expressionPreferences,expression=provider?.read(item.message.conversation,item.message.mainText??'')??[],expressionHash=runtimeHash(expression);return {text:foundation.text,foundationHash:foundation.version,stamp:runtimeHash([target.stamp,expressionHash]),items:[...target.items,...expression],guard:()=>{if(this.persona().version!==foundation.version||this.expressionPreferences!==provider||expression.some(before=>!(provider?.read(item.message.conversation,item.message.mainText??'')??[]).some(current=>runtimeHash(current)===runtimeHash(before))))throw new Error('SOURCE_STALE');target.guard();}};}
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
  private readonly conversations:ConversationCoordinator;
  private experienceMemory:import('@dafeiyu/contracts').ExperienceMemoryPort|undefined;
  private foundationMemory:import('./foundation.js').FoundationSnapshot|undefined;
  bindExperienceMemory(port:import('@dafeiyu/contracts').ExperienceMemoryPort){
    if(this.experienceMemory)throw new Error('DUPLICATE_PROVIDER');this.foundationMemory=port.foundation(()=>readFoundation(this.config.personaFile));this.experienceMemory=port;
    return ()=>{if(this.experienceMemory===port){this.experienceMemory=undefined;this.foundationMemory=undefined;}};
  }
  private readonly harness=new HarnessRuntime(()=>z.json().parse(this.configuredCapabilities()));
  bindHarnessCatalog(provider:Pick<import('@dafeiyu/contracts').DshToolsPort,'catalog'>):()=>void{return this.harness.bind(provider);}
  private readonly contexts:ContextCoordinator;
  private readonly personas:PersonaRuntime;
  private readonly extensions = new Map<string, Registered>();
  private readonly actionScopes = new WeakMap<ConversationAccess,{context:ExecutionContext;owner:string}>();
  private readonly controller = new AbortController();
  private fatal: string | null = null;
  private closing: Promise<void> | null = null;
  private closed = false;
  private readonly gate = new ServiceGate();
  private admissionHeld=false;
  private readonly readyListeners = new Set<() => void>();
  private readonly registry = new CapabilityRegistry();
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
    this.journal = new Journal(resolve(this.config.dataDir, 'journal.sqlite'));
    this.contexts=new ContextCoordinator(this.config.agentId,this.journal,this.config.context);
    {this.contexts.register('core-situation','1',[situationContributor(()=>true,scene=>this.executions?.responsibilityFacts(scene)??[],
      (request,item,proof)=>{const scope=this.contexts.scopeFor(request),runId=this.runStore?.findRequest('conversation',scope.traceId)?.runId;if(!runId||!this.runStore)throw new Error('RUN_NOT_RUNNING');if(this.runStore.get(runId).state!=='running')return;this.runStore.bindInput(runId,'operational-context:'+digestSource(JSON.stringify([item.text,item.sources])),{route:scope.route,item,proof});},
      (request,dependency)=>{try{const scope=this.contexts.scopeFor(request),record=z.object({route:z.string(),item:ContextItemSchema,proof:z.json()}).parse(this.runStore?.findContext('operational-context:'+dependency.hash));return record.route===scope.route&&record.item.id===dependency.id&&record.item.version===dependency.version&&digestSource(JSON.stringify([record.item.text,record.item.sources]))===dependency.hash&&(this.executions?.responsibilitySnapshotCurrent(record.proof,request.conversation)??false);}catch{return false;}})]);
    this.contexts.pinRegion('core-situation:responsibilities');}
    this.personas=new PersonaRuntime(this.config.context);
    this.runtime = new DshRuntime(ctx, { provider: this.config.provider, model: this.config.model,
      ...(this.config.reasoningEffort ? { reasoningEffort: ReasoningEffortId(this.config.reasoningEffort) } : {}) }, resolve(this.config.dataDir),this.contexts,
      this.config.agentId,()=>this.compactionBinding(),
      (frame,data,seqs)=>{const item=this.journal.get(frame.id);this.journal.append({...this.event(item,data.status==='sources-retired'?'context.sources.retired':data.status==='fragments-retired'?'context.summary.updated':'context.compaction.checked',data),sources:seqs.map(seq=>({kind:'session' as const,id:item.sessionId,seq,route:item.route}))});},this.harness);
    this.conversations=new ConversationCoordinator({ctx:this.ctx,config:this.config,journal:this.journal,runtime:this.runtime,personas:this.personas,contexts:this.contexts,extensions:this.extensions,signal:this.controller.signal,
      schedulingReady:()=>this.gate.active&&!this.admissionHeld,accepting:()=>this.accepting,failure:()=>this.fatal,fail:code=>{this.fatal=code;},
      runs:()=>this.runStore,executions:()=>this.executions,conversationRuns:()=>this.conversationRuns,scheduler:()=>this.scheduler,media:()=>this.mediaPort,experience:()=>this.experienceMemory,
      assertAccepting:()=>this.assertAccepting(),persona:()=>this.persona(),modelRoute:()=>this.analysisModelRoute(),recoveryModel:()=>this.recoveryModel(),
      targetPersona:(item,id,signal,guard)=>this.targetPersona(item,id,signal,guard),compaction:()=>this.compactionBinding(),
      prepareMediaReply:(authority,reply,signal)=>this.prepareMediaReplyAccess(authority,reply,signal),event:(item,type,data,parent)=>this.event(item,type,data,parent)});
    this.contexts.register('core-delivery-recovery','1',[{id:'pending-replies',kind:'operational-fact',prepare:async request=>{
      const scope=this.contexts.scopeFor(request),current=this.journal.get(scope.traceId),facts=this.conversations.replyStateFacts(current);
      return facts.map(f=>({id:f.inboundId,version:runtimeHash(f),text:JSON.stringify(f),expiresAt:'9999-12-31T23:59:59.999Z',sources:[{ref:'dafeiyu:pending-reply:'+f.inboundId,version:'1',hash:runtimeHash(f)}]}));
    },validate:(request,item)=>{try{const current=this.journal.get(this.contexts.scopeFor(request).traceId);return this.conversations.replyStateFacts(current).some(f=>f.inboundId===item.id&&runtimeHash(f)===item.version);}catch{return false;}}}]);
    this.registry.register(this.config.agentId,{protocolVersion:API_VERSION,id:CAPABILITY_OWNER,version:'1',agentId:this.config.agentId,actions:[{
      id:CAPABILITY_QUERY,version:'1',description:'查询当前已注册的大肥鱼能力、提供方状态和任务要求。可选tool读取精确参数；注册不等于当前会话获准执行，也不证明外部依赖可用。',effects:'read',scope:'any',
      inputSchema:z.strictObject({tool:z.string().min(1).max(160).optional()}),outputSchema:z.json(),execute:async(raw,context)=>{
        this.executionAuthority(context,CAPABILITY_OWNER);const {tool}=z.object({tool:z.string().optional()}).parse(raw),catalog=this.configuredCapabilities();
        const native=tool?this.registry.actions().find(action=>action.id===tool):undefined;
        const details=native?{id:native.id,description:native.description,parameters:native.input}:null;
        return {status:'succeeded',effects:'none',completeness:'complete',data:z.json().parse({...catalog,details}),sources:[],receipts:[]};
      }},{id:'dafeiyu_task_outcome',version:'1',description:'说明本轮应等待还是完成。依据实际工作自行判断；这条决定不会伪造操作成功或消息送达。',effects:'local-write',scope:'task',
        inputSchema:TaskDispositionSchema,outputSchema:z.json(),
        execute:async(input,context)=>{if(!this.executions)throw new Error('DEPENDENCY_UNAVAILABLE');return {status:'succeeded',effects:'confirmed',completeness:'complete',data:this.executions.setDisposition(context,input),sources:[],receipts:[]};}
      },{id:'dafeiyu_task_review',version:'1',description:'按需复核当前工作的草案与实际操作，获得有局限的建议。是否采纳、继续、等待和留下什么想法仍由你决定；不会自动修改任务或人格。',scope:'task',effects:'read',inputSchema:z.strictObject({proposal:z.string().trim().min(1).max(16000)}),outputSchema:z.json(),
        execute:async(input,context)=>{if(!this.executions)throw new Error('DEPENDENCY_UNAVAILABLE');return {status:'succeeded',effects:'none',completeness:'complete',data:await this.executions.review(context,input),sources:[],receipts:[]};}
      }]});
    
  }
  recover():void {
    this.assertOpen();
    if(this.gate.state==='recovered'||this.gate.active)return;
    if(this.gate.state!=='registered')throw new Error('SERVICE_LIFECYCLE_CONFLICT');
    if(this.executions&&!this.executionRecovered)throw new Error('EXECUTION_RECOVERY_REQUIRED');
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
    if(!this.experienceMemory||!this.repositoryPort?.ready()||!this.executionMemoryPort?.ready()||!this.executions||!this.personas.configured)throw new Error('DEPENDENCY_UNAVAILABLE');
    this.registry.checkReady(this.features());
    this.gate.activate();
    this.admissionHeld=true;if(!options.deferWork)this.releaseAdmission(options);
  }
  private releaseAdmission(options:{resumeMessages?:boolean;resumeExecutions?:boolean}):void {
    this.admissionHeld=false;
    try{for(const listener of this.readyListeners)listener();}catch(error){this.gate.quiesce();throw error;}
    if(options.resumeMessages!==false)for(const item of this.journal.list(['accepted','reply-ready']))if(this.extensions.get(item.extensionId)?.active)this.conversations.schedule(item);
    if(options.resumeExecutions!==false){this.executions?.activate();this.nativeTaskDelivery?.activate();}
  }
  onReady(listener:()=>void):()=>void {
    this.assertOpen();this.readyListeners.add(listener);if(this.accepting)listener();
    return ()=>{this.readyListeners.delete(listener);};
  }
  quiesce():void {this.gate.quiesce();}
  cancelRunning():void {this.quiesce();this.controller.abort();}
  get lifecycleState(){return this.gate.state;}
  private features(){return ['core.registration.v1','lifecycle.managed.v1','context.conversation.v1',...(this.repositoryPort?['task.repository.v1']:[]),...(this.executions?['execution.task.v1','execution.review.v1','execution.source-anchor.v1','execution.wake-ingress.v1','context.task.v1','execution.resource-scope.v1','execution.message-task.v1']:[]),...(this.nativeTaskDelivery?['delivery.task-result.v1','delivery.status-feedback.v1']:[]),...(this.executionMemoryPort?['memory.execution.v1','continuity.checkpoint.v1','task.intent.v1']:[]),...(this.capabilityObservationPort?['memory.capability-observation.v1']:[]),...(this.nativeExpressionPort?['memory.native-expression.v1']:[]),...(this.mediaPort?['media.assets.v1']:[]),...(this.personas.configured?['persona.stage-state.v1','persona.growth-selection.v1']:[])];}
  bindMessageTasks(binding:MessageTaskBinding){if(!this.executions)throw new Error('EXECUTION_NOT_CONFIGURED');const channel=this.extensions.get(binding.channelExtensionId);
    if(!channel?.active||!channel.extension.channels?.some(c=>c.channel===binding.channel&&c.account===binding.account))throw new Error('SCOPE_DENIED');
    return this.executions.bindMessageTasks({...binding,active:()=>channel.active&&binding.active()});}
  submitMessageTask(context:ExecutionContext,pluginId:string,input:unknown){if(!this.executions)throw new Error('EXECUTION_NOT_CONFIGURED');return this.executions.submitMessageTask(context,pluginId,input);}
  messageTaskStatus(context:ExecutionContext,pluginId:string,input:unknown){if(!this.executions)throw new Error('EXECUTION_NOT_CONFIGURED');const status=this.executions.messageTaskStatus(context,pluginId,input);return {...status,delivery:this.messageTaskDeliveryStatus(status.runId)};}
  controlMessageTask(context:ExecutionContext,pluginId:string,input:unknown){if(!this.executions)throw new Error('EXECUTION_NOT_CONFIGURED');return this.executions.controlMessageTask(context,pluginId,input);}
  capabilityManifest(){return {features:[...new Set([...this.features(),...this.registry.providedFeatures()])],actions:this.registry.actions().map(action=>({id:action.id,owner:action.owner,pluginVersion:action.pluginVersion,version:action.version,effects:action.effects,scope:action.scope}))};}
  private configuredCapabilities(){return {features:this.capabilityManifest().features.sort(),actions:[
    ...this.registry.actions().map(action=>({id:action.id,owner:action.owner,version:action.version,purpose:Array.from(action.description).slice(0,120).join(''),effects:action.effects,scope:action.scope,providerReady:action.active()})),
  ].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)};}
  get accepting(){return this.gate.active&&!this.admissionHeld&&!this.fatal&&!this.controller.signal.aborted&&this.dependenciesReady();}
  private dependenciesReady():boolean {
    try {
      if(!this.experienceMemory||!this.repositoryPort?.ready()||!this.executionMemoryPort?.ready()||!this.executions)return false;
      if(this.executions&&this.executions.health.error||!this.personas.ready)return false;
      if([...this.extensions.values()].some(entry=>entry.extension.lifecycleReady&&!entry.extension.lifecycleReady()))return false;
      this.registry.checkReady(this.features());return true;
    }catch{return false;}
  }
  private assertAccepting():void {this.assertOpen();this.gate.assertActive();if(this.admissionHeld)throw new Error('HOST_NOT_READY');if(!this.dependenciesReady())throw new Error('DEPENDENCY_UNAVAILABLE');}
  bindTaskRepository(port:TaskRepositoryPort):()=>void {
    this.assertOpen();if(this.repositoryPort)throw new Error('DUPLICATE_PROVIDER');const bound:TaskRepositoryPort=Object.freeze({ready:port.ready.bind(port),create:port.create.bind(port),findRequest:port.findRequest.bind(port),
      readState:port.readState.bind(port),readSelectedInputs:port.readSelectedInputs.bind(port),update:port.update.bind(port)});this.repositoryPort=bound;
    return ()=>{if(this.repositoryPort===bound)this.repositoryPort=undefined;};
  }
  bindGrowthProvider(provider:MemoryGrowthProvider):()=>void{this.assertOpen();const unbind=this.personas.bind(provider),unpin=this.contexts.pinRegion('memory:growth'),expression=provider.expressionPreferences?{read:provider.expressionPreferences.bind(provider)}:undefined;this.expressionPreferences=expression;return ()=>{unbind();unpin();if(this.expressionPreferences===expression)this.expressionPreferences=undefined;};}
  bindExecutionMemory(port:ExecutionMemoryPort):()=>void{this.assertOpen();if(this.executionMemoryPort)throw new Error('DUPLICATE_PROVIDER');
    const bound:ExecutionMemoryPort=Object.freeze({ready:port.ready.bind(port),...(port.resourceEpoch?{resourceEpoch:port.resourceEpoch.bind(port)}:{}),validate:port.validate.bind(port),operationSources:port.operationSources.bind(port),outcomeSources:port.outcomeSources.bind(port),
      prepareContext:port.prepareContext.bind(port),validateContext:port.validateContext.bind(port),captureContinuity:port.captureContinuity.bind(port),checkpoint:port.checkpoint.bind(port),bindResult:port.bindResult.bind(port),
      generation:port.generation.bind(port),acceptIntent:port.acceptIntent.bind(port),intent:port.intent.bind(port),resolveIntent:port.resolveIntent.bind(port),summarizeFragments:port.summarizeFragments.bind(port),
      ...(port.compactionPolicy?{compactionPolicy:Object.freeze({...port.compactionPolicy})}:{}),...(port.rewrite?{rewrite:port.rewrite.bind(port)}:{})});
    this.executionMemoryPort=bound;return ()=>{if(this.executionMemoryPort===bound)this.executionMemoryPort=undefined;};}
  personaAccess(context:ExecutionContext,pluginId:string,effect:'read'|'local-write'='read'):PersonaAccess {
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
  capabilityResources(context:ExecutionContext,pluginId:string):readonly Conversation[]{if(!this.executions)throw new Error('EXECUTION_NOT_CONFIGURED');return this.executions.resources(context,pluginId);}
  quoteReplySource(context:ExecutionContext,pluginId:string){if(!this.executions)throw new Error('EXECUTION_NOT_CONFIGURED');return this.executions.quoteReplySource(context,pluginId);}
  async deliverPublicProgress(context:ExecutionContext,pluginId:string,raw:unknown):Promise<import('@dafeiyu/contracts').DeliveryResult>{
    if(!this.runStore||!this.executions)throw new Error('EXECUTION_NOT_CONFIGURED');
    const input=z.strictObject({kind:z.enum(['intent','progress','blocked']),text:z.string().trim().min(1).max(1000)}).parse(raw),authority=this.authorizeExternalTask(context,pluginId);
    const source=this.quoteReplySource(context,pluginId),item=this.journal.get(source.inboundId),channel=this.conversations.deliveryChannel(item);
    if(!channel||item.message.conversation.channel!=='qq')throw new Error('DEPENDENCY_UNAVAILABLE');
    const facts=this.runStore.operations(context.runId).filter(operation=>operation.id!==context.operationId&&operation.state==='finished'&&operation.outcome?.effects!=='unknown'&&['succeeded','partial'].includes(operation.outcome?.status??'')&&!['qq_progress','dsh_tool_list'].includes(operation.action)).slice(-6);
    if(input.kind==='progress'&&!facts.length)throw new Error('PROGRESS_EVIDENCE_REQUIRED');
    const signal=AbortSignal.any([context.signal,channel.signal]),guard=()=>{signal.throwIfAborted();authority.guard();if(this.conversations.deliveryChannel(item)?.identity!==channel.identity)throw new Error('SOURCE_STALE');};guard();
    return this.conversations.enqueueTaskDelivery(item.route,async()=>{let invoked=false;try{guard();const persona=this.targetPersona(item,context.operationId,signal,guard),model={provider:this.config.provider,model:this.config.model,...(this.config.reasoningEffort?{reasoningEffort:ReasoningEffortId(this.config.reasoningEffort)}:{})};
      const result=await renderPublicProgress(this.ctx,model,this.config.dataDir,context.operationId,persona.text,persona.items,{target:item.message.conversation,taskId:context.taskId!,runId:context.runId,inboundId:item.id,question:authority.authorization.goal,taskState:'running',
        evidence:[{id:'intent',kind:'inference',text:JSON.stringify({requestedPublicFeedback:input,note:'仅公开反馈草稿，不是完成事实。'})},...facts.map((operation,index)=>({id:'P'+index,kind:'reported' as const,text:JSON.stringify({action:operation.action,outcome:operation.outcome}).slice(0,8000)}))]},signal,()=>{guard();persona.guard();},this.config.context.requestMaxBytes-this.config.context.outputReserveBytes);
      guard();persona.guard();const reply:Reply={id:'qq-progress:'+context.operationId,conversation:item.message.conversation,sourceMessageId:item.message.id,text:result.text};
      invoked=true;return await channel.capability.deliver(reply,signal,()=>{guard();persona.guard();});
      }catch{return {status:invoked?'unknown' as const:'not-sent' as const,code:invoked?'QQ_PROGRESS_RESULT_UNKNOWN':'QQ_PROGRESS_NOT_SENT'};}
    });
  }
  authorizeCapabilityResource(context:ExecutionContext,pluginId:string,raw:unknown):Conversation {
    if(!this.executions)throw new Error('EXECUTION_NOT_CONFIGURED');const scene=ConversationSchema.parse(raw);this.executions.authorizeResource(context,pluginId,scene);return scene;
  }
  capabilityResourceCurrent(raw:unknown):boolean {const proof=ResourceProofSchema.safeParse(raw);return proof.success&&this.registry.resourceCurrent(proof.data);}
  capabilityPublicView(raw:unknown,view:string):boolean {const proof=ResourceProofSchema.safeParse(raw);return proof.success&&this.registry.publicView(proof.data,view);}
  capabilityTargetView(raw:unknown,view:string,target:Conversation,scope:unknown){const proof=ResourceProofSchema.safeParse(raw),destination=ConversationSchema.safeParse(target),execution=ExecutionScopeSchema.safeParse(scope);
    return proof.success&&destination.success&&execution.success&&execution.data.agentId===this.config.agentId?this.registry.targetView(proof.data,view,destination.data,execution.data):null;}
  capabilityResourceEpoch(scope?:TimelineScope):string {return this.registry.resourceEpoch(scope);}
  capabilityResourceEpochWithout(providerId:string,scope?:TimelineScope):string {return this.registry.resourceEpoch(scope,providerId);}
  capabilityHistoryCurrent(scope:TimelineScope,deps:readonly SourceDependency[]):boolean {
    const session=this.journal.sessionFor(scope);return !!session&&this.runtime.summarySourcesCurrent(session,deps);
  }
  capabilityObservationCurrent(scope:TimelineScope,source:PersonaSourceRef,exposedHash?:string):boolean {
    return !!this.capabilityObservationPort?.ready()&&this.capabilityObservationPort.valid(scope,source,exposedHash);
  }
  mediaExpressionFence(access:PersonaAccess,target:Conversation,roots:readonly string[]){access.guard();const port=this.capabilityObservationPort;if(!port?.ready()||!port.mediaFence)throw new Error('DEPENDENCY_UNAVAILABLE');return port.mediaFence(access,target,roots);}
  recordCapabilityObservation(context:ExecutionContext,pluginId:string,raw:unknown,options?:{readonly inheritExecutionHistory:true}) {
    if(options!==undefined)z.strictObject({inheritExecutionHistory:z.literal(true)}).parse(options);
    const input=CapabilityObservationSchema.parse(raw);if(input.proof.provider!==pluginId)throw new Error('SCOPE_DENIED');
    const scene=this.authorizeCapabilityResource(context,pluginId,input.proof.scene),execution=this.personaAccess(context,pluginId);
    const port=this.capabilityObservationPort;if(!port?.ready())throw new Error('DEPENDENCY_UNAVAILABLE');
    const guard=()=>{execution.guard();this.authorizeCapabilityResource(context,pluginId,scene);if(this.capabilityObservationPort!==port||!port.ready()||!this.capabilityResourceCurrent(input.proof))throw new Error('SOURCE_STALE');};
    guard();return port.record({execution,scene,guard,...(options?.inheritExecutionHistory?{inheritExecutionHistory:true as const}:{})},input);
  }
  selectCapabilityObservation(context:ExecutionContext,pluginId:string,sceneInput:unknown,raw:unknown,actualView:string) {
    const scene=this.authorizeCapabilityResource(context,pluginId,sceneInput),execution=this.personaAccess(context,pluginId,'local-write'),input=CapabilitySelectionSchema.parse(raw);
    const port=this.capabilityObservationPort;if(!port?.ready())throw new Error('DEPENDENCY_UNAVAILABLE');
    const guard=()=>{execution.guard();this.authorizeCapabilityResource(context,pluginId,scene);if(this.capabilityObservationPort!==port||!port.ready())throw new Error('DEPENDENCY_UNAVAILABLE');};
    guard();return port.select({execution,scene,guard},input,actualView);
  }
  personaContext(request:ContextRequest){const scope=this.scopeForContext(request),id=this.runStore?.findRequest('conversation',scope.traceId)?.runId;const persona=id?this.personas.current(id):undefined;persona?.guard();return persona?.items??[];}
  configureExecution(raw:ExecutionOptions):void {
    this.assertOpen();if(this.gate.state!=='registered'||this.executions)throw new Error('SERVICE_LIFECYCLE_CONFLICT');
    const options=ExecutionOptionsSchema.parse(raw),store=new RuntimeStore(resolve(this.config.dataDir,'runtime.sqlite'),{agentId:this.config.agentId,profileId:options.profileId},{create:options.createStore});
    this.runStore=store;this.scheduler=new RunScheduler(options.maxConcurrentRuns);
    this.conversationRuns=new ConversationRuns(this.ctx,store,this.journal,this.config.agentId,run=>this.conversations.validateRunPersona(run));
    this.executions=new ExecutionCoordinator({agentId:this.config.agentId,store,journal:this.journal,runtime:this.runtime,registry:this.registry,scheduler:this.scheduler,options,personas:this.personas,
      channelDescription:id=>this.conversations.deliveryChannel(this.journal.get(id))?.capability.description??'',repository:()=>this.repositoryPort,memory:()=>this.executionMemoryPort,experience:()=>this.experienceMemory,accepting:()=>this.accepting,assertAccepting:()=>this.assertAccepting(),persona:()=>this.persona(),model:this.analysisModelRoute(),
      turnTimeoutMs:this.config.turnTimeoutMs,reviewTimeoutMs:this.config.phaseTimeouts.review,context:this.config.context,signal:this.controller.signal,messageSignal:id=>this.conversations.messageProcessingSignal(id),media:()=>this.mediaPort,projectConversation:()=>this.conversationRuns!.project(),progress:id=>this.nativeTaskDelivery?.progress(id)??Promise.resolve(null),settled:id=>{if(this.runStore?.get(id).state==='failed')void this.nativeTaskDelivery?.progress(id).catch(()=>{});else void this.nativeTaskDelivery?.request(id,true).catch(()=>{});}});
    this.nativeTaskDelivery=new NativeTaskDelivery({ctx:this.ctx,store,contexts:this.contexts,cwd:this.config.dataDir,signal:this.controller.signal,timeoutMs:NATIVE_RENDER_ATTEMPTS*(this.config.phaseTimeouts.render+this.config.phaseTimeouts.verification)+this.config.deliveryTimeoutMs,sendTimeoutMs:this.config.deliveryTimeoutMs,
      describe:id=>this.executions!.describeMessageResult(id),access:id=>this.executions!.nativeResultAccess(id),expression:()=>this.nativeExpressionPort,accepting:()=>this.accepting,flush:()=>this.executions!.flushEvents(),
      feedbackSource:id=>this.executions!.feedbackSource(id),
      model:()=>({provider:this.config.provider,model:this.config.model,...(this.config.reasoningEffort?{reasoningEffort:ReasoningEffortId(this.config.reasoningEffort)}:{})}),
      channel:item=>this.conversations.deliveryChannel(item),
      enqueue:(route,work)=>this.conversations.enqueueTaskDelivery(route,work),acquire:()=>this.scheduler!.acquire(false),
      persona:(item,id,signal,guard)=>this.targetPersona(item,id,signal,guard),media:()=>this.mediaPort,mediaAccess:(authority,reply,signal)=>this.prepareMediaReplyAccess(authority,reply,signal),
    });
  }
  async recoverExecutions():Promise<void>{if(!this.executions)throw new Error('EXECUTION_NOT_CONFIGURED');if(this.gate.state!=='registered')throw new Error('SERVICE_LIFECYCLE_CONFLICT');this.executions.recover();await this.conversationRuns?.recover();this.executionRecovered=true;}
  executionProducer(id:string,options?:unknown){if(!this.executions)throw new Error('EXECUTION_NOT_CONFIGURED');return this.executions.producer(id,options);}
  bindWakeAuthority(provider:WakeAuthorityProvider){if(!this.executions)throw new Error('EXECUTION_NOT_CONFIGURED');return this.executions.bindWake(provider);}
  bindExecutionLifecycle(owner:string,receive:(event:import('@dafeiyu/contracts').ExecutionLifecycle)=>void){if(!this.executions)throw new Error('EXECUTION_NOT_CONFIGURED');return this.executions.bindLifecycle(owner,receive);}
  captureActivityAnchor(context:ExecutionContext,pluginId:string){if(!this.executions)throw new Error('EXECUTION_NOT_CONFIGURED');return this.executions.captureActivity(context,pluginId);}
  activityAnchorStatus(anchor:unknown){if(!this.executions)throw new Error('EXECUTION_NOT_CONFIGURED');return this.executions.activityAnchorStatus(anchor);}
  createMaintenanceAnchor(runId:string,taskId:string,epoch:number){if(!this.executions)throw new Error('EXECUTION_NOT_CONFIGURED');return this.executions.maintenanceAnchor(runId,taskId,epoch);}
  activityPressure(){return {...(this.scheduler?.status??{active:0,waiting:0,foregroundWaiting:0}),foregroundRuns:this.executions?.foregroundPending??0};}
  executionAuthority(context:ExecutionContext,pluginId:string){if(!this.executions)throw new Error('EXECUTION_NOT_CONFIGURED');return this.executions.authority(context,pluginId);}
  authorizeExternalTask(context:ExecutionContext,pluginId:string){if(!this.executions)throw new Error('EXECUTION_NOT_CONFIGURED');return this.executions.authorizeExternalTask(context,pluginId);}
  externalTaskSourceCurrent(authorization:unknown,pluginId:string):boolean{return this.executions?.externalTaskSourceCurrent(authorization,pluginId)??false;}
  explicitTaskInstruction(context:ExecutionContext,pluginId:string){if(!this.executions)throw new Error('EXECUTION_NOT_CONFIGURED');return this.executions.explicitTaskInstruction(context,pluginId);}
  executionEvents(context:ExecutionContext,pluginId:string){const authority=this.executionAuthority(context,pluginId);if(authority.scope.kind!=='task')throw new Error('UNSUPPORTED_EXECUTION_ORIGIN');return this.journal.executionEvents(authority.agentId,authority.scope.taskId);}
  private persona() {
    if(!this.foundationMemory)throw new Error('MEMORY_FOUNDATION_REQUIRED');return this.foundationMemory;
  }
  private event(item: PendingMessage, type: string, data: Record<string, Json> = {}, causedBy: string | null = null) {
    return eventFor(this.config.agentId, item, type, '@dafeiyu/core', CORE_VERSION, item.id, causedBy, data);
  }
  private assertOpen(): void {
    if (this.controller.signal.aborted) throw new Error('Dafeiyu is closing');
    if (this.fatal) throw new Error(this.fatal,{cause:this.conversations.failureCause});
  }
  /** Resolve an active invocation issued by this core. Model arguments cannot select a route or impersonate a context. */
  conversationAccess(context:ExecutionContext,owner:string):ConversationAccess {
    this.executionAuthority(context,owner);
    if(context.scope.kind!=='conversation'||context.origin.kind!=='message')throw new Error('CONVERSATION_REQUIRED');
    const item=this.journal.get(context.origin.inboundId);
    const access=Object.freeze({operationId:context.operationId,conversation:item.message.conversation,sourceMessageId:item.message.id,signal:context.signal});
    this.actionScopes.set(access,{context,owner});return access;
  }
  scopeFor(access:ConversationAccess,effect:'read'|'local-write'='read'):OperationScope {
    const issued=this.actionScopes.get(access);if(!issued)throw new Error('SCOPE_DENIED');
    const context=this.executions!.authority(issued.context,issued.owner,effect);
    if(context.scope.kind!=='conversation'||context.origin.kind!=='message'||!this.runStore)throw new Error('CONVERSATION_REQUIRED');
    return {agentId:context.agentId,route:context.scope.route,traceId:context.origin.inboundId,operationId:context.operationId,startedEventId:this.runStore.operation(context.operationId).startedEventId};
  }
  operationDependencyCurrent(scope:import('@dafeiyu/contracts').TimelineScope,dep:Extract<SourceDependency,{kind:'execution-operation'}>):boolean {
    try{if(!this.runStore||scope.agentId!==this.config.agentId)return false;const run=this.runStore.get(dep.runId),operation=this.runStore.operation(dep.operationId);
      const route=run.definition.scope.kind==='conversation'?run.definition.scope.route:run.definition.scope.scopeKey;
      return route===scope.route&&run.definition.scope.agentId===scope.agentId&&operation.runId===run.id&&operation.state==='finished'&&runtimeHash(operation.outcome)===dep.hash&&runtimeHash(this.runStore.readInput(run.id,'operation-inputs:'+operation.id))===dep.inputHash;
    }catch{return false;}
  }
  scopeForContext(request:ContextRequest):OperationScope{this.assertOpen();return this.contexts.scopeFor(request);}
  experienceOriginCurrent(origin:import('@dafeiyu/contracts').RunOrigin):boolean {
    try{for(let depth=0;depth<64;depth++){
      if(origin.kind==='message'){const item=this.journal.get(origin.inboundId);return runtimeHash(item.message.conversation)===runtimeHash(origin.conversation)&&!this.journal.messageRecalled({agentId:this.config.agentId,route:item.route},item.message.id);}
      if(origin.kind!=='continuation')return true;
      if(!this.runStore)return false;origin=this.runStore.get(origin.parentRunId).definition.origin;
    }return false;}catch{return false;}
  }
  private observationEntry():Registered|undefined{return [...this.extensions.values()].find(e=>e.active&&e.extension.memoryObservationProvider);}
  private observationAuthority(entry:Registered,conversation:Conversation,context?:ConversationAccess):ObservationAuthority {
    this.assertOpen();if(!entry.active)throw new Error('Extension is unregistered');
    const route=conversationKey(this.config.agentId,conversation);
    let taskId:string|null=null,ingressPluginId=entry.extension.id,agentTaskId:string|null=null;
    let parent:ObservationAuthority['parent'];
    if(context){
      const scope=this.scopeFor(context),event=this.journal.scopedEvent(scope,scope.startedEventId);
      if(scope.route!==route||event?.plugin!==entry.extension.id)throw new Error('Observation context does not belong to this capability');
      taskId=this.compactionBinding()?.provider.basis(scope).taskId??null;
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
      return false;
    }catch{return false;}
  }
  summaryReference(context:ConversationAccess,ref:string){const scope=this.scopeFor(context);return this.runtime.readSummaryReference(this.journal.sessionFor(scope)??'',ref);}
  historicalSourceCurrent(scope:Pick<OperationScope,'agentId'|'route'>,sessionId:string,seq:number):boolean{
    return scope.agentId===this.config.agentId&&this.journal.sessionFor(scope)===sessionId&&this.runtime.sourceCurrent(sessionId,seq);
  }
  /** Host-only durable authorization for read/analyze/commit work, never an ConversationAccess. */
  issueAnalysisGrant(context: ConversationAccess): string { return this.journal.issueAnalysisGrant(this.scopeFor(context),CORE_VERSION); }
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
  registerExtension(extension:Extension):ExtensionHandle {
    this.assertOpen();
    if(extension.memoryObservationProvider&&this.observationEntry())throw new Error('DUPLICATE_PROVIDER');
    if(extension.compactionProvider&&this.compactionBinding())throw new Error('DUPLICATE_PROVIDER');
    const handle=this.registry.register(this.config.agentId,extension);
    const registered:Registered={extension:Object.freeze({...extension}),controller:new AbortController(),active:true};
    let release:()=>void;
    try{release=this.contexts.register(extension.id,extension.version,extension.conversationContexts??[]);this.extensions.set(extension.id,registered);}
    catch(error){handle.dispose();throw error;}
    for(const item of this.journal.list(['accepted','reply-ready']))if(item.extensionId===extension.id)this.conversations.schedule(item);
    return {
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
        if (item.state === 'accepted' || item.state === 'reply-ready') this.conversations.schedule(item);
        return receipt;
      },

      dispose:()=>{if(!registered.active)return;registered.active=false;registered.controller.abort();release();handle.dispose();this.extensions.delete(extension.id);}
    };
  }
  retryDelivery(id:string){this.conversations.retryDelivery(id);}
  getStatus() {
    return { agentId: this.config.agentId, state: this.fatal ? 'error' : this.controller.signal.aborted ? 'closed' : this.gate.active?(this.admissionHeld?'composing':this.dependenciesReady()?'ready':'degraded'):this.gate.state==='quiescing'?'draining':'composing',
      lifecycle:this.gate.state,error: this.fatal,execution:this.executions?.health??null,nativeDelivery:this.closed?this.closedNativeDelivery:this.runStore?.nativeDeliveries.counts()??null, extensions: [...new Set([...this.extensions.keys(),...this.registry.ids()])], queuedRoutes: this.conversations.queuedRoutes,
      messages: this.closed ? [] : this.journal.list().map(item => ({ id: item.id, state: item.state, sessionId: item.sessionId })) };
  }
  async whenIdle(): Promise<void> {
    do{await this.conversations.whenIdle();await this.executions?.whenIdle();await this.nativeTaskDelivery?.whenIdle();}while(this.conversations.queuedRoutes||this.nativeTaskDelivery?.pending);
    if (this.fatal) throw new Error(this.fatal,{cause:this.conversations.failureCause});
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.quiesce();this.readyListeners.clear();this.registry.close();
    this.controller.abort();
    this.closing = (async () => {
      try{await this.conversations.whenIdle();await this.executions?.whenIdle();await this.nativeTaskDelivery?.whenIdle();}
      finally{try { await this.runtime.close(); } finally {this.nativeTaskDelivery?.close();this.closedNativeDelivery=this.runStore?.nativeDeliveries.counts()??null;this.runStore?.close();this.closed = true;this.gate.close(); this.journal.close(); }}
    })();
    return this.closing;
  }
}

/** DSH/Cordis lifecycle entry point. The installed host supplies all injected DSH services. */
export function apply(ctx: Context, config: Config): void {
  const core = new DafeiyuService(ctx, config);
  ctx.effect(() => () => core.close(), 'dafeiyu.close');
}

export * from './storage-status.js';
