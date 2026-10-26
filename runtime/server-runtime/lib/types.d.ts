import { z } from 'zod';
import type { ExecutorPermit, ExecutorRoute } from '#dafeiyu/server-executor/protocol';
export declare const RuntimeIdentitySchema: z.ZodString;
export declare const ModelCallOwnerSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"host">;
    profileId: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"executor">;
    jobId: z.ZodUUID;
}, z.core.$strict>], "kind">;
export type ModelCallOwner = z.infer<typeof ModelCallOwnerSchema>;
export declare const ModelBudgetRequestSchema: z.ZodObject<{
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
    authorizationId: z.ZodString;
    owner: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"host">;
        profileId: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"executor">;
        jobId: z.ZodUUID;
    }, z.core.$strict>], "kind">;
    deadline: z.ZodNumber;
}, z.core.$strict>;
export type ModelBudgetRequest = z.infer<typeof ModelBudgetRequestSchema>;
export declare const ModelBudgetSettlementSchema: z.ZodObject<{
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
    authorizationId: z.ZodString;
    owner: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"host">;
        profileId: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"executor">;
        jobId: z.ZodUUID;
    }, z.core.$strict>], "kind">;
}, z.core.$strict>;
export type ModelBudgetSettlement = z.infer<typeof ModelBudgetSettlementSchema>;
/** Borrowed program capability. Implementations own the existing durable money/clock authority. */
export interface ModelBudgetAuthority {
    readonly kind: 'acceptance' | 'operations' | 'offline-test';
    readonly authorizationId: string;
    readonly route: ExecutorRoute;
    /** Revalidate the original authorization and unresolved reservations, without starting a clock. */
    guard(): void;
    remainingMs(): number;
    /** Optional durable authority stop source, including an idle window's deadline. Never a second clock. */
    onStop?(listener: (code: string) => void): () => void;
    reserve(input: ModelBudgetRequest, signal: AbortSignal): Promise<ExecutorPermit>;
    /** Must accept accounting after execution cancellation or revocation. */
    settle(input: ModelBudgetSettlement): Promise<{
        unknown: boolean;
    }>;
}
export interface RuntimeCallRecord {
    readonly request: ModelBudgetRequest;
    readonly permit: ExecutorPermit;
    readonly state: 'reserved' | 'settled' | 'unknown';
    readonly settlement: ModelBudgetSettlement | null;
}
export declare function runtimeCode(error: unknown, fallback?: string): string;
