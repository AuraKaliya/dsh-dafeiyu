/** Protocol gate for voice-bound message sources and versioned media delivery; old rows stay byte-identical. */
export function migrateMediaRuntime(db) {
    const version = Number(db.prepare('PRAGMA user_version').get()?.user_version);
    if (version === 4)
        return;
    if (version !== 3)
        throw new Error('RUNTIME_SCHEMA_UNSUPPORTED');
    db.prepare('SELECT * FROM native_deliveries LIMIT 0').all();
    db.exec('PRAGMA user_version=4;');
}
