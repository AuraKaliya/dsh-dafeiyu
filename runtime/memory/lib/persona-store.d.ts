import type { DatabaseSync } from 'node:sqlite';
import type { PersonaAccess, PersonaSourceRef, PersonaStage, PreparedPersona, PreparedPersonaEntry, PreparedPersonaTrialEntry, PersonaSourceEvidence, SourceDependency } from '#dafeiyu/contracts';
export interface PersonaMaterial {
    text: string;
    dependencies: PersonaSourceRef[];
    rootSources: string[];
    evidence?: PersonaSourceEvidence;
}
export type PersonaResolver = (access: PersonaAccess, ref: PersonaSourceRef) => PersonaMaterial | null;
/** One authority for candidate, stage and scene-selection changes. Bodies remain source references. */
export declare class PersonaStore {
    private readonly db;
    private readonly transaction;
    private readonly resolve;
    private readonly trials;
    private readonly adoptions;
    constructor(db: DatabaseSync, transaction: <T>(work: () => T) => T, resolve: PersonaResolver);
    private promotedTrial;
    private request;
    private event;
    private candidate;
    private checked;
    private checkExperienceBasis;
    private writeCandidate;
    stage(agentId: string): PersonaStage;
    private writeStage;
    private selection;
    private writeSelection;
    propose(access: PersonaAccess, raw: unknown): {
        id: `${string}-${string}-${string}-${string}-${string}`;
        version: number;
        state: string;
    };
    review(access: PersonaAccess, raw: unknown): {
        id: string;
        version: number;
        state: "withdrawn" | "dormant" | "superseded" | "proposed" | "held" | "trial" | "adopted" | "rejected";
    };
    selectTrial(access: PersonaAccess, raw: unknown): {
        selection: {
            agentId: string;
            scopeKey: string;
            version: number;
            hash: string;
        };
        entries: {
            candidate: {
                id: string;
                version: number;
            };
            applicability: string;
            exitConditions: string[];
        }[];
    };
    admitTrial(access: PersonaAccess, raw: unknown): {
        id: string;
        hash: string;
    }[];
    completeTrial(access: PersonaAccess, raw: unknown): {
        id: string;
        hash: string;
    }[];
    validateHistoricalTrial(access: PersonaAccess, dependency: Extract<SourceDependency, {
        kind: 'context';
    }>): boolean;
    reviewAdoption(access: PersonaAccess, raw: unknown): {
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
    publish(access: PersonaAccess, raw: unknown): {
        stageRevision: number;
        selectionVersion: number;
        entries: {
            id: string;
            version: number;
        }[];
    };
    select(access: PersonaAccess, raw: unknown): {
        selectionVersion: number;
    };
    withdraw(access: PersonaAccess, raw: unknown): {
        id: string;
        version: number;
        state: "withdrawn";
    };
    prepare(access: PersonaAccess): PreparedPersona;
    validate(access: PersonaAccess, entry: PreparedPersonaEntry | PreparedPersonaTrialEntry): boolean;
    status(access: PersonaAccess): {
        trialSelectionVersion: number;
        trialSelection: {
            agentId: string;
            scopeKey: string;
            version: number;
            hash: string;
        } | null;
        trialEntries: {
            candidate: {
                id: string;
                version: number;
            };
            applicability: string;
            exitConditions: string[];
        }[];
        trialOutcomes: {
            ref: {
                id: string;
                hash: string;
            };
            candidate: {
                id: string;
                version: number;
            };
            runId: string;
            state: "completed" | "failed" | "cancelled" | "interrupted";
            gaps: string[];
        }[];
        stageRevision: number;
        selectionVersion: number;
        legacySelection: boolean;
        candidates: {
            id: string;
            version: number;
            state: "withdrawn" | "dormant" | "superseded" | "proposed" | "held" | "trial" | "adopted" | "rejected";
            kind: "preference" | "view" | "interest" | "habit" | "relationship" | "value-application";
            applicability: string;
            maturity: string;
            available: boolean;
        }[];
    };
    drainOutbox(append: (body: unknown, id: string) => void): number;
}
