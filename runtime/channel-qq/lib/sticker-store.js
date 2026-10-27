import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, lstatSync, readFileSync, writeFileSync, realpathSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { ConversationSchema, MediaAssetRefSchema, MediaSourceDescriptionSchema } from '#dafeiyu/contracts';
export const QQ_STICKER_PROVIDER = 'qq-stickers';
export const QqStickersConfigSchema = z.strictObject({ enabled: z.boolean().default(false), maxBytes: z.number().int().min(1024).max(1024 ** 3).default(512 * 1024 ** 2), maxEntries: z.number().int().min(1).max(5000).default(1000) });
export const StickerMetadataSchema = z.strictObject({ name: z.string().trim().min(1).max(80), description: z.string().trim().min(1).max(600), tags: z.array(z.string().trim().min(1).max(32)).max(12) });
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const same = (a, b) => hash(a) === hash(b);
const bodySchema = StickerMetadataSchema.extend({ scope: z.enum(['conversation', 'global']), scene: ConversationSchema, origin: z.strictObject({ messageId: z.string().min(1).max(80), sender: z.string().min(1).max(80) }),
    mime: z.enum(['image/gif', 'image/png', 'image/jpeg', 'image/webp']), bytes: z.number().int().positive().max(16 * 1024 ** 2), enabled: z.boolean(), deleted: z.boolean(), collectedAt: z.iso.datetime(), uses: z.number().int().nonnegative(), lastUsedAt: z.iso.datetime().nullable() });
