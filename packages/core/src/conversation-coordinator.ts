import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {SourceDependencySchema} from '@dafeiyu/contracts';
import type {Context} from '@deepseek-ai/cordis';
import type {AgentOptions} from '@deepseek-ai/dsh-agent';
import type {ContextItem,Extension,Json,PendingMessage,Reply,MediaPort,MediaReplyAccess,MediaReplyAuthority,ExperienceMemoryPort} from '@dafeiyu/contracts';
import {eventFor} from '@dafeiyu/journal';
import type {Journal,NewEvent} from '@dafeiyu/journal';
import {DshRunError} from './runtime.js';
import type {DshRuntime} from './runtime.js';
import {renderConversationRecovery,decidePendingReplies} from './conversation-recovery.js';
import {renderPublicProgress} from './target-renderer.js';
import {prepareReplySources,prepareCapturedReplySources} from './reply-sources.js';
import {runtimeHash} from './runtime-store.js';
import type {RuntimeStore,StoredRun} from './runtime-store.js';
import type {ExecutionCoordinator} from './execution-coordinator.js';
import type {ConversationRuns} from './conversation-run.js';
import type {RunScheduler} from './run-scheduler.js';
import type {PersonaRuntime} from './persona-runtime.js';
import type {ContextCoordinator} from './context.js';
import type {CompactionBinding} from './compaction-runtime.js';
import type {FoundationSnapshot} from './foundation.js';
import type {CoreRuntimeConfig} from './index.js';
import {CORE_VERSION} from './version.js';

interface ConversationHost {
  ctx:Context;config:CoreRuntimeConfig;journal:Journal;runtime:DshRuntime;personas:PersonaRuntime;contexts:ContextCoordinator;
  extensions:ReadonlyMap<string,{extension:Extension;controller:AbortController;active:boolean}>;signal:AbortSignal;
  schedulingReady():boolean;accepting():boolean;failure():string|null;fail(code:string):void;
  runs():RuntimeStore|undefined;executions():ExecutionCoordinator|undefined;conversationRuns():ConversationRuns|undefined;
  scheduler():RunScheduler|undefined;media():MediaPort|undefined;experience():ExperienceMemoryPort|undefined;
  assertAccepting():void;persona():FoundationSnapshot;modelRoute():{provider:string;model:string;reasoningEffort?:string};recoveryModel():AgentOptions;
  targetPersona(item:PendingMessage,id:string,signal:AbortSignal,guard:()=>void):{text:string;foundationHash:string;stamp:string;items:readonly ContextItem[];guard():void};
  compaction():CompactionBinding|undefined;
  prepareMediaReply(authority:MediaReplyAuthority,reply:Reply,signal:AbortSignal):Promise<MediaReplyAccess>;
  event(item:PendingMessage,type:string,data?:Record<string,Json>,parent?:string|null):NewEvent;
}

/** Owns conversation serialization and channel delivery. Kernel identity and authority remain in injected ports. */
export class ConversationCoordinator {
  private readonly queues=new Map<string,Promise<void>>();
  private readonly scheduled=new Set<string>();
  constructor(private readonly host:ConversationHost){}
  private get ctx(){return this.host.ctx;}
  private get config(){return this.host.config;}
  private get journal(){return this.host.journal;}
  private get runtime(){return this.host.runtime;}
  private get personas(){return this.host.personas;}
  private get contexts(){return this.host.contexts;}
  private get extensions(){return this.host.extensions;}
  private get controller(){return {signal:this.host.signal};}
  private get runStore(){return this.host.runs();}
  private get executions(){return this.host.executions();}
  private get conversationRuns(){return this.host.conversationRuns();}
  private get scheduler(){return this.host.scheduler();}
  private get mediaPort(){return this.host.media();}
  private get experienceMemory(){return this.host.experience();}
  private get accepting(){return this.host.accepting();}
  private get fatal(){return this.host.failure();}
  private set fatal(value:string|null){if(value)this.host.fail(value);}
  private assertAccepting(){this.host.assertAccepting();}
  private persona(){return this.host.persona();}
  private analysisModelRoute(){return this.host.modelRoute();}
  private recoveryModel(){return this.host.recoveryModel();}
  private targetPersona(...args:Parameters<ConversationHost['targetPersona']>){return this.host.targetPersona(...args);}
  private compactionBinding(){return this.host.compaction();}
  private prepareMediaReplyAccess(...args:Parameters<ConversationHost['prepareMediaReply']>){return this.host.prepareMediaReply(...args);}
  private event(...args:Parameters<ConversationHost['event']>){return this.host.event(...args);}
  get queuedRoutes(){return this.queues.size;}
  failureCause:unknown;
  async whenIdle(){while(this.queues.size)await Promise.all([...this.queues.values()]);}

