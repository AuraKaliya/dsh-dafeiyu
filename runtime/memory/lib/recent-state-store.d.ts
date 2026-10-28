import type { DatabaseSync } from 'node:sqlite';
import type { PersonaAccess, ExecutionScope, ContextItem, SourceDependency } from '#dafeiyu/contracts';
export declare const RECENT_STATE_TABLES: readonly ["recent_self_states", "recent_state_revisions", "recent_state_requests", "recent_state_publications"];
export declare function verifyRecentStateSchema(db: DatabaseSync): void;
export declare function migrateRecentState(db: DatabaseSync): void;
/** Mutable attention belongs to Growth. No Task completion or personality adoption is written here. */
export declare class RecentStateStore {
    private readonly db;
    private readonly transaction;
    private readonly current;
    constructor(db: DatabaseSync, transaction: <T>(fn: () => T) => T, current: (runId: string, sources: readonly SourceDependency[]) => boolean);
    private load;
    private request;
    save(access: PersonaAccess, raw: unknown, sources: readonly SourceDependency[]): {
        id: string;
        version: number;
        status: "active" | "withdrawn" | "dormant";
        scope: string;
        personalityAdopted: boolean;
    };
    read(access: PersonaAccess, id: string): {
        schemaVersion: 1;
        id: string;
        version: number;
        scope: {
            kind: "conversation";
            agentId: string;
            route: string;
        } | {
            kind: "task";
            agentId: string;
            taskId: string;
            scopeKey: string;
        };
        runId: string;
        operationId: string;
        text: string;
        topics: string[];
        motivation: "unknown" | "mixed" | "delegated" | "self-directed";
        originMotivation: string;
        status: "active" | "withdrawn" | "dormant";
        expiresAt: string;
        createdAt: string;
        updatedAt: string;
        sources: ({
            kind: "capability";
            ref: {
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
            agentId: string;
            route: string;
        } | {
            kind: "execution-source";
            ref: {
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
            agentId: string;
            route: string;
        } | {
            kind: "execution-input";
            runId: string;
            hash: string;
            agentId: string;
            route: string;
        } | {
            kind: "execution-operation";
            runId: string;
            operationId: string;
            hash: string;
            inputHash: string;
            agentId: string;
            route: string;
        } | {
            kind: "memory";
            id: string;
            revision: number;
            version: number;
            hash: string;
            agentId: string;
            route: string;
        } | {
            kind: "inbound";
            id: string;
            hash: string;
            fence: string;
            agentId: string;
            route: string;
        } | {
            kind: "timeline";
            ref: string;
            hash: string;
            fence: string;
            agentId: string;
            route: string;
        } | {
            kind: "working";
            id: string;
            taskId: string;
            revision: number;
            hash: string;
            agentId: string;
            route: string;
        } | {
            kind: "feedback";
            id: string;
            version: number;
            hash: string;
            agentId: string;
            route: string;
        } | {
            kind: "context";
            owner: string;
            region: string;
            id: string;
            version: string;
            hash: string;
            agentId: string;
            route: string;
        } | {
            kind: "legacy";
            epoch: string;
            agentId: string;
            route: string;
        } | {
            kind: "ephemeral";
            traceId: string;
            agentId: string;
            route: string;
        } | {
            kind: "unavailable";
            reason: string;
            agentId: string;
            route: string;
        })[];
        claimType: "self_report";
    };
    list(scope: ExecutionScope): {
        schemaVersion: 1;
        id: string;
        version: number;
        scope: {
            kind: "conversation";
            agentId: string;
            route: string;
        } | {
            kind: "task";
            agentId: string;
            taskId: string;
            scopeKey: string;
        };
        runId: string;
        operationId: string;
        text: string;
        topics: string[];
        motivation: "unknown" | "mixed" | "delegated" | "self-directed";
        originMotivation: string;
        status: "active" | "withdrawn" | "dormant";
        expiresAt: string;
        createdAt: string;
        updatedAt: string;
        sources: ({
            kind: "capability";
            ref: {
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
            agentId: string;
            route: string;
        } | {
            kind: "execution-source";
            ref: {
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
            agentId: string;
            route: string;
        } | {
            kind: "execution-input";
            runId: string;
            hash: string;
            agentId: string;
            route: string;
        } | {
            kind: "execution-operation";
            runId: string;
            operationId: string;
            hash: string;
            inputHash: string;
            agentId: string;
            route: string;
        } | {
            kind: "memory";
            id: string;
            revision: number;
            version: number;
            hash: string;
            agentId: string;
            route: string;
        } | {
            kind: "inbound";
            id: string;
            hash: string;
            fence: string;
            agentId: string;
            route: string;
        } | {
            kind: "timeline";
            ref: string;
            hash: string;
            fence: string;
            agentId: string;
            route: string;
        } | {
            kind: "working";
            id: string;
            taskId: string;
            revision: number;
            hash: string;
            agentId: string;
            route: string;
        } | {
            kind: "feedback";
            id: string;
            version: number;
            hash: string;
            agentId: string;
            route: string;
        } | {
            kind: "context";
            owner: string;
            region: string;
            id: string;
            version: string;
            hash: string;
            agentId: string;
            route: string;
        } | {
            kind: "legacy";
            epoch: string;
            agentId: string;
            route: string;
        } | {
            kind: "ephemeral";
            traceId: string;
            agentId: string;
            route: string;
        } | {
            kind: "unavailable";
            reason: string;
            agentId: string;
            route: string;
        })[];
        claimType: "self_report";
    }[];
    publish(access: PersonaAccess, raw: unknown, review: {
        selfOnly: true;
        privateDetails: false;
        thirdPartyClaims: false;
    }, policyEnabled: boolean): {
        id: string;
        version: number;
        publication: string;
        scope: string;
        rawSourcesShared: boolean;
    };
    published(scope: ExecutionScope): {
        publication: string;
        id: string;
        version: number;
        view: string;
        expiresAt: string;
        claimType: "self_report";
    }[];
    unpublish(access: PersonaAccess, raw: unknown, shared: boolean): {
        publication: string;
        withdrawn: boolean;
        originRecordChanged: boolean;
    };
    prepare(scope: ExecutionScope, query: string, shared: boolean, limit: number): ContextItem[];
    private audit;
}
