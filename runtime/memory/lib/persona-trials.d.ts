import type { DatabaseSync } from 'node:sqlite';
import type { PersonaAccess, PersonaCandidate, PersonaTrialSelection, PersonaTrialSelectionRef, PersonaTrialSelectInput, PersonaTrialAdmissionInput, PersonaTrialAdmissionRef, PersonaTrialCompletionInput, PersonaTrialOutcomeRef, PersonaTrialOutcome, PreparedPersonaTrialEntry, SourceDependency, Json } from '#dafeiyu/contracts';
import type { PersonaMaterial, PersonaResolver } from './persona-store.js';
interface TrialHost {
    check(access: PersonaAccess, candidate: PersonaCandidate): PersonaMaterial;
    event(access: PersonaAccess, type: string, data: Record<string, Json>): void;
    promoted(access: PersonaAccess, trial: PersonaCandidate, current: PersonaCandidate, requireSelection?: boolean): boolean;
}
/** Trial records are observations of use. Adoption is a separate, revalidated transaction. */
export declare class PersonaTrialStore {
    private readonly db;
    private readonly resolve;
    private readonly host;
    constructor(db: DatabaseSync, resolve: PersonaResolver, host: TrialHost);
    selection(access: PersonaAccess, version?: number): {
        version: number;
        body: PersonaTrialSelection | null;
        ref: PersonaTrialSelectionRef | null;
    };
    select(access: PersonaAccess, raw: PersonaTrialSelectInput): {
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
    private writeSelection;
    private projection;
    prepare(access: PersonaAccess): {
        version: number;
        entries: PreparedPersonaTrialEntry[];
        omitted: number;
    };
    admit(access: PersonaAccess, raw: PersonaTrialAdmissionInput): PersonaTrialAdmissionRef[];
    complete(access: PersonaAccess, raw: PersonaTrialCompletionInput): PersonaTrialOutcomeRef[];
    private assertRun;
    private sameRecord;
    readOutcome(access: PersonaAccess, ref: PersonaTrialOutcomeRef): PersonaTrialOutcome;
    historical(access: PersonaAccess, dependency: Extract<SourceDependency, {
        kind: 'context';
    }>): boolean;
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
    };
    remove(access: PersonaAccess, ids: readonly string[]): void;
}
export {};
