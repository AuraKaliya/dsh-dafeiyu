export const QQ_APPLICATION_ID = 0x44465131;
export const QQ_SCHEMA_VERSION = 5;
const tables = {
    messages: 'CREATE TABLE messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,route TEXT NOT NULL,id TEXT NOT NULL,sender TEXT NOT NULL,text TEXT NOT NULL,UNIQUE(route,id))',
    receipts: 'CREATE TABLE receipts(reply_id TEXT PRIMARY KEY,platform_id TEXT NOT NULL)',
    handled: 'CREATE TABLE handled(route TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(route,id))',
};
// The unversioned connector had exactly these definitions. Do not adopt arbitrary databases.
const normalize = (sql) => sql.toLowerCase().replace(/\bif\s+not\s+exists\b/g, '').replace(/[\s;]+/g, '');
const groupTable = 'CREATE TABLE qq_group_snapshots(account TEXT PRIMARY KEY,at TEXT NOT NULL,revision INTEGER NOT NULL,groups_json TEXT NOT NULL)';
const cacheTables = {
    qq_message_meta: 'CREATE TABLE qq_message_meta(route TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,hash TEXT NOT NULL,deleted INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(route,id))',
    qq_cache_state: 'CREATE TABLE qq_cache_state(route TEXT PRIMARY KEY,epoch INTEGER NOT NULL)',
    qq_browse_snapshots: 'CREATE TABLE qq_browse_snapshots(id TEXT PRIMARY KEY,instance_id TEXT NOT NULL,owner TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,body TEXT NOT NULL,expires_at INTEGER NOT NULL,UNIQUE(instance_id,owner,request_id))',
};
const deliveryTables = {
    qq_delivery_plans: 'CREATE TABLE qq_delivery_plans(reply_id TEXT PRIMARY KEY,plan_hash TEXT NOT NULL,body TEXT NOT NULL)',
    qq_delivery_segments: 'CREATE TABLE qq_delivery_segments(reply_id TEXT NOT NULL,position INTEGER NOT NULL,state TEXT NOT NULL,receipt TEXT,code TEXT,PRIMARY KEY(reply_id,position))',
};
// Versioned JSON bodies let 5E add media delivery protocols without rewriting legacy text rows.
const mediaTables = {
    qq_media_sources: 'CREATE TABLE qq_media_sources(id TEXT PRIMARY KEY,route TEXT NOT NULL,message_id TEXT NOT NULL,position INTEGER NOT NULL,version INTEGER NOT NULL,deleted INTEGER NOT NULL,body TEXT NOT NULL,body_hash TEXT NOT NULL,private_body TEXT,updated_at INTEGER NOT NULL,UNIQUE(route,message_id,position))',
    qq_media_drafts: 'CREATE TABLE qq_media_drafts(id TEXT PRIMARY KEY,body TEXT NOT NULL,body_hash TEXT NOT NULL,state TEXT NOT NULL)',
    qq_media_deliveries: 'CREATE TABLE qq_media_deliveries(reply_id TEXT PRIMARY KEY,plan_hash TEXT NOT NULL,body TEXT NOT NULL)',
    qq_media_parts: 'CREATE TABLE qq_media_parts(reply_id TEXT NOT NULL,position INTEGER NOT NULL,state TEXT NOT NULL,receipt TEXT,code TEXT,PRIMARY KEY(reply_id,position))',
};
/** Read-only even on a legacy store. Opening a service is deliberately separate from inspection. */
export function inspectQqSchema(db) {
    const version = Number(db.prepare('PRAGMA user_version').get()?.user_version);
    const applicationId = Number(db.prepare('PRAGMA application_id').get()?.application_id);
    const objects = db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT GLOB 'sqlite_*' ORDER BY name").all();
    const fresh = version === 0 && applicationId === 0 && objects.length === 0;
    const expected = [...Object.entries(tables), ...(version >= 2 ? [['qq_group_snapshots', groupTable]] : []), ...(version >= 3 ? Object.entries(cacheTables) : []), ...(version >= 4 ? Object.entries(deliveryTables) : []), ...(version >= 5 ? Object.entries(mediaTables) : [])];
    const structure = objects.length === expected.length && expected.every(([name, sql]) => {
        const found = objects.find(item => item.name === name);
        return found?.type === 'table' && typeof found.sql === 'string' && normalize(found.sql) === normalize(sql);
    });
    const supported = structure && (version === 0 && applicationId === 0 || [1, 2, 3, 4, 5].includes(version) && applicationId === QQ_APPLICATION_ID);
    return { version, applicationId, fresh, supported };
}
/** Caller must have admitted a fresh database or an explicitly authorized migration. */
export function initializeQqSchema(db, migrate) {
    db.exec('BEGIN IMMEDIATE');
    try {
        const current = inspectQqSchema(db);
        if (!current.fresh && !current.supported)
            throw new Error('QQ_STORAGE_UNSUPPORTED');
        if (!current.fresh && current.version < QQ_SCHEMA_VERSION && !migrate)
            throw new Error('QQ_MIGRATION_REQUIRED');
        if (current.fresh)
            for (const sql of Object.values(tables))
                db.exec(sql);
        if (current.fresh || current.version < 2)
            db.exec(groupTable);
        if (current.fresh || current.version < 3)
            for (const sql of Object.values(cacheTables))
                db.exec(sql);
        if (current.fresh || current.version < 4)
            for (const sql of Object.values(deliveryTables))
                db.exec(sql);
        if (current.fresh || current.version < 5)
            for (const sql of Object.values(mediaTables))
                db.exec(sql);
        if (current.fresh || current.version < QQ_SCHEMA_VERSION) {
            db.exec(`PRAGMA application_id=${QQ_APPLICATION_ID}; PRAGMA user_version=${QQ_SCHEMA_VERSION};`);
        }
        db.exec('COMMIT');
    }
    catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
}
