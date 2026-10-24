import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { inspectQqSchema, initializeQqSchema, QQ_SCHEMA_VERSION } from './schema.js';
const remembered = z.object({ id: z.string(), sender: z.string(), text: z.string() });
export class QqStore {
  private readonly db: DatabaseSync;
  constructor(file: string, options: { migrate?: boolean } = {}) {
    mkdirSync(dirname(file), { recursive: true }); this.db = new DatabaseSync(file);
    try {
      // Refuse unknown/legacy stores before changing their persistent journal mode.
      const current = inspectQqSchema(this.db);
      if (!current.fresh && !current.supported) throw new Error('QQ_STORAGE_UNSUPPORTED');
      if (!current.fresh && current.version < QQ_SCHEMA_VERSION && !options.migrate) throw new Error('QQ_MIGRATION_REQUIRED');
      this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
      initializeQqSchema(this.db, options.migrate ?? false);
    } catch (error) { this.db.close(); throw error; }
  }
  remember(route: string, id: string, sender: string, text: string): void {
    this.db.prepare('INSERT OR IGNORE INTO messages(route,id,sender,text) VALUES(?,?,?,?)').run(route, id, sender, text.slice(0,32000));
    this.db.prepare('DELETE FROM messages WHERE route=? AND seq NOT IN(SELECT seq FROM messages WHERE route=? ORDER BY seq DESC LIMIT 200)').run(route, route);
  }
  find(route: string, id: string) { const row = this.db.prepare('SELECT id,sender,text FROM messages WHERE route=? AND id=?').get(route,id); return row ? remembered.parse(row) : null; }
  receipt(id: string): string | null { const row = this.db.prepare('SELECT platform_id FROM receipts WHERE reply_id=?').get(id); return row ? z.string().parse(row.platform_id) : null; }
  handled(route: string, id: string): boolean { return !!this.db.prepare('SELECT 1 FROM handled WHERE route=? AND id=?').get(route,id); }
  acknowledge(route: string, id: string): void { this.db.prepare('INSERT OR IGNORE INTO handled VALUES(?,?)').run(route,id); }
  sent(replyId: string, platformId: string): void { this.db.prepare('INSERT INTO receipts VALUES(?,?)').run(replyId, platformId); }
  close(): void { this.db.close(); }
}
