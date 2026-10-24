import type { DatabaseSync } from 'node:sqlite';

export const PERSONA_TABLES=['persona_candidates','persona_candidate_revisions','persona_profiles','persona_profile_revisions','persona_dependencies',
  'persona_requests','persona_outbox','continuity_checkpoints','task_intent_events'] as const;

/** v8 adds independent persona aggregates. No existing memory, boundary or task body is rewritten. */
export function migratePersona(db:DatabaseSync):void{
  const version=Number(db.prepare('PRAGMA user_version').get()?.user_version);
if(version===8||version===9||version===10){for(const table of PERSONA_TABLES)db.prepare(`SELECT * FROM ${table} LIMIT 0`).all();return;}
  if(version!==7)throw new Error('Unsupported persona memory schema');
  db.exec(`
    CREATE TABLE persona_candidates(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>0),state TEXT NOT NULL);
    CREATE TABLE persona_candidate_revisions(id TEXT NOT NULL REFERENCES persona_candidates(id),version INTEGER NOT NULL,body TEXT NOT NULL,body_hash TEXT NOT NULL,PRIMARY KEY(id,version));
    CREATE TABLE persona_profiles(agent_id TEXT PRIMARY KEY,revision INTEGER NOT NULL CHECK(revision>=0));
    CREATE TABLE persona_profile_revisions(agent_id TEXT NOT NULL REFERENCES persona_profiles(agent_id),revision INTEGER NOT NULL,body TEXT NOT NULL,body_hash TEXT NOT NULL,PRIMARY KEY(agent_id,revision));
    CREATE TABLE persona_dependencies(owner_kind TEXT NOT NULL,owner_id TEXT NOT NULL,owner_version INTEGER NOT NULL,source_key TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(owner_kind,owner_id,owner_version,source_key));
    CREATE INDEX persona_dependencies_source ON persona_dependencies(source_key);
    CREATE TABLE persona_requests(agent_id TEXT NOT NULL,producer TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,receipt TEXT NOT NULL,PRIMARY KEY(agent_id,producer,request_id));
    CREATE TABLE persona_outbox(ordinal INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,body TEXT NOT NULL,delivered INTEGER NOT NULL DEFAULT 0 CHECK(delivered IN (0,1)));
    CREATE TABLE continuity_checkpoints(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,task_id TEXT NOT NULL REFERENCES task_workspaces(id),run_id TEXT NOT NULL,body TEXT NOT NULL,body_hash TEXT NOT NULL);
    CREATE TABLE task_intent_events(ordinal INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,agent_id TEXT NOT NULL,task_id TEXT NOT NULL REFERENCES task_workspaces(id),task_epoch INTEGER NOT NULL,producer TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,body TEXT NOT NULL,UNIQUE(agent_id,producer,request_id));
    CREATE TRIGGER persona_candidate_revision_immutable BEFORE UPDATE ON persona_candidate_revisions BEGIN SELECT RAISE(ABORT,'Immutable candidate revision');END;
    CREATE TRIGGER persona_candidate_revision_retain BEFORE DELETE ON persona_candidate_revisions BEGIN SELECT RAISE(ABORT,'Retain candidate revision');END;
    CREATE TRIGGER persona_profile_revision_immutable BEFORE UPDATE ON persona_profile_revisions BEGIN SELECT RAISE(ABORT,'Immutable profile revision');END;
    CREATE TRIGGER persona_profile_revision_retain BEFORE DELETE ON persona_profile_revisions BEGIN SELECT RAISE(ABORT,'Retain profile revision');END;
    CREATE TRIGGER persona_dependency_immutable BEFORE UPDATE ON persona_dependencies BEGIN SELECT RAISE(ABORT,'Immutable persona dependency');END;
    CREATE TRIGGER persona_dependency_retain BEFORE DELETE ON persona_dependencies BEGIN SELECT RAISE(ABORT,'Retain persona dependency');END;
    CREATE TRIGGER persona_request_immutable BEFORE UPDATE ON persona_requests BEGIN SELECT RAISE(ABORT,'Immutable persona request');END;
    CREATE TRIGGER persona_outbox_immutable BEFORE UPDATE OF id,body ON persona_outbox BEGIN SELECT RAISE(ABORT,'Immutable persona event');END;
    CREATE TRIGGER continuity_checkpoint_immutable BEFORE UPDATE ON continuity_checkpoints BEGIN SELECT RAISE(ABORT,'Immutable continuity checkpoint');END;
    CREATE TRIGGER continuity_checkpoint_retain BEFORE DELETE ON continuity_checkpoints BEGIN SELECT RAISE(ABORT,'Retain continuity checkpoint');END;
    CREATE TRIGGER task_intent_immutable BEFORE UPDATE ON task_intent_events BEGIN SELECT RAISE(ABORT,'Immutable task intent');END;
    CREATE TRIGGER task_intent_retain BEFORE DELETE ON task_intent_events BEGIN SELECT RAISE(ABORT,'Retain task intent');END;
    PRAGMA user_version=8;
  `);
  db.prepare('INSERT INTO memory_schema_migrations VALUES(8,?,0,?)').run(new Date().toISOString(),'add-persona-and-continuity-without-reclassifying-legacy-v1');
}
