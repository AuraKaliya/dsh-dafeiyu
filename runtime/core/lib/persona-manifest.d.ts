import type { FoundationSnapshot } from './foundation.js';
import type { StoredRun } from './runtime-store.js';
/** An explicit absence of the future stage provider is not a fabricated empty personality. */
export declare function foundationManifest(run: StoredRun, foundation: FoundationSnapshot, model: unknown): {
    schemaVersion: 1;
    agentId: string;
    runId: string;
    foundationHash: string;
    foundationIdentity: string;
    stageRevision: number;
    selectionVersion: number;
    stageStatus: "not-configured" | "empty" | "selected" | "degraded";
    entries: {
        candidate: {
            id: string;
            version: number;
        };
        contentRef: {
            kind: "memory";
            revision: number;
            id: string;
            agentId: string;
            scopeKey: string;
            version: number;
            contentHash: string;
            authorization?: {
                taskId: string;
                taskEpoch: number;
                grantId: string;
                grantVersion: number;
                policyId: string;
                policyVersion: number;
            } | undefined;
            selectionId?: string | undefined;
            range?: {
                start: number;
                end: number;
            } | undefined;
        } | {
            kind: "execution-source";
            id: string;
            agentId: string;
            scopeKey: string;
            version: number;
            contentHash: string;
        };
        dependencies: ({
            kind: "memory";
            revision: number;
            id: string;
            agentId: string;
            scopeKey: string;
            version: number;
            contentHash: string;
            authorization?: {
                taskId: string;
                taskEpoch: number;
                grantId: string;
                grantVersion: number;
                policyId: string;
                policyVersion: number;
            } | undefined;
            selectionId?: string | undefined;
            range?: {
                start: number;
                end: number;
            } | undefined;
        } | {
            kind: "execution-source";
            id: string;
            agentId: string;
            scopeKey: string;
            version: number;
            contentHash: string;
        })[];
    }[];
    continuityCheckpointId: string | null;
    policyVersion: string;
    modelRouteHash: string;
    assemblyVersion: "1";
    omittedCandidates?: number | undefined;
} | {
    agentId: string;
    runId: string;
    foundationHash: string;
    foundationIdentity: string;
    stageRevision: number;
    selectionVersion: number;
    stageStatus: "not-configured" | "empty" | "selected" | "degraded";
    continuityCheckpointId: string | null;
    policyVersion: string;
    modelRouteHash: string;
    schemaVersion: 2;
    assemblyVersion: "2";
    entries: {
        candidate: {
            id: string;
            version: number;
        };
        contentRef: {
            kind: "memory";
            revision: number;
            id: string;
            agentId: string;
            scopeKey: string;
            version: number;
            contentHash: string;
            authorization?: {
                taskId: string;
                taskEpoch: number;
                grantId: string;
                grantVersion: number;
                policyId: string;
                policyVersion: number;
            } | undefined;
            selectionId?: string | undefined;
            range?: {
                start: number;
                end: number;
            } | undefined;
        } | {
            kind: "execution-source";
            id: string;
            agentId: string;
            scopeKey: string;
            version: number;
            contentHash: string;
        };
        dependencies: ({
            kind: "memory";
            revision: number;
            id: string;
            agentId: string;
            scopeKey: string;
            version: number;
            contentHash: string;
            authorization?: {
                taskId: string;
                taskEpoch: number;
                grantId: string;
                grantVersion: number;
                policyId: string;
                policyVersion: number;
            } | undefined;
            selectionId?: string | undefined;
            range?: {
                start: number;
                end: number;
            } | undefined;
        } | {
            kind: "execution-source";
            id: string;
            agentId: string;
            scopeKey: string;
            version: number;
            contentHash: string;
        })[];
        adoption: {
            basis: "legacy-unclassified";
            maturity: "legacy-unclassified";
        } | {
            basis: "reviewed";
            maturity: "tentative" | "established";
            review: {
                id: string;
                hash: string;
            };
            decision: {
                id: string;
                hash: string;
            };
        };
    }[];
    trialSelectionVersion: number;
    trialEntries: {
        projection: "trial";
        maturity: "tentative";
        candidate: {
            id: string;
            version: number;
        };
        contentRef: {
            kind: "memory";
            revision: number;
            id: string;
            agentId: string;
            scopeKey: string;
            version: number;
            contentHash: string;
            authorization?: {
                taskId: string;
                taskEpoch: number;
                grantId: string;
                grantVersion: number;
                policyId: string;
                policyVersion: number;
            } | undefined;
            selectionId?: string | undefined;
            range?: {
                start: number;
                end: number;
            } | undefined;
        } | {
            kind: "execution-source";
            id: string;
            agentId: string;
            scopeKey: string;
            version: number;
            contentHash: string;
        };
        dependencies: ({
            kind: "memory";
            revision: number;
            id: string;
            agentId: string;
            scopeKey: string;
            version: number;
            contentHash: string;
            authorization?: {
                taskId: string;
                taskEpoch: number;
                grantId: string;
                grantVersion: number;
                policyId: string;
                policyVersion: number;
            } | undefined;
            selectionId?: string | undefined;
            range?: {
                start: number;
                end: number;
            } | undefined;
        } | {
            kind: "execution-source";
            id: string;
            agentId: string;
            scopeKey: string;
            version: number;
            contentHash: string;
        })[];
        trialSelection: {
            agentId: string;
            scopeKey: string;
            version: number;
            hash: string;
        };
        projectionHash: string;
    }[];
    omittedTrials: number;
    omittedCandidates?: number | undefined;
};
