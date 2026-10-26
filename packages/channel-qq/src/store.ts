import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { inspectQqSchema, initializeQqSchema, QQ_SCHEMA_VERSION } from './schema.js';
import { GroupListSchema, GroupSnapshotSchema, QqAccountIdSchema, groupReceivesMessages } from './groups.js';
import type { GroupInput, GroupSnapshot } from './groups.js';
import { QqCache } from './cache.js';
import type { QqCacheOptions } from './cache.js';
import { redactContent } from '@dafeiyu/contracts';
import type { MediaAttachment } from '@dafeiyu/contracts';
import { QqDeliveryLedger } from './delivery.js';
import { QqMediaStore } from './media-store.js';
import { QqMediaDeliveryLedger } from './media-delivery.js';
const remembered = z.object({ id: z.string(), sender: z.string(), text: z.string() });
export class QqStore {
  private readonly db: DatabaseSync;
  readonly cache: QqCache;
  readonly delivery: QqDeliveryLedger;
  readonly media:QqMediaStore;
  readonly mediaDelivery:QqMediaDeliveryLedger;
  constructor(file: string, options: { migrate?: boolean; cache?: QqCacheOptions } = {}) {
    mkdirSync(dirname(file), { recursive: true }); this.db = new DatabaseSync(file);
    try {
      // Refuse unknown/legacy stores before changing their persistent journal mode.
      const current = inspectQqSchema(this.db);
      if (!current.fresh && !current.supported) throw new Error('QQ_STORAGE_UNSUPPORTED');
      if (!current.fresh && current.version < QQ_SCHEMA_VERSION && !options.migrate) throw new Error('QQ_MIGRATION_REQUIRED');
      this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
      initializeQqSchema(this.db, options.migrate ?? false);
      this.cache = new QqCache(this.db, options.cache);
      this.delivery = new QqDeliveryLedger(this.db);
      this.media=new QqMediaStore(this.db,this.cache);
      this.mediaDelivery=new QqMediaDeliveryLedger(this.db);
    } catch (error) { this.db.close(); throw error; }
  }
  remember(route: string, id: string, sender: string, text: string, metadata?: { occurredAt: string|null; unsupported: readonly string[];media?:readonly MediaAttachment[];groupGeneration?:number }): boolean { return this.cache.remember(route, id, sender, text, metadata); }
  find(route: string, id: string) { const row = this.db.prepare('SELECT id,sender,text FROM messages WHERE route=? AND id=?').get(route,id); if (!row) return null; const value = remembered.parse(row); return { ...value, text: redactContent(value.text).value }; }
  receipt(id: string): string | null { const row = this.db.prepare('SELECT platform_id FROM receipts WHERE reply_id=?').get(id); return row ? z.string().parse(row.platform_id) : null; }
  handled(route: string, id: string): boolean { return !!this.db.prepare('SELECT 1 FROM handled WHERE route=? AND id=?').get(route,id); }
  acknowledge(route: string, id: string): void { this.db.prepare('INSERT OR IGNORE INTO handled VALUES(?,?)').run(route,id); }
  sent(replyId: string, platformId: string): void { this.db.prepare('INSERT INTO receipts VALUES(?,?)').run(replyId, platformId); }
  groupSnapshot(account: string): GroupSnapshot | null {
    const row = this.db.prepare('SELECT at,revision,groups_json FROM qq_group_snapshots WHERE account=?').get(QqAccountIdSchema.parse(account));
    return row ? GroupSnapshotSchema.parse({ account, at: row.at, revision: row.revision, groups: JSON.parse(z.string().parse(row.groups_json)) }) : null;
  }
  saveGroups(account: string, groups: readonly GroupInput[], at: string): GroupSnapshot {
    QqAccountIdSchema.parse(account); z.iso.datetime().parse(at); const incoming = GroupListSchema.parse(groups);
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
      const snapshot = this.groupSnapshot(account)!; this.db.exec('COMMIT'); return snapshot;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close(): void { this.db.close(); }
}
