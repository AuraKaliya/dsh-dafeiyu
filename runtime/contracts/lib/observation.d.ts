import { z } from 'zod';
export declare const ReadProgressSchema: z.ZodObject<{
    state: z.ZodEnum<{
        failed: "failed";
        unread: "unread";
        observed: "observed";
        unavailable: "unavailable";
    }>;
    subject: z.ZodEnum<{
        reference: "reference";
        "provided-page": "provided-page";
        "source-range": "source-range";
    }>;
    completeness: z.ZodEnum<{
        unknown: "unknown";
        complete: "complete";
        partial: "partial";
    }>;
}, z.core.$strict>;
import type { Conversation } from './index.js';
export declare const MemoryObservationSchema: z.ZodObject<{
    requestId: z.ZodString;
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
    startedAt: z.ZodISODateTime;
    observedAt: z.ZodISODateTime;
    finishedAt: z.ZodISODateTime;
    outcome: z.ZodEnum<{
        failed: "failed";
        completed: "completed";
    }>;
    selection: z.ZodObject<{
        policyId: z.ZodString;
        policyVersion: z.ZodString;
        reasonCode: z.ZodString;
    }, z.core.$strict>;
    counts: z.ZodObject<{
        received: z.ZodNumber;
        processed: z.ZodNumber;
        modelExposed: z.ZodNumber;
    }, z.core.$strict>;
    sources: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        occurredAt: z.ZodISODateTime;
        expectedVersion: z.ZodOptional<z.ZodNumber>;
        archive: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"digest">;
            hash: z.ZodString;
        }, z.core.$strict>], "kind">;
        policy: z.ZodOptional<z.ZodObject<{
            internalUse: z.ZodOptional<z.ZodEnum<{
                conversation: "conversation";
                none: "none";
            }>>;
            externalExpression: z.ZodOptional<z.ZodEnum<{
                conversation: "conversation";
                none: "none";
            }>>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    exposedSources: z.ZodDefault<z.ZodArray<z.ZodString>>;
    contributions: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        form: z.ZodLiteral<"original">;
        source: z.ZodString;
        id: z.ZodString;
        exposure: z.ZodArray<z.ZodString>;
        policy: z.ZodOptional<z.ZodObject<{
            internalUse: z.ZodOptional<z.ZodEnum<{
                conversation: "conversation";
                none: "none";
            }>>;
            externalExpression: z.ZodOptional<z.ZodEnum<{
                conversation: "conversation";
                none: "none";
            }>>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        form: z.ZodLiteral<"fragment">;
        source: z.ZodString;
        start: z.ZodNumber;
        end: z.ZodNumber;
        text: z.ZodString;
        id: z.ZodString;
        exposure: z.ZodArray<z.ZodString>;
        policy: z.ZodOptional<z.ZodObject<{
            internalUse: z.ZodOptional<z.ZodEnum<{
                conversation: "conversation";
                none: "none";
            }>>;
            externalExpression: z.ZodOptional<z.ZodEnum<{
                conversation: "conversation";
                none: "none";
            }>>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        form: z.ZodLiteral<"summary">;
        text: z.ZodString;
        id: z.ZodString;
        exposure: z.ZodArray<z.ZodString>;
        policy: z.ZodOptional<z.ZodObject<{
            internalUse: z.ZodOptional<z.ZodEnum<{
                conversation: "conversation";
                none: "none";
            }>>;
            externalExpression: z.ZodOptional<z.ZodEnum<{
                conversation: "conversation";
                none: "none";
            }>>;
        }, z.core.$strict>>;
    }, z.core.$strict>], "form">>;
}, z.core.$strict>;
export type MemoryObservation = z.infer<typeof MemoryObservationSchema>;
export interface ObservationAuthority {
    agentId: string;
    route: string;
    pluginId: string;
    pluginVersion: string;
    ingressPluginId: string;
    conversation: Conversation;
    taskId: string | null;
    agentTaskId?: string;
    taskWorkId?: string;
    parent?: {
        traceId: string;
        operationId: string;
        eventId: string;
    };
}
export interface ObservationReceipt {
    activityId: string;
    sequence: number;
    eventId: string;
    duplicate: boolean;
    sources: {
        key: string;
        ref: string;
        version: number;
    }[];
    contributions: {
        id: string;
        form: 'original' | 'fragment' | 'summary';
        memoryId: string;
        revision: number;
        version: number;
    }[];
    auditPending: boolean;
}
export declare const ObservationStoredReceiptSchema: z.ZodObject<{
    activityId: z.ZodUUID;
    sequence: z.ZodNumber;
    eventId: z.ZodUUID;
    duplicate: z.ZodBoolean;
    sources: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        ref: z.ZodString;
        version: z.ZodNumber;
    }, z.core.$strict>>;
    contributions: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        form: z.ZodEnum<{
            original: "original";
            fragment: "fragment";
            summary: "summary";
        }>;
        memoryId: z.ZodUUID;
        revision: z.ZodNumber;
        version: z.ZodNumber;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const ObservationSourceReadSchema: z.ZodObject<{
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
    ref: z.ZodString;
    mode: z.ZodDefault<z.ZodEnum<{
        normal: "normal";
        deleted: "deleted";
    }>>;
    offset: z.ZodDefault<z.ZodNumber>;
    limit: z.ZodDefault<z.ZodNumber>;
}, z.core.$strict>;
export declare const ObservationSourceChangeSchema: z.ZodObject<{
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
    ref: z.ZodString;
    requestId: z.ZodString;
    expectedVersion: z.ZodNumber;
    action: z.ZodEnum<{
        delete: "delete";
        restore: "restore";
    }>;
}, z.core.$strict>;
export interface MemoryObservationProvider {
    submit(authority: ObservationAuthority, input: MemoryObservation): ObservationReceipt;
    open(authority: ObservationAuthority, input: z.output<typeof ObservationSourceReadSchema>): Record<string, unknown>;
    change(authority: ObservationAuthority, input: z.output<typeof ObservationSourceChangeSchema>): Record<string, unknown>;
}
