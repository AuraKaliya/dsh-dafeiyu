import { z } from 'zod';
import type { TimelineScope } from './history.js';
export declare const MemoryBoundarySchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    policyVersion: z.ZodLiteral<1>;
    owner: z.ZodObject<{
        kind: z.ZodLiteral<"agent">;
        agentId: z.ZodString;
    }, z.core.$strict>;
    sourceScene: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"conversation">;
        route: z.ZodString;
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
        ingressPluginId: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"legacy-route">;
        route: z.ZodString;
    }, z.core.$strict>], "kind">;
    task: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"unassigned">;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"conversation-task">;
        route: z.ZodString;
        id: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"agent-task">;
        id: z.ZodUUID;
    }, z.core.$strict>], "kind">;
    internalUse: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"conversation">;
        route: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"none">;
    }, z.core.$strict>], "kind">;
    externalExpression: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"conversation">;
        route: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"none">;
    }, z.core.$strict>], "kind">;
    assignment: z.ZodEnum<{
        "legacy-migration": "legacy-migration";
        "conservative-create": "conservative-create";
    }>;
}, z.core.$strict>, z.ZodObject<{
    schemaVersion: z.ZodLiteral<2>;
    policyVersion: z.ZodLiteral<1>;
    owner: z.ZodObject<{
        kind: z.ZodLiteral<"agent">;
        agentId: z.ZodString;
    }, z.core.$strict>;
    sourceScene: z.ZodObject<{
        kind: z.ZodLiteral<"execution-task">;
        route: z.ZodString;
        taskId: z.ZodUUID;
    }, z.core.$strict>;
    task: z.ZodObject<{
        kind: z.ZodLiteral<"agent-task">;
        id: z.ZodUUID;
    }, z.core.$strict>;
    internalUse: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"task">;
        route: z.ZodString;
        taskId: z.ZodUUID;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"none">;
    }, z.core.$strict>], "kind">;
    externalExpression: z.ZodObject<{
        kind: z.ZodLiteral<"none">;
    }, z.core.$strict>;
    assignment: z.ZodLiteral<"execution-create">;
}, z.core.$strict>], "schemaVersion">;
export type MemoryBoundary = z.infer<typeof MemoryBoundarySchema>;
export type MemoryAccessPurpose = 'internal' | 'expression';
export declare const MemoryBoundaryPolicySchema: z.ZodObject<{
    internalUse: z.ZodOptional<z.ZodEnum<{
        conversation: "conversation";
        none: "none";
    }>>;
    externalExpression: z.ZodOptional<z.ZodEnum<{
        conversation: "conversation";
        none: "none";
    }>>;
}, z.core.$strict>;
export type MemoryBoundaryPolicy = z.infer<typeof MemoryBoundaryPolicySchema>;
/** Trusted call-site metadata, never accepted from model tool arguments. */
export declare const MemoryWriteBindingSchema: z.ZodObject<{
    conversation: z.ZodOptional<z.ZodObject<{
        channel: z.ZodString;
        account: z.ZodString;
        kind: z.ZodEnum<{
            private: "private";
            group: "group";
            local: "local";
        }>;
        id: z.ZodString;
    }, z.core.$strict>>;
    ingressPluginId: z.ZodOptional<z.ZodString>;
    taskId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    agentTaskId: z.ZodOptional<z.ZodUUID>;
    executionScope: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"conversation">;
        agentId: z.ZodString;
        route: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"task">;
        agentId: z.ZodString;
        taskId: z.ZodUUID;
        scopeKey: z.ZodString;
    }, z.core.$strict>], "kind">>;
}, z.core.$strict>;
export type MemoryWriteBinding = z.infer<typeof MemoryWriteBindingSchema>;
export declare function boundaryAllows(boundary: MemoryBoundary, scope: TimelineScope, purpose: MemoryAccessPurpose): boolean;
