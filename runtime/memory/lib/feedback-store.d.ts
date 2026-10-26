import { z } from 'zod';
import type { OperationScope, TimelineScope } from '#dafeiyu/contracts';
import type { NewEvent } from '#dafeiyu/journal';
export declare const digestText: (text: string) => string;
export declare const dependencySchema: z.ZodObject<{
    evidence: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"capability">;
        ref: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"execution">;
        ref: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"observation">;
        ref: z.ZodString;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"timeline">;
        ref: z.ZodString;
        contentHash: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"memory">;
        id: z.ZodUUID;
        revision: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>], "kind">;
    version: z.ZodNullable<z.ZodNumber>;
    ancestors: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodUUID;
        revision: z.ZodNumber;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>>>;
    sourceFences: z.ZodOptional<z.ZodArray<z.ZodObject<{
        ref: z.ZodString;
        contentHash: z.ZodString;
        fence: z.ZodString;
    }, z.core.$strict>>>;
}, z.core.$strict>;
export type FeedbackDependency = z.infer<typeof dependencySchema>;
export declare const archiveSchema: z.ZodObject<{
    id: z.ZodUUID;
    body: z.ZodString;
    hash: z.ZodString;
    report: z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        completeness: z.ZodEnum<{
            unknown: "unknown";
            complete: "complete";
            partial: "partial";
        }>;
        summary: z.ZodString;
        effects: z.ZodEnum<{
            unknown: "unknown";
            partial: "partial";
            none: "none";
            applied: "applied";
        }>;
        receipts: z.ZodArray<z.ZodString>;
        sourceRefs: z.ZodArray<z.ZodString>;
        outcome: z.ZodEnum<{
            unknown: "unknown";
            partial: "partial";
            failed: "failed";
            succeeded: "succeeded";
            running: "running";
        }>;
        resourceVersion: z.ZodString;
        diagnostics: z.ZodArray<z.ZodObject<{
            code: z.ZodString;
            message: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    preview: z.ZodObject<{
        text: z.ZodString;
        totalChars: z.ZodNumber;
    }, z.core.$strict>;
    origin: z.ZodEnum<{
        returned: "returned";
        exception: "exception";
        "invalid-result": "invalid-result";
    }>;
    redacted: z.ZodBoolean;
    createdAt: z.ZodISODateTime;
    pluginId: z.ZodString;
    pluginVersion: z.ZodString;
    action: z.ZodString;
    operationId: z.ZodString;
    startedEventId: z.ZodString;
    traceId: z.ZodString;
    dependencies: z.ZodArray<z.ZodObject<{
        evidence: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"capability">;
            ref: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"execution">;
            ref: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"observation">;
            ref: z.ZodString;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"timeline">;
            ref: z.ZodString;
            contentHash: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"memory">;
            id: z.ZodUUID;
            revision: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>], "kind">;
        version: z.ZodNullable<z.ZodNumber>;
        ancestors: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodUUID;
            revision: z.ZodNumber;
            version: z.ZodNumber;
            contentHash: z.ZodString;
        }, z.core.$strict>>>;
        sourceFences: z.ZodOptional<z.ZodArray<z.ZodObject<{
            ref: z.ZodString;
            contentHash: z.ZodString;
            fence: z.ZodString;
        }, z.core.$strict>>>;
    }, z.core.$strict>>;
    rejectedSources: z.ZodBoolean;
}, z.core.$strict>;
export type FeedbackArchive = z.infer<typeof archiveSchema>;
export interface FeedbackRecord {
    archive: FeedbackArchive;
    version: number;
    deleted: boolean;
}
export interface FeedbackHeaderRecord {
    archive: Omit<FeedbackArchive, 'body'>;
    version: number;
    deleted: boolean;
}
/** Immutable sanitized originals; mutable logical state and transactional audit receipts. */
export declare class FeedbackStore {
    private readonly db;
    private readonly headers;
    constructor(file: string);
    private transaction;
    get(scope: TimelineScope, id: string): FeedbackRecord | null;
    /** Immutable header cache is bounded; ownership and mutable logical state are always read anew. */
    header(scope: TimelineScope, id: string): FeedbackHeaderRecord | null;
    list(scope: TimelineScope): Generator<FeedbackHeaderRecord>;
    /** New archives do not invalidate old summaries; state changes do, including restore. */
    mutationEpoch(scope: TimelineScope): number;
    private event;
    put(scope: OperationScope, value: Omit<FeedbackArchive, 'id' | 'createdAt'>): FeedbackRecord;
    change(scope: OperationScope, input: {
        id: string;
        expectedVersion: number;
        requestId: string;
        reason: string;
    }, deleted: boolean): {
        duplicate: boolean;
        id: string;
        version: number;
        eventId: string;
    };
    flush(publish: (event: NewEvent, id: string) => void): number;
    close(): void;
}
