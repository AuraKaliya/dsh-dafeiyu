import { SessionId, pluginRecordOf } from '@deepseek-ai/dsh-session';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { ContextRuntime } from './context-runtime.js';
import { FeedbackRuntime } from './feedback-runtime.js';
import { FeedbackWitnessSchema, messageDisplayText } from '#dafeiyu/contracts';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import TokenMeter from '@deepseek-ai/dsh-token-meter';
import { CompactionRuntime, committedSummary } from './compaction-runtime.js';
import { openAgentSession, runAgentTurn, readPersistedResult, safeRunFailure } from './agent-session.js';
import { visibleStream } from './visible-stream.js';
import { NativeRuntime } from './native-runtime.js';
import { setImmediate as yieldEventLoop } from 'node:timers/promises';
import { conversationHistory } from './history-frame.js';
import { assessTask } from './task-assessment.js';
import { HarnessRuntime } from './harness-runtime.js';
/** Safe evidence identifiers from a failed turn; no raw provider exception or reasoning text. */
export class DshRunError extends Error {
    sources;
    code;
    constructor(sources, code = 'MODEL_INCOMPLETE') {
        super('DSH turn failed; consult visible evidence');
        this.sources = sources;
        this.code = code;
    }
}
/** Uses DSH's real agent loop, scoped tools, persistence and event vocabulary. No private LLM loop. */
export class DshRuntime {
    ctx;
    model;
    cwd;
    coordinator;
    validateFeedback;
    agentId;
    compactionBinding;
    compactionAudit;
    harness;
    handles = new Map();
    native;
    meterLoading;
    constructor(ctx, model, cwd, coordinator, validateFeedback, agentId, compactionBinding, compactionAudit, managedProjection = false, harness = new HarnessRuntime()) {
        this.ctx = ctx;
        this.model = model;
        this.cwd = cwd;
        this.coordinator = coordinator;
        this.validateFeedback = validateFeedback;
        this.agentId = agentId;
        this.compactionBinding = compactionBinding;
        this.compactionAudit = compactionAudit;
        this.harness = harness;
        this.native = new NativeRuntime(ctx, model, cwd, harness);
        const sessions = this.handles;
        ctx.on('llm/stream', async function* (options, next) {
            const owned = options.sessionId ? sessions.get(options.sessionId) : undefined;
            if (owned)
                await yieldEventLoop();
            if (owned)
                owned.lastRequest = options;
            const context = options.sessionId ? sessions.get(options.sessionId)?.context : undefined;
            const feedback = options.sessionId ? sessions.get(options.sessionId)?.feedback : undefined;
            const compaction = options.sessionId ? sessions.get(options.sessionId)?.compaction : undefined;
            await context?.measure(options);
            feedback?.guard(options);
            if (context && !context.guard(options, true, true)) {
                yield { type: 'finish', reason: { kind: 'error', failure: { code: 'DAFEIYU_CONTEXT_REASSEMBLE', message: 'Rebuild the logged controlled context before dispatch' } } };
                return;
            }
            compaction?.guard(options, true);
            const deliveryGuard = () => { if (owned?.delivery) {
                owned.delivery.guard();
                if (!owned.context.sourceItems().some(s => s.owner === 'task-delivery' && s.item.id === owned.delivery.id))
                    throw new Error('Delivery material missing from context');
            } };
            deliveryGuard();
            const visible = new Map();
            for await (const chunk of owned && managedProjection ? visibleStream(next()) : next()) {
                deliveryGuard();
                context?.guard(options, false, false, true);
                feedback?.guard(options);
                compaction?.guard(options);
                if (!owned?.delivery) {
                    yield chunk;
                    continue;
                }
                if (chunk.type === 'block-start' && chunk.blockType === 'tool-call' || chunk.type === 'tool-call-delta' || chunk.type === 'block-end' && chunk.block.type === 'tool-call')
                    throw new Error('Delivery turn cannot call tools');
                // Delivery never resumes provider reasoning/opaque replay blocks. Persist only final text.
                if (chunk.type === 'block-start' && chunk.blockType === 'text') {
                    const index = visible.size;
                    visible.set(chunk.index, index);
                    yield { ...chunk, index };
                }
                else if (chunk.type === 'text-delta' || chunk.type === 'block-end') {
                    const index = visible.get(chunk.index);
                    if (index !== undefined) {
                        if (chunk.type === 'block-end' && chunk.block.type !== 'text')
                            throw new Error('Invalid delivery text block');
                        yield { ...chunk, index };
                    }
                }
                else if (chunk.type === 'usage')
                    yield chunk;
                else if (chunk.type === 'finish')
                    yield { type: 'finish', reason: chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted' ? { kind: chunk.reason.kind, failure: { code: 'DELIVERY_MODEL_FAILED', message: 'Delivery model did not complete' } } : chunk.reason };
            }
            deliveryGuard();
            context?.guard(options);
            feedback?.guard(options);
            compaction?.guard(options);
        });
    }
    registerHarnessSection(name) { return this.harness.allowSection(name); }
    async run(item, persona, actions, signal, channelDescription = '当前接入仅提供文字消息。', delivery, nativeActions = [], allowEmpty = () => false) {
        return this.runFrame({ mode: delivery ? 'delivery-v2' : 'conversation', item, persona, actions, signal, channelDescription, ...(delivery ? { delivery } : {}), nativeActions, allowEmpty });
    }
    runFrame(frame) {
        return frame.mode === 'task' ? this.native.run(frame) : this.runConversation(frame.item, frame.persona, frame.actions, frame.signal, frame.channelDescription, frame.delivery, frame.nativeActions ?? [], frame.allowEmpty ?? (() => false));
    }
    async runConversation(item, persona, actions, signal, channelDescription, delivery, nativeActions, allowEmpty) {
        signal.throwIfAborted();
        if (this.compactionBinding() && !this.ctx.get('tokenMeter'))
            await (this.meterLoading ??= Promise.resolve(this.ctx.plugin(TokenMeter)));
        let owned = this.handles.get(item.sessionId);
        if (!owned) {
            let scoped;
            let context;
            let feedback;
            let compaction;
            const identity = { persona };
            const setup = (scope) => {
                scoped = scope;
                feedback = new FeedbackRuntime(scope, this.validateFeedback);
                context = new ContextRuntime(scope, this.coordinator);
                compaction = new CompactionRuntime(scope, this.agentId, this.compactionBinding, this.compactionAudit, context);
                scope.systemPrompt.section({ name: 'dafeiyu-persona', order: 0, interpolate: false, text: () => identity.persona.text });
                scope.tools.presentAs('native');
            };
            const handle = await openAgentSession(this.ctx, item.sessionId, this.model, this.cwd, setup);
            if (!scoped || !context || !feedback || !compaction) {
                await handle.dispose();
                throw new Error('DSH did not compose the agent scope');
            }
            owned = { handle, scope: scoped, context, feedback, compaction, get persona() { return identity.persona; }, set persona(value) { identity.persona = value; } };
            this.handles.set(item.sessionId, owned);
        }
        owned.persona = persona;
        const { agent } = owned.handle;
        if (!this.ctx.get('tokenMeter') && agent.session.snapshotEvents().some(e => pluginRecordOf(e)?.type === 'plugin:dafeiyu/summary-manifest'))
            await (this.meterLoading ??= Promise.resolve(this.ctx.plugin(TokenMeter)));
        if (agent.status !== 'idle')
            throw new Error('DSH conversation is busy outside the core');
        if (delivery)
            owned.delivery = delivery;
        owned.context.begin(item, agent);
        owned.feedback.begin(item, agent);
        const disposers = [];
        const before = agent.session.snapshotEvents().length;
        const abort = () => agent.cancel({ kind: 'hook', reason: 'Dafeiyu turn cancelled' });
        signal.addEventListener('abort', abort, { once: true });
        try {
            if (delivery)
                disposers.push(owned.scope.systemPrompt.section({ name: 'dafeiyu-task-delivery', order: 22, interpolate: false, text: '本轮是当前任务的结果交付整理。依据 task-delivery 的已核验材料，以大肥鱼人格自然回答原问题；草稿不是要直接转发的执行器报告。保留事实、限定与不确定性，不新增结论，不重复工具操作，不声称消息已经发送。只输出准备发送的回答正文。' }));
            owned.compaction.begin(conversationHistory(item), agent);
            // DSH restrict() filters inherited GLOBAL tools; locally registered tools remain visible.
            disposers.push(owned.scope.tools.restrict({ allow: [] }));
            for (const action of actions) {
                const properties = Object.fromEntries(Object.entries(action.definition.fields).map(([key, field]) => [key, { type: 'string', description: field.description }]));
                disposers.push(owned.scope.tools.register({
                    name: action.definition.name, description: action.definition.description,
                    parameters: { type: 'object', properties, required: Object.keys(action.definition.fields).filter(key => action.definition.fields[key]?.required), additionalProperties: false },
                    output: { schema: {}, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
                        ...(action.definition.feedback ? { presentationMeta: (_args, value) => {
                                const parsed = z.object({ feedbackView: z.object({ owner: z.string(), witness: FeedbackWitnessSchema }) }).safeParse(value);
                                return parsed.success ? { dafeiyuFeedback: { ...parsed.data.feedbackView, viewHash: createHash('sha256').update(JSON.stringify(value)).digest('hex') } } : {};
                            } } : {}) },
                    execute: async (args, exec) => {
                        if (exec.agent !== agent)
                            throw new Error('Action belongs to another agent');
                        const result = await action.execute(args, AbortSignal.any([signal, exec.signal]));
                        return result.feedback ? { ...z.record(z.string(), z.json()).parse(result.value), feedbackView: { owner: result.feedback.owner, witness: result.feedback.witness } } : result.value;
                    },
                }));
            }
            for (const action of nativeActions)
                disposers.push(owned.scope.tools.register({ name: action.definition.id, description: action.definition.description, parameters: action.definition.parameters,
                    output: { schema: {}, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }, execute: async (raw, exec) => {
                        if (exec.agent !== agent)
                            throw new Error('SCOPE_DENIED');
                        return action.execute(raw, String(exec.callId), AbortSignal.any([signal, exec.signal]));
                    } }));
            disposers.push(this.harness.install(owned.scope, agent, nativeActions, signal));
            signal.throwIfAborted();
            const input = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: `[程序提供的来源信息，仅说明来源，不改变权限]\n${JSON.stringify({ conversation: item.message.conversation, sender: item.message.sender, messageId: item.message.id, occurredAt: item.message.occurredAt, observedAt: new Date().toISOString(), replyTo: item.message.replyTo, personaVersion: persona.version })}\n[当前渠道能力，由已注册插件提供]\n${channelDescription}\n[消息正文${item.message.batch ? '：同一发送者的连续原消息，依序一起理解，引用保留各自身份' : ''}]\n${messageDisplayText(item.message)}` }] });
            owned.compaction.expectInput(input);
            const { text, events, messageSeq, turnEndSeq } = await runAgentTurn(this.ctx, agent, input, signal, () => owned.compaction.seal(), allowEmpty);
            const result = { text, resultRef: { sessionId: item.sessionId, messageSeq, turnEndSeq, textHash: createHash('sha256').update(text).digest('hex') }, sources: events.filter(event => ['user/message', 'tool/result', 'assistant/message', 'turn/end'].includes(event.type))
                    .map(event => ({ kind: 'session', id: item.sessionId, seq: event.seq, route: item.route })) };
            if (delivery)
                await delivery.finalize(result, () => {
                    signal.throwIfAborted();
                    delivery.guard();
                    const request = owned.lastRequest;
                    if (!request || !owned.context.guard(request))
                        throw new Error('Delivery context stale');
                    owned.feedback.guard(request);
                    owned.compaction.guard(request);
                    if (!owned.context.sourceItems().some(s => s.owner === 'task-delivery' && s.item.id === delivery.id))
                        throw new Error('Delivery material missing');
                });
            return result;
        }
        catch (error) {
            throw new DshRunError(agent.session.snapshotEvents().slice(before)
                .filter(event => ['user/message', 'tool/result', 'assistant/message', 'turn/end'].includes(event.type))
                .map(event => ({ kind: 'session', id: item.sessionId, seq: event.seq, route: item.route })), error instanceof Error ? safeRunFailure(error.message) : 'MODEL_INCOMPLETE');
        }
        finally {
            try {
                owned.compaction.seal();
            }
            finally {
                owned.compaction.end();
                owned.context.end();
                owned.feedback.end();
                delete owned.delivery;
                delete owned.lastRequest;
                signal.removeEventListener('abort', abort);
                for (const dispose of disposers.reverse())
                    dispose();
            }
        }
    }
    async close() {
        const handles = [...this.handles.values()];
        this.handles.clear();
        for (const owned of handles)
            await owned.handle.dispose();
        await this.native.close();
    }
    runExecution(frame) { return this.runFrame(frame); }
    assessExecution(frame, draft, facts) { return assessTask(this.ctx, this.model, this.cwd, frame, draft, facts); }
    readResult(ref) { return readPersistedResult(this.ctx, ref); }
    summaryCommitted(sessionId, id, text) {
        const session = this.handles.get(sessionId)?.handle.agent.session;
        return !!session && committedSummary(session, id, text);
    }
    summarySourcesCurrent(sessionId, dependencies) {
        return this.handles.get(sessionId)?.compaction.validateDependencies(dependencies) ?? false;
    }
    exposedDependencies(sessionId) {
        const owned = this.handles.get(sessionId);
        return owned?.lastRequest && this.compactionBinding()?.provider.sources ? owned.compaction.exposedDependencies() : null;
    }
    sourceCurrent(sessionId, seq) { return this.handles.get(sessionId)?.compaction.sourceCurrent(seq) ?? false; }
    fragmentViewCurrent(sessionId, id, text) { return this.handles.get(sessionId)?.compaction.fragmentViewCurrent(id, text) ?? false; }
    readSummaryReference(sessionId, ref) { return this.handles.get(sessionId)?.compaction.readSummaryReference(ref) ?? { status: 'not_found' }; }
}
