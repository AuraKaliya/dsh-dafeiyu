import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { PersonaAccess, PersonaCandidate, PersonaSourceRef, PersonaSourceEvidence, PersonaRecordRef } from '#dafeiyu/contracts';
import type { PersonaMaterial, PersonaResolver } from './persona-store.js';
export declare const PERSONA_ADOPTION_POLICY: string;
export type PersonaProofTable = 'persona_trial_admissions' | 'persona_trial_outcomes' | 'persona_adoption_reviews' | 'persona_adoption_decisions';
export type PersonaProofOwner = 'selection' | 'admission' | 'outcome' | 'review' | 'decision';
export declare function readPersonaCandidate(db: DatabaseSync, access: PersonaAccess, id: string, version?: number): PersonaCandidate;
export declare function readPersonaProof<T>(db: DatabaseSync, access: PersonaAccess, table: PersonaProofTable, raw: PersonaRecordRef, schema: z.ZodType<T>): T;
/** Legacy producers remain unknown; a primary label alone does not assert a real-world observation. */
export declare function describePersonaMaterial(ref: PersonaSourceRef, material: PersonaMaterial): PersonaSourceEvidence;
export declare function describePersonaSources(access: PersonaAccess, refs: readonly PersonaSourceRef[], resolve: PersonaResolver): PersonaSourceEvidence[];
export declare function savePersonaDependencies(db: DatabaseSync, kind: PersonaProofOwner, id: string, version: number, refs: readonly PersonaSourceRef[]): void;
