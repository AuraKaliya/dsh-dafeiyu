import type { DatabaseSync } from 'node:sqlite';
import type { PersonaAccess, PersonaSourceRef } from '#dafeiyu/contracts';
import type { PersonaMaterial, PersonaResolver } from './persona-store.js';
export declare class ExecutionSources {
    private readonly db;
    private readonly transaction;
    private readonly resolve;
    constructor(db: DatabaseSync, transaction: <T>(work: () => T) => T, resolve: PersonaResolver);
    private ensureTask;
    private event;
    selfReport(access: PersonaAccess, requestId: string, text: string, refs: readonly PersonaSourceRef[]): PersonaSourceRef;
    observe(access: PersonaAccess, raw: unknown): PersonaSourceRef;
    private record;
    reference(access: PersonaAccess, id: string): PersonaSourceRef | null;
    open(access: PersonaAccess, ref: PersonaSourceRef): PersonaMaterial | null;
    metadata(access: PersonaAccess, ref: PersonaSourceRef): {
        schemaVersion: 2;
        kind: "digest" | "self-report" | "primary";
        text: string;
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
        producer: string;
        operationId: string;
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
        rootSources: string[];
        history: ({
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
        occurredAt: string;
        resource: string;
        coverage: string[];
        completeness: "unknown" | "complete" | "partial";
        nature?: "unknown" | "observed" | "synthetic" | "hypothetical" | "self-report" | "derived" | undefined;
    } | {
        schemaVersion: 1;
        kind: "self-report";
        text: string;
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
        producer: string;
        operationId: string;
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
        rootSources: string[];
    };
    operationSources(access: PersonaAccess, operationId: string): PersonaSourceRef[];
    private bump;
    change(access: PersonaAccess, raw: unknown): {
        id: string;
        version: number;
    };
    drainOutbox(append: (body: unknown, id: string) => void): number;
}
