import type { DatabaseSync } from 'node:sqlite';
/** SQLite journal-mode changes can report BUSY immediately despite busy_timeout. Retry only that setup step within the same time budget. */
export declare function configureSqlite(db: DatabaseSync, busyTimeoutMs?: number): void;
