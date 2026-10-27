import { z } from 'zod';
import type { Json } from '#dafeiyu/contracts';
import { NativeDeliveryStore } from './native-delivery-store.js';
export declare const RUNTIME_APPLICATION_ID = 1145459249;
export declare const RUNTIME_SCHEMA_VERSION = 4;
export declare const RuntimeIdentitySchema: z.ZodObject<{
    agentId: z.ZodString;
    profileId: z.ZodString;
}, z.core.$strict>;
export type RuntimeIdentity = z.infer<typeof RuntimeIdentitySchema>;
export declare const RunStateSchema: z.ZodEnum<{
    running: "running";
    completed: "completed";
    interrupted: "interrupted";
    cancelled: "cancelled";
    accepted: "accepted";
    waiting: "waiting";
    queued: "queued";
    cancelling: "cancelling";
    failed: "failed";
}>;
export type RunState = z.infer<typeof RunStateSchema>;
export declare const RunDefinitionSchema: z.ZodObject<{
    taskId: z.ZodNullable<z.ZodUUID>;
    origin: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"message">;
        inboundId: z.ZodUUID;
        conversation: z.ZodObject<{
            channel: z.ZodString;
            account: z.ZodString;
            kind: z.ZodEnum<{
                private: "private";
                group: "group";
                local: "local";
            }>;
            id: z.ZodString;
        }, z.core.$strict>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"native">;
        producerId: z.ZodString;
        requestId: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"wake">;
        producerId: z.ZodString;
        scheduleId: z.ZodString;
        scheduleVersion: z.ZodNumber;
        occurrenceId: z.ZodString;
        dueAt: z.ZodISODateTime;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"continuation">;
        parentRunId: z.ZodUUID;
        checkpointId: z.ZodUUID;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"maintenance">;
        producerId: z.ZodString;
        requestId: z.ZodString;
    }, z.core.$strict>], "kind">;
    scope: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"conversation">;
        agentId: z.ZodString;
        route: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"task">;
        agentId: z.ZodString;
        taskId: z.ZodUUID;
        scopeKey: z.ZodString;
    }, z.core.$strict>], "kind">;
    intentVersion: z.ZodNumber;
    policyId: z.ZodString;
    parentRunId: z.ZodDefault<z.ZodNullable<z.ZodUUID>>;
}, z.core.$strict>;
export type RunDefinition = z.infer<typeof RunDefinitionSchema>;
export declare const RunSnapshotSchema: z.ZodObject<{
    sessionId: z.ZodString;
    personaVersion: z.ZodString;
    model: z.ZodObject<{
        provider: z.ZodString;
        model: z.ZodString;
        reasoningEffort: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>;
    registryVersion: z.ZodString;
    authorityVersion: z.ZodString;
    inputs: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        version: z.ZodNumber;
        hash: z.ZodString;
        scopeKey: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type RunSnapshot = z.infer<typeof RunSnapshotSchema>;
export declare const RunResultRefSchema: z.ZodObject<{
    sessionId: z.ZodString;
    messageSeq: z.ZodNumber;
    turnEndSeq: z.ZodNumber;
    textHash: z.ZodString;
}, z.core.$strict>;
export type RunResultRef = z.infer<typeof RunResultRefSchema>;
export declare function runtimeHash(value: unknown): string;
export interface StoredRun {
    id: string;
    requestKey: string;
    definition: RunDefinition;
    state: RunState;
    version: number;
    snapshot: RunSnapshot | null;
    result: RunResultRef | null;
    error: string | null;
    createdAt: string;
    updatedAt: string;
}
/** One-host execution ledger. Task definitions and complete DSH histories remain in their own stores. */
export declare class RuntimeStore {
    readonly file: string;
    private readonly options;
    readonly nativeDeliveries: NativeDeliveryStore;
    private readonly db;
    private readonly nonce;
    private closed;
    readonly identity: Readonly<RuntimeIdentity>;
    constructor(file: string, identity: RuntimeIdentity, options?: {
        create?: boolean;
        migrate?: boolean;
        requirePersonaManifest?: boolean;
    });
    private initialize;
    private open;
    private transaction;
    private event;
    prepareRequest(producer: string, requestId: string, raw: unknown): {
        id: string;
        producer: string;
        requestId: string;
        payload: z.core.util.JSONType;
        taskId: string | null;
        runId: string | null;
    };
    request(id: string): {
        id: string;
        producer: string;
        requestId: string;
        payload: z.core.util.JSONType;
        taskId: string | null;
        runId: string | null;
    };
    findRequest(producer: string, requestId: string): {
        id: string;
        producer: string;
        requestId: string;
        payload: z.core.util.JSONType;
        taskId: string | null;
        runId: string | null;
    } | null;
    pendingRequests(): {
        id: string;
        producer: string;
        requestId: string;
        payload: z.core.util.JSONType;
        taskId: string | null;
        runId: string | null;
    }[];
    bindTask(requestKey: string, taskId: string): void;
    acceptRun(requestKey: string, raw: unknown): StoredRun;
    private acceptInside;
    acceptWake(requestKey: string, raw: unknown): StoredRun;
    get(id: string): StoredRun;
    list(states?: readonly RunState[]): StoredRun[];
    nativeDeliveryCandidates(): string[];
    session(keyValue: string): string;
    transition(id: string, expectedVersion: number, to: RunState, error?: string | null): StoredRun;
    private transitionInside;
    start(id: string, version: number, raw: unknown, persona?: unknown): StoredRun;
    personaBinding(id: string): {
        kind: "legacy-unbound";
        manifest?: never;
    } | {
        kind: "bound";
        manifest: {
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
    };
    complete(id: string, version: number, raw: unknown): StoredRun;
    beginOperation(runId: string, callId: string, action: string, plugin: string, pluginVersion: string, input: unknown, actionVersion?: string): {
        reused: boolean;
        id: string;
        runId: string;
        callId: string;
        fingerprint: string;
        action: string;
        plugin: string;
        pluginVersion: string;
        actionVersion: string | null;
        versionsBound: boolean;
        state: "unknown" | "started" | "finished";
        startedEventId: string;
        outcome: {
            status: "unknown" | "cancelled" | "partial" | "failed" | "succeeded";
            effects: "unknown" | "none" | "confirmed";
            completeness: "unknown" | "partial" | "complete";
            data: z.core.util.JSONType;
            sources: {
                id: string;
                scopeKey: string;
                version: number;
                contentHash: string;
            }[];
            receipts: {
                id: string;
                kind: string;
            }[];
            errorCode?: string | undefined;
        } | null;
    };
    operation(id: string): {
        id: string;
        runId: string;
        callId: string;
        fingerprint: string;
        action: string;
        plugin: string;
        pluginVersion: string;
        actionVersion: string | null;
        versionsBound: boolean;
        state: "unknown" | "started" | "finished";
        startedEventId: string;
        outcome: {
            status: "unknown" | "cancelled" | "partial" | "failed" | "succeeded";
            effects: "unknown" | "none" | "confirmed";
            completeness: "unknown" | "partial" | "complete";
            data: z.core.util.JSONType;
            sources: {
                id: string;
                scopeKey: string;
                version: number;
                contentHash: string;
            }[];
            receipts: {
                id: string;
                kind: string;
            }[];
            errorCode?: string | undefined;
        } | null;
    };
    bindInput(runId: string, id: string, body: unknown): void;
    readInput(runId: string, id: string): Json | null;
    /** A program-only maintenance authority record, never new model output in a finished Run. */
    bindMaintenanceAnchor(runId: string, id: string, body: unknown): void;
    findContext(id: string): Json | null;
    appendExecutionEvent(runId: string, type: string, data: Record<string, Json>): string;
    /** Reads the immutable lifecycle fact, even after its outbox delivery was acknowledged. */
    latestRunEvent(runId: string, state: RunState): {
        id: string;
        runId: string;
        type: string;
        at: string;
        data: Record<string, z.core.util.JSONType>;
    } | null;
    /** Core-only receipts do not manufacture a model result or an admission in an already closed Run. */
    bindPersonaTrialRecord(runId: string, kind: 'admission-input' | 'admission-receipt' | 'completion-receipt', raw: unknown): void;
    operations(runId: string): {
        id: string;
        runId: string;
        callId: string;
        fingerprint: string;
        action: string;
        plugin: string;
        pluginVersion: string;
        actionVersion: string | null;
        versionsBound: boolean;
        state: "unknown" | "started" | "finished";
        startedEventId: string;
        outcome: {
            status: "unknown" | "cancelled" | "partial" | "failed" | "succeeded";
            effects: "unknown" | "none" | "confirmed";
            completeness: "unknown" | "partial" | "complete";
            data: z.core.util.JSONType;
            sources: {
                id: string;
                scopeKey: string;
                version: number;
                contentHash: string;
            }[];
            receipts: {
                id: string;
                kind: string;
            }[];
            errorCode?: string | undefined;
        } | null;
    }[];
    finishOperation(id: string, raw: unknown): {
        id: string;
        runId: string;
        callId: string;
        fingerprint: string;
        action: string;
        plugin: string;
        pluginVersion: string;
        actionVersion: string | null;
        versionsBound: boolean;
        state: "unknown" | "started" | "finished";
        startedEventId: string;
        outcome: {
            status: "unknown" | "cancelled" | "partial" | "failed" | "succeeded";
            effects: "unknown" | "none" | "confirmed";
            completeness: "unknown" | "partial" | "complete";
            data: z.core.util.JSONType;
            sources: {
                id: string;
                scopeKey: string;
                version: number;
                contentHash: string;
            }[];
            receipts: {
                id: string;
                kind: string;
            }[];
            errorCode?: string | undefined;
        } | null;
    };
    checkpoint(runId: string, body: unknown): string;
    readCheckpoint(runId: string, id: string): Json;
    checkpoints(runId: string): string[];
    control(runId: string, requestKey: string, version: number, to: RunState): StoredRun;
    /** A durable chat projection belongs to the same transaction as the completed Run. */
    completeWithProjection(id: string, version: number, result: unknown, projection: Record<string, Json>): StoredRun;
    recover(): number;
    outbox(): {
        id: string;
        runId: string;
        type: string;
        at: string;
        data: Record<string, z.core.util.JSONType>;
    }[];
    acknowledgeEvent(id: string): void;
    close(): void;
}
