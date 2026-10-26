import type { DatabaseSync } from 'node:sqlite';
export declare const EXECUTION_MEMORY_TABLES: readonly ["execution_scopes", "execution_sources", "execution_observations", "execution_contributions", "growth_selections", "growth_revisions", "growth_requests", "task_execution_results", "execution_memory_requests", "execution_memory_outbox"];
/** Additive v7 migration. No old body, boundary, request fingerprint or tombstone is rewritten. */
export declare function migrateExecutionMemory(db: DatabaseSync): void;
