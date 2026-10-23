import { Context, Service } from '@deepseek-ai/cordis';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import { API_VERSION, MessageSchema, ObservationSchema, conversationKey,ToolFeedbackSchema,FeedbackMetaSchema,FeedbackWitnessSchema,FEEDBACK_RETIRED_TEXT,FeedbackCaptureError } from '@dafeiyu/contracts';
import type { FeedbackDelivery } from '@dafeiyu/contracts';
import type { ActionCapability, ActionContext, OperationScope, Extension, ExtensionHandle, Json, PendingMessage, PersonaSnapshot, Receipt, Reply } from '@dafeiyu/contracts';
import { Journal, eventFor } from '@dafeiyu/journal';
import { DshRuntime, DshRunError } from './runtime.js';
import type { BoundAction,ActionResult } from './runtime.js';
import { ContextCoordinator,contextConfigSchema } from './context.js';
import type { ContextRequest } from '@dafeiyu/contracts';
import { CORE_VERSION } from './version.js';
import { capsuleSchema } from './compaction-runtime.js';
import type { CompactionBinding } from './compaction-runtime.js';
export type { CompactionBinding } from './compaction-runtime.js';
export { readCompactionEvents } from './compaction-runtime.js';
export { readProvenance } from './provenance.js';

export const name = 'dafeiyu-core';
export const inject = ['agents', 'sessions', 'sessionPersistence', 'tools', 'systemPrompt','llm'];
const ConfigSchema = z.strictObject({
  agentId: z.string().min(1).max(100), dataDir: z.string().min(1), personaFile: z.string().min(1),
  provider: z.string().min(1), model: z.string().min(1),
  reasoningEffort: z.string().min(1).optional(),
  turnTimeoutMs: z.number().int().min(50).max(3_600_000).default(600_000),
  deliveryTimeoutMs: z.number().int().min(50).max(60_000).default(15_000),
  context:contextConfigSchema.default({maxBytes:16000,requestMaxBytes:1000000,outputReserveBytes:16000,prepareTimeoutMs:5000,regions:{}}),
});
export type Config = z.input<typeof ConfigSchema>;
interface Registered { extension: Extension; controller: AbortController; active: boolean }
declare module '@deepseek-ai/cordis' { interface Context { dafeiyu: DafeiyuService } }

/** Owns a logical persona and its independent conversations; extensions own platform-specific work. */
export class DafeiyuService extends Service {
  readonly journal: Journal;
  private readonly config: z.output<typeof ConfigSchema>;
  private readonly runtime: DshRuntime;
  private readonly contexts:ContextCoordinator;
  private readonly extensions = new Map<string, Registered>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly scheduled = new Set<string>();
  private readonly actionScopes = new WeakMap<ActionContext, OperationScope>();
  private readonly controller = new AbortController();
  private fatal: string | null = null;
  private closing: Promise<void> | null = null;
  private closed = false;

