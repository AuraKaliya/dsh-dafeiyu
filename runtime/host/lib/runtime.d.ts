import { Context } from '@deepseek-ai/cordis';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import * as Core from '#dafeiyu/core';
import { RUNTIME_SCHEMA_VERSION } from '#dafeiyu/core/runtime-store';
import * as Memory from '#dafeiyu/memory';
import { MEMORY_SCHEMA_VERSION } from '#dafeiyu/memory/store';
import * as Activity from '#dafeiyu/activity';
import * as Media from '#dafeiyu/media';
import * as Bili from '#dafeiyu/bilibili';
import { ServerExecutorService, EXECUTOR_SCHEMA_VERSION } from '#dafeiyu/server-executor';
import type { ServerExecutorDependencies } from '#dafeiyu/server-executor';
import { BILI_OWNER_SCHEMA_VERSION } from '#dafeiyu/bilibili/channel';
import type { BiliOwnerChannel, BiliOwnerPorts } from '#dafeiyu/bilibili/channel';
import type { PreparedHostConfig } from './configuration.js';
export type HostPhase = 'created' | 'inspected' | 'opening' | 'binding' | 'recovering' | 'ready' | 'degraded' | 'draining' | 'failed' | 'stopped';
export interface HostRuntimeOptions {
    readonly mode?: 'daemon' | 'single-run';
    readonly coordination?: string;
    readonly signal?: AbortSignal;
    /** Program-only test seam, forbidden for formal or real-provider profiles. */
    readonly adapter?: LlmAdapter;
    /** Fictional profiles only, so clock-driven acceptance can run without real waiting. */
    readonly activityClock?: {
        now: () => number;
        monotonic: () => number;
    };
    /** Program-only fictional-platform seam, rejected for real-provider/formal profiles. */
    readonly biliTransport?: Bili.HttpTransport;
    /** Trusted ports supplied by the server launcher; profile JSON cannot supply functions or a replacement runner. */
    readonly serverExecutorDependencies?: ServerExecutorDependencies;
    /** Trusted native channel transport and a shared machine account lease, never supplied by JSON. */
    readonly createBiliOwnerPorts?: () => Promise<BiliOwnerPorts>;
    /** Trusted program hook, awaited before Core/Memory or channel admission; never loaded from profile JSON. */
    readonly installModelAdmission?: (ctx: Context, config: PreparedHostConfig) => void | Promise<void>;
    readonly onPhase?: (phase: HostPhase, host: ManagedHost) => void;
    readonly onModelCall?: (call: {
        provider: string;
        model: string;
        purpose: string;
        status: 'started' | 'completed' | 'failed';
    }) => void;
}
export interface PluginHealth {
    id: string;
    required: boolean;
    state: 'configured' | 'starting' | 'ready' | 'degraded' | 'disabled' | 'not-configured' | 'failed' | 'stopped';
    version: string | null;
    code: string | null;
}
export interface HostSnapshot {
    schemaVersion: 1;
    profileId: string;
    agentId: string;
    instanceId: string;
    pid: number;
    at: string;
    configHash: string;
    foundationHash: string;
    phase: HostPhase;
    mode: 'daemon' | 'single-run';
    accepting: boolean;
    error: string | null;
    plugins: PluginHealth[];
    features: string[];
    services: {
        memory: ReturnType<Memory.MemoryService['runtimeHealth']> | null;
        activity: Activity.ActivityService['health'] | null;
        media: Media.MediaService['health'] | null;
        bilibili: Bili.BiliService['health'] | null;
        executor?: ServerExecutorService['health'];
        biliOwner?: ReturnType<BiliOwnerChannel['getStatus']>;
        taskDelivery: ReturnType<Core.DafeiyuService['getStatus']>['nativeDelivery'];
        qq: {
            state: string;
            groupSync: string;
            groupError: string | null;
            effectiveGroups: number;
            lastGroupSync: string | null;
            capabilities: boolean;
            tasks: {
                enabled: boolean;
                registered: boolean;
                deliverResults: boolean;
            };
            delivery: {
                plans: number;
                pending: number;
                unknown: number;
            };
        } | null;
    };
    counts: {
        activeRuns: number;
        queuedRuns: number;
        queuedRoutes: number;
        pendingMessages: number;
        outbox: number;
    };
    schemas: {
        journal: 2;
        memory: typeof MEMORY_SCHEMA_VERSION;
        runtime: typeof RUNTIME_SCHEMA_VERSION;
        activity: 1 | null;
        media: typeof Media.MEDIA_SCHEMA_VERSION | null;
        bilibili: 1 | null;
        executor?: typeof EXECUTOR_SCHEMA_VERSION;
        biliOwner?: typeof BILI_OWNER_SCHEMA_VERSION;
    };
}
export interface HostRunResult {
    taskId: string;
    runId: string;
    state: string;
    error: string | null;
    result: string | null;
}
/** One local profile, one DSH owner. CLI bootstrap binds DSH_HOME before loading this module. */
export declare class ManagedHost {
    private readonly options;
    readonly ctx: Context;
    readonly config: PreparedHostConfig;
    readonly mode: 'daemon' | 'single-run';
    private phase;
    private error;
    private lease;
    private instanceId;
    private timer;
    private closing;
    private coreValue;
    private memoryValue;
    private qqValue;
    private activityValue;
    private mediaValue;
    private biliValue;
    private executorValue;
    private biliOwnerValue;
    private credentials;
    private health;
    private readonly jobs;
    private finishClose;
    private readonly finished;
    private constructor();
    get core(): Core.DafeiyuService;
    static start(config: PreparedHostConfig, options?: HostRuntimeOptions): Promise<ManagedHost>;
    private mark;
    private plugin;
    private open;
    private refresh;
    private biliHealth;
    /** Missing optional IO must not turn retained private work into stale-source failures during global recovery. */
    private biliOwnerPendingWork;
    private biliOwnerHealth;
    private executorHealth;
    private qqHealth;
    private outbox;
    snapshot(): HostSnapshot;
    publish(): void;
    run(raw: unknown): Promise<HostRunResult>;
    private performRun;
    whenClosed(): Promise<void>;
    close(_reason?: string): Promise<void>;
    private shutdown;
}
