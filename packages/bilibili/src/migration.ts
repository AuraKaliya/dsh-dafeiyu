import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

import type { StorageIdentity } from '@dafeiyu/journal';
import { BILI_APPLICATION_ID, BILI_SCHEMA_VERSION, BILI_TABLES,biliHash } from './store.js';

export type BiliMigrationState = 'missing' | 'current' | 'upgradable' | 'unsupported';
export interface BiliMigrationInspection {
    readonly exists: boolean;
    readonly version: number;
    readonly applicationId: number;
    readonly integrity: boolean;
    readonly identityMatches: boolean;
    readonly state: BiliMigrationState;
}
const V6_TABLES=['bili_auth_meta','bili_verifications'];
const BASE_TABLES=BILI_TABLES.filter(table=>!V6_TABLES.includes(table));
const FAILURE_KINDS=new Set(['rate-limit','risk','login','permission','verification','network','response','cancelled','local']);

/** Read-only preflight. Never creates, migrates or repairs anything. */
export function inspectBiliMigration(file: string, identity: StorageIdentity): BiliMigrationInspection {
    if (!existsSync(file)) return { exists: false, version: 0, applicationId: 0, integrity: false, identityMatches: false, state: 'missing' };
    const db = new DatabaseSync(file, { readOnly: true });
    try {
        const version = Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0);
        const applicationId = Number(db.prepare('PRAGMA application_id').get()?.application_id ?? 0);
        const integrity = String(db.prepare('PRAGMA integrity_check').get()?.integrity_check ?? '') === 'ok';
        let identityMatches = false;
        try {
            const row = db.prepare('SELECT body FROM bili_metadata WHERE id=1').get();
            identityMatches = !!row && biliHash(JSON.parse(String(row.body))) === biliHash(identity);
        } catch { /* A missing metadata table is reported as a mismatch, not as a write opportunity. */ }
        let layout=true;try{
          // The v6-only tables are created by the explicit migration, so a pre-v6 layout checks the base set.
          for(const table of BASE_TABLES.filter(table=>!table.startsWith('bili_reading')&&table!=='bili_comment_cursors'))db.prepare(`SELECT * FROM ${table} LIMIT 0`).all();
          if(version===3){const columns=db.prepare('PRAGMA table_info(bili_reading)').all().map(row=>row.name);layout=columns.length===3&&columns.includes('bvid')&&columns.includes('body')&&columns.includes('updated_at');}
          if(version>=4){db.prepare('SELECT owner,bvid,version,body,updated_at FROM bili_reading LIMIT 0').all();db.prepare('SELECT owner,request_id,bvid,version FROM bili_reading_receipts LIMIT 0').all();}
          if(version===BILI_SCHEMA_VERSION)for(const table of BILI_TABLES)db.prepare(`SELECT * FROM ${table} LIMIT 0`).all();
        }catch{layout=false;}
        const state: BiliMigrationState = applicationId !== BILI_APPLICATION_ID||!layout ? 'unsupported'
            : version === BILI_SCHEMA_VERSION ? 'current'
                : [2,3,4,5].includes(version) ? 'upgradable' : 'unsupported';
        return { exists: true, version, applicationId, integrity, identityMatches, state };
    } finally {
        db.close();
    }
}

export interface BiliMigrationResult {
    readonly state: 'current';
    readonly migrated: boolean;
    readonly version: number;
    readonly backup?: string;
}

function tableCounts(db:DatabaseSync):Record<string,number>{
    const counts:Record<string,number>={};
    for(const table of BASE_TABLES)counts[table]=Number((db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {n?:number}).n??0);
    return counts;
}
/** Content digests prove the upgrade kept every existing row, not just the row count. */
function tableDigests(db:DatabaseSync):Record<string,string>{
    const digests:Record<string,string>={};
    // The control row is intentionally rewritten from the old shape; it is checked by its own migration.
    for(const table of BASE_TABLES.filter(table=>table!=='bili_http_control')){
        const rows=(db.prepare(`SELECT * FROM ${table}`).all() as Record<string,unknown>[]).map(row=>JSON.stringify(row)).sort();
        digests[table]=createHash('sha256').update(rows.join('\n')).digest('hex');
    }
    return digests;
}
/** v2/v3/v4 reading layout -> the v5 reading layout. */
function upgradeReadingLayout(db:DatabaseSync,version:number):void{
    db.exec('CREATE TABLE IF NOT EXISTS bili_reading_legacy(bvid TEXT PRIMARY KEY,body TEXT NOT NULL,updated_at INTEGER NOT NULL);');
    if (version === 3) {
        db.exec('INSERT OR REPLACE INTO bili_reading_legacy(bvid,body,updated_at) SELECT bvid,body,updated_at FROM bili_reading;');
        db.exec('DROP TABLE bili_reading;');
    }
    db.exec('CREATE TABLE IF NOT EXISTS bili_reading(owner TEXT NOT NULL,bvid TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(owner,bvid));');
    db.exec('CREATE TABLE IF NOT EXISTS bili_reading_receipts(owner TEXT NOT NULL,request_id TEXT NOT NULL,bvid TEXT NOT NULL,version INTEGER NOT NULL,PRIMARY KEY(owner,request_id));');
    db.exec('CREATE TABLE IF NOT EXISTS bili_reading_history(owner TEXT NOT NULL,bvid TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL,fingerprint TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(owner,bvid,version));');
    db.exec('CREATE TABLE IF NOT EXISTS bili_comment_cursors(id TEXT PRIMARY KEY,owner TEXT NOT NULL,hash TEXT NOT NULL,body TEXT NOT NULL,UNIQUE(owner,hash));');
    db.exec('CREATE INDEX IF NOT EXISTS bili_reading_updated ON bili_reading(owner,updated_at DESC);');
    for(const row of db.prepare('SELECT owner,bvid,version,body,updated_at FROM bili_reading').all()){
      db.prepare('INSERT OR IGNORE INTO bili_reading_history VALUES(?,?,?,?,?,?)').run(String(row.owner),String(row.bvid),Number(row.version),String(row.body),'legacy:'+biliHash(JSON.parse(String(row.body))),Number(row.updated_at));
    }
}
/**
 * v5 -> v6: add authentication/verification metadata and rewrite the single pause
 * row into scoped pauses. Evidence decides the scope; without evidence the pause is
 * shared (conservative) and cannot be auto-released by a management probe.
 */
