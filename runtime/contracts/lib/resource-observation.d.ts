import { z } from 'zod';
import type { Conversation } from './conversation.js';
import type { PersonaAccess, PersonaSourceRef } from './persona.js';
import type { TimelineScope } from './history.js';
import type { ExecutionScope } from './execution.js';
export declare const ResourceProofSchema: z.ZodObject<{
    provider: z.ZodString;
    scene: z.ZodObject<{
        channel: z.ZodString;
        account: z.ZodString;
        kind: z.ZodEnum<{
            private: "private";
            group: "group";
            local: "local";
        }>;
        id: z.ZodString;
    }, z.core.$strict>;
    key: z.ZodString;
    version: z.ZodNumber;
    hash: z.ZodString;
    roots: z.ZodArray<z.ZodString>;
    detail: z.ZodJSONSchema;
}, z.core.$strict>;
export type ResourceProof = z.infer<typeof ResourceProofSchema>;
export declare const ResourceTargetViewSchema: z.ZodObject<{
    kind: z.ZodEnum<{
        reported: "reported";
        inference: "inference";
    }>;
    stamp: z.ZodString;
}, z.core.$strict>;
export type ResourceTargetView = z.infer<typeof ResourceTargetViewSchema>;
/** Owned by the registered capability, used only to verify persisted source facts. */
export interface ResourceProofProvider {
    current(proof: ResourceProof): boolean;
    epoch(scope?: TimelineScope): string;
    /** Program-verified public bytes only; never a model-authored claim of publicness. */
    publicView?(proof: ResourceProof, view: string): boolean;
    /** Exact recipient and task permission, not a declaration that these bytes are public. */
    targetView?(proof: ResourceProof, view: string, target: Conversation, scope: ExecutionScope): ResourceTargetView | null;
}
export declare const CapabilityObservationSchema: z.ZodObject<{
    requestId: z.ZodString;
    proof: z.ZodObject<{
        provider: z.ZodString;
        scene: z.ZodObject<{
            channel: z.ZodString;
            account: z.ZodString;
            kind: z.ZodEnum<{
                private: "private";
                group: "group";
                local: "local";
            }>;
            id: z.ZodString;
        }, z.core.$strict>;
        key: z.ZodString;
        version: z.ZodNumber;
        hash: z.ZodString;
        roots: z.ZodArray<z.ZodString>;
        detail: z.ZodJSONSchema;
    }, z.core.$strict>;
    text: z.ZodString;
    occurredAt: z.ZodISODateTime;
    coverage: z.ZodArray<z.ZodString>;
    counts: z.ZodObject<{
        received: z.ZodNumber;
        processed: z.ZodNumber;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const CapabilitySelectionSchema: z.ZodObject<{
    requestId: z.ZodString;
    observationId: z.ZodUUID;
    version: z.ZodNumber;
    mode: z.ZodEnum<{
        none: "none";
        original: "original";
        fragment: "fragment";
        summary: "summary";
    }>;
    start: z.ZodOptional<z.ZodNumber>;
    end: z.ZodOptional<z.ZodNumber>;
    text: z.ZodOptional<z.ZodString>;
    reason: z.ZodString;
}, z.core.$strict>;
export interface CapabilityObservationAccess {
    readonly execution: PersonaAccess;
    readonly scene: Conversation;
    readonly guard: () => void;
    /** Program-only derived observations inherit the live execution history, never model-supplied citations. */
    readonly inheritExecutionHistory?: true;
}
export interface CapabilityObservationPort {
    ready(): boolean;
    record(access: CapabilityObservationAccess, input: z.output<typeof CapabilityObservationSchema>): {
        source: PersonaSourceRef;
        duplicate: boolean;
    };
    select(access: CapabilityObservationAccess, input: z.output<typeof CapabilitySelectionSchema>, actualView: string): Record<string, unknown>;
    valid(scope: TimelineScope, source: PersonaSourceRef, exposedHash?: string): boolean;
    mediaFence?(access: PersonaAccess, target: Conversation, roots: readonly string[]): {
        allowed: boolean;
        stamp: string;
    };
}
