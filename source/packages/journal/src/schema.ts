import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';

export const JOURNAL_APPLICATION_ID = 0x44464a32;
const required: Record<string, readonly string[]> = {
  conversations: ['route','session_id'], inbox: ['ordinal','id','route','message_id','extension_id','payload','state','reply'],
  events: ['seq','id','route','trace_id','operation_id','body'], ownership: ['singleton','pid','nonce'],
  analysis_grants: ['id','agent_id','route','body','revoked'],
};
export interface JournalInspection { exists: boolean; version: number; applicationId: number; supported: boolean; activeOwner: boolean }
export function journalHasLiveOwner(db:DatabaseSync):boolean {
  const owner=db.prepare('SELECT pid FROM ownership WHERE singleton=1').get();
  if(!owner)return false;
  try{process.kill(Number(owner.pid),0);return true;}catch(error){return !(error instanceof Error&&'code'in error&&error.code==='ESRCH');}
}
export function checkJournalShape(db: DatabaseSync,allowEarlyV1=false): void {
  for (const [table, columns] of Object.entries(required)) {
    const actual = db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
    if(table==='analysis_grants'&&allowEarlyV1&&actual.length===0)continue;
    if (columns.some(column => !actual.includes(column))) throw new Error('Unsupported journal shape');
  }
  const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all().map(row => row.name);
  if (!triggers.includes('events_no_update') || !triggers.includes('events_no_delete')) throw new Error('Unsupported journal protections');
}
export function inspectJournal(file: string): JournalInspection {
  if (!existsSync(file)) return { exists: false, version: 0, applicationId: 0, supported: true, activeOwner: false };
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const version = Number(db.prepare('PRAGMA user_version').get()?.user_version), applicationId = Number(db.prepare('PRAGMA application_id').get()?.application_id);
    let supported = version === 1 && applicationId === 0 || version === 2 && applicationId === JOURNAL_APPLICATION_ID;
    if (supported) { try { checkJournalShape(db,version===1); if(version===2)db.prepare('SELECT version,applied_at FROM journal_schema_migrations LIMIT 0').all(); } catch { supported = false; } }
    let activeOwner = false;
    if (supported) activeOwner=journalHasLiveOwner(db);
    return { exists: true, version, applicationId, supported, activeOwner };
  } finally { db.close(); }
}

export function migrateJournalSchema(db: DatabaseSync): void {
  const version = Number(db.prepare('PRAGMA user_version').get()?.user_version);
  checkJournalShape(db,version===1);
  if (version === 2) { db.prepare('SELECT version,applied_at FROM journal_schema_migrations LIMIT 0').all(); return; }
  if(version!==1)throw new Error('Unsupported journal schema');
  if(journalHasLiveOwner(db))throw new Error('Journal is already owned by a live process');
  db.exec('BEGIN IMMEDIATE');
  try {
    const lockedVersion=Number(db.prepare('PRAGMA user_version').get()?.user_version),lockedApp=Number(db.prepare('PRAGMA application_id').get()?.application_id);
    if(lockedVersion===2&&lockedApp===JOURNAL_APPLICATION_ID){checkJournalShape(db);db.exec('COMMIT');return;}
    if(lockedVersion!==1||lockedApp!==0)throw new Error('Unsupported journal schema');
    checkJournalShape(db,true);if(journalHasLiveOwner(db))throw new Error('Journal is already owned by a live process');
    db.exec(`CREATE TABLE IF NOT EXISTS analysis_grants(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,route TEXT NOT NULL,body TEXT NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE journal_schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
      CREATE INDEX events_visibility ON events(json_extract(body,'$.visibility.kind'),route,seq);
      PRAGMA application_id=${JOURNAL_APPLICATION_ID}; PRAGMA user_version=2;`);
    db.prepare('INSERT INTO journal_schema_migrations VALUES(2,?)').run(new Date().toISOString());db.exec('COMMIT');
  } catch(error){db.exec('ROLLBACK');throw error;}
}
