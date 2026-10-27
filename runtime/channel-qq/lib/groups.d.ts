import { z } from 'zod';
import type { QqStore } from './store.js';
export declare const QqAccountIdSchema: z.ZodString;
export declare const GroupSyncConfigSchema: z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    mode: z.ZodDefault<z.ZodEnum<{
        allowlist: "allowlist";
        joined: "joined";
    }>>;
    intervalMs: z.ZodDefault<z.ZodNumber>;
    maxStaleMs: z.ZodDefault<z.ZodNumber>;
}, z.core.$strict>;
export type GroupSyncConfig = z.output<typeof GroupSyncConfigSchema>;
declare const GroupInfoSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    msgMask: z.ZodDefault<z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<2>, z.ZodLiteral<3>, z.ZodLiteral<4>, z.ZodNull]>>;
}, z.core.$strict>;
export declare const GroupListSchema: z.ZodArray<z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    msgMask: z.ZodDefault<z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<2>, z.ZodLiteral<3>, z.ZodLiteral<4>, z.ZodNull]>>;
}, z.core.$strict>>;
export type GroupInfo = z.infer<typeof GroupListSchema>[number];
export type GroupInput = z.input<typeof GroupInfoSchema>;
export declare const groupReceivesMessages: (group: GroupInfo) => boolean;
export declare const GroupSnapshotSchema: z.ZodObject<{
    account: z.ZodString;
    at: z.ZodISODateTime;
    revision: z.ZodNumber;
    groups: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        msgMask: z.ZodDefault<z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<2>, z.ZodLiteral<3>, z.ZodLiteral<4>, z.ZodNull]>>;
        acceptedAfter: z.ZodDefault<z.ZodNumber>;
        generation: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type GroupSnapshot = z.infer<typeof GroupSnapshotSchema>;
export declare const GroupSyncStateSchema: z.ZodEnum<{
    disabled: "disabled";
    unavailable: "unavailable";
    current: "current";
    stale: "stale";
}>;
interface DirectoryOptions {
    account: string;
    allowed: readonly string[];
    config: GroupSyncConfig;
    store: Pick<QqStore, 'groupSnapshot' | 'saveGroups'>;
    fetchGroups(signal: AbortSignal): Promise<readonly GroupInfo[]>;
    rejectIdentity(): void;
    /** Monotonic clock seam for local tests, never a model argument. */
    clock?: () => number;
    wallClock?: () => number;
}
/** A remembered membership snapshot is history; only a fresh response in this process grants access. */
export declare class GroupDirectory {
    private readonly options;
    private readonly clock;
    private readonly controller;
    private timer;
    private pending;
    private running;
    private snapshot;
    private verifiedAt;
    private error;
    private readonly signals;
    private readonly ingressAfter;
    constructor(options: DirectoryOptions);
    state(): z.infer<typeof GroupSyncStateSchema>;
    effective(): string[];
    info(id: string): GroupInfo | null;
    accepts(id: string, occurredAt: number): boolean;
    generation(id: string): number;
    /** Existing accepted work uses the durable activation boundary, not the reconnect ingress cutoff. */
    processingSignal(id: string, occurredAt: number): AbortSignal;
    private revokeAll;
    status(): {
        enabled: boolean;
        mode: "allowlist" | "joined";
        state: "disabled" | "unavailable" | "current" | "stale";
        paused: boolean;
        lastSuccessAt: string | null;
        verifiedThisProcess: boolean;
        revision: number | null;
        joinedIds: string[];
        effectiveIds: string[];
        assistantIds: string[];
        unknownIds: string[];
        error: string | null;
    };
    start(): Promise<void>;
    refresh(): Promise<void>;
    private performRefresh;
    private schedule;
    pause(): void;
    whenIdle(): Promise<void>;
}
export {};
