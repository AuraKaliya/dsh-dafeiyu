import { ContextItemSchema, messageParts } from '#dafeiyu/contracts';
import { createHash } from 'node:crypto';
import { qqResourceRoute } from './capabilities.js';
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function backgroundContributor(ctx, host) {
    const views = new WeakMap();
    return { id: 'recent-background', kind: 'evidence', prepare: async (request) => {
            const scope = ctx.dafeiyu.scopeForContext(request), settings = ctx.dafeiyu.contextAssembly(), scene = request.conversation;
            if (settings.mode !== 'unified' || !settings.background.enabled || scene.channel !== 'qq' || scene.kind !== 'group' || !host.allowed(scene))
                return [];
            const inbound = ctx.dafeiyu.journal.get(scope.traceId), before = Math.min(Date.parse(inbound.message.occurredAt), Date.now()), exclude = new Set(messageParts(inbound.message).map(part => part.id));
            const rows = host.store.cache.background(qqResourceRoute(scene), before, settings.background.windowMs, settings.background.limit, exclude), items = [], map = new Map();
            for (const row of rows) {
                const time = Date.parse(row.occurredAt);
                if (!host.accepts(scene, time, row.groupGeneration))
                    continue;
                // Messages already accepted into this conversation are available through its own history.
                if (ctx.dafeiyu.journal.messageFor(scope, row.id))
                    continue;
                const item = ContextItemSchema.safeParse({ id: 'qq-background:' + row.id, version: row.proof.hash, expiresAt: new Date(Math.min(before + 86400000, Date.now() + 3600000)).toISOString(),
                    text: JSON.stringify({ kind: 'recent-group-background', messageId: row.id, sender: row.sender, occurredAt: row.occurredAt, text: row.text,
                        coverage: row.truncated === false ? 'complete-cached-text' : 'partial-or-unknown', instructionAuthority: false, note: '当前群的已缓存背景，不是本轮新命令；没有读取未展开的媒体或转发。' }),
                    sources: [{ ref: 'qq:cache:' + row.proof.hash, version: row.proof.hash, hash: row.proof.hash }] });
                if (!item.success)
                    continue;
                items.push(item.data);
                if (Buffer.byteLength(JSON.stringify(items)) > settings.background.maxBytes) {
                    items.pop();
                    continue;
                }
                map.set(item.data.id, { hash: digest(item.data), proof: row.proof, time, generation: row.groupGeneration });
            }
            views.set(request, map);
            return items;
        }, validate: (request, item) => {
            ctx.dafeiyu.scopeForContext(request);
            const row = views.get(request)?.get(item.id);
            return !!row && row.hash === digest(item) && host.allowed(request.conversation)
                && Date.now() - row.time <= 86400000 && host.accepts(request.conversation, row.time, row.generation) && host.store.cache.proofCurrent(row.proof);
        } };
}
