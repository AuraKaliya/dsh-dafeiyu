import type { DatabaseSync } from 'node:sqlite';

export const EXECUTION_MEMORY_TABLES = ['execution_scopes','execution_sources','execution_observations','execution_contributions',
  'growth_selections','growth_revisions','growth_requests','task_execution_results','execution_memory_requests','execution_memory_outbox'] as const;

/** Additive v7 migration. No old body, boundary, request fingerprint or tombstone is rewritten. */
export function migrateExecutionMemory(db: DatabaseSync): void {
  const version=Number(db.prepare('PRAGMA user_version').get()?.user_version);
if(version===7||version===8||version===9||version===10||version===11||version===12){for(const table of EXECUTION_MEMORY_TABLES)db.prepare(`SELECT * FROM ${table} LIMIT 0`).all();return;}
  if(version!==6)throw new Error('Unsupported execution memory schema');
  db.exec(`
    CREATE TABLE execution_scopes(scope_key TEXT PRIMARY KEY,agent_id TEXT NOT NULL,task_id TEXT NOT NULL REFERENCES task_workspaces(id),body TEXT NOT NULL,fingerprint TEXT NOT NULL,UNIQUE(agent_id,task_id));
    CREATE TABLE execution_sources(id TEXT PRIMARY KEY,scope_key TEXT NOT NULL REFERENCES execution_scopes(scope_key),run_id TEXT NOT NULL,producer TEXT NOT NULL,body TEXT NOT NULL,content_hash TEXT NOT NULL,state_version INTEGER NOT NULL DEFAULT 1,deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)));
    CREATE TABLE execution_observations(id TEXT PRIMARY KEY,scope_key TEXT NOT NULL REFERENCES execution_scopes(scope_key),run_id TEXT NOT NULL,producer TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,body TEXT NOT NULL,receipt TEXT NOT NULL,UNIQUE(scope_key,producer,request_id));
    CREATE TABLE execution_contributions(memory_id TEXT PRIMARY KEY REFERENCES memory_items(id),observation_id TEXT NOT NULL REFERENCES execution_observations(id),body TEXT NOT NULL);
    CREATE TABLE growth_selections(agent_id TEXT NOT NULL,scope_key TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(agent_id,scope_key));
    CREATE TABLE growth_revisions(agent_id TEXT NOT NULL,scope_key TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(agent_id,scope_key,version));
    CREATE TABLE growth_requests(agent_id TEXT NOT NULL,scope_key TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,receipt TEXT NOT NULL,PRIMARY KEY(agent_id,scope_key,request_id));
    CREATE TABLE task_execution_results(task_id TEXT NOT NULL REFERENCES task_workspaces(id),run_id TEXT PRIMARY KEY,task_epoch INTEGER NOT NULL,body TEXT NOT NULL,body_hash TEXT NOT NULL);
    CREATE TABLE execution_memory_requests(scope_key TEXT NOT NULL,producer TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,receipt TEXT NOT NULL,PRIMARY KEY(scope_key,producer,request_id));
    CREATE TABLE execution_memory_outbox(id TEXT PRIMARY KEY,body TEXT NOT NULL,delivered INTEGER NOT NULL DEFAULT 0);
    CREATE TRIGGER execution_scopes_immutable BEFORE UPDATE ON execution_scopes BEGIN SELECT RAISE(ABORT,'Immutable execution scope'); END;
    CREATE TRIGGER execution_source_body_immutable BEFORE UPDATE OF id,scope_key,run_id,producer,body,content_hash ON execution_sources BEGIN SELECT RAISE(ABORT,'Immutable execution source'); END;
    CREATE TRIGGER execution_source_retain BEFORE DELETE ON execution_sources BEGIN SELECT RAISE(ABORT,'Retain execution source state'); END;
    CREATE TRIGGER execution_observation_immutable BEFORE UPDATE ON execution_observations BEGIN SELECT RAISE(ABORT,'Immutable execution observation'); END;
    CREATE TRIGGER execution_contribution_immutable BEFORE UPDATE ON execution_contributions BEGIN SELECT RAISE(ABORT,'Immutable execution contribution'); END;
    CREATE TRIGGER growth_revision_immutable BEFORE UPDATE ON growth_revisions BEGIN SELECT RAISE(ABORT,'Immutable growth revision'); END;
    CREATE TRIGGER growth_revision_retain BEFORE DELETE ON growth_revisions BEGIN SELECT RAISE(ABORT,'Retain growth revision'); END;
    CREATE TRIGGER task_execution_result_immutable BEFORE UPDATE ON task_execution_results BEGIN SELECT RAISE(ABORT,'Immutable execution result'); END;
    CREATE TRIGGER execution_outbox_body_immutable BEFORE UPDATE OF id,body ON execution_memory_outbox BEGIN SELECT RAISE(ABORT,'Immutable execution event'); END;
    PRAGMA user_version=7;
  `);
  db.prepare('INSERT INTO memory_schema_migrations VALUES(7,?,0,?)').run(new Date().toISOString(),'add-execution-and-growth-without-legacy-reclassification-v1');
}
