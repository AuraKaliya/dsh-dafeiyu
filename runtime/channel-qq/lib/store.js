import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { inspectQqSchema, initializeQqSchema, QQ_SCHEMA_VERSION } from './schema.js';
import { GroupListSchema, GroupSnapshotSchema, QqAccountIdSchema, groupReceivesMessages } from './groups.js';
import { QqCache, QqCacheProofSchema } from './cache.js';
import { redactContent } from '#dafeiyu/contracts';
import { QqDeliveryLedger } from './delivery.js';
import { QqMediaStore } from './media-store.js';
import { QqMediaDeliveryLedger } from './media-delivery.js';
import { QqMessageBatches, QqBatchConfigSchema } from './batch.js';
import { QqStickerStore, QqStickersConfigSchema } from './sticker-store.js';
const remembered = z.object({ id: z.string(), sender: z.string(), text: z.string() });
const quoteSchema = z.strictObject({ route: z.string(), messageId: z.string().max(80), observedAt: z.iso.datetime(), occurredAt: z.iso.datetime(), expiresAt: z.iso.datetime(), proof: QqCacheProofSchema });
export class QqStore {
    db;
    cache;
    delivery;
    media;
    mediaDelivery;
    stickers;
    batches(config, host, clock) { return new QqMessageBatches(this.db, config, host, clock); }
    constructor(file, options = {}) {
        mkdirSync(dirname(file), { recursive: true });
        this.db = new DatabaseSync(file);
        try {
            // Refuse unknown/legacy stores before changing their persistent journal mode.
            const current = inspectQqSchema(this.db);
            if (!current.fresh && !current.supported)
                throw new Error('QQ_STORAGE_UNSUPPORTED');
            if (!current.fresh && current.version < QQ_SCHEMA_VERSION && !options.migrate)
                throw new Error('QQ_MIGRATION_REQUIRED');
            this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
            initializeQqSchema(this.db, options.migrate ?? false);
            this.cache = new QqCache(this.db, options.cache);
            this.delivery = new QqDeliveryLedger(this.db);
            this.media = new QqMediaStore(this.db, this.cache);
            this.mediaDelivery = new QqMediaDeliveryLedger(this.db);
            this.stickers = new QqStickerStore(this.db, resolve(dirname(file), 'stickers', 'objects'), QqStickersConfigSchema.parse(options.stickers ?? {}));
        }
        catch (error) {
            this.db.close();
            throw error;
        }
    }
    remember(route, id, sender, text, metadata) { return this.cache.remember(route, id, sender, text, metadata); }
    selectReplyQuote(replyId, value) {
        const next = quoteSchema.parse(value), old = this.db.prepare('SELECT body FROM qq_reply_quotes WHERE reply_id=?').get(replyId);
        if (old) {
            if (quoteSchema.parse(JSON.parse(String(old.body))).messageId !== next.messageId)
                throw new Error('IDEMPOTENCY_CONFLICT');
            return;
        }
        this.db.prepare('INSERT INTO qq_reply_quotes VALUES(?,?)').run(replyId, JSON.stringify(next));
    }
    replyQuote(replyId, route) {
        const row = this.db.prepare('SELECT body FROM qq_reply_quotes WHERE reply_id=?').get(replyId);
        if (!row)
            return null;
        const quote = quoteSchema.parse(JSON.parse(String(row.body)));
        if (quote.route !== route || Date.parse(quote.expiresAt) <= Date.now() || Date.parse(quote.occurredAt) < Date.parse(quote.observedAt) - 86400000 || Date.parse(quote.occurredAt) > Date.parse(quote.observedAt) || !this.cache.proofCurrent(quote.proof))
            throw new Error('SOURCE_STALE');
        return quote.messageId;
    }
    appendHistory(route, id, sender, text, metadata) {
        if (this.cache.known(route, id)) {
            this.cache.completeHistoryMetadata(route, id, metadata.occurredAt, metadata.forwardIds);
            return false;
        }
        if (Number(this.db.prepare('SELECT count(*) AS n FROM messages WHERE route=?').get(route)?.n) >= 200)
            return false;
        return this.cache.remember(route, id, sender, text, { ...metadata, history: true });
    }
    find(route, id) { const row = this.db.prepare('SELECT id,sender,text FROM messages WHERE route=? AND id=?').get(route, id); if (!row)
        return null; const value = remembered.parse(row); return { ...value, text: redactContent(value.text).value }; }
    receipt(id) { const row = this.db.prepare('SELECT platform_id FROM receipts WHERE reply_id=?').get(id); return row ? z.string().parse(row.platform_id) : null; }
    handled(route, id) { return !!this.db.prepare('SELECT 1 FROM handled WHERE route=? AND id=?').get(route, id); }
    acknowledge(route, id) { this.db.prepare('INSERT OR IGNORE INTO handled VALUES(?,?)').run(route, id); }
    sent(replyId, platformId) { this.db.prepare('INSERT INTO receipts VALUES(?,?)').run(replyId, platformId); }
    groupSnapshot(account) {
        const row = this.db.prepare('SELECT at,revision,groups_json FROM qq_group_snapshots WHERE account=?').get(QqAccountIdSchema.parse(account));
        return row ? GroupSnapshotSchema.parse({ account, at: row.at, revision: row.revision, groups: JSON.parse(z.string().parse(row.groups_json)) }) : null;
    }
    saveGroups(account, groups, at) {
        QqAccountIdSchema.parse(account);
        z.iso.datetime().parse(at);
        const incoming = GroupListSchema.parse(groups);
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const prior = this.groupSnapshot(account);
            const previous = new Map(prior?.groups.map(group => [group.id, group]) ?? []);
            const body = JSON.stringify(incoming.map(group => {
                const old = previous.get(group.id);
                const activated = groupReceivesMessages(group) && (!old || !groupReceivesMessages(old));
                return { ...group, acceptedAfter: activated ? Math.ceil(Date.parse(at) / 1000) * 1000 : old?.acceptedAfter ?? 0,
                    generation: activated ? (prior?.revision ?? 0) + 1 : old?.generation ?? 0 };
            }));
            this.db.prepare(`INSERT INTO qq_group_snapshots(account,at,revision,groups_json) VALUES(?,?,1,?)
        ON CONFLICT(account) DO UPDATE SET at=excluded.at,revision=revision+1,groups_json=excluded.groups_json`).run(account, at, body);
            const snapshot = this.groupSnapshot(account);
            this.db.exec('COMMIT');
            return snapshot;
        }
        catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }
    close() { this.db.close(); }
}
