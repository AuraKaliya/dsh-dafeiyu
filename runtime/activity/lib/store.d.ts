import { z } from 'zod';
import { ActivityConfigSchema } from '#dafeiyu/contracts';
import type { ActivityScheduleBody, ActivityDomainEvent, WakeOccurrenceBody, ActivityOccurrenceState, ExecutionScope } from '#dafeiyu/contracts';
export declare const ACTIVITY_APPLICATION_ID = 1145454900;
export declare const ACTIVITY_SCHEMA_VERSION = 1;
export declare const ACTIVITY_TABLES: readonly ["activity_metadata", "activity_schedules", "activity_schedule_revisions", "activity_tasks", "activity_occurrences", "activity_outbox", "activity_requests", "activity_domain_events", "activity_condition_watermarks", "activity_run_events", "activity_usage", "activity_clock"];
declare const identitySchema: z.ZodObject<{
    agentId: z.ZodString;
    profileId: z.ZodString;
}, z.core.$strict>;
export declare const activityHash: (value: unknown) => string;
export declare const activityScope: (scope: ExecutionScope) => string;
export interface StoredSchedule {
    body: ActivityScheduleBody;
    status: 'active' | 'paused' | 'cancelled' | 'exhausted' | 'blocked';
    nextDue: number | null;
    notBefore: number;
    failures: number;
    error: string | null;
}
export interface StoredOccurrence {
    body: WakeOccurrenceBody;
    state: ActivityOccurrenceState;
    runId: string | null;
    startedAt: number | null;
    error: string | null;
}
/** Trusted program persistence. No method accepts model authority directly. */
export declare class ActivityStore {
    private readonly db;
    readonly config: z.output<typeof ActivityConfigSchema>;
    readonly identity: z.infer<typeof identitySchema>;
    private closed;
    constructor(file: string, identity: z.infer<typeof identitySchema>, config?: z.input<typeof ActivityConfigSchema>, create?: boolean);
    private initialize;
    private transaction;
    private clock;
    private authorize;
    get(id: string, scope?: ExecutionScope): StoredSchedule;
    list(scope: ExecutionScope, limit?: number): StoredSchedule[];
    private validate;
    private request;
    create(raw: unknown, now: number): {
        id: string;
        version: number;
    };
    private revision;
    snapshot(id: string, version: number): {
        schemaVersion: 1;
        id: string;
        agentId: string;
        version: number;
        owner: {
            kind: "conversation";
            agentId: string;
            route: string;
        } | {
            kind: "task";
            agentId: string;
            taskId: string;
            scopeKey: string;
        };
        purpose: "maintenance" | "exploration";
        goal: string;
        basis: ({
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
        anchor: {
            schemaVersion: 1;
            id: string;
            runId: string;
            operationId: string;
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
            intentVersion: number;
            kind: "maintenance" | "execution";
            hash: string;
        } | null;
        maintenanceId: string | null;
        policyId: string;
        configHash: string;
        taskGeneration: number;
        trigger: {
            kind: "once";
            at: string;
        } | {
            kind: "interval";
            anchorAt: string;
            intervalMs: number;
        } | {
            kind: "condition";
            event: "task-settled" | "memory-pending" | "resource-restored";
            key: string;
        };
        missed: "skip" | "coalesce" | "run-once";
        timeZone: string;
        quiet: {
            start: string;
            end: string;
        }[];
        state: "active" | "paused" | "cancelled";
        createdAt: string;
        updatedAt: string;
    };
    update(id: string, scope: ExecutionScope, raw: unknown, now: number): {
        id: string;
        version: number;
    };
    bindTask(id: string, generation: number, taskId: string, epoch: number): void;
    task(id: string, generation?: number): {
        taskId: string;
        epoch: number;
    } | null;
    event(raw: ActivityDomainEvent): number;
    due(now: number): string[];
    private condition;
    issue(id: string, now: number): WakeOccurrenceBody | null;
    occurrence(id: string): StoredOccurrence;
    byRun(runId: string): StoredOccurrence | null;
    lastWake(): number;
    maintenancePlan(id: string): StoredSchedule | null;
    pauseIntent(id: string, runId: string, reason: 'foreground' | 'daily-budget' | 'time-budget', expectedVersion: number, now: number): {
        kind: "pause-intent";
        requestId: string;
        runId: string;
        reason: "foreground" | "daily-budget" | "time-budget";
        expectedVersion: number;
        at: number;
    };
    pausedBy(id: string, runId: string): {
        reason: "foreground" | "daily-budget" | "time-budget";
        at: number;
    } | null;
    resumeIntent(id: string, parentRunId: string, checkpointId: string, taskVersion: number, now: number): {
        kind: "resume-intent";
        requestId: string;
        parentRunId: string;
        checkpointId: string;
        taskVersion: number;
        at: number;
    };
    attachResume(id: string, parentRunId: string, runId: string, now: number): void;
    outbox(): StoredOccurrence[];
    acknowledge(id: string, runId: string, now: number): void;
    reject(id: string, code: string, now: number): void;
    block(id: string, code: string, now: number): void;
    runEvent(raw: unknown): void;
    used(now: number): number;
    occurrenceUsed(id: string): number;
    active(): StoredOccurrence[];
    counts(): {
        plans: number;
        states: {
            [k: string]: number;
        };
        occurrences: {
            [k: string]: number;
        };
    };
    close(): void;
}
export {};
