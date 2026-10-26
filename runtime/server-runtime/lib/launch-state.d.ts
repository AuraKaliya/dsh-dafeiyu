import { z } from 'zod';
import type { HostSnapshot } from '#dafeiyu/host';
import type { WindowsHostProof } from '#dafeiyu/server-executor/windows-process';
export declare const SERVER_RUNTIME_STATUS_FILE = "server-runtime-status.json";
export declare const SERVER_RUNTIME_STATUS_MAX_BYTES = 32768;
export declare const ServerRuntimeStatusIdentitySchema: z.ZodObject<{
    profileId: z.ZodString;
    agentId: z.ZodString;
    accountingId: z.ZodString;
    manifestHash: z.ZodString;
    configHash: z.ZodString;
}, z.core.$strict>;
export type ServerRuntimeStatusIdentity = z.infer<typeof ServerRuntimeStatusIdentitySchema>;
export declare const ServerRuntimeParentProofSchema: z.ZodObject<{
    pid: z.ZodNumber;
    creationId: z.ZodString;
    nodeHash: z.ZodString;
    ownerSid: z.ZodString;
    observedAt: z.ZodISODateTime;
}, z.core.$strict>;
export type ServerRuntimeParentProof = z.infer<typeof ServerRuntimeParentProofSchema>;
export declare const ServerRuntimeHostStateSchema: z.ZodObject<{
    instanceId: z.ZodNullable<z.ZodUUID>;
    observedAt: z.ZodISODateTime;
    phase: z.ZodEnum<{
        created: "created";
        inspected: "inspected";
        opening: "opening";
        binding: "binding";
        recovering: "recovering";
        ready: "ready";
        degraded: "degraded";
        draining: "draining";
        failed: "failed";
        stopped: "stopped";
    }>;
    accepting: z.ZodBoolean;
    counts: z.ZodObject<{
        activeRuns: z.ZodNumber;
        queuedRuns: z.ZodNumber;
        queuedRoutes: z.ZodNumber;
        pendingMessages: z.ZodNumber;
        outbox: z.ZodNumber;
    }, z.core.$strict>;
}, z.core.$strict>;
export type ServerRuntimeHostState = z.infer<typeof ServerRuntimeHostStateSchema>;
export declare const ServerRuntimeStopSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"accounting-stop">;
    code: z.ZodString;
    reason: z.ZodEnum<{
        "unknown-cost": "unknown-cost";
        expired: "expired";
        exhausted: "exhausted";
        "clock-stop": "clock-stop";
    }>;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"runtime-failure">;
    code: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"requested">;
    code: z.ZodString;
}, z.core.$strict>], "kind">;
export type ServerRuntimeStop = z.infer<typeof ServerRuntimeStopSchema>;
export declare const ServerRuntimeStatusInputSchema: z.ZodObject<{
    state: z.ZodEnum<{
        failed: "failed";
        stopped: "stopped";
        starting: "starting";
        running: "running";
        stopping: "stopping";
    }>;
    host: z.ZodNullable<z.ZodObject<{
        instanceId: z.ZodNullable<z.ZodUUID>;
        observedAt: z.ZodISODateTime;
        phase: z.ZodEnum<{
            created: "created";
            inspected: "inspected";
            opening: "opening";
            binding: "binding";
            recovering: "recovering";
            ready: "ready";
            degraded: "degraded";
            draining: "draining";
            failed: "failed";
            stopped: "stopped";
        }>;
        accepting: z.ZodBoolean;
        counts: z.ZodObject<{
            activeRuns: z.ZodNumber;
            queuedRuns: z.ZodNumber;
            queuedRoutes: z.ZodNumber;
            pendingMessages: z.ZodNumber;
            outbox: z.ZodNumber;
        }, z.core.$strict>;
    }, z.core.$strict>>;
    parentProof: z.ZodNullable<z.ZodObject<{
        pid: z.ZodNumber;
        creationId: z.ZodString;
        nodeHash: z.ZodString;
        ownerSid: z.ZodString;
        observedAt: z.ZodISODateTime;
    }, z.core.$strict>>;
    stop: z.ZodNullable<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"accounting-stop">;
        code: z.ZodString;
        reason: z.ZodEnum<{
            "unknown-cost": "unknown-cost";
            expired: "expired";
            exhausted: "exhausted";
            "clock-stop": "clock-stop";
        }>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"runtime-failure">;
        code: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"requested">;
        code: z.ZodString;
    }, z.core.$strict>], "kind">>;
    closure: z.ZodObject<{
        drained: z.ZodBoolean;
        proof: z.ZodEnum<{
            "not-created": "not-created";
            open: "open";
            closed: "closed";
            unconfirmed: "unconfirmed";
        }>;
    }, z.core.$strict>;
}, z.core.$strict>;
export type ServerRuntimeStatusInput = z.infer<typeof ServerRuntimeStatusInputSchema>;
export declare const ServerRuntimeStatusSchema: z.ZodObject<{
    state: z.ZodEnum<{
        failed: "failed";
        stopped: "stopped";
        starting: "starting";
        running: "running";
        stopping: "stopping";
    }>;
    host: z.ZodNullable<z.ZodObject<{
        instanceId: z.ZodNullable<z.ZodUUID>;
        observedAt: z.ZodISODateTime;
        phase: z.ZodEnum<{
            created: "created";
            inspected: "inspected";
            opening: "opening";
            binding: "binding";
            recovering: "recovering";
            ready: "ready";
            degraded: "degraded";
            draining: "draining";
            failed: "failed";
            stopped: "stopped";
        }>;
        accepting: z.ZodBoolean;
        counts: z.ZodObject<{
            activeRuns: z.ZodNumber;
            queuedRuns: z.ZodNumber;
            queuedRoutes: z.ZodNumber;
            pendingMessages: z.ZodNumber;
            outbox: z.ZodNumber;
        }, z.core.$strict>;
    }, z.core.$strict>>;
    parentProof: z.ZodNullable<z.ZodObject<{
        pid: z.ZodNumber;
        creationId: z.ZodString;
        nodeHash: z.ZodString;
        ownerSid: z.ZodString;
        observedAt: z.ZodISODateTime;
    }, z.core.$strict>>;
    stop: z.ZodNullable<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"accounting-stop">;
        code: z.ZodString;
        reason: z.ZodEnum<{
            "unknown-cost": "unknown-cost";
            expired: "expired";
            exhausted: "exhausted";
            "clock-stop": "clock-stop";
        }>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"runtime-failure">;
        code: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"requested">;
        code: z.ZodString;
    }, z.core.$strict>], "kind">>;
    closure: z.ZodObject<{
        drained: z.ZodBoolean;
        proof: z.ZodEnum<{
            "not-created": "not-created";
            open: "open";
            closed: "closed";
            unconfirmed: "unconfirmed";
        }>;
    }, z.core.$strict>;
    schemaVersion: z.ZodLiteral<1>;
    directoryIdentity: z.ZodString;
    writerId: z.ZodUUID;
    writerPid: z.ZodNumber;
    sequence: z.ZodNumber;
    at: z.ZodISODateTime;
    clockRegressed: z.ZodBoolean;
    profileId: z.ZodString;
    agentId: z.ZodString;
    accountingId: z.ZodString;
    manifestHash: z.ZodString;
    configHash: z.ZodString;
}, z.core.$strict>;
export type ServerRuntimeStatus = z.infer<typeof ServerRuntimeStatusSchema>;
export interface ServerRuntimeStatusWriterOptions extends ServerRuntimeStatusIdentity {
    readonly coreDir: string;
}
export type ServerRuntimeStatusRead = {
    readonly kind: 'missing' | 'invalid';
    readonly live: 'unverified';
    readonly fresh: false;
    readonly code: string;
} | {
    readonly kind: 'snapshot';
    readonly live: 'unverified';
    readonly fresh: boolean;
    readonly code: string | null;
    readonly ageMs: number;
    readonly hostAgeMs: number | null;
    readonly snapshot: ServerRuntimeStatus;
    readonly token: {
        readonly writerId: string;
        readonly sequence: number;
        readonly hash: string;
    };
    readonly accountingStopped: boolean;
    readonly recordedAccountingStopReceipt: boolean;
};
/** Select program metadata only; this projection itself does not authenticate a copied proof. */
export declare function projectServerRuntimeParentProof(proof: WindowsHostProof): ServerRuntimeParentProof;
export declare function projectServerRuntimeHost(snapshot: HostSnapshot): ServerRuntimeHostState;
/** Read-only and bounded. Freshness is not OS liveness, lease ownership or health proof. */
export declare function readServerRuntimeStatus(coreDir: string, expected: ServerRuntimeStatusIdentity, options: {
    maxAgeMs: number;
    now?: number;
}): ServerRuntimeStatusRead;
/** Requires the launcher's existing accounting/profile ownership; this is not a second runtime lease.
 * Synchronous compare-before-replace rejects stale callbacks. The caller must serialize different processes. */
export declare class ServerRuntimeStatusWriter {
    readonly file: string;
    private readonly directory;
    private readonly coreDir;
    private readonly identity;
    private readonly writerId;
    private previous;
    private own;
    constructor(options: ServerRuntimeStatusWriterOptions);
    private ownerCheck;
    write(raw: ServerRuntimeStatusInput, now?: number): ServerRuntimeStatus;
}
