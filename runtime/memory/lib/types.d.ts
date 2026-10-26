import { z } from 'zod';
import type { MemoryBoundaryPolicy } from '#dafeiyu/contracts';
export declare const MEMORY_VERSION = "0.15.0";
export declare const kindSchema: z.ZodEnum<{
    preference: "preference";
    experience: "experience";
    knowledge: "knowledge";
    procedure: "procedure";
}>;
export declare const claimSchema: z.ZodEnum<{
    inference: "inference";
    reported_claim: "reported_claim";
    self_report: "self_report";
    observation: "observation";
}>;
export declare const versionSchema: z.ZodNumber;
export declare const sourceVersionSchema: z.ZodObject<{
    id: z.ZodUUID;
    revision: z.ZodNumber;
    version: z.ZodNumber;
    contentHash: z.ZodString;
}, z.core.$strict>;
export declare const sourceFenceSchema: z.ZodObject<{
    ref: z.ZodString;
    contentHash: z.ZodString;
    fence: z.ZodString;
}, z.core.$strict>;
export declare const keySchema: z.ZodString;
export declare const evidenceSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
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
export type Evidence = z.infer<typeof evidenceSchema>;
export declare const revisionSchema: z.ZodObject<{
    id: z.ZodUUID;
    revision: z.ZodNumber;
    kind: z.ZodEnum<{
        preference: "preference";
        experience: "experience";
        knowledge: "knowledge";
        procedure: "procedure";
    }>;
    claimType: z.ZodEnum<{
        inference: "inference";
        reported_claim: "reported_claim";
        self_report: "self_report";
        observation: "observation";
    }>;
    content: z.ZodString;
    contentHash: z.ZodString;
    sources: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
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
    }, z.core.$strict>], "kind">>;
    createdAt: z.ZodISODateTime;
    analysisStatus: z.ZodEnum<{
        not_analyzed: "not_analyzed";
        evidence_checked: "evidence_checked";
    }>;
    analysis: z.ZodOptional<z.ZodObject<{
        jobId: z.ZodUUID;
        candidateId: z.ZodUUID;
        policyVersion: z.ZodLiteral<"literal-evidence-v1">;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type Revision = z.infer<typeof revisionSchema>;
export declare const receiptSchema: z.ZodObject<{
    id: z.ZodUUID;
    version: z.ZodNumber;
    revision: z.ZodNumber;
    eventId: z.ZodUUID;
    generation: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
export type MutationReceipt = z.infer<typeof receiptSchema>;
export type ReadMode = 'normal' | 'history' | 'deleted';
export interface WriteContent {
    readonly kind: z.infer<typeof kindSchema>;
    readonly claimType: z.infer<typeof claimSchema>;
    readonly content: string;
    readonly sources: readonly Evidence[];
    readonly analysis?: {
        readonly jobId: string;
        readonly candidateId: string;
        readonly policyVersion: 'literal-evidence-v1';
    };
}
type Mutation = {
    readonly action: 'create';
    readonly requestId: string;
    readonly value: WriteContent;
} | {
    readonly action: 'revise';
    readonly requestId: string;
    readonly id: string;
    readonly expectedVersion: number;
    readonly value: WriteContent;
} | {
    readonly action: 'delete' | 'restore';
    readonly requestId: string;
    readonly id: string;
    readonly expectedVersion: number;
    readonly reason: string;
};
export type Command = Mutation & {
    readonly expectedGeneration?: number;
    readonly boundaryPolicy?: MemoryBoundaryPolicy;
};
export type MemoryErrorCode = 'not_found' | 'version_conflict' | 'idempotency_conflict' | 'deleted' | 'not_deleted' | 'source_unavailable' | 'stale_cursor' | 'invalid_cursor';
export declare class MemoryError extends Error {
    readonly code: MemoryErrorCode;
    constructor(code: MemoryErrorCode);
}
export declare const memoryRef: (id: string, revision: number) => string;
export declare const memoryRefPattern: RegExp;
export {};
