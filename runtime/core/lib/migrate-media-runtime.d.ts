import type { DatabaseSync } from 'node:sqlite';
/** Protocol gate for voice-bound message sources and versioned media delivery; old rows stay byte-identical. */
export declare function migrateMediaRuntime(db: DatabaseSync): void;
