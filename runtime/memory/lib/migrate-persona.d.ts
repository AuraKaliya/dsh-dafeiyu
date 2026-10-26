import type { DatabaseSync } from 'node:sqlite';
export declare const PERSONA_TABLES: readonly ["persona_candidates", "persona_candidate_revisions", "persona_profiles", "persona_profile_revisions", "persona_dependencies", "persona_requests", "persona_outbox", "continuity_checkpoints", "task_intent_events"];
/** v8 adds independent persona aggregates. No existing memory, boundary or task body is rewritten. */
export declare function migratePersona(db: DatabaseSync): void;
