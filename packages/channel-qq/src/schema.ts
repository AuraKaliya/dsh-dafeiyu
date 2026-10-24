import type { DatabaseSync } from 'node:sqlite';

export const QQ_APPLICATION_ID = 0x44465131;
export const QQ_SCHEMA_VERSION = 1;

const tables = {
  messages: 'CREATE TABLE messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,route TEXT NOT NULL,id TEXT NOT NULL,sender TEXT NOT NULL,text TEXT NOT NULL,UNIQUE(route,id))',
  receipts: 'CREATE TABLE receipts(reply_id TEXT PRIMARY KEY,platform_id TEXT NOT NULL)',
  handled: 'CREATE TABLE handled(route TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(route,id))',
};
// The unversioned connector had exactly these definitions. Do not adopt arbitrary databases.
const normalize = (sql: string) => sql.toLowerCase().replace(/\bif\s+not\s+exists\b/g, '').replace(/[\s;]+/g, '');
export interface QqSchemaInspection {
  version: number;
  applicationId: number;
  fresh: boolean;
  supported: boolean;
}

/** Read-only even on a legacy store. Opening a service is deliberately separate from inspection. */
export function inspectQqSchema(db: DatabaseSync): QqSchemaInspection {
  const version = Number(db.prepare('PRAGMA user_version').get()?.user_version);
  const applicationId = Number(db.prepare('PRAGMA application_id').get()?.application_id);
  const objects = db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const fresh = version === 0 && applicationId === 0 && objects.length === 0;
  const expected = Object.entries(tables);
  const structure = objects.length === expected.length && expected.every(([name, sql]) => {
    const found = objects.find(item => item.name === name);
    return found?.type === 'table' && typeof found.sql === 'string' && normalize(found.sql) === normalize(sql);
  });
  const supported = structure && (version === 0 && applicationId === 0 || version === QQ_SCHEMA_VERSION && applicationId === QQ_APPLICATION_ID);
  return { version, applicationId, fresh, supported };
}

/** Caller must have admitted a fresh database or an explicitly authorized migration. */
export function initializeQqSchema(db: DatabaseSync, migrate: boolean): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    const current = inspectQqSchema(db);
    if (!current.fresh && !current.supported) throw new Error('QQ_STORAGE_UNSUPPORTED');
    if (!current.fresh && current.version < QQ_SCHEMA_VERSION && !migrate) throw new Error('QQ_MIGRATION_REQUIRED');
    if (current.fresh) for (const sql of Object.values(tables)) db.exec(sql);
    if (current.fresh || current.version < QQ_SCHEMA_VERSION) {
      db.exec(`PRAGMA application_id=${QQ_APPLICATION_ID}; PRAGMA user_version=${QQ_SCHEMA_VERSION};`);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
