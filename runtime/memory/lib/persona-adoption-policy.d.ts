import type { ExecutionScope, Motivation, PersonaAdoptionReasonCode, PersonaAdoptionReview, PersonaCandidate, PersonaSourceEvidence, PersonaTrialAdmission, PersonaTrialOutcome } from '#dafeiyu/contracts';
export interface PersonaAdoptionTrialEvidence {
    readonly admission: PersonaTrialAdmission;
    readonly outcome: PersonaTrialOutcome;
}
export interface PersonaAdoptionPolicyInput {
    readonly candidate: PersonaCandidate;
    readonly review: PersonaAdoptionReview;
    readonly trials: readonly PersonaAdoptionTrialEvidence[];
    readonly sourceEvidence: readonly PersonaSourceEvidence[];
    readonly originalMotivation: Motivation;
    readonly scope: ExecutionScope;
}
export interface PersonaAdoptionPolicyResult {
    readonly eligibility: 'allowed' | 'held';
    readonly reasons: readonly PersonaAdoptionReasonCode[];
}
/** This identity binds qualifications, not a claim that the program proved semantic truth. */
export declare const PERSONA_ADOPTION_POLICY_VERSION: string;
/**
 * Pure qualification policy over already authenticated records. The caller must verify current
 * references, hashes, permissions, source validity, and the core lifecycle certificate before entry,
 * and recheck them at commit. No caller-supplied boolean can substitute for those checks.
 */
export declare function evaluatePersonaAdoption(input: PersonaAdoptionPolicyInput): PersonaAdoptionPolicyResult;
