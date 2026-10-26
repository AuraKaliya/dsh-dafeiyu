export function migratePersonaRuntime(db) {
    const version = Number(db.prepare('PRAGMA user_version').get()?.user_version);
    if (version === 2 || version === 3 || version === 4) {
        db.prepare('SELECT * FROM run_persona_manifests LIMIT 0').all();
        return;
    }
    if (version !== 1)
        throw new Error('RUNTIME_SCHEMA_UNSUPPORTED');
    db.exec(`CREATE TABLE run_persona_manifests(run_id TEXT PRIMARY KEY REFERENCES runs(id),body TEXT NOT NULL,body_hash TEXT NOT NULL);
    CREATE TRIGGER run_persona_manifest_immutable BEFORE UPDATE ON run_persona_manifests BEGIN SELECT RAISE(ABORT,'Immutable persona manifest');END;
    CREATE TRIGGER run_persona_manifest_retain BEFORE DELETE ON run_persona_manifests BEGIN SELECT RAISE(ABORT,'Retain persona manifest');END;
    PRAGMA user_version=2;`);
}
