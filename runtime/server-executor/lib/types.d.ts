import { z } from 'zod';
export declare const ExecutorHashSchema: z.ZodString;
export declare const ExecutorCodeSchema: z.ZodString;
export declare const ExecutorIdentitySchema: z.ZodObject<{
    agentId: z.ZodString;
    profileId: z.ZodString;
}, z.core.$strict>;
export declare const ExecutorTaskScopeSchema: z.ZodPipe<z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"conversation">;
    agentId: z.ZodString;
    route: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"task">;
    agentId: z.ZodString;
    taskId: z.ZodUUID;
    scopeKey: z.ZodString;
}, z.core.$strict>], "kind">, z.ZodTransform<{
    kind: "task";
    agentId: string;
    taskId: string;
    scopeKey: string;
}, {
    kind: "conversation";
    agentId: string;
    route: string;
} | {
    kind: "task";
    agentId: string;
    taskId: string;
    scopeKey: string;
}>>;
export type ExecutorTaskScope = z.output<typeof ExecutorTaskScopeSchema>;
/** A durable description, never a transferable Core grant. Only the service may derive these hashes from live authority. */
export declare const ExecutorJobSpecSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    scope: z.ZodPipe<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"conversation">;
        agentId: z.ZodString;
        route: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"task">;
        agentId: z.ZodString;
        taskId: z.ZodUUID;
        scopeKey: z.ZodString;
    }, z.core.$strict>], "kind">, z.ZodTransform<{
        kind: "task";
        agentId: string;
        taskId: string;
        scopeKey: string;
    }, {
        kind: "conversation";
        agentId: string;
        route: string;
    } | {
        kind: "task";
        agentId: string;
        taskId: string;
        scopeKey: string;
    }>>;
    intentVersion: z.ZodNumber;
    requestId: z.ZodString;
    authorizationKey: z.ZodString;
    goalHash: z.ZodString;
    inputHash: z.ZodString;
    profileHash: z.ZodString;
    commandHash: z.ZodString;
    executableHash: z.ZodString;
    budgetAuthorizationId: z.ZodString;
}, z.core.$strict>;
export type ExecutorJobSpec = z.infer<typeof ExecutorJobSpecSchema>;
/** Every actual operation keeps its full authorization fingerprint, including its Run/operation binding. */
export declare const ExecutorOperationBindingSchema: z.ZodObject<{
    runId: z.ZodUUID;
    operationId: z.ZodUUID;
    authorizationHash: z.ZodString;
}, z.core.$strict>;
export type ExecutorOperationBinding = z.infer<typeof ExecutorOperationBindingSchema>;
export declare const ExecutorProcessSchema: z.ZodObject<{
    pid: z.ZodNumber;
    creationId: z.ZodString;
    executableHash: z.ZodString;
}, z.core.$strict>;
export type ExecutorProcess = z.infer<typeof ExecutorProcessSchema>;
export declare const ExecutorHandshakeSchema: z.ZodObject<{
    nonceHash: z.ZodString;
    profileHash: z.ZodString;
    process: z.ZodObject<{
        pid: z.ZodNumber;
        creationId: z.ZodString;
        executableHash: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>;
export type ExecutorHandshake = z.infer<typeof ExecutorHandshakeSchema>;
export declare const ExecutorStateSchema: z.ZodEnum<{
    prepared: "prepared";
    launching: "launching";
    running: "running";
    completed: "completed";
    failed: "failed";
    cancelled: "cancelled";
    unknown: "unknown";
}>;
export type ExecutorState = z.infer<typeof ExecutorStateSchema>;
export declare const ExecutorOutputSchema: z.ZodObject<{
    relative: z.ZodString;
    hash: z.ZodString;
    bytes: z.ZodNumber;
}, z.core.$strict>;
export declare const ExecutorExitSchema: z.ZodObject<{
    code: z.ZodNullable<z.ZodNumber>;
    signal: z.ZodNullable<z.ZodString>;
    verified: z.ZodBoolean;
}, z.core.$strict>;
export declare const ExecutorTerminalSchema: z.ZodObject<{
    state: z.ZodEnum<{
        completed: "completed";
        failed: "failed";
        cancelled: "cancelled";
        unknown: "unknown";
    }>;
    effects: z.ZodEnum<{
        unknown: "unknown";
        none: "none";
        confirmed: "confirmed";
    }>;
    sessionId: z.ZodNullable<z.ZodString>;
    exit: z.ZodNullable<z.ZodObject<{
        code: z.ZodNullable<z.ZodNumber>;
        signal: z.ZodNullable<z.ZodString>;
        verified: z.ZodBoolean;
    }, z.core.$strict>>;
    output: z.ZodNullable<z.ZodObject<{
        relative: z.ZodString;
        hash: z.ZodString;
        bytes: z.ZodNumber;
    }, z.core.$strict>>;
    gaps: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export type ExecutorTerminal = z.infer<typeof ExecutorTerminalSchema>;
export declare const ExecutorReceiptSchema: z.ZodObject<{
    state: z.ZodEnum<{
        completed: "completed";
        failed: "failed";
        cancelled: "cancelled";
        unknown: "unknown";
    }>;
    effects: z.ZodEnum<{
        unknown: "unknown";
        none: "none";
        confirmed: "confirmed";
    }>;
    sessionId: z.ZodNullable<z.ZodString>;
    exit: z.ZodNullable<z.ZodObject<{
        code: z.ZodNullable<z.ZodNumber>;
        signal: z.ZodNullable<z.ZodString>;
        verified: z.ZodBoolean;
    }, z.core.$strict>>;
    output: z.ZodNullable<z.ZodObject<{
        relative: z.ZodString;
        hash: z.ZodString;
        bytes: z.ZodNumber;
    }, z.core.$strict>>;
    gaps: z.ZodArray<z.ZodString>;
    schemaVersion: z.ZodLiteral<1>;
    id: z.ZodUUID;
    jobId: z.ZodUUID;
    createdAt: z.ZodISODateTime;
    nonceHash: z.ZodNullable<z.ZodString>;
    process: z.ZodNullable<z.ZodObject<{
        pid: z.ZodNumber;
        creationId: z.ZodString;
        executableHash: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type ExecutorReceipt = z.infer<typeof ExecutorReceiptSchema>;
export declare const ExecutorReceiptRefSchema: z.ZodObject<{
    id: z.ZodUUID;
    hash: z.ZodString;
}, z.core.$strict>;
export declare const ExecutorEventSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"prepared">;
    requestHash: z.ZodString;
    schemaVersion: z.ZodLiteral<1>;
    id: z.ZodUUID;
    jobId: z.ZodUUID;
    version: z.ZodNumber;
    at: z.ZodISODateTime;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"launching">;
    nonceHash: z.ZodString;
    schemaVersion: z.ZodLiteral<1>;
    id: z.ZodUUID;
    jobId: z.ZodUUID;
    version: z.ZodNumber;
    at: z.ZodISODateTime;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"running">;
    handshake: z.ZodObject<{
        nonceHash: z.ZodString;
        profileHash: z.ZodString;
        process: z.ZodObject<{
            pid: z.ZodNumber;
            creationId: z.ZodString;
            executableHash: z.ZodString;
        }, z.core.$strict>;
    }, z.core.$strict>;
    schemaVersion: z.ZodLiteral<1>;
    id: z.ZodUUID;
    jobId: z.ZodUUID;
    version: z.ZodNumber;
    at: z.ZodISODateTime;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"cancel-requested">;
    code: z.ZodString;
    schemaVersion: z.ZodLiteral<1>;
    id: z.ZodUUID;
    jobId: z.ZodUUID;
    version: z.ZodNumber;
    at: z.ZodISODateTime;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"terminal">;
    receipt: z.ZodObject<{
        id: z.ZodUUID;
        hash: z.ZodString;
    }, z.core.$strict>;
    schemaVersion: z.ZodLiteral<1>;
    id: z.ZodUUID;
    jobId: z.ZodUUID;
    version: z.ZodNumber;
    at: z.ZodISODateTime;
}, z.core.$strict>], "type">;
export type ExecutorEvent = z.infer<typeof ExecutorEventSchema>;
export interface StoredExecutorJob {
    readonly id: string;
    readonly spec: ExecutorJobSpec;
    readonly hash: string;
    readonly state: ExecutorState;
    readonly version: number;
    readonly nonceHash: string | null;
    readonly process: ExecutorProcess | null;
    readonly cancelRequested: boolean;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly receipt: ExecutorReceipt | null;
}
export declare const executorHash: (value: unknown) => string;
