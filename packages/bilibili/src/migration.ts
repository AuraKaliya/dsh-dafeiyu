import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import type { StorageIdentity } from '@dafeiyu/journal';
import { BILI_APPLICATION_ID, BILI_SCHEMA_VERSION, biliHash } from './store.js';

export type BiliMigrationState = 'missing' | 'current' | 'upgradable' | 'unsupported';
export interface BiliMigrationInspection {
    readonly exists: boolean;
    readonly version: number;
    readonly applicationId: number;
    readonly integrity: boolean;
    readonly identityMatches: boolean;
    readonly state: BiliMigrationState;
}

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
        const state: BiliMigrationState = applicationId !== BILI_APPLICATION_ID ? 'unsupported'
            : version === BILI_SCHEMA_VERSION ? 'current'
                : version === 2 || version === 3 ? 'upgradable' : 'unsupported';
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

/**
 * Explicit v2/v3 -> v4 migration. Identity, integrity and version are checked
 * before any write; the backup is taken before the transaction opens.
 */
export function migrateBiliStorage(file: string, identity: StorageIdentity, options: { backup: string }): BiliMigrationResult {
    const before = inspectBiliMigration(file, identity);
    if (before.state === 'current') return { state: 'current', migrated: false, version: before.version };
    if (before.state === 'missing') throw new Error('BILI_INITIALIZATION_REQUIRED');
    if (before.state === 'unsupported') throw new Error('BILI_MIGRATION_UNSUPPORTED');
    if (!before.integrity) throw new Error('BILI_MIGRATION_INTEGRITY_FAILED');
    if (!before.identityMatches) throw new Error('BILI_IDENTITY_MISMATCH');

    mkdirSync(dirname(options.backup), { recursive: true });
    copyFileSync(file, options.backup);

    const db = new DatabaseSync(file);
    try {
        db.exec('PRAGMA busy_timeout=5000;BEGIN IMMEDIATE');
        try {
            db.exec('CREATE TABLE IF NOT EXISTS bili_reading_legacy(bvid TEXT PRIMARY KEY,body TEXT NOT NULL,updated_at INTEGER NOT NULL);');
            if (before.version === 3) {
            db.exec('INSERT OR REPLACE INTO bili_reading_legacy(bvid,body,updated_at) SELECT bvid,body,updated_at FROM bili_reading;');
                db.exec('INSERT OR REPLACE INTO bili_reading_legacy(bvid,body,updated_at) SELECT bvid,body,updated_at FROM bili_reading;');
                db.exec('DROP TABLE bili_reading;');
            }
            db.exec('CREATE TABLE bili_reading(owner TEXT NOT NULL,bvid TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(owner,bvid));');
            db.exec('CREATE TABLE bili_reading_receipts(owner TEXT NOT NULL,request_id TEXT NOT NULL,bvid TEXT NOT NULL,version INTEGER NOT NULL,PRIMARY KEY(owner,request_id));');
            db.exec('CREATE TABLE bili_reading_history(owner TEXT NOT NULL,bvid TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL,fingerprint TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(owner,bvid,version));');
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
