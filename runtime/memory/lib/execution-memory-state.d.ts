import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { PersonaAccess, PersonaSourceRef, ContinuityCheckpoint } from '#dafeiyu/contracts';
import type { MemoryStore } from './store.js';
import type { ExecutionSources } from './execution-sources.js';
import type { PersonaResolver } from './persona-store.js';
export declare const evidenceSelectionSchema: z.ZodObject<{
    requestId: z.ZodString;
    expectedVersion: z.ZodNumber;
    entries: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
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
}, z.core.$strict>;
/** The existing memory database owns task evidence, intent events and continuity indexes.
 * No task goal or DSH message history is duplicated here. */
export declare class ExecutionMemoryState {
    private readonly db;
    private readonly memory;
    private readonly sources;
    private readonly resolve;
    constructor(db: DatabaseSync, memory: MemoryStore, sources: ExecutionSources, resolve: PersonaResolver);
    private task;
    private event;
    private bump;
    generation(access: PersonaAccess): number;
    private writeHistory;
    private historyValid;
    expose(access: PersonaAccess, ref: PersonaSourceRef): void;
    operationSources(access: PersonaAccess, id: string): ({
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
    changeContribution(access: PersonaAccess, raw: unknown): {
        id: string;
        version: number;
        revision: number;
        eventId: string;
        generation?: number | undefined;
    } & {
        duplicate: boolean;
    };
    private command;
    withSources<T>(access: PersonaAccess, work: () => T): T;
    memoryMaterial(access: PersonaAccess, ref: PersonaSourceRef): {
        text: string;
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
    } | null;
    contribute(access: PersonaAccess, raw: unknown): {
        id: string;
        revision: number;
        version: number;
        eventId: string;
        duplicate: boolean;
        source: {
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
        generation?: number | undefined;
    };
    selection(access: PersonaAccess): {
        kind: "execution-selection";
        version: number;
        entries: ({
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
    };
    select(access: PersonaAccess, raw: unknown): {
        kind: "execution-selection";
        version: number;
        entries: ({
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
    };
    context(access: PersonaAccess): {
        id: string;
        version: string;
        text: string;
        sources: {
            ref: string;
            version: string;
            hash: string;
        }[];
        expiresAt: string;
    }[];
    validateContext(access: PersonaAccess, item: import('#dafeiyu/contracts').ContextItem): boolean;
    acceptIntent(access: PersonaAccess): void;
    private appendIntent;
    intent(access: PersonaAccess): {
        motivation: {
            kind: "unknown" | "maintenance" | "explicit-task" | "self-exploration" | "conversation-invitation" | "mixed";
            basis: string[];
        };
        blocking: boolean;
        events: {
            schemaVersion: 1;
            id: string;
            agentId: string;
            taskId: string;
            taskEpoch: number;
            runId: string;
            requestId: string;
            producer: string;
            kind: "accepted" | "objection" | "resolved";
            motivation: {
                kind: "unknown" | "maintenance" | "explicit-task" | "self-exploration" | "conversation-invitation" | "mixed";
                basis: string[];
            };
            category: "none" | "preference" | "scope" | "method" | "premise" | "missing-information";
            blocking: boolean;
            reason: string;
            evidence: ({
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
            resolves: string | null;
            createdAt: string;
            actions?: string[] | undefined;
            historyHash?: string | undefined;
        }[];
    };
    object(access: PersonaAccess, raw: unknown): {
        schemaVersion: 1;
        id: string;
        agentId: string;
        taskId: string;
        taskEpoch: number;
        runId: string;
        requestId: string;
        producer: string;
        kind: "accepted" | "objection" | "resolved";
        motivation: {
            kind: "unknown" | "maintenance" | "explicit-task" | "self-exploration" | "conversation-invitation" | "mixed";
            basis: string[];
        };
        category: "none" | "preference" | "scope" | "method" | "premise" | "missing-information";
        blocking: boolean;
        reason: string;
        evidence: ({
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
        resolves: string | null;
        createdAt: string;
        actions?: string[] | undefined;
        historyHash?: string | undefined;
    };
    resolveIntent(access: PersonaAccess, raw: unknown): {
        schemaVersion: 1;
        id: string;
        agentId: string;
        taskId: string;
        taskEpoch: number;
        runId: string;
        requestId: string;
        producer: string;
        kind: "accepted" | "objection" | "resolved";
        motivation: {
            kind: "unknown" | "maintenance" | "explicit-task" | "self-exploration" | "conversation-invitation" | "mixed";
            basis: string[];
        };
        category: "none" | "preference" | "scope" | "method" | "premise" | "missing-information";
        blocking: boolean;
        reason: string;
        evidence: ({
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
        resolves: string | null;
        createdAt: string;
        actions?: string[] | undefined;
        historyHash?: string | undefined;
    };
    capture(access: PersonaAccess, raw: ContinuityCheckpoint): {
        id: string;
        hash: string;
    };
    checkpoint(access: PersonaAccess, id: string, historical?: boolean): {
        schemaVersion: 1;
        id: string;
        agentId: string;
        runId: string;
        taskId: string;
        taskEpoch: number;
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
        foundationHash: string;
        stageRevision: number;
        sessionId: string;
        throughSeq: number;
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
        completedOperations: string[];
        unknownOperations: string[];
        summary: string;
        gaps: string[];
        createdAt: string;
        historyHash?: string | undefined;
        intentEvents?: string[] | undefined;
    } | null;
    bindResult(taskId: string, runId: string, epoch: number, body: unknown): void;
}
