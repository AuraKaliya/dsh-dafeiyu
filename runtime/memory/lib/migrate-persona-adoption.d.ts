import type { DatabaseSync } from 'node:sqlite';
export declare const PERSONA_ADOPTION_TABLES: readonly ["persona_trial_selections", "persona_trial_selection_revisions", "persona_trial_selection_entries", "persona_trial_admissions", "persona_trial_outcomes", "persona_adoption_reviews", "persona_adoption_review_outcomes", "persona_adoption_decisions", "persona_adoption_dependencies"];
/** Read-only shape verification shared by reopen and host preflight. */
export declare function verifyPersonaAdoptionSchema(db: DatabaseSync): void;
/** Caller owns the transaction. v12 appends proof tables without reclassifying or rewriting legacy data. */
export declare function migratePersonaAdoption(db: DatabaseSync): void;