  schedule(item: PendingMessage): void {
    if(!this.host.schedulingReady())return;
    if (this.scheduled.has(item.id)) return;
    this.scheduled.add(item.id);
    const previous = this.queues.get(item.route) ?? Promise.resolve();
    const task = previous.then(() => this.process(item.id)).catch(error => {
      // A failed journal/checkpoint cannot be safely papered over with another send.
      this.failureCause=error;this.fatal = 'Workflow storage failure; automatic processing stopped';
    }).finally(() => {
      this.scheduled.delete(item.id);
      if (this.queues.get(item.route) === task) this.queues.delete(item.route);
    });
    this.queues.set(item.route, task);
  }

  enqueueTaskDelivery<T>(route:string,work:()=>Promise<T>):Promise<T>{
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

  replyStateFacts(current:PendingMessage){
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

  private replyRecoveryActions(item:PendingMessage):import('./execution-frame.js').NativeAction[] {
    if(!this.pendingReplyFacts(item).length)return [];
    return (['resume','supersede'] as const).map(decision=>{
      const inputSchema=z.strictObject({inboundId:z.uuid()}),input=z.toJSONSchema(inputSchema),parameters=input as import('./capability-registry.js').BoundAction['parameters'];
      const definition:import('./capability-registry.js').BoundAction={id:'dafeiyu_reply_'+decision,owner:'core',version:'1',pluginVersion:CORE_VERSION,
        description:decision==='resume'?'续发当前会话确定未发送的答复部分。':'由当前回答替代旧答复尚未发送的部分。',effects:'local-write',scope:'any',input,parameters,active:()=>this.accepting,signal:this.controller.signal,
        validateInput:raw=>inputSchema.parse(raw),execute:async()=>{throw new Error('CORE_DISPATCH_REQUIRED');}};
      return {definition,execute:async(raw,_callId,signal)=>{signal.throwIfAborted();this.messageProcessingSignal(item.id)?.throwIfAborted();return {status:'succeeded',effects:'confirmed',completeness:'complete',sources:[],receipts:[],data:this.resolvePendingReply(item,inputSchema.parse(raw).inboundId,decision)};}};
    });
  }

  private async process(id: string): Promise<void> {
    const release=await this.scheduler?.acquire(true);
    try{await this.processMessage(id);}finally{try{const runId=this.runStore?.findRequest('conversation',id)?.runId;if(runId)this.personas.current(runId)?.dispose();}finally{release?.();}}
  }

  messageProcessingSignal(id: string): AbortSignal | undefined {
    const item = this.journal.get(id), source = this.extensions.get(item.extensionId);
    if (!source?.active) throw new Error('DEPENDENCY_UNAVAILABLE');
    return source.extension.channels?.find(channel => channel.channel === item.message.conversation.channel
      && channel.account === item.message.conversation.account)?.processingSignal?.(item.message);
  }

  deliveryChannel(item: PendingMessage) {
    const entry = this.extensions.get(item.extensionId), capability = entry?.extension.channels?.find(channel =>
      channel.channel === item.message.conversation.channel && channel.account === item.message.conversation.account);
    if (!entry?.active || !capability) return null;
    try {
      const access = capability.processingSignal?.(item.message); access?.throwIfAborted();
      return { identity: entry, id: entry.extension.id, version: entry.extension.version, capability,
        signal: access ? AbortSignal.any([entry.controller.signal, access]) : entry.controller.signal };
    } catch { return null; }
  }

  validateRunPersona(run:StoredRun):void{const binding=this.runStore?.personaBinding(run.id);if(binding?.kind==='bound')this.personas.validateStored(run,binding.manifest,[],this.controller.signal,()=>this.controller.signal.throwIfAborted());}

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
        if(!this.conversationRuns||!this.executions||!this.experienceMemory)throw new Error('DEPENDENCY_UNAVAILABLE');
        run=this.conversationRuns.begin(item,persona,this.analysisModelRoute(),[...this.extensions.values()].map(entry=>({id:entry.extension.id,version:entry.extension.version})),this.executions.conversationSnapshot(source.extension.id),
          record=>this.personas.prepare(record,persona,this.analysisModelRoute(),[],signal,()=>{signal.throwIfAborted();if(!source.active)throw new Error('DEPENDENCY_UNAVAILABLE');}).manifest);
        this.experienceMemory.begin({id:run.id,scope:run.definition.scope,origin:run.definition.origin,goal:item.message.mainText??item.message.text,at:run.createdAt});
        started = this.journal.transition(item.id, 'accepted', 'processing', this.event(item, 'turn.started',run?{runId:run.id}:{}, accepted?.id ?? null));
        this.journal.append(this.event(item, 'persona.loaded', { version: persona.version }, started.id));
        const nativeActions=this.executions.conversationActions(run,source.extension.id,signal,()=>{if(!source.active)throw new Error('DEPENDENCY_UNAVAILABLE');});
        const capabilityDescription=[channel?.description,this.executions?JSON.stringify(this.executions.messageCapabilities(item.message)):null].filter(Boolean).join('\n');
        const conversationActions=source.extension.id==='local-owner-tasks'?[]:this.replyRecoveryActions(item);
        result = await this.runtime.run(item, persona, [...nativeActions,...conversationActions], signal, capabilityDescription,()=>!!(run&&this.runStore?.operations(run.id).some(op=>(op.plugin==='qq-tasks'&&op.action==='qq_task_submit'||op.plugin==='local-owner-tasks'&&op.action==='local_owner_task_submit')&&op.state==='finished'&&op.outcome?.status==='succeeded'&&op.outcome.effects==='confirmed'))||!!(run&&this.mediaPort?.replyDraft?.(run.id)?.selected&&this.runStore?.operations(run.id).some(op=>op.action==='qq_sticker_use'&&op.plugin==='qq-stickers'&&op.state==='finished'&&op.outcome?.status==='succeeded'&&op.outcome.effects==='confirmed')));
        signal.throwIfAborted();
        if(run)this.personas.current(run.id)?.guard();
      } catch (error) {
        const failure=error instanceof DshRunError?error.code:'TURN_FAILED';
        if(run){this.conversationRuns?.fail(run,failure);this.experienceMemory?.settle(run.id,'failed');}

        await this.conversationRuns?.project();
        this.journal.transition(item.id, this.journal.get(item.id).state, 'failed', { ...this.event(item, 'turn.failed', { code: failure, phase:'execution', note: 'Earlier operations may have effects; no automatic replay' }, started?.id??null),
          sources: error instanceof DshRunError ? error.sources : [] });
        await this.notifyConversationFailure(item,failure);
        return;
      }
      if(!run||!this.conversationRuns||!this.experienceMemory)throw new Error('DEPENDENCY_UNAVAILABLE');
      this.conversationRuns.complete(run,item,result,started!.id);this.experienceMemory.settle(run.id,'completed');await this.conversationRuns.project();
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
    } catch(error) { const dependency=SourceDependencySchema.safeParse(error instanceof Error?error.cause:null);if(dependency.success)this.journal.append(deliveryEvent('delivery.source-invalid',{dependency:z.json().parse(dependency.data)},sending.id));
      const code=error instanceof Error&&['MEDIA_DELIVERY_NOT_CONFIGURED','MEDIA_DRAFT_AUTHORITY_MISMATCH','MEDIA_REPLY_OPERATION_UNCONFIRMED','MEDIA_TARGET_DENIED','MEDIA_SIZE_LIMIT','MEDIA_BLOB_CORRUPT','MEDIA_TTS_NOT_CONFIGURED'].includes(error.message)?error.message:'SOURCE_STALE';
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
}
