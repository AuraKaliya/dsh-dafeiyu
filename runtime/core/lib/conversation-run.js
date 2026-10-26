import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ConversationSchema } from '#dafeiyu/contracts';
import { eventFor } from '#dafeiyu/journal';
import { readPersistedResult } from './agent-session.js';
import { RuntimeStore, runtimeHash } from './runtime-store.js';
import { CORE_VERSION } from './version.js';
import { foundationManifest } from './persona-manifest.js';
const projectionSchema = z.strictObject({ inboundId: z.uuid(), startedEventId: z.uuid(), reply: z.strictObject({ id: z.string(), conversation: ConversationSchema, sourceMessageId: z.string(), text: z.string().min(1) }),
    sources: z.array(z.strictObject({ kind: z.enum(['message', 'session', 'event']), id: z.string(), seq: z.number().int().nonnegative().optional(), route: z.string().optional() })) });
const hash = (text) => createHash('sha256').update(text).digest('hex');
/** The journal owns delivery. The Run owns only the durable model execution and its projection. */
export class ConversationRuns {
    ctx;
    store;
    journal;
    agentId;
    validatePersona;
    constructor(ctx, store, journal, agentId, validatePersona = () => { }) {
        this.ctx = ctx;
        this.store = store;
        this.journal = journal;
        this.agentId = agentId;
        this.validatePersona = validatePersona;
    }
    begin(item, persona, model, registry, execution = { policyId: 'conversation-v2', authority: null, actions: [] }, preparePersona) {
        const request = this.store.prepareRequest('conversation', item.id, { kind: 'message', inboundId: item.id, messageHash: runtimeHash(item.message) });
        let run = this.store.acceptRun(request.id, { taskId: null, scope: { kind: 'conversation', agentId: this.agentId, route: item.route }, origin: { kind: 'message', inboundId: item.id, conversation: item.message.conversation }, intentVersion: 0, policyId: execution.policyId });
        if (run.state === 'accepted')
            run = this.store.transition(run.id, run.version, 'queued');
        if (run.state !== 'queued')
            throw new Error('RUN_INTERRUPTED');
        return this.store.start(run.id, run.version, { sessionId: item.sessionId, personaVersion: persona.version, model, registryVersion: runtimeHash({ legacy: registry, v3: execution.actions }), authorityVersion: runtimeHash({ extension: item.extensionId, route: item.route, policy: execution.authority }), inputs: [] }, preparePersona?.(run) ?? foundationManifest(run, persona, model));
    }
    complete(run, item, result, startedEventId) {
        if (!result.resultRef)
            throw new Error('PERSISTENCE_FAILED');
        const projection = projectionSchema.parse({ inboundId: item.id, startedEventId, reply: { id: `${item.id}:reply`, conversation: item.message.conversation, sourceMessageId: item.message.id, text: result.text }, sources: result.sources });
        this.store.completeWithProjection(run.id, this.store.get(run.id).version, result.resultRef, z.record(z.string(), z.json()).parse(projection));
    }
    fail(run) { const current = this.store.get(run.id); if (['queued', 'running', 'cancelling'].includes(current.state))
        this.store.transition(run.id, current.version, 'failed', 'MODEL_INCOMPLETE'); }
    async project() {
        for (const event of this.store.outbox()) {
            const run = this.store.get(event.runId);
            if (run.definition.origin.kind !== 'message')
                continue;
            if (event.type === 'conversation.result-ready') {
                const projection = projectionSchema.parse(event.data), item = this.journal.get(run.definition.origin.inboundId), ref = run.result;
                if (!ref || run.state !== 'completed' || projection.inboundId !== item.id || projection.reply.sourceMessageId !== item.message.id
                    || projection.reply.id !== `${item.id}:reply` || runtimeHash(projection.reply.conversation) !== runtimeHash(item.message.conversation)
                    || run.definition.scope.kind !== 'conversation' || run.definition.scope.route !== item.route || ref.sessionId !== item.sessionId || ref.textHash !== hash(projection.reply.text))
                    throw new Error('RESULT_BINDING_CONFLICT');
                if (item.state === 'processing') {
                    try {
                        this.validatePersona(run);
                    }
                    catch {
                        this.journal.transition(item.id, 'processing', 'failed', eventFor(this.agentId, item, 'delivery.blocked', 'core', CORE_VERSION, item.id, null, { runId: run.id, code: 'SOURCE_STALE' }));
                        this.store.acknowledgeEvent(event.id);
                        continue;
                    }
                    // Read persisted DSH facts, without creating an Agent or running a model.
                    await readPersistedResult(this.ctx, ref);
                    this.journal.transition(item.id, 'processing', 'reply-ready', { ...eventFor(this.agentId, item, 'turn.completed', 'core', CORE_VERSION, item.id, projection.startedEventId, { runId: run.id }),
                        sources: projection.sources.map(source => ({ kind: source.kind, id: source.id, ...(source.seq === undefined ? {} : { seq: source.seq }), ...(source.route === undefined ? {} : { route: source.route }) })) }, projection.reply);
                }
                else if (!['reply-ready', 'sending', 'delivered', 'uncertain'].includes(item.state))
                    throw new Error('RESULT_PROJECTION_CONFLICT');
            }
            else {
                const item = this.journal.get(run.definition.origin.inboundId), operation = typeof event.data.operationId === 'string' ? this.store.operation(event.data.operationId) : null;
                this.journal.appendOnce({ ...eventFor(this.agentId, item, event.type, operation?.plugin ?? 'core', operation?.pluginVersion ?? CORE_VERSION, operation?.id ?? run.id, operation && event.type !== 'operation.started' ? operation.startedEventId : null, { runId: run.id, ...event.data }), occurredAt: event.at }, event.id);
            }
            this.store.acknowledgeEvent(event.id);
        }
    }
    async recover() {
        await this.project();
        for (const run of this.store.list()) {
            if (run.definition.origin.kind !== 'message')
                continue;
            const item = this.journal.get(run.definition.origin.inboundId);
            if (item.state === 'processing' && run.state === 'failed')
                this.journal.transition(item.id, 'processing', 'failed', eventFor(this.agentId, item, 'turn.failed', 'core', CORE_VERSION, item.id, null, { runId: run.id, code: 'MODEL_INCOMPLETE' }));
            if (item.state === 'accepted' && ['running', 'interrupted', 'failed', 'cancelled', 'cancelling'].includes(run.state))
                this.journal.transition(item.id, 'accepted', 'uncertain', eventFor(this.agentId, item, 'recovery.uncertain', 'core', CORE_VERSION, item.id, null, { runId: run.id, code: 'RUN_INTERRUPTED' }));
        }
    }
}
