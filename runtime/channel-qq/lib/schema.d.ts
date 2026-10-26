import type { DatabaseSync } from 'node:sqlite';
export declare const QQ_APPLICATION_ID = 1145458993;
export declare const QQ_SCHEMA_VERSION = 5;
export interface QqSchemaInspection {
    version: number;
    applicationId: number;
    fresh: boolean;
    supported: boolean;
}
/** Read-only even on a legacy store. Opening a service is deliberately separate from inspection. */
export declare function inspectQqSchema(db: DatabaseSync): QqSchemaInspection;
/** Caller must have admitted a fresh database or an explicitly authorized migration. */
export declare function initializeQqSchema(db: DatabaseSync, migrate: boolean): void;
