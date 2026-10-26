import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { ExperienceRelationSchema } from '#dafeiyu/contracts';
import type { PersonaAccess, PersonaSourceRef, ExperienceRevision, MaintenanceSnapshot, MaintenanceLifecycle } from '#dafeiyu/contracts';
import type { PersonaResolver } from './persona-store.js';
export interface ExperienceDraft {
    content: ExperienceRevision['content'];
    contentRef: PersonaSourceRef;
    supports: PersonaSourceRef[];
    counters: PersonaSourceRef[];
    target: {
        id: string;
        version: number;
    } | null;
}
export declare class ExperienceStore {
    private readonly db;
    private readonly transaction;
    private readonly resolve;
    constructor(db: DatabaseSync, transaction: <T>(fn: () => T) => T, resolve: PersonaResolver);
    private task;
    validate(access: PersonaAccess, snapshot: MaintenanceSnapshot, compareTargets?: boolean): void;
    private audit;
    private insert;
    request(access: PersonaAccess, raw: unknown): string;
    /** Program-only: durable core event identity; no model-facing authority fields. */
    recordLifecycle(raw: MaintenanceLifecycle, sources?: readonly PersonaSourceRef[]): string | null;
    private selectedFor;
    private eventRequest;
    snapshot(access: PersonaAccess, id: string): {
        input: {
            schemaVersion: 1;
            id: string;
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
            taskEpoch: number;
            runId: string;
            requestId: string;
            reason: string;
            goal: string;
            motivation: {
                kind: "unknown" | "explicit-task" | "self-exploration" | "conversation-invitation" | "maintenance" | "mixed";
                basis: string[];
            };
            sources: ({
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
            targets: {
                id: string;
                version: number;
            }[];
            event: {
                id: string;
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
                taskEpoch: number;
                origin: {
                    kind: "message";
                    inboundId: string;
                    conversation: {
                        channel: string;
                        account: string;
                        kind: "local" | "private" | "group";
                        id: string;
                    };
                } | {
                    kind: "native";
                    producerId: string;
                    requestId: string;
                } | {
                    kind: "wake";
                    producerId: string;
                    scheduleId: string;
                    scheduleVersion: number;
                    occurrenceId: string;
                    dueAt: string;
                } | {
                    kind: "continuation";
                    parentRunId: string;
                    checkpointId: string;
                } | {
                    kind: "maintenance";
                    producerId: string;
                    requestId: string;
                };
                motivation: {
                    kind: "unknown" | "explicit-task" | "self-exploration" | "conversation-invitation" | "maintenance" | "mixed";
                    basis: string[];
                };
                type: "run.running" | "run.completed" | "run.waiting" | "run.failed" | "run.cancelled" | "run.interrupted" | "evidence.changed";
                goal: string;
                at: string;
                operations: {
                    id: string;
                    action: string;
                    status: "unknown" | "failed" | "cancelled" | "partial" | "succeeded" | "started";
                    effects: "unknown" | "none" | "confirmed";
                    completeness: "unknown" | "complete" | "partial";
                }[];
                omittedOperations: number;
            } | null;
            watermark: string;
            createdAt: string;
            expiresAt: string;
            omittedSources?: number | undefined;
        };
        state: "completed" | "failed" | "cancelled" | "ready" | "running" | "stale" | "waiting-scheduler";
        version: number;
        result: z.core.util.JSONType;
        error: string | null;
    };
    status(access: PersonaAccess, id?: string): {
        id: string;
        state: "completed" | "failed" | "cancelled" | "ready" | "running" | "stale" | "waiting-scheduler";
        version: number;
        reason: string;
        watermark: string;
        available: boolean;
        error: string | null;
        processed: boolean;
    }[];
    begin(access: PersonaAccess, id: string): {
        input: {
            schemaVersion: 1;
            id: string;
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
            taskEpoch: number;
            runId: string;
            requestId: string;
            reason: string;
            goal: string;
            motivation: {
                kind: "unknown" | "explicit-task" | "self-exploration" | "conversation-invitation" | "maintenance" | "mixed";
                basis: string[];
            };
            sources: ({
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
            targets: {
                id: string;
                version: number;
            }[];
            event: {
                id: string;
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
                taskEpoch: number;
                origin: {
                    kind: "message";
                    inboundId: string;
                    conversation: {
                        channel: string;
                        account: string;
                        kind: "local" | "private" | "group";
                        id: string;
                    };
                } | {
                    kind: "native";
                    producerId: string;
                    requestId: string;
                } | {
                    kind: "wake";
                    producerId: string;
                    scheduleId: string;
                    scheduleVersion: number;
                    occurrenceId: string;
                    dueAt: string;
                } | {
                    kind: "continuation";
                    parentRunId: string;
                    checkpointId: string;
                } | {
                    kind: "maintenance";
                    producerId: string;
                    requestId: string;
                };
                motivation: {
                    kind: "unknown" | "explicit-task" | "self-exploration" | "conversation-invitation" | "maintenance" | "mixed";
                    basis: string[];
                };
                type: "run.running" | "run.completed" | "run.waiting" | "run.failed" | "run.cancelled" | "run.interrupted" | "evidence.changed";
                goal: string;
                at: string;
                operations: {
                    id: string;
                    action: string;
                    status: "unknown" | "failed" | "cancelled" | "partial" | "succeeded" | "started";
                    effects: "unknown" | "none" | "confirmed";
                    completeness: "unknown" | "complete" | "partial";
                }[];
                omittedOperations: number;
            } | null;
            watermark: string;
            createdAt: string;
            expiresAt: string;
            omittedSources?: number | undefined;
        };
        state: "completed" | "failed" | "cancelled" | "ready" | "running" | "stale" | "waiting-scheduler";
        version: number;
        result: z.core.util.JSONType;
        error: string | null;
    };
    fail(access: PersonaAccess, id: string, code: string): void;
    recover(): number | bigint;
    sourceCurrent(access: PersonaAccess, ref: PersonaSourceRef): boolean;
    read(access: PersonaAccess, id: string): ExperienceRevision;
    private write;
    commit(access: PersonaAccess, id: string, drafts: readonly ExperienceDraft[], relations: readonly z.infer<typeof ExperienceRelationSchema>[], extra?: unknown): z.core.util.JSONType;
    review(access: PersonaAccess, raw: unknown): z.core.util.JSONType | {
        id: string;
        version: number;
        state: "held" | "rejected" | "withdrawn" | "accepted";
    };
    relations(access: PersonaAccess, id: string): z.core.util.JSONType[];
    counts(): {
        [k: string]: number;
    };
    schedulingItem(id: string): {
        id: string;
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
        taskEpoch: number;
        runId: string;
        watermark: string;
        expiresAt: string;
        state: "completed" | "failed" | "cancelled" | "ready" | "running" | "stale" | "waiting-scheduler";
        version: number;
        reason: string;
        retainedSources: number;
        omittedSources: number;
    } | null;
    settleMetadata(id: string): boolean;
    pendingScheduling(agentId: string, after: number, limit: number): {
        items: {
            id: string;
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
            taskEpoch: number;
            runId: string;
            watermark: string;
            expiresAt: string;
            state: "completed" | "failed" | "cancelled" | "ready" | "running" | "stale" | "waiting-scheduler";
            version: number;
            reason: string;
            retainedSources: number;
            omittedSources: number;
        }[];
        next: number | null;
    };
    coalesceScheduling(id: string): {
        id: string;
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
        taskEpoch: number;
        runId: string;
        watermark: string;
        expiresAt: string;
        state: "completed" | "failed" | "cancelled" | "ready" | "running" | "stale" | "waiting-scheduler";
        version: number;
        reason: string;
        retainedSources: number;
        omittedSources: number;
    } | null;
}
