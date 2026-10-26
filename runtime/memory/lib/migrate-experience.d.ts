import type { DatabaseSync } from 'node:sqlite';
export declare const EXPERIENCE_TABLES: readonly ["experience_items", "experience_revisions", "experience_relations", "maintenance_events", "maintenance_requests", "maintenance_receipts", "maintenance_watermarks"];
export declare function migrateExperience(db: DatabaseSync): void;