const leaseSchema = z.strictObject({ requestKey: z.string(), scene: ConversationSchema, asset: MediaAssetRefSchema.nullable(), receipts: z.array(z.string()).max(1000) });
/** Persistent original bytes, independent of the disposable media cache. No model paths or URLs. */
export class QqStickerStore {
    db;
    config;
    root;
    constructor(db, directory, config) {
        this.db = db;
        this.config = config;
        this.root = resolve(directory);
        mkdirSync(this.root, { recursive: true });
        if (lstatSync(this.root).isSymbolicLink() || realpathSync(this.root) !== this.root)
            throw new Error('STICKER_PATH_ESCAPE');
    }
    file(sha) { if (!/^[a-f0-9]{64}$/.test(sha) || realpathSync(this.root) !== this.root)
        throw new Error('STICKER_PATH_ESCAPE'); return join(this.root, sha); }
    rows() { return this.db.prepare('SELECT * FROM qq_stickers ORDER BY rowid DESC').all().map(row => this.row(row)); }
    row(row) { return { id: z.uuid().parse(row.id), sha256: z.string().regex(/^[a-f0-9]{64}$/).parse(row.sha256), version: z.number().int().positive().parse(Number(row.version)), body: bodySchema.parse(JSON.parse(String(row.body))) }; }
    get(id) { const row = this.db.prepare('SELECT * FROM qq_stickers WHERE id=?').get(z.uuid().parse(id)); if (!row)
        throw new Error('STICKER_NOT_FOUND'); return this.row(row); }
    visible(row, scene) { return row.body.scene.account === scene.account && (row.body.scope === 'global' || same(row.body.scene, scene)); }
    list(scene, query = '') { const q = query.trim().toLocaleLowerCase(); return this.rows().filter(row => !row.body.deleted && this.visible(row, scene) && (!q || JSON.stringify([row.id, row.body.name, row.body.description, row.body.tags]).toLocaleLowerCase().includes(q))).slice(0, 40).map(row => this.summary(row)); }
    summary(row) { const { origin, scene, ...metadata } = row.body; return { id: row.id, version: row.version, sha256: row.sha256, ...metadata }; }
    managementList(query = '') { return this.rows().filter(row => !row.body.deleted && (!query || row.body.name.includes(query) || row.id === query)).slice(0, 200).map(row => ({ id: row.id, name: row.body.name, version: row.version, scope: row.body.scope, enabled: row.body.enabled, sourceScene: row.body.scene })); }
    collect(scene, origin, metadata, data, mime) {
        const sha = createHash('sha256').update(data).digest('hex'), old = this.rows().find(row => !row.body.deleted && row.sha256 === sha && same(row.body.scene, scene));
        if (old)
            return { ...this.summary(old), duplicate: true };
        const rows = this.rows().filter(row => !row.body.deleted), unique = new Map(rows.map(row => [row.sha256, row.body.bytes]));
        if (rows.length >= this.config.maxEntries || [...unique.values()].reduce((a, b) => a + b, 0) + (unique.has(sha) ? 0 : data.length) > this.config.maxBytes)
            throw new Error('STICKER_LIBRARY_FULL');
        const body = bodySchema.parse({ ...metadata, scene, origin, scope: 'conversation', mime, bytes: data.length, enabled: true, deleted: false, collectedAt: new Date().toISOString(), uses: 0, lastUsedAt: null });
        const file = this.file(sha);
        try {
            writeFileSync(file, data, { flag: 'wx', flush: true });
        }
        catch (error) {
            if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'EEXIST')
                throw error;
            this.bytes({ id: '', sha256: sha, version: 1, body });
        }
        const id = randomUUID();
        this.db.prepare('INSERT INTO qq_stickers VALUES(?,?,1,?)').run(id, sha, JSON.stringify(body));
        return { ...this.summary({ id, sha256: sha, version: 1, body }), duplicate: false };
    }
    bytes(row) {
        const file = this.file(row.sha256), info = lstatSync(file);
        if (!info.isFile() || info.isSymbolicLink() || info.size !== row.body.bytes || realpathSync(file) !== file)
            throw new Error('STICKER_BYTES_INVALID');
        const data = readFileSync(file);
        if (createHash('sha256').update(data).digest('hex') !== row.sha256)
            throw new Error('STICKER_BYTES_INVALID');
        return data;
    }
    lease(id, scene, requestKey) {
        const row = this.get(id);
        if (!row.body.enabled || row.body.deleted || !this.visible(row, scene))
            throw new Error('STICKER_SCOPE_DENIED');
        const prior = this.db.prepare("SELECT id,sticker_id,version FROM qq_sticker_leases WHERE json_extract(body,'$.requestKey')=?").get(requestKey);
        if (prior) {
            if (prior.sticker_id !== id || Number(prior.version) !== row.version)
                throw new Error('IDEMPOTENCY_CONFLICT');
            const description = this.describe(String(prior.id));
            if (!description || !same(description.origin.scene, scene))
                throw new Error('STICKER_SOURCE_STALE');
            return description;
        }
        const key = randomUUID(), body = leaseSchema.parse({ requestKey, scene, asset: null, receipts: [] });
        this.db.prepare('INSERT INTO qq_sticker_leases VALUES(?,?,?,?)').run(key, id, row.version, JSON.stringify(body));
        return this.describe(key);
    }
    describe(key) {
        const lease = this.db.prepare('SELECT * FROM qq_sticker_leases WHERE id=?').get(key);
        if (!lease)
            return null;
        const body = leaseSchema.parse(JSON.parse(String(lease.body))), row = this.get(String(lease.sticker_id));
        if (!row.body.enabled || row.body.deleted || row.version !== Number(lease.version) || !this.visible(row, body.scene))
            return null;
        const detail = { stickerId: row.id, sha256: row.sha256, bytes: row.body.bytes, mime: row.body.mime }, stamp = hash(detail), suffix = row.body.mime.split('/')[1];
        return MediaSourceDescriptionSchema.parse({ ref: { provider: QQ_STICKER_PROVIDER, key }, kind: 'image', name: 'sticker-' + row.id + '.' + suffix, mimeHint: row.body.mime, bytesHint: row.body.bytes, durationMsHint: null, rangeReadable: false, publicContent: false,
            origin: { provider: QQ_STICKER_PROVIDER, scene: body.scene, key, version: row.version, hash: stamp, roots: ['qq-sticker:' + row.id], detail } });
    }
    current(proof) { try {
        return same(this.describe(proof.key)?.origin, proof);
    }
    catch {
        return false;
    } }
    open(key) { const description = this.describe(key); if (!description)
        throw new Error('STICKER_SOURCE_STALE'); const detail = z.object({ stickerId: z.uuid() }).parse(description.origin.detail); return { data: this.bytes(this.get(detail.stickerId)), description }; }
    bind(key, asset) {
        const row = this.db.prepare('SELECT body FROM qq_sticker_leases WHERE id=?').get(key);
        if (!row || !this.describe(key))
            throw new Error('STICKER_SOURCE_STALE');
        const body = leaseSchema.parse(JSON.parse(String(row.body)));
        this.db.prepare('UPDATE qq_sticker_leases SET body=? WHERE id=?').run(JSON.stringify({ ...body, asset }), key);
    }
    permits(scene, asset) {
        return this.db.prepare("SELECT id,body FROM qq_sticker_leases WHERE json_extract(body,'$.asset.id')=?").all(asset.id).some(row => {
            const body = leaseSchema.parse(JSON.parse(String(row.body)));
            return same(body.scene, scene) && same(body.asset, asset) && this.describe(String(row.id))?.origin.scene.account === scene.account;
        });
    }
    used(scene, asset, replyId) {
        for (const lease of this.db.prepare("SELECT * FROM qq_sticker_leases WHERE json_extract(body,'$.asset.id')=?").all(asset.id)) {
            const body = leaseSchema.parse(JSON.parse(String(lease.body)));
            if (!same(body.scene, scene) || !same(body.asset, asset) || body.receipts.includes(replyId))
                continue;
            const row = this.get(String(lease.sticker_id));
            this.db.prepare('UPDATE qq_stickers SET body=? WHERE id=?').run(JSON.stringify({ ...row.body, uses: row.body.uses + 1, lastUsedAt: new Date().toISOString() }), row.id);
            this.db.prepare('UPDATE qq_sticker_leases SET body=? WHERE id=?').run(JSON.stringify({ ...body, receipts: [...body.receipts, replyId].slice(-1000) }), lease.id);
        }
    }
    manage(target, action, value = '') {
        const matches = this.rows().filter(row => !row.body.deleted && (row.id === target || row.body.name === target));
        if (matches.length !== 1)
            throw new Error(matches.length ? 'STICKER_NAME_AMBIGUOUS' : 'STICKER_NOT_FOUND');
        const row = matches[0];
        const body = bodySchema.parse({ ...row.body, ...(action === 'global' ? { scope: 'global' } : action === 'disable' ? { enabled: false } : action === 'enable' ? { enabled: true } : action === 'delete' ? { deleted: true, enabled: false } : action === 'rename' ? { name: value } : { tags: value.split(/[,，、]/u).map(tag => tag.trim()).filter(Boolean) }) });
        this.db.prepare('UPDATE qq_stickers SET version=version+1,body=? WHERE id=?').run(JSON.stringify(body), row.id);
        if (action === 'delete' && !this.rows().some(other => !other.body.deleted && other.sha256 === row.sha256))
            unlinkSync(this.file(row.sha256));
        return this.summary({ ...row, version: row.version + 1, body });
    }
    revokeSource(scene, messageId) { for (const row of this.rows())
        if (!row.body.deleted && row.body.enabled && same(row.body.scene, scene) && row.body.origin.messageId === messageId)
            this.db.prepare('UPDATE qq_stickers SET version=version+1,body=? WHERE id=?').run(JSON.stringify({ ...row.body, enabled: false }), row.id); }
    epoch() { return hash(this.rows().map(row => [row.id, row.version])); }
}
