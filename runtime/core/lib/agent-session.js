import { SessionId } from '@deepseek-ai/dsh-session';
import { createHash } from 'node:crypto';
import { z } from 'zod';
const visibleFailure = z.object({ kind: z.literal('error'), error: z.object({ message: z.string() }) });
const contextFailures = { 'Required context exceeds budget': 'REQUIRED_CONTEXT_CAPACITY', 'Required context unavailable': 'REQUIRED_CONTEXT_UNAVAILABLE',
    'Required context contributor missing': 'REQUIRED_CONTEXT_PROVIDER_MISSING', 'Context request budget exceeded': 'CONTEXT_REQUEST_CAPACITY' };
export function safeRunFailure(message) {
    return contextFailures[message] ?? (['SOURCE_VALIDATION_FAILED', 'PERSISTENCE_FAILED', 'MODEL_INCOMPLETE', 'DELIVERY_RENDER_TIMEOUT',
        'CONTEXT_REQUEST_CAPACITY', 'MODEL_CONTEXT_CAPACITY', 'PERSONA_CONTEXT_CAPACITY', 'REQUIRED_CONTEXT_CAPACITY', 'REQUIRED_CONTEXT_UNAVAILABLE', 'REQUIRED_CONTEXT_PROVIDER_MISSING', 'NATIVE_CONTEXT_SNAPSHOT_MISMATCH', 'CONTEXT_PREPARE_TIMEOUT'].includes(message) ? message : 'MODEL_INCOMPLETE');
}
export function turnFailureCode(value) { const parsed = visibleFailure.safeParse(value); return parsed.success ? safeRunFailure(parsed.data.error.message) : 'MODEL_INCOMPLETE'; }
/** The two execution origins share DSH ownership, flush and final-message rules. */
export async function openAgentSession(ctx, id, model, cwd, setup) {
    const sessionId = SessionId(id);
    return await ctx.sessionPersistence.stat(sessionId)
        ? ctx.agents.resume({ resumeSessionId: sessionId, agentOptions: model, setup })
        : ctx.agents.create({ sessionId, meta: { cwd }, agentOptions: model, setup });
}
export async function runAgentTurn(ctx, agent, input, signal, afterIdle = () => { }, allowEmpty = () => false) {
    if (agent.status !== 'idle')
        throw new Error('SESSION_BUSY');
    signal.throwIfAborted();
    const before = agent.session.snapshotEvents().length;
    const abort = () => agent.cancel({ kind: 'hook', reason: 'Dafeiyu run cancelled' });
    signal.addEventListener('abort', abort, { once: true });
    try {
        agent.followup(input);
        await agent.whenIdle();
        afterIdle();
        if (!await ctx.sessions.flush(agent.session))
            throw new Error('PERSISTENCE_FAILED');
        signal.throwIfAborted();
        const events = agent.session.snapshotEvents().slice(before);
        const ended = events.findLast(event => event.type === 'turn/end');
        if (!ended || ended.type !== 'turn/end' || ended.data.reason.kind !== 'completed')
            throw new Error(ended?.type === 'turn/end' ? turnFailureCode(ended.data.reason) : 'MODEL_INCOMPLETE');
        const output = events.findLast(event => event.type === 'assistant/message' && !event.data.interrupted && event.data.turn === ended.data.turn);
        if (!output || output.type !== 'assistant/message')
            throw new Error('MODEL_INCOMPLETE');
        const text = output.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n').trim();
        if (!text && !allowEmpty())
            throw new Error('MODEL_INCOMPLETE');
        return { text, events, messageSeq: output.seq, turnEndSeq: ended.seq };
    }
    finally {
        signal.removeEventListener('abort', abort);
    }
}
export async function readPersistedResult(ctx, ref) {
    const reader = await ctx.sessionPersistence.open(SessionId(ref.sessionId), 'read');
    try {
        const { events } = await reader.read(ref.messageSeq, ref.turnEndSeq - ref.messageSeq + 1), message = events.find(event => event.seq === ref.messageSeq), end = events.find(event => event.seq === ref.turnEndSeq);
        if (message?.type !== 'assistant/message' || message.data.interrupted || end?.type !== 'turn/end' || end.data.reason.kind !== 'completed' || message.data.turn !== end.data.turn)
            throw new Error('RESULT_BINDING_CONFLICT');
        const text = message.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n').trim();
        if (createHash('sha256').update(text).digest('hex') !== ref.textHash)
            throw new Error('RESULT_BINDING_CONFLICT');
        return text;
    }
    finally {
        await reader.close();
    }
}
