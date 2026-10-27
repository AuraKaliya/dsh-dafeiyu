import type { DatabaseSync } from 'node:sqlite';
import type { ObservationAuthority, MemoryObservation, ObservationReceipt, MemoryAccessPurpose, TimelineScope } from '#dafeiyu/contracts';
import type { MemoryStore } from './store.js';
export declare const observationSourceRef: (id: string) => string;
export declare function migrateObservations(db: DatabaseSync): void;
/** Shares the memory transaction and outbox: an activity and its selected contributions
 * either all commit or none do. Counts/interest decisions remain producer-reported facts. */
export declare class ObservationStore {
    private readonly db;
    private readonly transaction;
    private readonly memory;
    constructor(db: DatabaseSync, transaction: <T>(work: () => T) => T, memory: Pick<MemoryStore, 'mutate' | 'suppressedEvidence' | 'read' | 'taskSourceState'>);
    private publish;
    private record;
    source(scope: TimelineScope, ref: string, purpose?: MemoryAccessPurpose): {
        deleted: boolean;
        id: string;
        ref: string;
        version: number;
        plugin: string;
        key: string;
        producerVersion: string;
        occurredAt: string;
        retention: "text" | "digest";
        text: string | null;
        hash: string;
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
        taskWorkId?: string | undefined;
    } | null;
    private register;
    submit(authority: ObservationAuthority, input: MemoryObservation): Omit<ObservationReceipt, 'auditPending'>;
    open(authority: ObservationAuthority, input: {
        ref: string;
        mode: 'normal' | 'deleted';
        offset: number;
        limit: number;
    }): Record<string, unknown>;
    change(authority: ObservationAuthority, input: {
        ref: string;
        requestId: string;
        expectedVersion: number;
        action: 'delete' | 'restore';
    }): Record<string, unknown>;
    epoch(scope: TimelineScope): number;
    taskWorkForMemory(id: string): string | null;
    activity(scope: TimelineScope, id: string, purpose?: MemoryAccessPurpose): {
        hash: string;
        receipt: {
            activityId: string;
            sequence: number;
            eventId: string;
            duplicate: boolean;
            sources: {
                key: string;
                ref: string;
                version: number;
            }[];
            contributions: {
                id: string;
                form: "original" | "fragment" | "summary";
                memoryId: string;
                revision: number;
                version: number;
            }[];
        };
        summary: {
            producerReported: boolean;
            startedAt: string;
            observedAt: string;
            finishedAt: string;
            outcome: string;
            counts: {
                received: number;
                processed: number;
                modelExposed: number;
            };
            selection: {
                policyId: string;
                policyVersion: string;
                reasonCode: string;
            };
            activityId: string;
        };
    } | null;
    contribution(id: string, revision: number): unknown;
}
