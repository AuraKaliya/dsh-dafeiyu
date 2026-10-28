import { Service } from '@deepseek-ai/cordis';
import type { Context } from '@deepseek-ai/cordis';
import { z } from 'zod';
import type { ExecutionContextV3, MemoryMaintenanceSchedulingPort, ActivityDomainEvent } from '#dafeiyu/contracts';
import { ActivityStore } from './store.js';
export declare const configSchema: z.ZodObject<{
    agentId: z.ZodString;
    profileId: z.ZodString;
    dataDir: z.ZodString;
    settings: z.ZodPrefault<z.ZodObject<{
        tickMs: z.ZodDefault<z.ZodNumber>;
        minIntervalMs: z.ZodDefault<z.ZodNumber>;
        maxPlans: z.ZodDefault<z.ZodNumber>;
        maxConcurrent: z.ZodDefault<z.ZodNumber>;
        maxActiveMs: z.ZodDefault<z.ZodNumber>;
        dailyActiveMs: z.ZodDefault<z.ZodNumber>;
        backoffBaseMs: z.ZodDefault<z.ZodNumber>;
        maxBackoffMs: z.ZodDefault<z.ZodNumber>;
        timeZone: z.ZodDefault<z.ZodString>;
        quiet: z.ZodDefault<z.ZodArray<z.ZodObject<{
            start: z.ZodString;
            end: z.ZodString;
        }, z.core.$strict>>>;
        explorationPolicy: z.ZodDefault<z.ZodString>;
        maintenancePolicy: z.ZodDefault<z.ZodString>;
        maintenance: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type Config = z.input<typeof configSchema>;
declare module '@deepseek-ai/cordis' {
    interface Context {
        dafeiyuActivity: ActivityService;
    }
}
export declare const ACTIVITY_ACTIONS: readonly ["dafeiyu_activity_plan", "dafeiyu_activity_update", "dafeiyu_activity_status"];
export declare class ActivityService extends Service {
    private readonly now;
    readonly store: ActivityStore;
    readonly config: z.output<typeof configSchema>;
    readonly configHash: string;
    private readonly gate;
    private closed;
    private closing;
    private finalCounts;
    private readonly scheduler;
    private readonly handle;
    constructor(ctx: Context, raw: Config, now?: () => number, monotonic?: () => number);
    private access;
    private basis;
    private trigger;
    plan(context: ExecutionContextV3, raw: unknown): {
        id: string;
        version: number;
    };
    update(context: ExecutionContextV3, raw: unknown): {
        id: string;
        version: number;
    };
    status(context: ExecutionContextV3, id?: string): {
        id: string;
        version: number;
        status: "active" | "paused" | "cancelled" | "blocked" | "exhausted";
        purpose: "maintenance" | "exploration";
        goal: string | null;
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
        quiet: {
            start: string;
            end: string;
        }[];
        timeZone: string;
        nextDueAt: string | null;
        notBefore: string;
        error: string | null;
        source: {
            state: "valid" | "pending" | "stale";
            code: string | null;
        } | {
            state: string;
            code: string;
        };
    }[];
    private actions;
    recover(): void;
    activate(): void;
    bindMaintenance(port: MemoryMaintenanceSchedulingPort): void;
    start(automatic?: boolean): void;
    tick(): Promise<void>;
    notify(event: ActivityDomainEvent): number;
    stopBackground(): void;
    whenIdle(): Promise<void>;
    quiesce(): void;
    get lifecycleState(): import("#dafeiyu/contracts").ServicePhase;
    get health(): {
        counts: {
            plans: number;
            states: {
                [k: string]: number;
            };
            occurrences: {
                [k: string]: number;
            };
        };
        running: boolean;
        error: string | null;
        lifecycle: import("#dafeiyu/contracts").ServicePhase;
    };
    close(): Promise<void>;
}
