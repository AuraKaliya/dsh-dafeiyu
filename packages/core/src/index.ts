import { Context, Service } from '@deepseek-ai/cordis';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import { API_VERSION, MessageSchema, ObservationSchema, conversationKey } from '@dafeiyu/contracts';
import type { ActionCapability, ActionContext, OperationScope, Extension, ExtensionHandle, Json, PendingMessage, PersonaSnapshot, Receipt, Reply } from '@dafeiyu/contracts';
import { Journal, eventFor } from '@dafeiyu/journal';
import { DshRuntime, DshRunError } from './runtime.js';
import type { BoundAction } from './runtime.js';

export const name = 'dafeiyu-core';
export const inject = ['agents', 'sessions', 'sessionPersistence', 'tools', 'systemPrompt'];
const ConfigSchema = z.strictObject({
  agentId: z.string().min(1).max(100), dataDir: z.string().min(1), personaFile: z.string().min(1),
  provider: z.string().min(1), model: z.string().min(1),
  reasoningEffort: z.string().min(1).optional(),
  turnTimeoutMs: z.number().int().min(50).max(3_600_000).default(600_000),
  deliveryTimeoutMs: z.number().int().min(50).max(60_000).default(15_000),
});
export type Config = z.input<typeof ConfigSchema>;
interface Registered { extension: Extension; controller: AbortController; active: boolean }
declare module '@deepseek-ai/cordis' { interface Context { dafeiyu: DafeiyuService } }

/** Owns a logical persona and its independent conversations; extensions own platform-specific work. */
export class DafeiyuService extends Service {
  readonly journal: Journal;
  private readonly config: z.output<typeof ConfigSchema>;
  private readonly runtime: DshRuntime;
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
    this.runtime = new DshRuntime(ctx, { provider: this.config.provider, model: this.config.model,
      ...(this.config.reasoningEffort ? { reasoningEffort: ReasoningEffortId(this.config.reasoningEffort) } : {}) }, resolve(this.config.dataDir));
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
    return eventFor(this.config.agentId, item, type, '@dafeiyu/core', '0.3.0', item.id, causedBy, data);
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
    }
    // Snapshot registration metadata so caller-side mutations cannot change a running capability.
    extension = { ...extension,
      channels: (extension.channels ?? []).map(channel => ({ channel: channel.channel, account: channel.account,
        ...(channel.description ? { description: channel.description } : {}),
        deliver: channel.deliver.bind(channel) })),
      actions: (extension.actions ?? []).map(action => ({ name: action.name, description: action.description,
        execute: action.execute.bind(action),
        fields: Object.fromEntries(Object.entries(action.fields).map(([key, field]) => [key, { ...field }])) })),
    };
    const registered: Registered = { extension, controller: new AbortController(), active: true };
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
      execute: async (raw: unknown, signal: AbortSignal): Promise<Json> => {
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
          const result = await definition.execute(args, actionContext);
          actionSignal.throwIfAborted();
          const validated = z.json().parse(result);
          this.journal.append(event('operation.succeeded', started.id));
          return validated;
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
