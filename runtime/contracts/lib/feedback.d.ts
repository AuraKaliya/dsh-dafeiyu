import { z } from 'zod';
import type { ActionContext, Json } from './index.js';
import type { OperationScope } from './history.js';
/** Explicit tool-owned facts, not a heuristic interpretation of arbitrary output text. */
export declare const ToolFeedbackSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    outcome: z.ZodEnum<{
        unknown: "unknown";
        partial: "partial";
        failed: "failed";
        succeeded: "succeeded";
        running: "running";
    }>;
    effects: z.ZodEnum<{
        unknown: "unknown";
        partial: "partial";
        none: "none";
        applied: "applied";
    }>;
    completeness: z.ZodEnum<{
        unknown: "unknown";
        complete: "complete";
        partial: "partial";
    }>;
    resourceVersion: z.ZodString;
    summary: z.ZodString;
    diagnostics: z.ZodArray<z.ZodObject<{
        code: z.ZodString;
        message: z.ZodString;
    }, z.core.$strict>>;
    receipts: z.ZodArray<z.ZodString>;
    sourceRefs: z.ZodArray<z.ZodString>;
    data: z.ZodJSONSchema;
}, z.core.$strict>;
export type ToolFeedback = z.infer<typeof ToolFeedbackSchema>;
export declare const FeedbackWitnessSchema: z.ZodObject<{
    id: z.ZodUUID;
    version: z.ZodNumber;
    hash: z.ZodString;
    mode: z.ZodEnum<{
        deleted: "deleted";
        normal: "normal";
        history: "history";
    }>;
    view: z.ZodEnum<{
        page: "page";
        brief: "brief";
    }>;
    traceId: z.ZodString;
}, z.core.$strict>;
export type FeedbackWitness = z.infer<typeof FeedbackWitnessSchema>;
export interface FeedbackRequest {
    readonly context: ActionContext;
    readonly pluginId: string;
    readonly pluginVersion: string;
    readonly action: string;
    readonly origin: 'returned' | 'exception';
}
export interface FeedbackDelivery {
    readonly value: Json;
    readonly witness: FeedbackWitness | null;
}
export interface FeedbackProvider {
    capture(request: FeedbackRequest, raw: Json): Promise<FeedbackDelivery>;
    /** Only this provider's own read actions may issue historical/deleted view witnesses. */
    present(context: ActionContext, raw: Json): FeedbackDelivery;
    validate(scope: Pick<OperationScope, 'agentId' | 'route' | 'traceId'>, witness: FeedbackWitness): boolean;
}
export declare const FEEDBACK_RETIRED_TEXT: string;
export declare const FeedbackMetaSchema: z.ZodObject<{
    owner: z.ZodString;
    witness: z.ZodObject<{
        id: z.ZodUUID;
        version: z.ZodNumber;
        hash: z.ZodString;
        mode: z.ZodEnum<{
            deleted: "deleted";
            normal: "normal";
            history: "history";
        }>;
        view: z.ZodEnum<{
            page: "page";
            brief: "brief";
        }>;
        traceId: z.ZodString;
    }, z.core.$strict>;
    viewHash: z.ZodString;
}, z.core.$strict>;
export type FeedbackMeta = z.infer<typeof FeedbackMetaSchema>;
export declare class FeedbackCaptureError extends Error {
    readonly code: 'ARCHIVE_CAPACITY_EXCEEDED';
    constructor(code: 'ARCHIVE_CAPACITY_EXCEEDED');
}
