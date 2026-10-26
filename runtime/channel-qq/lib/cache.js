import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { redactContent, MediaAttachmentSchema } from '#dafeiyu/contracts';
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const key = z.string().min(1).max(120), routeSchema = z.string().min(1).max(2000);
const metadataSchema = z.strictObject({ occurredAt: z.iso.datetime().nullable(), unsupported: z.array(z.string().max(80)).max(16), truncated: z.boolean().nullable(), known: z.boolean(), media: z.array(MediaAttachmentSchema).max(8).optional() });
const refSchema = z.strictObject({ id: z.string().min(1).max(80), version: z.number().int().positive(), hash: z.string().length(64) });
export const QqCacheProofSchema = z.strictObject({ route: routeSchema, parts: z.array(refSchema).max(20), hash: z.string().length(64) });
const itemSchema = z.strictObject({ id: z.string(), sender: z.string(), receivedSequence: z.number().int().positive(), text: z.string(),
    occurredAt: z.iso.datetime().nullable(), unsupported: z.array(z.string()), legacyMetadata: z.boolean(), cacheTextTruncated: z.boolean().nullable(),
    media: z.array(MediaAttachmentSchema).max(8).optional(),
    range: z.strictObject({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), total: z.number().int().nonnegative() }) });
const pageSchema = z.strictObject({ order: z.literal('received-newest-first'), watermark: z.number().int().nonnegative(), oldestCachedSequence: z.number().int().nonnegative(),
    messages: z.array(itemSchema).max(20), limitations: z.array(z.string()) });
