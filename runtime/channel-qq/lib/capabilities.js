import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ConversationSchema, CapabilitySelectionSchema, PersonaSourceRefSchema, redactContent } from '#dafeiyu/contracts';
import { QqBrowseInputSchema, QqCacheProofSchema } from './cache.js';
export const QQ_ACTIONS = ['qq_groups', 'qq_browse', 'qq_observe_select'];
export const QqCapabilitiesConfigSchema = z.strictObject({ enabled: z.boolean().default(false),
    snapshotTtlMs: z.number().int().min(1000).max(3600000).default(3600000), maxSnapshots: z.number().int().min(1).max(1000).default(256) });
const browseSchema = QqBrowseInputSchema.extend({ target: ConversationSchema.optional() });
const selectSchema = CapabilitySelectionSchema.omit({ observationId: true, version: true }).extend({ snapshotId: z.uuid() });
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const qqResourceRoute = (scene) => JSON.stringify([scene.account, scene.kind, scene.id]);
/** A v3 capability extension, separate from the v2 transport. It never sends a QQ message. */
export class QqCapabilities {
    ctx;
    host;
    handle;
    observed = new Map();
    closed = false;
    constructor(ctx, host) {
        this.ctx = ctx;
        this.host = host;
        this.handle = ctx.dafeiyu.registerExtensionV3({ protocolVersion: 3, id: 'qq-capabilities', version: '1', agentId: host.agentId,
            requires: ['memory.capability-observation.v1', 'execution.resource-scope.v1'], provides: ['qq.browse.v1'], lifecycleReady: () => !this.closed,
            resourceProofs: { current: proof => this.current(proof), epoch: scope => this.epoch(scope) }, actions: this.actions() });
    }
    owner(context) { this.ctx.dafeiyu.executionAuthority(context, 'qq-capabilities'); return JSON.stringify([context.scope, context.intentVersion]); }
    assertAvailable() { if (this.closed || !this.host.available())
        throw new Error('CHANNEL_UNAVAILABLE'); }
    allowed(context, raw, cursor) {
        this.assertAvailable();
        let scene;
        if (raw !== undefined)
            scene = ConversationSchema.parse(raw);
        else if (cursor) {
            const snapshot = this.host.store.cache.snapshot(this.owner(context), cursor);
            const [account, kind, id] = z.tuple([z.string(), z.enum(['private', 'group']), z.string()]).parse(JSON.parse(snapshot.proof.route));
            scene = { channel: 'qq', account, kind, id };
        }
        else {
            const scenes = this.ctx.dafeiyu.capabilityResources(context, 'qq-capabilities').filter(scene => this.host.allowed(scene));
            if (scenes.length !== 1)
                throw new Error(scenes.length ? 'RESOURCE_TARGET_REQUIRED' : 'RESOURCE_SCOPE_DENIED');
            scene = scenes[0];
        }
        this.ctx.dafeiyu.authorizeCapabilityResource(context, 'qq-capabilities', scene);
        if (!this.host.allowed(scene))
            throw new Error('TARGET_NOT_ALLOWED');
        return scene;
    }
    current(proof) {
        if (this.closed || proof.provider !== 'qq-capabilities' || proof.version !== 1 || !this.host.allowed(proof.scene))
            return false;
        const parsed = QqCacheProofSchema.safeParse(proof.detail);
        return parsed.success && parsed.data.route === qqResourceRoute(proof.scene) && parsed.data.hash === proof.hash
            && proof.key === 'qq-cache:' + proof.hash && JSON.stringify(proof.roots) === JSON.stringify(this.roots(proof.scene, parsed.data.parts.map(part => part.id)))
            && this.host.store.cache.proofCurrent(parsed.data);
    }
    roots(scene, ids) { const prefix = `qq:${scene.account}:${scene.kind}:${scene.id}:`; return ids.length ? ids.map(id => prefix + 'message:' + id) : [prefix + 'empty-cache']; }
    epoch(scope) {
        if (this.closed)
            return 'closed';
        if (scope) {
            try {
                const parts = JSON.parse(scope.route);
                if (Array.isArray(parts) && parts.length === 5) {
                    const parsed = z.tuple([z.literal(this.host.agentId), z.literal('qq'), z.literal(this.host.botId), z.enum(['private', 'group']), z.string()]).safeParse(parts);
                    if (!parsed.success)
                        return '';
                    const scene = { channel: 'qq', account: parsed.data[2], kind: parsed.data[3], id: parsed.data[4] };
                    return digest([this.host.store.cache.generation(qqResourceRoute(scene)), this.host.allowed(scene)]);
                }
            }
            catch {
                return '';
            }
        }
        return digest([this.host.store.cache.generation(), this.host.groups.status().state, this.host.groups.effective(), this.closed]);
    }
    groups(context) {
        this.owner(context);
        this.assertAvailable();
        const sync = this.host.groups.status();
        const resources = this.ctx.dafeiyu.capabilityResources(context, 'qq-capabilities').filter(scene => this.host.allowed(scene)).map(scene => ({ scene,
            name: scene.kind === 'private' ? '主人私聊' : this.host.groups.info(scene.id)?.name ? redactContent(this.host.groups.info(scene.id).name).value : null,
            membership: sync.enabled ? 'last-confirmed-snapshot' : 'configured', synchronizedAt: sync.lastSuccessAt }));
        return { resources, sync: { state: sync.state, mode: sync.mode, lastSuccessAt: sync.lastSuccessAt }, coverage: '仅当前核心授权与本账号允许范围的交集；不是全部QQ群。' };
    }
    browse(context, raw) {
        const input = browseSchema.parse(raw), owner = this.owner(context), scene = this.allowed(context, input.target, input.cursor);
        const snapshot = this.host.store.cache.browse(qqResourceRoute(scene), owner, { requestId: digest([context.runId, input.requestId]), limit: input.limit, ...(input.cursor ? { cursor: input.cursor } : {}) });
        for (const [id, saved] of this.observed)
            try {
                this.host.store.cache.snapshot(saved.owner, id);
            }
            catch {
                this.observed.delete(id);
            }
        const proof = { provider: 'qq-capabilities', scene, key: 'qq-cache:' + snapshot.proof.hash, version: 1, hash: snapshot.proof.hash,
            roots: this.roots(scene, snapshot.proof.parts.map(part => part.id)), detail: snapshot.proof };
        const observation = this.ctx.dafeiyu.recordCapabilityObservation(context, 'qq-capabilities', { requestId: 'page:' + snapshot.id, proof, text: JSON.stringify(snapshot.page), occurredAt: snapshot.createdAt,
            coverage: ['本账号实际接收／发送的本地缓存', '仅页面messages及range范围', '媒体内容未读取；离线缺口未知'], counts: { received: snapshot.page.messages.length, processed: snapshot.page.messages.length } });
        this.observed.set(snapshot.id, { owner, source: observation.source, scene });
        return { target: scene, snapshotId: snapshot.id, expiresAt: snapshot.expiresAt, page: snapshot.page, pageLimit: input.limit, nextCursor: snapshot.next ? snapshot.id : null, observation,
            retention: '短期页面不等于长期记忆；旧未绑定账号缓存不自动混入。' };
    }
    select(context, raw) {
        const input = selectSchema.parse(raw), owner = this.owner(context);
        this.assertAvailable();
        const snapshot = this.host.store.cache.snapshot(owner, input.snapshotId), observation = this.observed.get(input.snapshotId);
        if (!observation || observation.owner !== owner)
            throw new Error('SNAPSHOT_UNAVAILABLE');
        const scene = this.allowed(context, observation.scene), { snapshotId: _snapshotId, ...choice } = input;
        return this.ctx.dafeiyu.selectCapabilityObservation(context, 'qq-capabilities', scene, { ...choice, observationId: observation.source.id, version: observation.source.version }, JSON.stringify(snapshot.page));
    }
    actions() {
        const make = (id, description, schema, effects, work) => ({ id, description, version: '1', inputSchema: schema, outputSchema: z.json(), effects,
            execute: async (input, context) => {
                try {
                    const data = z.json().parse(work(context, input)), source = id === 'qq_browse' ? z.object({ observation: z.object({ source: PersonaSourceRefSchema }) }).parse(data).observation.source : null;
                    return { status: 'succeeded', effects: effects === 'read' ? 'none' : 'confirmed', completeness: id === 'qq_browse' ? 'partial' : 'complete', data,
                        sources: source ? [{ id: source.id, scopeKey: source.scopeKey, version: source.version, contentHash: source.contentHash }] : [], receipts: [] };
                }
                catch (error) {
                    const code = error instanceof z.ZodError ? 'INVALID_INPUT' : error instanceof Error ? error.message : '';
                    if (!['INVALID_INPUT', 'CHANNEL_UNAVAILABLE', 'RESOURCE_TARGET_REQUIRED', 'RESOURCE_SCOPE_DENIED', 'TARGET_NOT_ALLOWED', 'SCOPE_DENIED', 'SNAPSHOT_UNAVAILABLE', 'SOURCE_STALE', 'CURSOR_STALE', 'IDEMPOTENCY_CONFLICT', 'SNAPSHOT_CAPACITY_EXCEEDED', 'PAGE_BUDGET_EXCEEDED', 'OBSERVATION_NOT_EXPOSED', 'HISTORY_UNTRACKED', 'SOURCE_SUPPRESSED', 'EMPTY_OBSERVATION', 'PRIVATE_INPUT_REJECTED', 'CAPACITY_EXCEEDED', 'DEPENDENCY_UNAVAILABLE'].includes(code))
                        throw error;
                    return { status: 'failed', effects: 'none', completeness: 'unknown', data: null, sources: [], receipts: [], errorCode: code };
                }
            } });
        return [make('qq_groups', '列出当前授权的QQ会话与群同步覆盖；私聊不会自动获得其它群的读取资格。', z.strictObject({}), 'read', context => this.groups(context)),
            make('qq_browse', '读取本账号实际收到的文字缓存，最多20条／页。不会补齐离线历史或理解媒体。target省略时仅在范围唯一或有cursor时自动确定；继续分页保持limit不变。requestId为ASCII幂等标识。', browseSchema, 'read', (context, input) => this.browse(context, input)),
            make('qq_observe_select', '对实际浏览且仍有效的snapshotId选择none、原文original、Unicode片段fragment或推断summary。摘要继承全部实际输入限制；这不会修改人格或对外发送。', selectSchema, 'local-write', (context, input) => this.select(context, input))];
    }
    close() { if (this.closed)
        return; this.closed = true; this.observed.clear(); this.handle.dispose(); }
}
