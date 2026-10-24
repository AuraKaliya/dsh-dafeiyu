import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { inspectQqSchema, initializeQqSchema, QQ_SCHEMA_VERSION } from './schema.js';
import { GroupListSchema, GroupSnapshotSchema, QqAccountIdSchema } from './groups.js';
import type { GroupInfo, GroupSnapshot } from './groups.js';
import { QqCache } from './cache.js';
import type { QqCacheOptions } from './cache.js';
import { redactContent } from '@dafeiyu/contracts';
import { QqDeliveryLedger } from './delivery.js';
const remembered = z.object({ id: z.string(), sender: z.string(), text: z.string() });
export class QqStore {
  private readonly db: DatabaseSync;
  readonly cache: QqCache;
  readonly delivery: QqDeliveryLedger;
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
    } catch (error) { this.db.close(); throw error; }
  }
  remember(route: string, id: string, sender: string, text: string, metadata?: { occurredAt: string; unsupported: readonly string[] }): boolean { return this.cache.remember(route, id, sender, text, metadata); }
  find(route: string, id: string) { const row = this.db.prepare('SELECT id,sender,text FROM messages WHERE route=? AND id=?').get(route,id); if (!row) return null; const value = remembered.parse(row); return { ...value, text: redactContent(value.text).value }; }
  receipt(id: string): string | null { const row = this.db.prepare('SELECT platform_id FROM receipts WHERE reply_id=?').get(id); return row ? z.string().parse(row.platform_id) : null; }
  handled(route: string, id: string): boolean { return !!this.db.prepare('SELECT 1 FROM handled WHERE route=? AND id=?').get(route,id); }
  acknowledge(route: string, id: string): void { this.db.prepare('INSERT OR IGNORE INTO handled VALUES(?,?)').run(route,id); }
  sent(replyId: string, platformId: string): void { this.db.prepare('INSERT INTO receipts VALUES(?,?)').run(replyId, platformId); }
  groupSnapshot(account: string): GroupSnapshot | null {
    const row = this.db.prepare('SELECT at,revision,groups_json FROM qq_group_snapshots WHERE account=?').get(QqAccountIdSchema.parse(account));
    return row ? GroupSnapshotSchema.parse({ account, at: row.at, revision: row.revision, groups: JSON.parse(z.string().parse(row.groups_json)) }) : null;
  }
  saveGroups(account: string, groups: readonly GroupInfo[], at: string): GroupSnapshot {
    QqAccountIdSchema.parse(account); z.iso.datetime().parse(at); const body = JSON.stringify(GroupListSchema.parse(groups));
    this.db.prepare(`INSERT INTO qq_group_snapshots(account,at,revision,groups_json) VALUES(?,?,1,?)
      ON CONFLICT(account) DO UPDATE SET at=excluded.at,revision=revision+1,groups_json=excluded.groups_json`).run(account, at, body);
    return this.groupSnapshot(account)!;
  }
  close(): void { this.db.close(); }
}
