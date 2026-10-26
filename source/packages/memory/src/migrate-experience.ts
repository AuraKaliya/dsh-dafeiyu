import type { DatabaseSync } from 'node:sqlite';

export const EXPERIENCE_TABLES=['experience_items','experience_revisions','experience_relations',
  'maintenance_events','maintenance_requests','maintenance_receipts','maintenance_watermarks'] as const;

export function migrateExperience(db:DatabaseSync):void {
  const version=Number(db.prepare('PRAGMA user_version').get()?.user_version);
  if(version===11||version===12){for(const table of EXPERIENCE_TABLES)db.prepare(`SELECT * FROM ${table} LIMIT 0`).all();return;}
  if(version!==10)throw new Error('Unsupported experience database');
  db.exec(`
    CREATE TABLE experience_items(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,scope_key TEXT NOT NULL,version INTEGER NOT NULL,state TEXT NOT NULL);
    CREATE INDEX experience_scope ON experience_items(agent_id,scope_key);
    CREATE TABLE experience_revisions(id TEXT NOT NULL REFERENCES experience_items(id),version INTEGER NOT NULL,body TEXT NOT NULL,body_hash TEXT NOT NULL,PRIMARY KEY(id,version));
    CREATE TABLE experience_relations(id TEXT PRIMARY KEY,maintenance_id TEXT NOT NULL,scope_key TEXT NOT NULL,body TEXT NOT NULL);
    CREATE INDEX experience_relation_scope ON experience_relations(scope_key,maintenance_id);
    CREATE TABLE maintenance_events(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,scope_key TEXT NOT NULL,body TEXT NOT NULL,body_hash TEXT NOT NULL);
    CREATE TABLE maintenance_requests(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,scope_key TEXT NOT NULL,producer TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,body TEXT NOT NULL,state TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,result TEXT,error TEXT,updated_at TEXT NOT NULL,UNIQUE(agent_id,scope_key,producer,request_id));
    CREATE INDEX maintenance_pending ON maintenance_requests(agent_id,scope_key,state);
    CREATE TABLE maintenance_receipts(agent_id TEXT NOT NULL,scope_key TEXT NOT NULL,producer TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(agent_id,scope_key,producer,request_id));
    CREATE TABLE maintenance_watermarks(agent_id TEXT NOT NULL,scope_key TEXT NOT NULL,request_id TEXT NOT NULL,watermark TEXT NOT NULL,PRIMARY KEY(agent_id,scope_key,request_id));
    CREATE TRIGGER experience_revision_immutable BEFORE UPDATE ON experience_revisions BEGIN SELECT RAISE(ABORT,'Immutable experience revision'); END;
    CREATE TRIGGER experience_revision_retain BEFORE DELETE ON experience_revisions BEGIN SELECT RAISE(ABORT,'Retain experience revision'); END;
    CREATE TRIGGER experience_relation_immutable BEFORE UPDATE ON experience_relations BEGIN SELECT RAISE(ABORT,'Immutable experience relation'); END;
    CREATE TRIGGER maintenance_event_immutable BEFORE UPDATE ON maintenance_events BEGIN SELECT RAISE(ABORT,'Immutable maintenance event'); END;
    CREATE TRIGGER maintenance_request_immutable BEFORE UPDATE OF id,agent_id,scope_key,producer,request_id,fingerprint,body ON maintenance_requests BEGIN SELECT RAISE(ABORT,'Immutable maintenance input'); END;
    CREATE TRIGGER maintenance_request_retain BEFORE DELETE ON maintenance_requests BEGIN SELECT RAISE(ABORT,'Retain maintenance request'); END;
    CREATE TRIGGER maintenance_receipt_immutable BEFORE UPDATE ON maintenance_receipts BEGIN SELECT RAISE(ABORT,'Immutable maintenance receipt'); END;
    PRAGMA user_version=11;
  `);
  db.prepare('INSERT INTO memory_schema_migrations VALUES(11,?,0,?)').run(new Date().toISOString(),'add-experience-and-maintenance-without-reclassifying-history-v1');
}
