import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { CapabilityObservationSchema, CapabilitySelectionSchema } from '#dafeiyu/contracts';
import type { CapabilityObservationAccess, PersonaAccess, PersonaSourceRef, TimelineScope, MemoryAccessPurpose, Conversation, ResourceProof } from '#dafeiyu/contracts';
import type { ResourceTargetView } from '#dafeiyu/contracts';
import type { MemoryStore } from './store.js';
declare const recordSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    kind: z.ZodEnum<{
        selected: "selected";
        observed: "observed";
    }>;
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
    runId: z.ZodUUID;
    operationId: z.ZodUUID;
    producer: z.ZodString;
    proof: z.ZodObject<{
        provider: z.ZodString;
        scene: z.ZodObject<{
            channel: z.ZodString;
            account: z.ZodString;
            kind: z.ZodEnum<{
                private: "private";
                group: "group";
                local: "local";
            }>;
            id: z.ZodString;
        }, z.core.$strict>;
        key: z.ZodString;
        version: z.ZodNumber;
        hash: z.ZodString;
        roots: z.ZodArray<z.ZodString>;
        detail: z.ZodJSONSchema;
    }, z.core.$strict>;
    observedHash: z.ZodString;
    occurredAt: z.ZodISODateTime;
    counts: z.ZodObject<{
        received: z.ZodNumber;
        processed: z.ZodNumber;
    }, z.core.$strict>;
    coverage: z.ZodArray<z.ZodString>;
    history: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"capability">;
        ref: z.ZodDiscriminatedUnion<[z.ZodObject<{
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
        }, z.core.$strict>], "kind">;
        agentId: z.ZodString;
        route: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution-source">;
        ref: z.ZodDiscriminatedUnion<[z.ZodObject<{
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
        }, z.core.$strict>], "kind">;
        agentId: z.ZodString;
        route: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution-input">;
        runId: z.ZodUUID;
        hash: z.ZodString;
        agentId: z.ZodString;
        route: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution-operation">;
        runId: z.ZodUUID;
        operationId: z.ZodUUID;
        hash: z.ZodString;
        inputHash: z.ZodString;
        agentId: z.ZodString;
        route: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        id: z.ZodString;
        revision: z.ZodNumber;
        version: z.ZodNumber;
        hash: z.ZodString;
        agentId: z.ZodString;
        route: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"inbound">;
        id: z.ZodString;
        hash: z.ZodString;
        fence: z.ZodString;
        agentId: z.ZodString;
        route: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"timeline">;
        ref: z.ZodString;
        hash: z.ZodString;
        fence: z.ZodString;
        agentId: z.ZodString;
        route: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"working">;
        id: z.ZodString;
        taskId: z.ZodString;
        revision: z.ZodNumber;
        hash: z.ZodString;
        agentId: z.ZodString;
        route: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"feedback">;
        id: z.ZodString;
        version: z.ZodNumber;
        hash: z.ZodString;
        agentId: z.ZodString;
        route: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"context">;
        owner: z.ZodString;
        region: z.ZodString;
        id: z.ZodString;
        version: z.ZodString;
        hash: z.ZodString;
        agentId: z.ZodString;
        route: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"legacy">;
        epoch: z.ZodString;
        agentId: z.ZodString;
        route: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"ephemeral">;
        traceId: z.ZodString;
        agentId: z.ZodString;
        route: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"unavailable">;
        reason: z.ZodString;
        agentId: z.ZodString;
        route: z.ZodString;
    }, z.core.$strict>], "kind">>;
    parent: z.ZodNullable<z.ZodDiscriminatedUnion<[z.ZodObject<{
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
    selection: z.ZodNullable<z.ZodObject<{
        mode: z.ZodEnum<{
            original: "original";
            fragment: "fragment";
            summary: "summary";
        }>;
        outputHash: z.ZodString;
    }, z.core.$strict>>;
    rawRetained: z.ZodLiteral<false>;
}, z.core.$strict>;
type RecordBody = z.infer<typeof recordSchema>;
type Validator = (scope: TimelineScope, body: RecordBody, access: PersonaAccess | undefined) => boolean;
export declare function migrateCapabilityObservations(db: DatabaseSync): void;
/** Observation receipts retain hashes/coverage. Only an explicit selection creates a memory item. */
export declare class CapabilityObservations {
    private readonly db;
    private readonly memory;
    private validator;
    private access;
    private readonly checking;
    constructor(db: DatabaseSync, memory: MemoryStore);
    bind(validator: Validator): () => void;
    withAccess<T>(access: PersonaAccess, work: () => T): T;
    private scope;
    private suppressed;
    private row;
    reference(scope: TimelineScope, id: string): PersonaSourceRef | null;
    valid(scope: TimelineScope, ref: PersonaSourceRef, exposedHash?: string): boolean;
    source(scope: TimelineScope, id: string, purpose: MemoryAccessPurpose): {
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
        hash: string;
        version: number;
        deleted: boolean;
        boundary: {
            schemaVersion: 1;
            policyVersion: 1;
            owner: {
                kind: "agent";
                agentId: string;
            };
            sourceScene: {
                kind: "conversation";
                route: string;
                conversation: {
                    channel: string;
                    account: string;
                    kind: "private" | "group" | "local";
                    id: string;
                };
                ingressPluginId: string | null;
            } | {
                kind: "legacy-route";
                route: string;
            };
            task: {
                kind: "unassigned";
            } | {
                kind: "conversation-task";
                route: string;
                id: string;
            } | {
                kind: "agent-task";
                id: string;
            };
            internalUse: {
                kind: "conversation";
                route: string;
            } | {
                kind: "none";
            };
            externalExpression: {
                kind: "conversation";
                route: string;
            } | {
                kind: "none";
            };
            assignment: "legacy-migration" | "conservative-create";
        } | {
            schemaVersion: 2;
            policyVersion: 1;
            owner: {
                kind: "agent";
                agentId: string;
            };
            sourceScene: {
                kind: "execution-task";
                route: string;
                taskId: string;
            };
            task: {
                kind: "agent-task";
                id: string;
            };
            internalUse: {
                kind: "task";
                route: string;
                taskId: string;
            } | {
                kind: "none";
            };
            externalExpression: {
                kind: "none";
            };
            assignment: "execution-create";
        };
        body: {
            schemaVersion: 1;
            kind: "selected" | "observed";
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
            origin: {
                kind: "message";
                inboundId: string;
                conversation: {
                    channel: string;
                    account: string;
                    kind: "private" | "group" | "local";
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
            runId: string;
            operationId: string;
            producer: string;
            proof: {
                provider: string;
                scene: {
                    channel: string;
                    account: string;
                    kind: "private" | "group" | "local";
                    id: string;
                };
                key: string;
                version: number;
                hash: string;
                roots: string[];
                detail: z.core.util.JSONType;
            };
            observedHash: string;
            occurredAt: string;
            counts: {
                received: number;
                processed: number;
            };
            coverage: string[];
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
            parent: {
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
            } | null;
            selection: {
                mode: "original" | "fragment" | "summary";
                outputHash: string;
            } | null;
            rawRetained: false;
        };
    } | null;
    material(access: PersonaAccess, ref: PersonaSourceRef): {
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
    expressionView(access: PersonaAccess, ref: PersonaSourceRef, target: Conversation, view: string, publicMedia?: boolean, publicView?: (proof: ResourceProof, view: string) => boolean, targetView?: (proof: ResourceProof, view: string) => ResourceTargetView | null): {
        text: string;
        fence: string;
        target?: ResourceTargetView;
    } | null;
    mediaFence(access: PersonaAccess, target: Conversation, roots: readonly string[]): {
        allowed: boolean;
        stamp: string;
    };
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
    operationSources(access: PersonaAccess, operationId: string): PersonaSourceRef[];
    private event;
    private insert;
    record(authority: CapabilityObservationAccess, input: z.output<typeof CapabilityObservationSchema>): {
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
        duplicate: boolean;
    };
    select(authority: CapabilityObservationAccess, input: z.output<typeof CapabilitySelectionSchema>, actualView: string): Record<string, unknown>;
}
export {};