const querySchema = z.strictObject({ watermark: z.number().int().nonnegative(), sequence: z.number().int().nonnegative(), offset: z.number().int().nonnegative(), epoch: z.number().int().nonnegative(), limit: z.number().int().min(1).max(20) });
const snapshotSchema = z.strictObject({ page: pageSchema, proof: QqCacheProofSchema, next: querySchema.nullable(), createdAt: z.iso.datetime() });
export const QqBrowseInputSchema = z.strictObject({ requestId: key, limit: z.number().int().min(1).max(20).default(20), cursor: z.uuid().optional() });
const rowSchema = z.object({ seq: z.number().int().safe(), id: z.string(), sender: z.string(), text: z.string() });
/** Actual received text, bounded short-lived views, and durable version facts; no model or long-term memory decisions. */
export class QqCache {
    db;
    instance = randomUUID();
    now;
    ttl;
    max;
    constructor(db, options = {}) {
        this.db = db;
        this.now = options.clock ?? Date.now;
        this.ttl = options.snapshotTtlMs ?? 3600000;
        this.max = options.maxSnapshots ?? 256;
    }
    atomic(work) { this.db.exec('BEGIN IMMEDIATE'); try {
        const value = work();
        this.db.exec('COMMIT');
        return value;
    }
    catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
    } }
    epoch(route) { return Number(this.db.prepare('SELECT epoch FROM qq_cache_state WHERE route=?').get(route)?.epoch ?? 0); }
    generation(route) { return route ? this.epoch(route) : Number(this.db.prepare('SELECT coalesce(sum(epoch),0) AS n FROM qq_cache_state').get()?.n); }
    known(route, id) { return !!this.db.prepare('SELECT 1 FROM qq_message_meta WHERE route=? AND id=?').get(route, id) || !!this.db.prepare('SELECT 1 FROM messages WHERE route=? AND id=?').get(route, id); }
    recalled(route, id) { return this.db.prepare('SELECT deleted FROM qq_message_meta WHERE route=? AND id=?').get(route, id)?.deleted === 1; }
    bump(route) { this.db.prepare('INSERT INTO qq_cache_state VALUES(?,1) ON CONFLICT(route) DO UPDATE SET epoch=epoch+1').run(route); }
    meta(route, row) {
        const existing = this.db.prepare('SELECT version,hash,body,deleted FROM qq_message_meta WHERE route=? AND id=?').get(route, row.id);
        if (existing)
            return { ...metadataSchema.parse(JSON.parse(String(existing.body))), version: Number(existing.version), hash: String(existing.hash), deleted: existing.deleted === 1 };
        const body = metadataSchema.parse({ occurredAt: null, unsupported: [], truncated: null, known: false }), hash = digest({ sender: row.sender, text: row.text, ...body });
        this.db.prepare('INSERT INTO qq_message_meta VALUES(?,?,1,?,0,?)').run(route, row.id, hash, JSON.stringify(body));
        return { ...body, version: 1, hash, deleted: false };
    }
    remember(route, id, sender, raw, metadata) {
        routeSchema.parse(route);
        z.string().min(1).max(80).parse(id);
        const sanitized = redactContent(raw).value;
        let text = sanitized.slice(0, 32000);
        if (/[\uD800-\uDBFF]$/.test(text))
            text = text.slice(0, -1);
        const body = metadataSchema.parse({ occurredAt: metadata?.occurredAt ?? null, unsupported: [...new Set(metadata?.unsupported ?? [])].slice(0, 16).map(kind => redactContent(kind).value.slice(0, 80)), truncated: sanitized.length > text.length, known: metadata !== undefined, ...(metadata?.media ? { media: metadata.media } : {}) });
        const hash = digest({ sender, text, ...body });
        return this.atomic(() => {
            const old = this.db.prepare('SELECT version,hash,deleted FROM qq_message_meta WHERE route=? AND id=?').get(route, id);
            if (old?.deleted === 1)
                return false;
            const cached = this.db.prepare('SELECT seq,id,sender,text FROM messages WHERE route=? AND id=?').get(route, id);
            if (!old && cached)
                this.meta(route, rowSchema.parse(cached));
            const previous = this.db.prepare('SELECT version,hash FROM qq_message_meta WHERE route=? AND id=?').get(route, id);
            if (previous?.hash === hash)
                return true;
            const version = Number(previous?.version ?? 0) + 1;
            this.db.prepare('INSERT INTO messages(route,id,sender,text) VALUES(?,?,?,?) ON CONFLICT(route,id) DO UPDATE SET sender=excluded.sender,text=excluded.text').run(route, id, sender, text);
            this.db.prepare('INSERT INTO qq_message_meta VALUES(?,?,?,?,0,?) ON CONFLICT(route,id) DO UPDATE SET version=excluded.version,hash=excluded.hash,body=excluded.body').run(route, id, version, hash, JSON.stringify(body));
            if (previous)
                this.bump(route);
            const removed = this.db.prepare('DELETE FROM messages WHERE route=? AND seq NOT IN(SELECT seq FROM messages WHERE route=? ORDER BY seq DESC LIMIT 200)').run(route, route);
            if (removed.changes)
                this.bump(route);
            return true;
        });
    }
    revoke(route, id) {
        routeSchema.parse(route);
        z.string().min(1).max(80).parse(id);
        return this.atomic(() => {
            const cached = this.db.prepare('SELECT seq,id,sender,text FROM messages WHERE route=? AND id=?').get(route, id);
            if (cached)
                this.meta(route, rowSchema.parse(cached));
            const old = this.db.prepare('SELECT deleted FROM qq_message_meta WHERE route=? AND id=?').get(route, id);
            if (old?.deleted === 1)
                return false;
            this.db.prepare('INSERT INTO qq_message_meta VALUES(?,?,1,?,1,?) ON CONFLICT(route,id) DO UPDATE SET version=version+1,deleted=1')
                .run(route, id, digest(['unseen', route, id]), JSON.stringify({ occurredAt: null, unsupported: [], truncated: null, known: false }));
            this.db.prepare('DELETE FROM messages WHERE route=? AND id=?').run(route, id);
            this.bump(route);
            this.db.prepare("DELETE FROM qq_browse_snapshots WHERE json_extract(body,'$.proof.route')=?").run(route);
            return true;
        });
    }
    proofCurrent(raw) {
        const parsed = QqCacheProofSchema.safeParse(raw);
        if (!parsed.success)
            return false;
        const { route, parts, hash } = parsed.data;
        if (digest({ route, parts }) !== hash)
            return false;
        return parts.every(ref => { const row = this.db.prepare('SELECT version,hash,deleted FROM qq_message_meta WHERE route=? AND id=?').get(route, ref.id); return row?.deleted === 0 && row.version === ref.version && row.hash === ref.hash; });
    }
    snapshot(owner, id) {
        const row = this.db.prepare('SELECT body,expires_at FROM qq_browse_snapshots WHERE id=? AND instance_id=? AND owner=?').get(z.uuid().parse(id), this.instance, owner);
        if (!row || Number(row.expires_at) <= this.now())
            throw new Error('SNAPSHOT_UNAVAILABLE');
        const value = snapshotSchema.parse(JSON.parse(String(row.body)));
        if (!this.proofCurrent(value.proof))
            throw new Error('SOURCE_STALE');
        return { id, ...value, expiresAt: new Date(Number(row.expires_at)).toISOString() };
    }
    browse(route, owner, raw) {
        routeSchema.parse(route);
        z.string().min(1).max(4000).parse(owner);
        const input = QqBrowseInputSchema.parse(raw);
        const fingerprint = digest({ route, input });
        return this.atomic(() => {
            this.db.prepare('DELETE FROM qq_browse_snapshots WHERE expires_at<=? OR instance_id<>?').run(this.now(), this.instance);
            const prior = this.db.prepare('SELECT id,fingerprint FROM qq_browse_snapshots WHERE instance_id=? AND owner=? AND request_id=?').get(this.instance, owner, input.requestId);
            if (prior) {
                if (prior.fingerprint !== fingerprint)
                    throw new Error('IDEMPOTENCY_CONFLICT');
                return this.snapshot(owner, String(prior.id));
            }
            if (Number(this.db.prepare('SELECT count(*) AS n FROM qq_browse_snapshots').get()?.n) >= this.max)
                throw new Error('SNAPSHOT_CAPACITY_EXCEEDED');
            const maximum = Number(this.db.prepare('SELECT coalesce(max(seq),0) AS n FROM messages WHERE route=?').get(route)?.n);
            const oldest = Number(this.db.prepare('SELECT coalesce(min(seq),0) AS n FROM messages WHERE route=?').get(route)?.n);
            let query = { watermark: maximum, sequence: maximum, offset: 0, epoch: this.epoch(route), limit: input.limit };
            if (input.cursor) {
                const previous = this.snapshot(owner, input.cursor);
                if (previous.proof.route !== route || previous.next?.limit !== input.limit || previous.next.epoch !== this.epoch(route))
                    throw new Error('CURSOR_STALE');
                query = previous.next;
            }
            const page = { order: 'received-newest-first', watermark: query.watermark, oldestCachedSequence: oldest, messages: [],
                limitations: ['仅实际收到的至多200条缓存；不含离线历史或平台全量记录。', '仅文字；媒体种类不等于已读取媒体内容。', '未知时间／旧元信息不可推断，文字范围以每条range为准。'] };
            const refs = [];
            let next = null;
            const rows = this.db.prepare('SELECT seq,id,sender,text FROM messages WHERE route=? AND seq<=? AND seq<=? ORDER BY seq DESC LIMIT ?').all(route, query.watermark, query.sequence, input.limit + 1).map(row => rowSchema.parse(row));
            for (const row of rows) {
                if (page.messages.length >= input.limit) {
                    next = { ...query, sequence: row.seq, offset: 0 };
                    break;
                }
                const meta = this.meta(route, row);
                if (meta.deleted)
                    continue;
                const points = Array.from(redactContent(row.text).value), start = row.seq === query.sequence ? query.offset : 0;
                if (start > points.length)
                    throw new Error('CURSOR_STALE');
                const item = { id: row.id, sender: row.sender, receivedSequence: row.seq, text: '', occurredAt: meta.occurredAt, unsupported: meta.unsupported,
                    legacyMetadata: !meta.known, cacheTextTruncated: meta.truncated, ...(meta.media ? { media: meta.media } : {}), range: { start, end: start, total: points.length } };
                let low = start, high = points.length;
                while (low < high) {
                    const end = Math.ceil((low + high) / 2), candidate = { ...item, text: points.slice(start, end).join(''), range: { ...item.range, end } };
                    if (JSON.stringify({ ...page, messages: [...page.messages, candidate] }).length <= 8000)
                        low = end;
                    else
                        high = end - 1;
                }
                if (low === start && start < points.length) {
                    next = { ...query, sequence: row.seq, offset: start };
                    break;
                }
                page.messages.push({ ...item, text: points.slice(start, low).join(''), range: { ...item.range, end: low } });
                refs.push({ id: row.id, version: meta.version, hash: meta.hash });
                if (low < points.length) {
                    next = { ...query, sequence: row.seq, offset: low };
                    break;
                }
            }
            if (!page.messages.length && rows.length)
                throw new Error('PAGE_BUDGET_EXCEEDED');
            const proof = { route, parts: refs, hash: digest({ route, parts: refs }) }, body = snapshotSchema.parse({ page, proof, next, createdAt: new Date(this.now()).toISOString() });
            const id = randomUUID();
            this.db.prepare('INSERT INTO qq_browse_snapshots VALUES(?,?,?,?,?,?,?)').run(id, this.instance, owner, input.requestId, fingerprint, JSON.stringify(body), this.now() + this.ttl);
            return this.snapshot(owner, id);
        });
    }
}
