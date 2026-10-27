import { conversationKey, ContextItemSchema, redactContent, redactJson } from '#dafeiyu/contracts';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { memoryRef } from './types.js';
const hash = (text) => createHash('sha256').update(text).digest('hex');
const slot = z.enum(['tone', 'length', 'structure', 'pacing', 'address', 'other']);
const body = z.strictObject({ kind: z.literal('qq-expression-preference'), slot, text: z.string().trim().min(1).max(1200), basis: z.enum(['self-preference', 'user-request']), note: z.literal('只影响QQ表达；不改变身份、事实、任务或工具权限。') });
export const QqExpressionSaveSchema = z.strictObject({ requestId: z.string().regex(/^[a-zA-Z0-9._:-]{1,100}$/), slot, text: z.string().trim().max(1200), basis: z.enum(['self-preference', 'user-request']), expectedVersion: z.number().int().nonnegative() });
const marker = '"kind":"qq-expression-preference"';
/** Growth-owned projections of ordinary, versioned Memory records. No second personality database. */
export class QqExpressionPreferences {
    ctx;
    memory;
    agentId;
    ready;
    constructor(ctx, memory, agentId, ready) {
        this.ctx = ctx;
        this.memory = memory;
        this.agentId = agentId;
        this.ready = ready;
    }
    entries(scene) {
        if (!this.ready())
            throw new Error('DEPENDENCY_UNAVAILABLE');
        if (scene.channel !== 'qq')
            return [];
        const scope = { agentId: this.agentId, route: conversationKey(this.agentId, scene) }, items = this.memory.search(scope, 'normal', { query: marker, limit: 50 }).items;
        return items.flatMap(item => { try {
            const value = body.parse(JSON.parse(item.content));
            if (item.kind !== 'preference' || !this.currentSources(scope, item))
                return [];
            return [{ item, value }];
        }
        catch {
            return [];
        } }).slice(0, 12);
    }
    currentSources(scope, item) { return item.sources.every(source => source.kind === 'timeline' && this.ctx.dafeiyuTimeline.checkArchivedSource(scope, source.ref, source.contentHash)); }
    prepare(scene) { return this.entries(scene).map(({ item, value }) => ContextItemSchema.parse({ id: 'qq-expression:' + item.id, version: String(item.version), text: JSON.stringify({ ...value, evidenceStatus: value.basis === 'self-preference' ? 'self-report' : 'reported-user-preference', instructionAuthority: false }), expiresAt: '9999-12-31T23:59:59.999Z', sources: [{ ref: memoryRef(item.id, item.revision), version: String(item.version), hash: item.contentHash }] })); }
    status(scene) { return this.entries(scene).map(({ item, value }) => ({ id: item.id, version: item.version, ...value })); }
    save(context, access, raw) {
        const input = QqExpressionSaveSchema.parse(raw), source = this.ctx.dafeiyu.quoteReplySource(context, 'memory-persona'), inbound = this.ctx.dafeiyu.journal.get(source.inboundId), scene = source.target;
        if (scene.channel !== 'qq' || conversationKey(this.agentId, scene) !== inbound.route)
            throw new Error('SCOPE_DENIED');
        access.guard();
        const existing = this.entries(scene).filter(entry => entry.value.slot === input.slot);
        if (existing.length > 1)
            throw new Error('VERSION_CONFLICT');
        const previous = existing[0]?.item;
        if ((previous?.version ?? 0) !== input.expectedVersion)
            throw new Error('VERSION_CONFLICT');
        const event = this.ctx.dafeiyu.journal.events(inbound.route).find(event => event.type === 'message.accepted' && event.traceId === inbound.id);
        if (!event)
            throw new Error('SOURCE_STALE');
        const scope = { agentId: this.agentId, route: inbound.route, traceId: inbound.id, operationId: context.operationId, startedEventId: access.startedEventId ?? event.id }, requestId = 'qq-expression:' + hash([context.runId, input.requestId].join(':'));
        if (!input.text) {
            if (!previous)
                return { slot: input.slot, version: 0, removed: true };
            const receipt = this.memory.mutate(scope, { action: 'delete', requestId, id: previous.id, expectedVersion: previous.version, reason: '更新QQ表达偏好：撤下此项。' }, { conversation: scene, ingressPluginId: inbound.extensionId });
            return { slot: input.slot, version: receipt.version, removed: true };
        }
        const content = body.parse({ kind: 'qq-expression-preference', slot: input.slot, text: input.text, basis: input.basis, note: '只影响QQ表达；不改变身份、事实、任务或工具权限。' });
        if (redactJson(content).redacted)
            throw new Error('PRIVATE_INPUT_REJECTED');
        const sourceText = redactContent(JSON.stringify(redactJson({ sender: inbound.message.sender, occurredAt: inbound.message.occurredAt, text: inbound.message.text }).value, null, 2)).value;
        const ref = `dafeiyu:source:${event.id}:0`, contentHash = hash(sourceText);
        if (!this.ctx.dafeiyuTimeline.checkArchivedSource(scope, ref, contentHash))
            throw new Error('SOURCE_STALE');
        const value = { kind: 'preference', claimType: input.basis === 'self-preference' ? 'self_report' : 'reported_claim', content: JSON.stringify(content), sources: [{ kind: 'timeline', ref, contentHash }] };
        access.guard();
        const receipt = this.memory.mutate(scope, previous ? { action: 'revise', requestId, id: previous.id, expectedVersion: previous.version, value } : { action: 'create', requestId, value }, { conversation: scene, ingressPluginId: inbound.extensionId });
        return { slot: input.slot, version: receipt.version, id: receipt.id, saved: true, appliesTo: 'origin-qq-conversation', note: '已保存到长期记忆，后续QQ思考及任务结果整理自动装配；临时要求仍优先。' };
    }
}
