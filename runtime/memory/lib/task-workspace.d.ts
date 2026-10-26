import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { ObservationAuthority, MemoryObservation, TimelineScope, MemoryAccessPurpose, ContextItem, TaskWorkspaceProvider } from '#dafeiyu/contracts';
import type { MemoryStore } from './store.js';
export declare const witnessSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"memory">;
    route: z.ZodString;
    id: z.ZodUUID;
    revision: z.ZodNumber;
    version: z.ZodNumber;
    contentHash: z.ZodString;
    ancestors: z.ZodArray<z.ZodObject<{
        id: z.ZodUUID;
        revision: z.ZodNumber;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>>;
    fences: z.ZodArray<z.ZodObject<{
        ref: z.ZodString;
        contentHash: z.ZodString;
        fence: z.ZodString;
    }, z.core.$strict>>;
    authorization: z.ZodOptional<z.ZodObject<{
        taskId: z.ZodUUID;
        taskEpoch: z.ZodNumber;
        grantId: z.ZodUUID;
        grantVersion: z.ZodNumber;
        policyId: z.ZodString;
        policyVersion: z.ZodNumber;
    }, z.core.$strict>>;
    range: z.ZodOptional<z.ZodObject<{
        start: z.ZodNumber;
        end: z.ZodNumber;
    }, z.core.$strict>>;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"observation">;
    route: z.ZodString;
    id: z.ZodUUID;
    contentHash: z.ZodString;
}, z.core.$strict>], "kind">;
export type Witness = z.infer<typeof witnessSchema>;
export declare function migrateTaskWorkspaces(db: DatabaseSync): void;
/** One SQLite transaction for task state, source adoption, observations and outbox. Task
 * control epoch, scene activation and per-slot version are independent concurrency fences. */
export declare class TaskWorkspace {
    private readonly db;
    private readonly transaction;
    private readonly memory;
    private readonly timeline;
    private readonly sameSource;
    private authorization;
    authorizeWith(validate: NonNullable<TaskWorkspace['authorization']>): void;
    state(agentId: string, id: string): {
        version: number;
        epoch: number;
        status: "completed" | "active" | "paused";
    };
    memoryProof(scope: TimelineScope, id: string, revision: number, version: number, contentHash: string): {
        kind: "memory";
        route: string;
        id: string;
        revision: number;
        version: number;
        contentHash: string;
        ancestors: {
            id: string;
            revision: number;
            version: number;
            contentHash: string;
        }[];
        fences: {
            ref: string;
            contentHash: string;
            fence: string;
        }[];
        authorization?: {
            taskId: string;
            taskEpoch: number;
            grantId: string;
            grantVersion: number;
            policyId: string;
            policyVersion: number;
        } | undefined;
        range?: {
            start: number;
            end: number;
        } | undefined;
    } | {
        kind: "observation";
        route: string;
        id: string;
        contentHash: string;
    } | null;
    validProof(agentId: string, proof: Witness): boolean;
    expressionLink(agentId: string, taskId: string, id: string): {
        id: string;
        text: string;
        proof: {
            kind: "memory";
            route: string;
            id: string;
            revision: number;
            version: number;
            contentHash: string;
            ancestors: {
                id: string;
                revision: number;
                version: number;
                contentHash: string;
            }[];
            fences: {
                ref: string;
                contentHash: string;
                fence: string;
            }[];
            authorization?: {
                taskId: string;
                taskEpoch: number;
                grantId: string;
                grantVersion: number;
                policyId: string;
                policyVersion: number;
            } | undefined;
            range?: {
                start: number;
                end: number;
            } | undefined;
        } | {
            kind: "observation";
            route: string;
            id: string;
            contentHash: string;
        };
    } | null;
    expressionSlot(agentId: string, taskId: string, slot: string): {
        slot: string;
        version: number;
        jobId: string;
        text: string;
        proofs: ({
            kind: "memory";
            route: string;
            id: string;
            revision: number;
            version: number;
            contentHash: string;
            ancestors: {
                id: string;
                revision: number;
                version: number;
                contentHash: string;
            }[];
            fences: {
                ref: string;
                contentHash: string;
                fence: string;
            }[];
            authorization?: {
                taskId: string;
                taskEpoch: number;
                grantId: string;
                grantVersion: number;
                policyId: string;
                policyVersion: number;
            } | undefined;
            range?: {
                start: number;
                end: number;
            } | undefined;
        } | {
            kind: "observation";
            route: string;
            id: string;
            contentHash: string;
        })[];
    } | null;
    selectAuthorized(agentId: string, id: string, requestId: string, expectedVersion: number, proofs: Witness[]): {
        taskId: string;
        version: number;
        links: string[];
    };
    constructor(db: DatabaseSync, transaction: <T>(work: () => T) => T, memory: MemoryStore, timeline: (scope: TimelineScope, ref: string, hash: string) => boolean, sameSource: (scope: TimelineScope, a: string, b: string) => boolean);
    private task;
    private record;
    private revise;
    private request;
    create(agentId: string, input: Parameters<TaskWorkspaceProvider['create']>[1]): string;
    findCreateRequest(agentId: string, requestId: string): string | null;
    update(agentId: string, id: string, input: Parameters<TaskWorkspaceProvider['update']>[2]): Record<string, unknown>;
    private member;
    join(authority: ObservationAuthority, id: string, input: Parameters<TaskWorkspaceProvider['join']>[2]): Record<string, unknown>;
    selection(scope: TimelineScope): {
        version: number;
        taskId: string | null;
    };
    activeTask(scope: TimelineScope): string | null;
    activate(authority: ObservationAuthority, id: string | null, input: Parameters<TaskWorkspaceProvider['activate']>[2]): Record<string, unknown>;
    private capture;
    private evidence;
    link(authority: ObservationAuthority, id: string, input: Parameters<TaskWorkspaceProvider['link']>[2]): Record<string, unknown>;
    private links;
    private adopt;
    begin(authority: ObservationAuthority, id: string, input: Parameters<TaskWorkspaceProvider['begin']>[2]): string;
    private job;
    private current;
    sourceState(agentId: string, jobId: string, purpose?: MemoryAccessPurpose): 'valid' | 'deleted' | 'changed' | 'unavailable';
    observe(authority: ObservationAuthority, id: string, input: MemoryObservation): Omit<import("#dafeiyu/contracts").ObservationReceipt, "auditPending">;
    complete(authority: ObservationAuthority, id: string, input: Parameters<TaskWorkspaceProvider['complete']>[2]): Record<string, unknown>;
    private entries;
    read(agentId: string, id: string): Record<string, unknown>;
    sceneItems(scope: TimelineScope): ContextItem[];
    view(authority: ObservationAuthority, id: string): Record<string, unknown>;
    recover(agentId: string): void;
}
