import { z } from 'zod';
import type { Conversation } from './index.js';
export declare const ContextStageSchema: z.ZodEnum<{
    conversation: "conversation";
    verification: "verification";
    feedback: "feedback";
    exploration: "exploration";
    assessment: "assessment";
    delivery: "delivery";
    recovery: "recovery";
}>;
export type ContextStage = z.infer<typeof ContextStageSchema>;
export declare const ContextHandoffSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    stage: z.ZodEnum<{
        conversation: "conversation";
        verification: "verification";
        feedback: "feedback";
        exploration: "exploration";
        assessment: "assessment";
        delivery: "delivery";
        recovery: "recovery";
    }>;
    task: z.ZodNullable<z.ZodObject<{
        taskId: z.ZodUUID;
        runId: z.ZodUUID;
        intentVersion: z.ZodNumber;
    }, z.core.$strict>>;
    goal: z.ZodString;
    originalRequest: z.ZodNullable<z.ZodObject<{
        conversation: z.ZodObject<{
            channel: z.ZodString;
            account: z.ZodString;
            kind: z.ZodEnum<{
                private: "private";
                group: "group";
                local: "local";
            }>;
            id: z.ZodString;
        }, z.core.$strict>;
        messageId: z.ZodString;
        occurredAt: z.ZodISODateTime;
        text: z.ZodString;
    }, z.core.$strict>>;
    latestRequest: z.ZodNullable<z.ZodObject<{
        conversation: z.ZodObject<{
            channel: z.ZodString;
            account: z.ZodString;
            kind: z.ZodEnum<{
                private: "private";
                group: "group";
                local: "local";
            }>;
            id: z.ZodString;
        }, z.core.$strict>;
        messageId: z.ZodString;
        occurredAt: z.ZodISODateTime;
        text: z.ZodString;
    }, z.core.$strict>>;
    facts: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
    note: z.ZodString;
}, z.core.$strict>;
export type ContextHandoff = z.infer<typeof ContextHandoffSchema>;
export declare const ContextAssemblySchema: z.ZodObject<{
    mode: z.ZodDefault<z.ZodEnum<{
        legacy: "legacy";
        unified: "unified";
    }>>;
    deadlineMs: z.ZodDefault<z.ZodNumber>;
    recall: z.ZodPrefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        strategy: z.ZodDefault<z.ZodEnum<{
            lexical: "lexical";
            hybrid: "hybrid";
        }>>;
        candidates: z.ZodDefault<z.ZodNumber>;
        limit: z.ZodDefault<z.ZodNumber>;
        maxBytes: z.ZodDefault<z.ZodNumber>;
        timeoutMs: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strict>>;
    background: z.ZodPrefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        windowMs: z.ZodDefault<z.ZodNumber>;
        limit: z.ZodDefault<z.ZodNumber>;
        maxBytes: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strict>>;
    recentState: z.ZodPrefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        shared: z.ZodDefault<z.ZodBoolean>;
        maxBytes: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type ContextAssembly = z.infer<typeof ContextAssemblySchema>;
export declare const ContextRegionPolicySchema: z.ZodObject<{
    maxBytes: z.ZodDefault<z.ZodNumber>;
    priority: z.ZodDefault<z.ZodNumber>;
    required: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strict>;
export declare const ContextBudgetSchema: z.ZodObject<{
    maxBytes: z.ZodDefault<z.ZodNumber>;
    requestMaxBytes: z.ZodDefault<z.ZodNumber>;
    outputReserveBytes: z.ZodDefault<z.ZodNumber>;
    prepareTimeoutMs: z.ZodDefault<z.ZodNumber>;
    regions: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
        maxBytes: z.ZodDefault<z.ZodNumber>;
        priority: z.ZodDefault<z.ZodNumber>;
        required: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strict>>>;
    assembly: z.ZodPrefault<z.ZodObject<{
        mode: z.ZodDefault<z.ZodEnum<{
            legacy: "legacy";
            unified: "unified";
        }>>;
        deadlineMs: z.ZodDefault<z.ZodNumber>;
        recall: z.ZodPrefault<z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
            strategy: z.ZodDefault<z.ZodEnum<{
                lexical: "lexical";
                hybrid: "hybrid";
            }>>;
            candidates: z.ZodDefault<z.ZodNumber>;
            limit: z.ZodDefault<z.ZodNumber>;
            maxBytes: z.ZodDefault<z.ZodNumber>;
            timeoutMs: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strict>>;
        background: z.ZodPrefault<z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
            windowMs: z.ZodDefault<z.ZodNumber>;
            limit: z.ZodDefault<z.ZodNumber>;
            maxBytes: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strict>>;
        recentState: z.ZodPrefault<z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
            shared: z.ZodDefault<z.ZodBoolean>;
            maxBytes: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type ContextBudget = z.infer<typeof ContextBudgetSchema>;
/** Opaque by identity at the core boundary; only issued during a context preparation cycle. */
export interface ContextRequest {
    readonly conversation: Conversation;
    readonly sourceMessageId: string;
    readonly signal: AbortSignal;
}
export declare const ContextItemSchema: z.ZodObject<{
    id: z.ZodString;
    version: z.ZodString;
    text: z.ZodString;
    sources: z.ZodArray<z.ZodObject<{
        ref: z.ZodString;
        version: z.ZodString;
        hash: z.ZodString;
    }, z.core.$strict>>;
    expiresAt: z.ZodISODateTime;
}, z.core.$strict>;
export type ContextItem = z.infer<typeof ContextItemSchema>;
export interface ContextContributor {
    readonly id: string;
    readonly kind: 'working-state' | 'evidence' | 'operational-fact';
    /** Return only selected atomic entries. Never return a whole analysis report or search hit list. */
    prepare(request: ContextRequest): Promise<readonly ContextItem[]>;
    /** Synchronous admission check; false retires the entry without affecting other contributors. */
    validate(request: ContextRequest, item: Readonly<ContextItem>): boolean;
    /** Optional persisted, source-checked historical fact view; never grants current-state authority. */
    validateHistorical?(request: ContextRequest, dependency: Extract<import('./compaction.js').SourceDependency, {
        kind: 'context';
    }>): boolean;
}