function upgradeToV6(db:DatabaseSync):void{
    const before=tableCounts(db),beforeDigests=tableDigests(db);
    db.exec(`CREATE TABLE IF NOT EXISTS bili_auth_meta(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS bili_verifications(id TEXT PRIMARY KEY,at INTEGER NOT NULL,state TEXT NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS bili_verifications_recent ON bili_verifications(at DESC);`);
    const row=db.prepare('SELECT body FROM bili_http_control WHERE id=1').get();
    if(row){
        const raw=JSON.parse(String(row.body)) as Record<string,unknown>;
        if(!('version' in raw)){
            const old=raw as {failures?:unknown;kind?:unknown;endpoint?:unknown;held?:unknown};
            const failures=typeof old.failures==='number'&&Number.isInteger(old.failures)&&old.failures>=0?old.failures:0;
            const kind=typeof old.kind==='string'&&FAILURE_KINDS.has(old.kind)?old.kind:'response';
            const endpoint=typeof old.endpoint==='string'?old.endpoint.slice(0,40):null;
            const held=old.held===true;
            let scope:'anonymous-http'|'shared'='shared';
            if(failures>0&&kind&&endpoint){
                const evidence=db.prepare("SELECT body FROM bili_http_attempts WHERE json_extract(body,'$.outcome')='failed' AND json_extract(body,'$.kind')=? AND json_extract(body,'$.endpoint')=? ORDER BY at DESC,rowid DESC LIMIT 1").get(kind,endpoint);
                if(evidence){const attempt=JSON.parse(String((evidence as {body?:unknown}).body));if(attempt?.transport==='http'&&attempt?.auth==='anonymous')scope='anonymous-http';}
            }
            const blocked=Number((db.prepare('SELECT blocked_until FROM bili_clock WHERE id=1').get() as {blocked_until?:number}|undefined)?.blocked_until??0);
            const pauses=failures>0?[{scope,uid:null,endpoint,kind,failures,held,until:Math.max(0,blocked),updatedAt:Date.now()}]:[];
            db.prepare('UPDATE bili_http_control SET body=? WHERE id=1').run(JSON.stringify({version:2,pauses,probe:null,permit:null}));
        }else if(raw.version!==2)throw new Error('BILI_MIGRATION_UNSUPPORTED');
    }
    const after=tableCounts(db),afterDigests=tableDigests(db);
    for(const [table,count] of Object.entries(before))if(after[table]!==count)throw new Error('BILI_MIGRATION_VERIFY_FAILED');
    for(const [table,digest] of Object.entries(beforeDigests))if(afterDigests[table]!==digest)throw new Error('BILI_MIGRATION_VERIFY_FAILED');
}

/**
 * Explicit v2/v3/v4 -> v5 -> v6 migration. Identity, integrity and version are checked
 * before any write; the backup is taken before the transaction opens.
 */
export function migrateBiliStorage(file: string, identity: StorageIdentity, options: { backup: string }): BiliMigrationResult {
    const before = inspectBiliMigration(file, identity);
    if (before.state === 'missing') throw new Error('BILI_INITIALIZATION_REQUIRED');
    if (before.state === 'unsupported') throw new Error('BILI_MIGRATION_UNSUPPORTED');
    if (!before.integrity) throw new Error('BILI_MIGRATION_INTEGRITY_FAILED');
    if (!before.identityMatches) throw new Error('BILI_IDENTITY_MISMATCH');
    if (before.state === 'current') return { state: 'current', migrated: false, version: before.version };

    mkdirSync(dirname(options.backup), { recursive: true });
    if (existsSync(options.backup)) throw new Error('BILI_MIGRATION_BACKUP_EXISTS');
    // A single-file copy loses committed pages still in the WAL; VACUUM INTO is a consistent snapshot.
    const snapshot = new DatabaseSync(file, { readOnly: true });
    try {
        snapshot.exec(`VACUUM INTO '${options.backup.replace(/'/g, "''")}'`);
    } finally {
        snapshot.close();
    }
    const backupState = inspectBiliMigration(options.backup, identity);
    if (backupState.state === 'missing' || backupState.state === 'unsupported' || !backupState.integrity || !backupState.identityMatches || backupState.version !== before.version) throw new Error('BILI_MIGRATION_VERIFY_FAILED');

    const db = new DatabaseSync(file);
    try {
        db.exec('PRAGMA busy_timeout=5000;BEGIN IMMEDIATE');
        try {
            if(before.version<5)upgradeReadingLayout(db,before.version);
            if(before.version<6)upgradeToV6(db);
            db.exec(`PRAGMA user_version=${BILI_SCHEMA_VERSION};`);
            db.exec('COMMIT');
        } catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }
    } finally {
        db.close();
    }

    const after = inspectBiliMigration(file, identity);
    if (after.state !== 'current' || !after.identityMatches || !after.integrity) throw new Error('BILI_MIGRATION_VERIFY_FAILED');
    return { state: 'current', migrated: true, version: after.version, backup: options.backup };
}