  constructor(ctx: Context, config: Config) {
    super(ctx, 'dafeiyu');
    this.config = ConfigSchema.parse(config);
    this.persona();
    this.journal = new Journal(resolve(this.config.dataDir, 'journal.sqlite'));
    this.contexts=new ContextCoordinator(this.config.agentId,this.journal,this.config.context);
    this.runtime = new DshRuntime(ctx, { provider: this.config.provider, model: this.config.model,
      ...(this.config.reasoningEffort ? { reasoningEffort: ReasoningEffortId(this.config.reasoningEffort) } : {}) }, resolve(this.config.dataDir),this.contexts,
      (item,meta,text)=>this.feedbackViewCurrent({agentId:this.config.agentId,route:item.route,traceId:item.id},meta,text),this.config.agentId,()=>this.compactionBinding(),
      (item,data,seqs)=>{this.journal.append({...this.event(item,data.status==='sources-retired'?'context.sources.retired':'context.compaction.checked',data),sources:seqs.map(seq=>({kind:'session' as const,id:item.sessionId,seq,route:item.route}))});});
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
  }
  private persona(): PersonaSnapshot {
    const text = readFileSync(this.config.personaFile, 'utf8').trim();
    if (!text || text.length > 32_000) throw new Error('Persona must contain 1..32000 characters');
    return { text, version: createHash('sha256').update(text).digest('hex') };
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
  private feedbackEntry():Registered|undefined{return [...this.extensions.values()].find(e=>e.active&&e.extension.feedbackProvider);}
  private compactionBinding():CompactionBinding|undefined {
    const entry=[...this.extensions.values()].find(e=>e.active&&e.extension.compactionProvider);
    return entry?.extension.compactionProvider?{owner:entry.extension.id,version:entry.extension.version,provider:entry.extension.compactionProvider}:undefined;
  }
  /** Read-only source export gate for archived summary checkpoints. */
  compactionViewCurrent(scope:Pick<OperationScope,'agentId'|'route'|'traceId'>,text:string,compactionId:string):boolean {
    try {
      const capsule=capsuleSchema.parse(JSON.parse(text)),binding=this.compactionBinding();
      return !!binding&&scope.agentId===this.config.agentId&&capsule.agentId===scope.agentId&&capsule.route===scope.route
        &&capsule.owner===binding.owner&&(capsule.schemaVersion===2?this.runtime.summarySourcesCurrent(this.journal.sessionFor(scope)??'',capsule.dependencies!):capsule.epoch===binding.provider.basis(scope).epoch)
        &&this.runtime.summaryCommitted(this.journal.sessionFor(scope)??'',compactionId,text);
    }catch{return false;}
  }
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
  registerExtension(extension: Extension): ExtensionHandle {
    this.assertOpen();
    if (extension.apiVersion !== API_VERSION || extension.agentId !== this.config.agentId) throw new Error('Incompatible extension interface or agent binding');
    if (!/^[a-z][a-z0-9._-]{0,79}$/.test(extension.id) || !extension.version) throw new Error('Invalid extension identity');
    if (this.extensions.has(extension.id)) throw new Error('Duplicate extension ID');
    const existing = [...this.extensions.values()].map(entry => entry.extension);
    const channelKeys = new Set(existing.flatMap(ext => ext.channels ?? []).map(c => JSON.stringify([c.channel, c.account])));
    const actionNames = new Set(existing.flatMap(ext => ext.actions ?? []).map(action => action.name));
    for (const c of extension.channels ?? []) {
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
    if(extension.compactionProvider&&this.compactionBinding())throw new Error('Compaction provider already registered');
    if(extension.compactionProvider&&this.ctx.get('compaction'))throw new Error('Use one compaction writer per Dafeiyu host');
    // Snapshot registration metadata so caller-side mutations cannot change a running capability.
    extension = { ...extension,
      channels: (extension.channels ?? []).map(channel => ({ channel: channel.channel, account: channel.account,
        ...(channel.description ? { description: channel.description } : {}),
        deliver: channel.deliver.bind(channel) })),
      actions: (extension.actions ?? []).map(action => ({ name: action.name, description: action.description,
        execute: action.execute.bind(action),
        ...(action.feedback?{feedback:action.feedback}:{}),
        fields: Object.fromEntries(Object.entries(action.fields).map(([key, field]) => [key, { ...field }])) })),
      ...(extension.feedbackProvider?{feedbackProvider:{capture:extension.feedbackProvider.capture.bind(extension.feedbackProvider),
        present:extension.feedbackProvider.present.bind(extension.feedbackProvider),validate:extension.feedbackProvider.validate.bind(extension.feedbackProvider)}}:{}),
      ...(extension.compactionProvider?{compactionProvider:{policy:Object.freeze({...extension.compactionProvider.policy}),
        ...(extension.compactionProvider.sources?{sources:{inbound:extension.compactionProvider.sources.inbound.bind(extension.compactionProvider.sources),
          context:extension.compactionProvider.sources.context.bind(extension.compactionProvider.sources),tool:extension.compactionProvider.sources.tool.bind(extension.compactionProvider.sources),
          validate:extension.compactionProvider.sources.validate.bind(extension.compactionProvider.sources)}}:{}),
        basis:extension.compactionProvider.basis.bind(extension.compactionProvider),summarize:extension.compactionProvider.summarize.bind(extension.compactionProvider)}}:{}),
    };
    const registered: Registered = { extension, controller: new AbortController(), active: true };
    const unregisterContexts=this.contexts.register(extension.id,extension.version,extension.contexts??[]);
    this.extensions.set(extension.id, registered);
    for (const item of this.journal.list(['accepted', 'reply-ready'])) {
      if (item.extensionId === extension.id) this.schedule(item);
    }
    return {
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
        this.assertOpen();
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
  private actions(item: PendingMessage, causedBy: string): BoundAction[] {
    return [...this.extensions.values()].flatMap(entry => (entry.extension.actions ?? []).map(definition => ({
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
  }
  private parseAction(action: ActionCapability, raw: unknown): Record<string, string> {
    const fields = Object.fromEntries(Object.entries(action.fields).map(([key, field]) => [key,
      field.required ? z.string().max(32_000) : z.string().max(32_000).optional()]));
    const parsed = z.strictObject(fields).parse(raw);
    return Object.fromEntries(Object.entries(parsed).filter((pair): pair is [string, string] => typeof pair[1] === 'string'));
  }
  private async process(id: string): Promise<void> {
    if (this.controller.signal.aborted || this.fatal) return;
    let item = this.journal.get(id);
    const source = this.extensions.get(item.extensionId);
    if (!source?.active) return;
    if (item.state === 'accepted') {
      const accepted = this.journal.events(item.route).find(event => event.traceId === item.id && event.type === 'message.accepted');
      const started = this.journal.transition(item.id, 'accepted', 'processing', this.event(item, 'turn.started', {}, accepted?.id ?? null));
      let result;
      try {
        const persona = this.persona();
        this.journal.append(this.event(item, 'persona.loaded', { version: persona.version }, started.id));
        const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(this.config.turnTimeoutMs)]);
        const channel = source.extension.channels?.find(capability => capability.channel === item.message.conversation.channel && capability.account === item.message.conversation.account);
        result = await this.runtime.run(item, persona, this.actions(item, started.id), signal, channel?.description);
      } catch (error) {
        this.journal.transition(item.id, 'processing', 'failed', { ...this.event(item, 'turn.failed', { code: 'TURN_FAILED', note: 'Earlier operations may have effects; no automatic replay' }, started.id),
          sources: error instanceof DshRunError ? error.sources : [] });
        return;
      }
      const reply: Reply = { id: `${item.id}:reply`, conversation: item.message.conversation, sourceMessageId: item.message.id, text: result.text };
      this.journal.transition(item.id, 'processing', 'reply-ready', { ...this.event(item, 'turn.completed', {}, started.id), sources: result.sources }, reply);
      item = this.journal.get(id);
    }
    if (item.state !== 'reply-ready' || !item.reply) return;
    const channel = source.extension.channels?.find(c => c.channel === item.message.conversation.channel && c.account === item.message.conversation.account);
    if (!channel || !source.active || this.controller.signal.aborted || this.fatal) return;
    const completed = this.journal.events(item.route).findLast(event => event.traceId === item.id && event.type === 'turn.completed');
    const deliveryOperation = randomUUID();
    const deliveryEvent = (type: string, data: Record<string, Json>, parent: string | null) =>
      eventFor(this.config.agentId, item, type, source.extension.id, source.extension.version, deliveryOperation, parent, data);
    const sending = this.journal.transition(id, 'reply-ready', 'sending', deliveryEvent('delivery.started', { replyId: item.reply.id }, completed?.id ?? null));
    let result;
    try {
      result = await channel.deliver(item.reply, AbortSignal.any([this.controller.signal, source.controller.signal, AbortSignal.timeout(this.config.deliveryTimeoutMs)]));
      if (result.status === 'sent' && !result.receiptId) throw new Error('Missing transport receipt');
    } catch { result = { status: 'unknown' as const, code: 'DELIVERY_UNKNOWN' }; }
    const next = result.status === 'sent' ? 'delivered' : result.status === 'not-sent' ? 'reply-ready' : 'uncertain';
    this.journal.transition(id, 'sending', next, deliveryEvent(`delivery.${result.status}`, result.status === 'sent' ? { receiptId: result.receiptId } : { code: result.code }, sending.id));
  }
  /** Explicit retry only for definitely-not-sent replies; never runs the model or replays tool operations. */
  retryDelivery(id: string): void {
    this.assertOpen();
    const item = this.journal.get(id);
    if (item.state !== 'reply-ready') throw new Error('Only a definitely unsent reply may be retried');
    this.schedule(item);
  }
  getStatus() {
    return { agentId: this.config.agentId, state: this.fatal ? 'error' : this.controller.signal.aborted ? 'closed' : 'ready',
      error: this.fatal, extensions: [...this.extensions.keys()], queuedRoutes: this.queues.size,
      messages: this.closed ? [] : this.journal.list().map(item => ({ id: item.id, state: item.state, sessionId: item.sessionId })) };
  }
  async whenIdle(): Promise<void> {
    while (this.queues.size) await Promise.all([...this.queues.values()]);
    if (this.fatal) throw new Error(this.fatal);
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.controller.abort();
    this.closing = (async () => {
      await Promise.all([...this.queues.values()]);
      try { await this.runtime.close(); } finally { this.closed = true; this.journal.close(); }
    })();
    return this.closing;
  }
}

/** DSH/Cordis lifecycle entry point. The installed host supplies all injected DSH services. */
export function apply(ctx: Context, config: Config): void {
  const core = new DafeiyuService(ctx, config);
  ctx.effect(() => () => core.close(), 'dafeiyu.close');
}
