import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
export declare const BiliRetryPolicySchema: z.ZodObject<{
    rateDelaysMs: z.ZodDefault<z.ZodArray<z.ZodNumber>>;
    riskDelayMs: z.ZodDefault<z.ZodNumber>;
}, z.core.$strict>;
export type BiliRetryPolicy = z.infer<typeof BiliRetryPolicySchema>;
export type BiliFailureKind = 'rate-limit' | 'risk' | 'login' | 'permission' | 'verification' | 'network' | 'response' | 'cancelled' | 'local';
export declare const AttemptSchema: z.ZodObject<{
    id: z.ZodUUID;
    at: z.ZodNumber;
    sentAt: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
    endedAt: z.ZodNumber;
    endpoint: z.ZodEnum<{
        nav: "nav";
        discover: "discover";
        search: "search";
        video: "video";
        comments: "comments";
        replies: "replies";
        player: "player";
        play: "play";
        danmaku: "danmaku";
        media: "media";
        subtitle: "subtitle";
    }>;
    transport: z.ZodDefault<z.ZodEnum<{
        http: "http";
        "dsh-browser": "dsh-browser";
    }>>;
    auth: z.ZodEnum<{
        anonymous: "anonymous";
        "configured-session": "configured-session";
    }>;
    origin: z.ZodEnum<{
        task: "task";
        maintenance: "maintenance";
    }>;
    taskId: z.ZodNullable<z.ZodUUID>;
    runId: z.ZodNullable<z.ZodUUID>;
    operationId: z.ZodNullable<z.ZodUUID>;
    networkSent: z.ZodNullable<z.ZodBoolean>;
    httpStatus: z.ZodNullable<z.ZodNumber>;
    platformCode: z.ZodNullable<z.ZodNumber>;
    contentType: z.ZodNullable<z.ZodString>;
    retryAfter: z.ZodNullable<z.ZodString>;
    retryAt: z.ZodNullable<z.ZodNumber>;
    waitSource: z.ZodNullable<z.ZodEnum<{
        platform: "platform";
        "local-policy": "local-policy";
        "existing-state": "existing-state";
    }>>;
    outcome: z.ZodEnum<{
        success: "success";
        "headers-received": "headers-received";
        failed: "failed";
        blocked: "blocked";
    }>;
    errorCode: z.ZodNullable<z.ZodString>;
    kind: z.ZodNullable<z.ZodEnum<{
        "rate-limit": "rate-limit";
        risk: "risk";
        login: "login";
        permission: "permission";
        verification: "verification";
        network: "network";
        response: "response";
        cancelled: "cancelled";
        local: "local";
    }>>;
}, z.core.$strict>;
export type BiliAttempt = z.infer<typeof AttemptSchema>;
export declare function initializeBiliDiagnostics(db: DatabaseSync): void;
/** Retry-After is either integer seconds or an HTTP date; credentials/free text are never retained. */
export declare function parseRetryAfter(raw: string | undefined, now: number): {
    raw: string;
    at: number;
} | null;
export declare class BiliDiagnostics {
    private readonly db;
    constructor(db: DatabaseSync);
    private atomic;
    get state(): {
        failures: number;
        kind: string | null;
        endpoint: string | null;
        held: boolean;
        probeId: string | null;
        probeUntil: number;
    };
    /** A live condition cannot depend on a UI-sized recent-attempt window. */
    conditionAttempt(): BiliAttempt | null;
    private set;
    assertAvailable(): void;
    acquireProbe(id: string, now: number, timeout: number): void;
    release(id: string): void;
    success(id: string, endpoint: string): void;
    failure(endpoint: string, kind: BiliFailureKind, now: number, policy: BiliRetryPolicy, platformAt: number | null): {
        at: number;
        held: boolean;
        source: "platform" | "local-policy";
    };
    /** Trusted maintenance only, after resolving the diagnosed condition. Not a model tool. */
    resolveHold(): void;
    record(raw: BiliAttempt): void;
    recent(limit?: number): BiliAttempt[];
}
