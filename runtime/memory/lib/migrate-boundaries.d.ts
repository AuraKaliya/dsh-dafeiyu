import type { DatabaseSync } from 'node:sqlite';
/** Caller owns BEGIN IMMEDIATE. Recheck the version under that lock for concurrent opens.
 * No old row, fingerprint, content hash, tombstone, source fence or generation is rewritten. */
export declare function migrateMemoryBoundaries(db: DatabaseSync): void;
