import { z } from 'zod';
import { randomUUID, createHash } from 'node:crypto';
import { ConversationSchema, MediaKindSchema, MediaSourceDescriptionSchema, redactContent } from '#dafeiyu/contracts';
export const QQ_MEDIA_PROVIDER = 'qq-media';
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const locatorSchema = z.strictObject({ file: z.string().min(1).max(4096).optional(), fileId: z.string().min(1).max(4096).optional(), url: z.string().min(1).max(8192).optional() });
const bodySchema = z.strictObject({ scene: ConversationSchema, messageId: z.string().min(1).max(80), sender: z.string().min(1).max(80), position: z.number().int().nonnegative(), kind: MediaKindSchema,
    name: z.string().max(200).nullable(), bytesHint: z.number().int().nonnegative().safe().nullable(), envelopeHash: z.string().length(64), locatorHash: z.string().length(64) });
export class QqMediaStore {
    db;
    cache;
    constructor(db, cache) {
        this.db = db;
        this.cache = cache;
    }
    remember(scene, messageId, sender, envelopeHash, parts, positionOffset = 0) {
        const route = JSON.stringify([scene.account, scene.kind, scene.id]);
        if (this.cache.recalled(route, messageId))
            return [];
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const ids = [];
            for (const [index, part] of parts.entries()) {
                const position = positionOffset + index;
                if (!['image', 'record', 'video', 'file'].includes(part.type) || ids.length >= 8)
                    continue;
                const locator = locatorSchema.safeParse({ ...(typeof part.data.file === 'string' ? { file: part.data.file } : {}), ...(typeof part.data.file_id === 'string' ? { fileId: part.data.file_id } : {}), ...(typeof part.data.url === 'string' ? { url: part.data.url } : {}) });
                if (!locator.success || !Object.keys(locator.data).length)
                    continue;
                const rawName = typeof part.data.name === 'string' ? part.data.name : typeof part.data.file_name === 'string' ? part.data.file_name : null;
                const body = bodySchema.parse({ scene, messageId, sender, position, kind: part.type === 'record' ? 'audio' : part.type === 'file' ? 'document' : part.type, name: rawName ? redactContent(rawName).value.replace(/[\\/\x00-\x1f]/g, '_').slice(0, 200) : null,
                    bytesHint: typeof part.data.file_size === 'number' && Number.isSafeInteger(part.data.file_size) && part.data.file_size >= 0 ? part.data.file_size : null, envelopeHash, locatorHash: digest(locator.data) });
                const old = this.db.prepare('SELECT id,version,deleted,body_hash FROM qq_media_sources WHERE route=? AND message_id=? AND position=?').get(route, messageId, position);
                if (old?.deleted === 1)
                    continue;
                const id = old ? String(old.id) : randomUUID(), hash = digest(body);
                ids.push(id);
                if (old?.body_hash === hash)
                    continue;
                this.db.prepare('INSERT INTO qq_media_sources VALUES(?,?,?,?,?,0,?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,body=excluded.body,body_hash=excluded.body_hash,private_body=excluded.private_body,updated_at=excluded.updated_at')
                    .run(id, route, messageId, position, Number(old?.version ?? 0) + 1, JSON.stringify(body), hash, JSON.stringify(locator.data), Date.now());
            }
            for (const row of this.db.prepare('SELECT id FROM qq_media_sources WHERE route=? AND message_id=? AND deleted=0').all(route, messageId))
                if (!ids.includes(String(row.id)))
                    this.db.prepare('UPDATE qq_media_sources SET deleted=1,version=version+1,private_body=NULL WHERE id=?').run(row.id);
            this.db.exec('COMMIT');
            return ids;
        }
        catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }
    row(id) {
        const row = this.db.prepare('SELECT * FROM qq_media_sources WHERE id=?').get(z.uuid().parse(id));
        if (!row || row.deleted === 1)
            throw new Error('QQ_MEDIA_SOURCE_STALE');
        const body = bodySchema.parse(JSON.parse(String(row.body)));
        if (digest(body) !== row.body_hash || this.cache.recalled(String(row.route), body.messageId))
            throw new Error('QQ_MEDIA_SOURCE_STALE');
        return { id: String(row.id), version: Number(row.version), body, hash: String(row.body_hash), privateBody: row.private_body };
    }
    describe(id) {
        const row = this.row(id), { scene } = row.body;
        return MediaSourceDescriptionSchema.parse({ ref: { provider: QQ_MEDIA_PROVIDER, key: row.id + ':' + row.version }, kind: row.body.kind, name: row.body.name, bytesHint: row.body.bytesHint, mimeHint: null, durationMsHint: null, rangeReadable: false, publicContent: false,
            origin: { provider: QQ_MEDIA_PROVIDER, scene, key: row.id, version: row.version, hash: row.hash, roots: [`qq:${scene.account}:${scene.kind}:${scene.id}:message:${row.body.messageId}`], detail: { messageId: row.body.messageId, position: row.body.position, sender: row.body.sender } } });
    }
    reference(key) { const parsed = /^([a-f0-9-]{36}):(\d+)$/.exec(key); if (!parsed)
        throw new Error('QQ_MEDIA_SOURCE_STALE'); const description = this.describe(parsed[1]); if (description.ref.key !== key)
        throw new Error('QQ_MEDIA_SOURCE_STALE'); return description; }
    locator(key) { const description = this.reference(key), row = this.row(description.origin.key); if (typeof row.privateBody !== 'string')
        throw new Error('QQ_MEDIA_HANDLE_EXPIRED'); const value = locatorSchema.parse(JSON.parse(row.privateBody)); if (digest(value) !== row.body.locatorHash)
        throw new Error('QQ_MEDIA_SOURCE_STALE'); return value; }
    list(scene, messageId) { const route = JSON.stringify([scene.account, scene.kind, scene.id]); return this.db.prepare('SELECT id FROM qq_media_sources WHERE route=? AND message_id=? AND deleted=0 ORDER BY position LIMIT 8').all(route, messageId).flatMap(row => { try {
        return [this.describe(String(row.id))];
    }
    catch {
        return [];
    } }); }
    current(proof) { try {
        return digest(this.describe(proof.key).origin) === digest(proof);
    }
    catch {
        return false;
    } }
    revoke(scene, messageId) { return this.db.prepare('UPDATE qq_media_sources SET deleted=1,version=version+1,private_body=NULL WHERE route=? AND message_id=? AND deleted=0').run(JSON.stringify([scene.account, scene.kind, scene.id]), messageId).changes; }
    prune(maximum = 2048, oldest = Date.now() - 72 * 3600000) { this.db.prepare('UPDATE qq_media_sources SET private_body=NULL WHERE private_body IS NOT NULL AND (updated_at<? OR id NOT IN(SELECT id FROM qq_media_sources WHERE private_body IS NOT NULL ORDER BY updated_at DESC,id LIMIT ?))').run(oldest, maximum); }
    epoch() { return digest([this.cache.generation(), this.db.prepare('SELECT id,version,deleted FROM qq_media_sources ORDER BY id').all()]); }
}
