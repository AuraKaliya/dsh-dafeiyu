import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
const remembered = z.object({ id: z.string(), sender: z.string(), text: z.string() });
export class QqStore {
  private readonly db: DatabaseSync;
  constructor(file: string) {
    mkdirSync(dirname(file), { recursive: true }); this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,route TEXT NOT NULL,id TEXT NOT NULL,sender TEXT NOT NULL,text TEXT NOT NULL,UNIQUE(route,id));
      CREATE TABLE IF NOT EXISTS receipts(reply_id TEXT PRIMARY KEY,platform_id TEXT NOT NULL);`);
    this.db.exec('CREATE TABLE IF NOT EXISTS handled(route TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(route,id));');
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
