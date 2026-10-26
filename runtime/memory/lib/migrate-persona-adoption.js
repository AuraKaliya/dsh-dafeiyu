export const PERSONA_ADOPTION_TABLES = [
    'persona_trial_selections',
    'persona_trial_selection_revisions',
    'persona_trial_selection_entries',
    'persona_trial_admissions',
    'persona_trial_outcomes',
    'persona_adoption_reviews',
    'persona_adoption_review_outcomes',
    'persona_adoption_decisions',
    'persona_adoption_dependencies',
];
const columns = {
    persona_trial_selections: 'agent_id,scope_key,version',
    persona_trial_selection_revisions: 'agent_id,scope_key,version,body,body_hash',
    persona_trial_selection_entries: 'agent_id,scope_key,selection_version,candidate_id,candidate_version,body,body_hash',
    persona_trial_admissions: 'id,agent_id,scope_key,selection_version,candidate_id,candidate_version,run_id,manifest_hash,body,body_hash',
    persona_trial_outcomes: 'id,admission_id,agent_id,scope_key,run_id,body,body_hash',
    persona_adoption_reviews: 'id,agent_id,scope_key,candidate_id,candidate_version,run_id,producer,body,body_hash',
    persona_adoption_review_outcomes: 'review_id,outcome_id',
    persona_adoption_decisions: 'id,review_id,agent_id,scope_key,candidate_id,candidate_version,eligibility,body,body_hash',
    persona_adoption_dependencies: 'owner_kind,owner_id,owner_version,source_key,body,body_hash',
};
const indexes = [
    'persona_trial_selection_candidate', 'persona_trial_admission_run', 'persona_trial_outcome_run',
    'persona_adoption_review_candidate', 'persona_adoption_decision_review', 'persona_adoption_dependency_source',
];
const immutableTables = PERSONA_ADOPTION_TABLES.filter(table => table !== 'persona_trial_selections');
const triggers = [
    'persona_trial_selection_head_monotonic', 'persona_trial_selection_head_retain',
    ...immutableTables.flatMap(table => [`${table}_immutable`, `${table}_retain`]),
];
/** Read-only shape verification shared by reopen and host preflight. */
export function verifyPersonaAdoptionSchema(db) {
    for (const table of PERSONA_ADOPTION_TABLES)
        db.prepare(`SELECT ${columns[table]} FROM ${table} LIMIT 0`).all();
    for (const name of indexes) {
        if (db.prepare('SELECT type FROM sqlite_master WHERE name=?').get(name)?.type !== 'index')
            throw new Error('Unsupported persona adoption index');
    }
    for (const name of triggers) {
        if (db.prepare('SELECT type FROM sqlite_master WHERE name=?').get(name)?.type !== 'trigger')
            throw new Error('Unsupported persona adoption trigger');
    }
}
/** Caller owns the transaction. v12 appends proof tables without reclassifying or rewriting legacy data. */
export function migratePersonaAdoption(db) {
    const version = Number(db.prepare('PRAGMA user_version').get()?.user_version);
    if (version === 12) {
        verifyPersonaAdoptionSchema(db);
        return;
    }
    if (version !== 11)
        throw new Error('Unsupported persona adoption database');
    db.exec(`
    CREATE TABLE persona_trial_selections(
      agent_id TEXT NOT NULL,scope_key TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>=0),
      PRIMARY KEY(agent_id,scope_key));
    CREATE TABLE persona_trial_selection_revisions(
      agent_id TEXT NOT NULL,scope_key TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>0),
      body TEXT NOT NULL,body_hash TEXT NOT NULL CHECK(length(body_hash)=64),
      PRIMARY KEY(agent_id,scope_key,version),
      FOREIGN KEY(agent_id,scope_key) REFERENCES persona_trial_selections(agent_id,scope_key) ON DELETE RESTRICT);
    CREATE TABLE persona_trial_selection_entries(
      agent_id TEXT NOT NULL,scope_key TEXT NOT NULL,selection_version INTEGER NOT NULL CHECK(selection_version>0),
      candidate_id TEXT NOT NULL,candidate_version INTEGER NOT NULL CHECK(candidate_version>0),
      body TEXT NOT NULL,body_hash TEXT NOT NULL CHECK(length(body_hash)=64),
      PRIMARY KEY(agent_id,scope_key,selection_version,candidate_id,candidate_version),
      FOREIGN KEY(agent_id,scope_key,selection_version) REFERENCES persona_trial_selection_revisions(agent_id,scope_key,version) ON DELETE RESTRICT,
      FOREIGN KEY(candidate_id,candidate_version) REFERENCES persona_candidate_revisions(id,version) ON DELETE RESTRICT);
    CREATE INDEX persona_trial_selection_candidate ON persona_trial_selection_entries(candidate_id,candidate_version);
    CREATE TABLE persona_trial_admissions(
      id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,scope_key TEXT NOT NULL,selection_version INTEGER NOT NULL,
      candidate_id TEXT NOT NULL,candidate_version INTEGER NOT NULL,run_id TEXT NOT NULL,manifest_hash TEXT NOT NULL CHECK(length(manifest_hash)=64),
      body TEXT NOT NULL,body_hash TEXT NOT NULL CHECK(length(body_hash)=64),
      UNIQUE(agent_id,scope_key,run_id,candidate_id,candidate_version,selection_version),
      FOREIGN KEY(agent_id,scope_key,selection_version,candidate_id,candidate_version)
        REFERENCES persona_trial_selection_entries(agent_id,scope_key,selection_version,candidate_id,candidate_version) ON DELETE RESTRICT);
    CREATE INDEX persona_trial_admission_run ON persona_trial_admissions(agent_id,scope_key,run_id);
    CREATE TABLE persona_trial_outcomes(
      id TEXT PRIMARY KEY,admission_id TEXT NOT NULL UNIQUE REFERENCES persona_trial_admissions(id) ON DELETE RESTRICT,
      agent_id TEXT NOT NULL,scope_key TEXT NOT NULL,run_id TEXT NOT NULL,
      body TEXT NOT NULL,body_hash TEXT NOT NULL CHECK(length(body_hash)=64));
    CREATE INDEX persona_trial_outcome_run ON persona_trial_outcomes(agent_id,scope_key,run_id);
    CREATE TABLE persona_adoption_reviews(
      id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,scope_key TEXT NOT NULL,candidate_id TEXT NOT NULL,candidate_version INTEGER NOT NULL,
      run_id TEXT NOT NULL,producer TEXT NOT NULL,body TEXT NOT NULL,body_hash TEXT NOT NULL CHECK(length(body_hash)=64),
      FOREIGN KEY(candidate_id,candidate_version) REFERENCES persona_candidate_revisions(id,version) ON DELETE RESTRICT);
    CREATE INDEX persona_adoption_review_candidate ON persona_adoption_reviews(agent_id,scope_key,candidate_id,candidate_version);
    CREATE TABLE persona_adoption_review_outcomes(
      review_id TEXT NOT NULL REFERENCES persona_adoption_reviews(id) ON DELETE RESTRICT,
      outcome_id TEXT NOT NULL REFERENCES persona_trial_outcomes(id) ON DELETE RESTRICT,
      PRIMARY KEY(review_id,outcome_id));
    CREATE TABLE persona_adoption_decisions(
      id TEXT PRIMARY KEY,review_id TEXT NOT NULL REFERENCES persona_adoption_reviews(id) ON DELETE RESTRICT,
      agent_id TEXT NOT NULL,scope_key TEXT NOT NULL,candidate_id TEXT NOT NULL,candidate_version INTEGER NOT NULL,
      eligibility TEXT NOT NULL CHECK(eligibility IN ('allowed','held')),body TEXT NOT NULL,body_hash TEXT NOT NULL CHECK(length(body_hash)=64),
      FOREIGN KEY(candidate_id,candidate_version) REFERENCES persona_candidate_revisions(id,version) ON DELETE RESTRICT);
    CREATE INDEX persona_adoption_decision_review ON persona_adoption_decisions(review_id,eligibility);
    CREATE TABLE persona_adoption_dependencies(
      owner_kind TEXT NOT NULL CHECK(owner_kind IN ('selection','admission','outcome','review','decision')),
      owner_id TEXT NOT NULL,owner_version INTEGER NOT NULL CHECK(owner_version>0),source_key TEXT NOT NULL,
      body TEXT NOT NULL,body_hash TEXT NOT NULL CHECK(length(body_hash)=64),
      PRIMARY KEY(owner_kind,owner_id,owner_version,source_key));
    CREATE INDEX persona_adoption_dependency_source ON persona_adoption_dependencies(source_key);
    CREATE TRIGGER persona_trial_selection_head_monotonic BEFORE UPDATE ON persona_trial_selections
      WHEN NEW.agent_id<>OLD.agent_id OR NEW.scope_key<>OLD.scope_key OR NEW.version<=OLD.version
      BEGIN SELECT RAISE(ABORT,'Trial selection heads must advance in the same scope'); END;
    CREATE TRIGGER persona_trial_selection_head_retain BEFORE DELETE ON persona_trial_selections
      BEGIN SELECT RAISE(ABORT,'Retain trial selection head'); END;
  `);
    for (const table of immutableTables)
        db.exec(`
    CREATE TRIGGER ${table}_immutable BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Immutable persona adoption record'); END;
    CREATE TRIGGER ${table}_retain BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Retain persona adoption record'); END;
  `);
    db.prepare('INSERT INTO memory_schema_migrations VALUES(12,?,0,?)').run(new Date().toISOString(), 'add-persona-trial-adoption-without-reclassifying-legacy-v1');
    db.exec('PRAGMA user_version=12;');
    verifyPersonaAdoptionSchema(db);
}
