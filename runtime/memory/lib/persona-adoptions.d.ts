import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { PersonaAccess, PersonaCandidate, PersonaAdoptionReviewRef, PersonaAdoptionDecision, Json } from '#dafeiyu/contracts';
import type { PersonaResolver } from './persona-store.js';
/** Trusted adapter input: model-facing source keys have already been resolved under the live grant. */
export declare const PersonaAdoptionReviewRequestSchema: z.ZodObject<{
    requestId: z.ZodString;
    candidate: z.ZodObject<{
        id: z.ZodUUID;
        version: z.ZodNumber;
    }, z.core.$strict>;
    trialOutcomes: z.ZodArray<z.ZodObject<{
        id: z.ZodUUID;
        hash: z.ZodString;
    }, z.core.$strict>>;
    supports: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        revision: z.ZodNumber;
        authorization: z.ZodOptional<z.ZodObject<{
            taskId: z.ZodUUID;
            taskEpoch: z.ZodNumber;
            grantId: z.ZodUUID;
            grantVersion: z.ZodNumber;
            policyId: z.ZodString;
            policyVersion: z.ZodNumber;
        }, z.core.$strict>>;
        selectionId: z.ZodOptional<z.ZodUUID>;
        range: z.ZodOptional<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strict>>;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution-source">;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">>;
    counters: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        revision: z.ZodNumber;
        authorization: z.ZodOptional<z.ZodObject<{
            taskId: z.ZodUUID;
            taskEpoch: z.ZodNumber;
            grantId: z.ZodUUID;
            grantVersion: z.ZodNumber;
            policyId: z.ZodString;
            policyVersion: z.ZodNumber;
        }, z.core.$strict>>;
        selectionId: z.ZodOptional<z.ZodUUID>;
        range: z.ZodOptional<z.ZodObject<{
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strict>>;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution-source">;
        id: z.ZodUUID;
        agentId: z.ZodString;
        scopeKey: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">>;
    counterCheck: z.ZodDiscriminatedUnion<[z.ZodObject<{
        status: z.ZodLiteral<"found">;
        reason: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        status: z.ZodEnum<{
            unknown: "unknown";
            "not-obtained": "not-obtained";
        }>;
        reason: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        status: z.ZodLiteral<"checked-none">;
        checkedSources: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"memory">;
            revision: z.ZodNumber;
            authorization: z.ZodOptional<z.ZodObject<{
                taskId: z.ZodUUID;
                taskEpoch: z.ZodNumber;
                grantId: z.ZodUUID;
                grantVersion: z.ZodNumber;
                policyId: z.ZodString;
                policyVersion: z.ZodNumber;
            }, z.core.$strict>>;
            selectionId: z.ZodOptional<z.ZodUUID>;
            range: z.ZodOptional<z.ZodObject<{
                start: z.ZodNumber;
                end: z.ZodNumber;
            }, z.core.$strict>>;
            id: z.ZodUUID;
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"execution-source">;
            id: z.ZodUUID;
            agentId: z.ZodString;
            scopeKey: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>], "kind">>;
        reason: z.ZodString;
    }, z.core.$strict>], "status">;
    conclusionScope: z.ZodString;
    targetMaturity: z.ZodEnum<{
        tentative: "tentative";
        established: "established";
    }>;
    limitations: z.ZodArray<z.ZodString>;
    reason: z.ZodString;
}, z.core.$strict>;
interface Versions {
    stageRevision: number;
    selectionVersion: number;
    trialSelectionVersion: number;
}
interface AdoptionHost {
    versions(access: PersonaAccess): Versions;
    event(access: PersonaAccess, type: string, data: Record<string, Json>): void;
}
export declare class PersonaAdoptionStore {
    private readonly db;
    private readonly resolve;
    private readonly host;
    constructor(db: DatabaseSync, resolve: PersonaResolver, host: AdoptionHost);
    private trialEvidence;
    review(access: PersonaAccess, raw: unknown): {
        review: {
            id: string;
            hash: string;
        };
        decision: {
            id: string;
            hash: string;
        };
        eligibility: "held" | "allowed";
        reasons: ("trial-evidence-missing" | "trial-not-closed" | "trial-not-used" | "source-stale" | "scope-mismatch" | "candidate-stale" | "counter-evidence-unresolved" | "coverage-insufficient" | "motivation-mismatch" | "maturity-unsupported" | "review-required")[];
        published: boolean;
    };
    assess(access: PersonaAccess, candidate: PersonaCandidate, raw: PersonaAdoptionReviewRef, versions: Versions): PersonaAdoptionDecision;
    saveDecision(access: PersonaAccess, decision: PersonaAdoptionDecision): void;
    verifyAdopted(access: PersonaAccess, candidate: PersonaCandidate): void;
}
export {};
