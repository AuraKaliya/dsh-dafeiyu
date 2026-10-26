import { z } from 'zod';
export declare const EXECUTOR_IPC_VERSION = 1;
export declare const ExecutorRouteSchema: z.ZodObject<{
    provider: z.ZodString;
    model: z.ZodString;
    reasoningEffort: z.ZodNullable<z.ZodString>;
    contextWindow: z.ZodNumber;
    maxOutputTokens: z.ZodNumber;
    maxRequestBytes: z.ZodNumber;
}, z.core.$strict>;
export type ExecutorRoute = z.infer<typeof ExecutorRouteSchema>;
export declare const ExecutorCallSchema: z.ZodObject<{
    callId: z.ZodUUID;
    provider: z.ZodString;
    model: z.ZodString;
    reasoningEffort: z.ZodNullable<z.ZodString>;
    requestHash: z.ZodString;
    sessionHash: z.ZodString;
    inputBound: z.ZodNumber;
    outputBound: z.ZodNumber;
    requestBytes: z.ZodNumber;
    purpose: z.ZodEnum<{
        task: "task";
        compaction: "compaction";
        "session-title": "session-title";
    }>;
}, z.core.$strict>;
export type ExecutorCall = z.infer<typeof ExecutorCallSchema>;
export declare const ExecutorUsageSchema: z.ZodObject<{
    inputTokens: z.ZodNumber;
    outputTokens: z.ZodNumber;
    uncachedInputTokens: z.ZodNumber;
    cacheReadTokens: z.ZodNumber;
    cacheWriteTokens: z.ZodNumber;
    reasoningTokens: z.ZodNullable<z.ZodNumber>;
}, z.core.$strict>;
export type ExecutorUsage = z.infer<typeof ExecutorUsageSchema>;
export declare const ExecutorSettlementSchema: z.ZodObject<{
    callId: z.ZodUUID;
    reservationId: z.ZodUUID;
    usage: z.ZodNullable<z.ZodObject<{
        inputTokens: z.ZodNumber;
        outputTokens: z.ZodNumber;
        uncachedInputTokens: z.ZodNumber;
        cacheReadTokens: z.ZodNumber;
        cacheWriteTokens: z.ZodNumber;
        reasoningTokens: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strict>>;
    finish: z.ZodEnum<{
        error: "error";
        stop: "stop";
        "tool-calls": "tool-calls";
        "max-tokens": "max-tokens";
        aborted: "aborted";
        interrupted: "interrupted";
    }>;
    durationMs: z.ZodNumber;
    error: z.ZodNullable<z.ZodString>;
}, z.core.$strict>;
export type ExecutorSettlement = z.infer<typeof ExecutorSettlementSchema>;
export declare const ExecutorPermitSchema: z.ZodObject<{
    reservationId: z.ZodUUID;
    dispatchPermit: z.ZodUUID;
}, z.core.$strict>;
export type ExecutorPermit = z.infer<typeof ExecutorPermitSchema>;
export declare const ExecutorToolNameSchema: z.ZodString;
export declare const ExecutorToolCallSchema: z.ZodObject<{
    callId: z.ZodUUID;
    name: z.ZodString;
    sourceCallHash: z.ZodString;
    sessionHash: z.ZodString;
    argumentsHash: z.ZodString;
}, z.core.$strict>;
export type ExecutorToolCall = z.infer<typeof ExecutorToolCallSchema>;
export declare const ExecutorToolReceiptSchema: z.ZodObject<{
    callId: z.ZodUUID;
    permitId: z.ZodUUID;
    state: z.ZodEnum<{
        error: "error";
        completed: "completed";
        unknown: "unknown";
        aborted: "aborted";
    }>;
}, z.core.$strict>;
export type ExecutorToolReceipt = z.infer<typeof ExecutorToolReceiptSchema>;
export interface ExecutorToolRecord {
    readonly call: ExecutorToolCall;
    readonly permitId: string;
    state: 'admitted' | ExecutorToolReceipt['state'];
}
export declare const ChildMessageSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    version: z.ZodLiteral<1>;
    type: z.ZodLiteral<"online">;
    profileHash: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"ready">;
    profileHash: z.ZodString;
    version: z.ZodLiteral<1>;
    jobId: z.ZodUUID;
    nonce: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"reserve">;
    call: z.ZodObject<{
        callId: z.ZodUUID;
        provider: z.ZodString;
        model: z.ZodString;
        reasoningEffort: z.ZodNullable<z.ZodString>;
        requestHash: z.ZodString;
        sessionHash: z.ZodString;
        inputBound: z.ZodNumber;
        outputBound: z.ZodNumber;
        requestBytes: z.ZodNumber;
        purpose: z.ZodEnum<{
            task: "task";
            compaction: "compaction";
            "session-title": "session-title";
        }>;
    }, z.core.$strict>;
    version: z.ZodLiteral<1>;
    jobId: z.ZodUUID;
    nonce: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"settle">;
    settlement: z.ZodObject<{
        callId: z.ZodUUID;
        reservationId: z.ZodUUID;
        usage: z.ZodNullable<z.ZodObject<{
            inputTokens: z.ZodNumber;
            outputTokens: z.ZodNumber;
            uncachedInputTokens: z.ZodNumber;
            cacheReadTokens: z.ZodNumber;
            cacheWriteTokens: z.ZodNumber;
            reasoningTokens: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strict>>;
        finish: z.ZodEnum<{
            error: "error";
            stop: "stop";
            "tool-calls": "tool-calls";
            "max-tokens": "max-tokens";
            aborted: "aborted";
            interrupted: "interrupted";
        }>;
        durationMs: z.ZodNumber;
        error: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>;
    version: z.ZodLiteral<1>;
    jobId: z.ZodUUID;
    nonce: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"tool-admit">;
    tool: z.ZodObject<{
        callId: z.ZodUUID;
        name: z.ZodString;
        sourceCallHash: z.ZodString;
        sessionHash: z.ZodString;
        argumentsHash: z.ZodString;
    }, z.core.$strict>;
    version: z.ZodLiteral<1>;
    jobId: z.ZodUUID;
    nonce: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"tool-finish">;
    receipt: z.ZodObject<{
        callId: z.ZodUUID;
        permitId: z.ZodUUID;
        state: z.ZodEnum<{
            error: "error";
            completed: "completed";
            unknown: "unknown";
            aborted: "aborted";
        }>;
    }, z.core.$strict>;
    version: z.ZodLiteral<1>;
    jobId: z.ZodUUID;
    nonce: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"done">;
    callId: z.ZodUUID;
    version: z.ZodLiteral<1>;
    jobId: z.ZodUUID;
    nonce: z.ZodString;
}, z.core.$strict>], "type">;
export type ChildMessage = z.infer<typeof ChildMessageSchema>;
export declare const ParentMessageSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"bind">;
    profileHash: z.ZodString;
    deadline: z.ZodNumber;
    route: z.ZodObject<{
        provider: z.ZodString;
        model: z.ZodString;
        reasoningEffort: z.ZodNullable<z.ZodString>;
        contextWindow: z.ZodNumber;
        maxOutputTokens: z.ZodNumber;
        maxRequestBytes: z.ZodNumber;
    }, z.core.$strict>;
    version: z.ZodLiteral<1>;
    jobId: z.ZodUUID;
    nonce: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"active">;
    version: z.ZodLiteral<1>;
    jobId: z.ZodUUID;
    nonce: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"reserved">;
    callId: z.ZodUUID;
    permit: z.ZodObject<{
        reservationId: z.ZodUUID;
        dispatchPermit: z.ZodUUID;
    }, z.core.$strict>;
    version: z.ZodLiteral<1>;
    jobId: z.ZodUUID;
    nonce: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"settled">;
    callId: z.ZodUUID;
    unknown: z.ZodBoolean;
    version: z.ZodLiteral<1>;
    jobId: z.ZodUUID;
    nonce: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"tool-permitted">;
    callId: z.ZodUUID;
    permitId: z.ZodUUID;
    version: z.ZodLiteral<1>;
    jobId: z.ZodUUID;
    nonce: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"tool-recorded">;
    callId: z.ZodUUID;
    version: z.ZodLiteral<1>;
    jobId: z.ZodUUID;
    nonce: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"denied">;
    callId: z.ZodUUID;
    code: z.ZodString;
    version: z.ZodLiteral<1>;
    jobId: z.ZodUUID;
    nonce: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"finished">;
    callId: z.ZodUUID;
    version: z.ZodLiteral<1>;
    jobId: z.ZodUUID;
    nonce: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"cancel">;
    code: z.ZodString;
    version: z.ZodLiteral<1>;
    jobId: z.ZodUUID;
    nonce: z.ZodString;
}, z.core.$strict>], "type">;
export type ParentMessage = z.infer<typeof ParentMessageSchema>;
export interface ExecutorIpcEndpoint {
    send(value: unknown): Promise<void>;
    subscribe(message: (value: unknown) => void, disconnected: () => void): () => void;
    disconnect(): void;
}
export declare const executorError: (error: unknown, fallback?: string) => string;
/** TokenUsage input buckets are disjoint; reasoning is already included in output. */
export declare function normalizeExecutorUsage(raw: unknown): ExecutorUsage;
