import { Service } from '@deepseek-ai/cordis';
import type { Context } from '@deepseek-ai/cordis';
import type { DeliveryResult, Reply, TaskResultAnchor, ReplyMediaManifest } from '#dafeiyu/contracts';
import { z } from 'zod';
export { QqStore } from './store.js';
export { QqMediaDeliveryLedger } from './media-delivery.js';
export { inspectQqSchema, QQ_APPLICATION_ID, QQ_SCHEMA_VERSION } from './schema.js';
export { GroupDirectory, GroupSyncConfigSchema, GroupSyncStateSchema } from './groups.js';
export { naturallyAddressed } from './trigger.js';
export { QqBrowseInputSchema, QqCacheProofSchema } from './cache.js';
export type { QqCacheProof } from './cache.js';
export { QQ_ACTIONS } from './capabilities.js';
export { splitQqText, qqDeliveryPlan } from './delivery.js';
export type { QqDeliveryProgress, QqDeliveryPlan } from './delivery.js';
export { QQ_TASK_ACTIONS, qqTaskDirective } from './tasks.js';
export { QQ_MEDIA_ACTIONS } from './media.js';
export declare const name = "dafeiyu-channel-qq";
export declare const inject: string[];
declare const configSchema: z.ZodObject<{
    agentId: z.ZodString;
    botId: z.ZodString;
    ownerId: z.ZodString;
    groupIds: z.ZodArray<z.ZodString>;
    naturalNames: z.ZodDefault<z.ZodArray<z.ZodString>>;
    groupSync: z.ZodPrefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        mode: z.ZodDefault<z.ZodEnum<{
            allowlist: "allowlist";
            joined: "joined";
        }>>;
        intervalMs: z.ZodDefault<z.ZodNumber>;
        maxStaleMs: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strict>>;
    capabilities: z.ZodPrefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        snapshotTtlMs: z.ZodDefault<z.ZodNumber>;
        maxSnapshots: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strict>>;
    tasks: z.ZodPrefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        deliverResults: z.ZodDefault<z.ZodBoolean>;
        policyId: z.ZodDefault<z.ZodString>;
        explorationResources: z.ZodOptional<z.ZodArray<z.ZodObject<{
            channel: z.ZodString;
            account: z.ZodString;
            kind: z.ZodEnum<{
                private: "private";
                group: "group";
                local: "local";
            }>;
            id: z.ZodString;
        }, z.core.$strict>>>;
        expressionPolicy: z.ZodOptional<z.ZodObject<{
            id: z.ZodString;
            version: z.ZodNumber;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    media: z.ZodPrefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        sendEnabled: z.ZodDefault<z.ZodBoolean>;
        cacheRoots: z.ZodDefault<z.ZodArray<z.ZodString>>;
        httpsHosts: z.ZodDefault<z.ZodArray<z.ZodString>>;
        maxReadBytes: z.ZodDefault<z.ZodNumber>;
        voiceDirectives: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strict>>;
    httpURL: z.ZodString;
    wsURL: z.ZodString;
    tokenFile: z.ZodString;
    dataDir: z.ZodString;
    lifecycleMode: z.ZodDefault<z.ZodEnum<{
        legacy: "legacy";
        managed: "managed";
    }>>;
    requestTimeoutMs: z.ZodDefault<z.ZodNumber>;
    reconnectMs: z.ZodDefault<z.ZodNumber>;
}, z.core.$strict>;
export type Config = z.input<typeof configSchema>;
export declare const QqPluginConfigSchema: z.ZodObject<{
    media: z.ZodPrefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        sendEnabled: z.ZodDefault<z.ZodBoolean>;
        cacheRoots: z.ZodDefault<z.ZodArray<z.ZodString>>;
        httpsHosts: z.ZodDefault<z.ZodArray<z.ZodString>>;
        maxReadBytes: z.ZodDefault<z.ZodNumber>;
        voiceDirectives: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strict>>;
    botId: z.ZodString;
    ownerId: z.ZodString;
    groupIds: z.ZodArray<z.ZodString>;
    naturalNames: z.ZodDefault<z.ZodArray<z.ZodString>>;
    groupSync: z.ZodPrefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        mode: z.ZodDefault<z.ZodEnum<{
            allowlist: "allowlist";
            joined: "joined";
        }>>;
        intervalMs: z.ZodDefault<z.ZodNumber>;
        maxStaleMs: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strict>>;
    capabilities: z.ZodPrefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        snapshotTtlMs: z.ZodDefault<z.ZodNumber>;
        maxSnapshots: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strict>>;
    tasks: z.ZodPrefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        deliverResults: z.ZodDefault<z.ZodBoolean>;
        policyId: z.ZodDefault<z.ZodString>;
        explorationResources: z.ZodOptional<z.ZodArray<z.ZodObject<{
            channel: z.ZodString;
            account: z.ZodString;
            kind: z.ZodEnum<{
                private: "private";
                group: "group";
                local: "local";
            }>;
            id: z.ZodString;
        }, z.core.$strict>>>;
        expressionPolicy: z.ZodOptional<z.ZodObject<{
            id: z.ZodString;
            version: z.ZodNumber;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    httpURL: z.ZodString;
    wsURL: z.ZodString;
    tokenFile: z.ZodString;
    requestTimeoutMs: z.ZodDefault<z.ZodNumber>;
    reconnectMs: z.ZodDefault<z.ZodNumber>;
}, z.core.$strict>;
declare module '@deepseek-ai/cordis' {
    interface Context {
        dafeiyuQQ: QqChannel;
    }
}
type Status = 'starting' | 'online' | 'offline' | 'rejected' | 'stopped';
/** Explicitly scoped QQ transport. No model calls, shell tools, friend approvals or history replay. */
export declare class QqChannel extends Service {
    private readonly config;
    private readonly api;
    private readonly store;
    private readonly transport;
    private readonly mediaTransport;
    private closedDeliveryCounts;
    private readonly groups;
    private readonly handle;
    private readonly capabilities;
    private readonly tasks;
    private readonly media;
    private readonly token;
    private socket;
    private retry;
    private heartbeat;
    private lastPong;
    private stopped;
    private quiescing;
    private verified;
    private ingressHeld;
    private buffered;
    private bufferedBytes;
    private state;
    private error;
    private readonly controller;
    private queue;
    private readonly sending;
    private counters;
    constructor(ctx: Context, raw: Config);
    private observation;
    getStatus(): {
        state: Status;
        error: string | null;
        botId: string;
        ownerId: string;
        media: {
            enabled: boolean;
            sendEnabled: boolean;
            registered: boolean;
            actions: "qq_media_list"[];
            voiceDirectives: boolean;
        };
        groupIds: string[];
        groupSync: {
            enabled: boolean;
            mode: "allowlist" | "joined";
            state: "disabled" | "unavailable" | "current" | "stale";
            paused: boolean;
            lastSuccessAt: string | null;
            verifiedThisProcess: boolean;
            revision: number | null;
            joinedIds: string[];
            effectiveIds: string[];
            error: string | null;
        };
        delivery: {
            plans: number;
            pending: number;
            unknown: number;
        };
        tasks: {
            enabled: boolean;
            registered: boolean;
            deliverResults: boolean;
            actions: ("qq_task_submit" | "qq_task_status" | "qq_task_control")[];
        };
        capabilities: {
            enabled: boolean;
            registered: boolean;
            actions: ("qq_groups" | "qq_browse" | "qq_observe_select")[];
        };
        counters: {
            received: number;
            accepted: number;
            ignored: number;
            unsupported: number;
            delivered: number;
            segmentsConfirmed: number;
            reconnects: number;
            recalled: number;
        };
        at: string;
    };
    private deliveryCounts;
    private cacheRoute;
    private allowed;
    /** Program-side refresh; no model invocation, privilege expansion or history replay. */
    refreshGroups(): Promise<void>;
    start(): Promise<void>;
    holdIngress(): void;
    releaseIngress(): void;
    quiesce(): void;
    whenIdle(): Promise<void>;
    private connect;
    private retryLater;
    private receive;
    deliver(reply: Reply, signal: AbortSignal, authority?: () => void): Promise<DeliveryResult>;
    deliverMedia(reply: Reply & {
        media: ReplyMediaManifest;
    }, signal: AbortSignal, authority: () => void, bytes: (position: number) => Promise<Uint8Array>): Promise<DeliveryResult>;
    deliverTaskResult(reply: Reply, raw: TaskResultAnchor, signal: AbortSignal, authority: () => void): Promise<DeliveryResult>;
    deliveryStatus(replyId: string): import("./delivery.js").QqDeliveryProgress | import("./media-delivery.js").QqMediaDeliveryProgress | null;
    private checkDelivery;
    private sendSegment;
    private sendMediaPart;
    close(): Promise<void>;
}
export declare function apply(ctx: Context, config: Config): Promise<void>;
