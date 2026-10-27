import { z } from 'zod';
import type { PreparedHostConfig } from './configuration.js';
declare const snapshotSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    profileId: z.ZodString;
    agentId: z.ZodString;
    instanceId: z.ZodUUID;
    pid: z.ZodNumber;
    at: z.ZodISODateTime;
    configHash: z.ZodString;
    foundationHash: z.ZodString;
    phase: z.ZodEnum<{
        failed: "failed";
        created: "created";
        inspected: "inspected";
        opening: "opening";
        binding: "binding";
        recovering: "recovering";
        ready: "ready";
        degraded: "degraded";
        draining: "draining";
        stopped: "stopped";
    }>;
    mode: z.ZodEnum<{
        daemon: "daemon";
        "single-run": "single-run";
    }>;
    accepting: z.ZodBoolean;
    error: z.ZodNullable<z.ZodString>;
    plugins: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        required: z.ZodBoolean;
        state: z.ZodEnum<{
            disabled: "disabled";
            failed: "failed";
            configured: "configured";
            ready: "ready";
            degraded: "degraded";
            stopped: "stopped";
            starting: "starting";
            "not-configured": "not-configured";
        }>;
        version: z.ZodNullable<z.ZodString>;
        code: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>>;
    features: z.ZodArray<z.ZodString>;
    services: z.ZodObject<{
        memory: z.ZodNullable<z.ZodObject<{
            lifecycle: z.ZodEnum<{
                active: "active";
                registered: "registered";
                recovered: "recovered";
                quiescing: "quiescing";
                closed: "closed";
            }>;
            analysis: z.ZodObject<{
                state: z.ZodEnum<{
                    paused: "paused";
                    failed: "failed";
                    ready: "ready";
                    stopped: "stopped";
                    "not-configured": "not-configured";
                }>;
                active: z.ZodBoolean;
            }, z.core.$strict>;
            retrieval: z.ZodEnum<{
                configured: "configured";
                "not-configured": "not-configured";
            }>;
            compaction: z.ZodEnum<{
                configured: "configured";
                "not-configured": "not-configured";
            }>;
            sourceTracking: z.ZodOptional<z.ZodEnum<{
                configured: "configured";
                "not-configured": "not-configured";
            }>>;
            maintenance: z.ZodOptional<z.ZodObject<{
                state: z.ZodEnum<{
                    paused: "paused";
                    ready: "ready";
                    "not-configured": "not-configured";
                    closed: "closed";
                }>;
                active: z.ZodNumber;
                requests: z.ZodRecord<z.ZodString, z.ZodNumber>;
                scheduler: z.ZodEnum<{
                    "not-configured": "not-configured";
                    connected: "connected";
                }>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        activity: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            lifecycle: z.ZodEnum<{
                active: "active";
                registered: "registered";
                recovered: "recovered";
                quiescing: "quiescing";
                closed: "closed";
            }>;
            running: z.ZodBoolean;
            error: z.ZodNullable<z.ZodString>;
            counts: z.ZodObject<{
                plans: z.ZodNumber;
                states: z.ZodRecord<z.ZodString, z.ZodNumber>;
                occurrences: z.ZodRecord<z.ZodString, z.ZodNumber>;
            }, z.core.$strict>;
        }, z.core.$strict>>>;
        media: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            lifecycle: z.ZodEnum<{
                active: "active";
                registered: "registered";
                recovered: "recovered";
                quiescing: "quiescing";
                closed: "closed";
            }>;
            modalities: z.ZodObject<{
                vision: z.ZodBoolean;
                asr: z.ZodBoolean;
                events: z.ZodBoolean;
                documents: z.ZodBoolean;
                tts: z.ZodBoolean;
            }, z.core.$strict>;
            counts: z.ZodObject<{
                sources: z.ZodNumber;
                assets: z.ZodNumber;
                bytes: z.ZodNumber;
                drafts: z.ZodNumber;
                exports: z.ZodNumber;
                jobs: z.ZodRecord<z.ZodString, z.ZodNumber>;
            }, z.core.$strict>;
            reconciliation: z.ZodObject<{
                settled: z.ZodNumber;
                pending: z.ZodNumber;
                conflicts: z.ZodNumber;
            }, z.core.$strict>;
        }, z.core.$strict>>>;
        bilibili: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            lifecycle: z.ZodEnum<{
                active: "active";
                registered: "registered";
                recovered: "recovered";
                quiescing: "quiescing";
                closed: "closed";
            }>;
            media: z.ZodBoolean;
            counts: z.ZodObject<{
                pages: z.ZodNumber;
                requests: z.ZodNumber;
                pending: z.ZodNumber;
            }, z.core.$strict>;
            backoffUntil: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strict>>>;
        executor: z.ZodOptional<z.ZodObject<{
            lifecycle: z.ZodEnum<{
                active: "active";
                registered: "registered";
                recovered: "recovered";
                quiescing: "quiescing";
                closed: "closed";
            }>;
            active: z.ZodNumber;
            counts: z.ZodRecord<z.ZodString, z.ZodNumber>;
            mode: z.ZodEnum<{
                production: "production";
                offline: "offline";
            }>;
        }, z.core.$strict>>;
        biliOwner: z.ZodOptional<z.ZodObject<{
            lifecycle: z.ZodEnum<{
                active: "active";
                registered: "registered";
                recovered: "recovered";
                quiescing: "quiescing";
                closed: "closed";
            }>;
            accountUid: z.ZodString;
            ownerUid: z.ZodString;
            transport: z.ZodLiteral<"program-injected">;
            verified: z.ZodBoolean;
            ingressHeld: z.ZodBoolean;
            polling: z.ZodBoolean;
            inFlight: z.ZodNumber;
            lastPollAt: z.ZodNullable<z.ZodISODateTime>;
            error: z.ZodNullable<z.ZodString>;
            bindingFault: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            backoffUntil: z.ZodNumber;
            bindingReady: z.ZodBoolean;
            counts: z.ZodObject<{
                inbound: z.ZodRecord<z.ZodString, z.ZodNumber>;
                deliveries: z.ZodRecord<z.ZodString, z.ZodNumber>;
            }, z.core.$strict>;
            leaseEpoch: z.ZodNumber;
        }, z.core.$strict>>;
        taskDelivery: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            total: z.ZodNumber;
            pending: z.ZodNumber;
            sent: z.ZodNumber;
            partial: z.ZodNumber;
            uncertain: z.ZodNumber;
            blocked: z.ZodNumber;
        }, z.core.$strict>>>;
        qq: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            state: z.ZodEnum<{
                rejected: "rejected";
                stopped: "stopped";
                starting: "starting";
                offline: "offline";
                online: "online";
            }>;
            groupSync: z.ZodEnum<{
                disabled: "disabled";
                unavailable: "unavailable";
                current: "current";
                stale: "stale";
            }>;
            groupError: z.ZodNullable<z.ZodString>;
            effectiveGroups: z.ZodNumber;
            lastGroupSync: z.ZodNullable<z.ZodISODateTime>;
            capabilities: z.ZodOptional<z.ZodBoolean>;
            tasks: z.ZodOptional<z.ZodObject<{
                enabled: z.ZodBoolean;
                registered: z.ZodBoolean;
                deliverResults: z.ZodBoolean;
            }, z.core.$strict>>;
            delivery: z.ZodOptional<z.ZodObject<{
                plans: z.ZodNumber;
                pending: z.ZodNumber;
                unknown: z.ZodNumber;
            }, z.core.$strict>>;
        }, z.core.$strict>>>;
    }, z.core.$strict>;
    counts: z.ZodObject<{
        activeRuns: z.ZodNumber;
        queuedRuns: z.ZodNumber;
        queuedRoutes: z.ZodNumber;
        pendingMessages: z.ZodNumber;
        outbox: z.ZodNumber;
    }, z.core.$strict>;
    schemas: z.ZodObject<{
        journal: z.ZodLiteral<2>;
        memory: z.ZodUnion<readonly [z.ZodLiteral<8>, z.ZodLiteral<9>, z.ZodLiteral<10>, z.ZodLiteral<11>, z.ZodLiteral<12>]>;
        runtime: z.ZodUnion<readonly [z.ZodLiteral<2>, z.ZodLiteral<3>, z.ZodLiteral<4>]>;
        activity: z.ZodOptional<z.ZodNullable<z.ZodLiteral<1>>>;
        media: z.ZodOptional<z.ZodNullable<z.ZodLiteral<2>>>;
        bilibili: z.ZodOptional<z.ZodNullable<z.ZodLiteral<1>>>;
        executor: z.ZodOptional<z.ZodLiteral<1>>;
        biliOwner: z.ZodOptional<z.ZodLiteral<2>>;
    }, z.core.$strict>;
}, z.core.$strict>;
export type SavedHostSnapshot = z.infer<typeof snapshotSchema>;
/** An old or edited file is evidence of a snapshot, never proof of a live healthy instance. */
export declare function readHostStatus(config: PreparedHostConfig, coordination?: string, now?: number): {
    online: boolean;
    fresh: boolean;
    status: "not-running";
    codes: string[];
    snapshot: null;
} | {
    online: boolean;
    fresh: boolean;
    status: "online" | "not-running" | "unhealthy";
    codes: string[];
    snapshot: {
        schemaVersion: 1;
        profileId: string;
        agentId: string;
        instanceId: string;
        pid: number;
        at: string;
        configHash: string;
        foundationHash: string;
        phase: "failed" | "created" | "inspected" | "opening" | "binding" | "recovering" | "ready" | "degraded" | "draining" | "stopped";
        mode: "daemon" | "single-run";
        accepting: boolean;
        error: string | null;
        plugins: {
            id: string;
            required: boolean;
            state: "disabled" | "failed" | "configured" | "ready" | "degraded" | "stopped" | "starting" | "not-configured";
            version: string | null;
            code: string | null;
        }[];
        features: string[];
        services: {
            memory: {
                lifecycle: "active" | "registered" | "recovered" | "quiescing" | "closed";
                analysis: {
                    state: "paused" | "failed" | "ready" | "stopped" | "not-configured";
                    active: boolean;
                };
                retrieval: "configured" | "not-configured";
                compaction: "configured" | "not-configured";
                sourceTracking?: "configured" | "not-configured" | undefined;
                maintenance?: {
                    state: "paused" | "ready" | "not-configured" | "closed";
                    active: number;
                    requests: Record<string, number>;
                    scheduler: "not-configured" | "connected";
                } | undefined;
            } | null;
            activity?: {
                lifecycle: "active" | "registered" | "recovered" | "quiescing" | "closed";
                running: boolean;
                error: string | null;
                counts: {
                    plans: number;
                    states: Record<string, number>;
                    occurrences: Record<string, number>;
                };
            } | null | undefined;
            media?: {
                lifecycle: "active" | "registered" | "recovered" | "quiescing" | "closed";
                modalities: {
                    vision: boolean;
                    asr: boolean;
                    events: boolean;
                    documents: boolean;
                    tts: boolean;
                };
                counts: {
                    sources: number;
                    assets: number;
                    bytes: number;
                    drafts: number;
                    exports: number;
                    jobs: Record<string, number>;
                };
                reconciliation: {
                    settled: number;
                    pending: number;
                    conflicts: number;
                };
            } | null | undefined;
            bilibili?: {
                lifecycle: "active" | "registered" | "recovered" | "quiescing" | "closed";
                media: boolean;
                counts: {
                    pages: number;
                    requests: number;
                    pending: number;
                };
                backoffUntil: number | null;
            } | null | undefined;
            executor?: {
                lifecycle: "active" | "registered" | "recovered" | "quiescing" | "closed";
                active: number;
                counts: Record<string, number>;
                mode: "production" | "offline";
            } | undefined;
            biliOwner?: {
                lifecycle: "active" | "registered" | "recovered" | "quiescing" | "closed";
                accountUid: string;
                ownerUid: string;
                transport: "program-injected";
                verified: boolean;
                ingressHeld: boolean;
                polling: boolean;
                inFlight: number;
                lastPollAt: string | null;
                error: string | null;
                backoffUntil: number;
                bindingReady: boolean;
                counts: {
                    inbound: Record<string, number>;
                    deliveries: Record<string, number>;
                };
                leaseEpoch: number;
                bindingFault?: string | null | undefined;
            } | undefined;
            taskDelivery?: {
                total: number;
                pending: number;
                sent: number;
                partial: number;
                uncertain: number;
                blocked: number;
            } | null | undefined;
            qq?: {
                state: "rejected" | "stopped" | "starting" | "offline" | "online";
                groupSync: "disabled" | "unavailable" | "current" | "stale";
                groupError: string | null;
                effectiveGroups: number;
                lastGroupSync: string | null;
                capabilities?: boolean | undefined;
                tasks?: {
                    enabled: boolean;
                    registered: boolean;
                    deliverResults: boolean;
                } | undefined;
                delivery?: {
                    plans: number;
                    pending: number;
                    unknown: number;
                } | undefined;
            } | null | undefined;
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
            memory: 8 | 9 | 10 | 11 | 12;
            runtime: 3 | 4 | 2;
            activity?: 1 | null | undefined;
            media?: 2 | null | undefined;
            bilibili?: 1 | null | undefined;
            executor?: 1 | undefined;
            biliOwner?: 2 | undefined;
        };
    };
};
export {};
