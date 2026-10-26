import { z } from 'zod';
import type { Conversation } from './conversation.js';
import type { DeliveryMaterial } from './delivery.js';
export declare const ExpressionPolicySchema: z.ZodObject<{
    requestId: z.ZodString;
    id: z.ZodString;
    expectedVersion: z.ZodNumber;
    enabled: z.ZodBoolean;
    target: z.ZodObject<{
        channel: z.ZodString;
        account: z.ZodString;
        kind: z.ZodEnum<{
            private: "private";
            group: "group";
            local: "local";
        }>;
        id: z.ZodString;
    }, z.core.$strict>;
    sources: z.ZodArray<z.ZodObject<{
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
        id: z.ZodUUID;
        revision: z.ZodNumber;
        version: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>>;
    reason: z.ZodString;
}, z.core.$strict>;
export declare const ExpressionPrepareSchema: z.ZodObject<{
    requestId: z.ZodString;
    inboundId: z.ZodUUID;
    linkIds: z.ZodArray<z.ZodUUID>;
    slots: z.ZodDefault<z.ZodArray<z.ZodString>>;
    policy: z.ZodOptional<z.ZodObject<{
        id: z.ZodString;
        version: z.ZodNumber;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const ExpressionOpenSchema: z.ZodObject<{
    packetId: z.ZodUUID;
    target: z.ZodObject<{
        channel: z.ZodString;
        account: z.ZodString;
        kind: z.ZodEnum<{
            private: "private";
            group: "group";
            local: "local";
        }>;
        id: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const ExpressionGenerateSchema: z.ZodObject<{
    requestId: z.ZodString;
    packetId: z.ZodUUID;
    target: z.ZodObject<{
        channel: z.ZodString;
        account: z.ZodString;
        kind: z.ZodEnum<{
            private: "private";
            group: "group";
            local: "local";
        }>;
        id: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const ExpressionResultSchema: z.ZodObject<{
    jobId: z.ZodUUID;
    target: z.ZodObject<{
        channel: z.ZodString;
        account: z.ZodString;
        kind: z.ZodEnum<{
            private: "private";
            group: "group";
            local: "local";
        }>;
        id: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const ExpressionWithdrawSchema: z.ZodObject<{
    requestId: z.ZodString;
    packetId: z.ZodUUID;
    expectedVersion: z.ZodNumber;
}, z.core.$strict>;
/** Target-bound materials, not send authorization. Only the native coordinator owns this API. */
export interface TaskExpressionControl {
    prepare(input: unknown): Record<string, unknown>;
    open(input: unknown): Record<string, unknown>;
    generate(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
    result(input: unknown): Record<string, unknown>;
    withdraw(input: unknown): Record<string, unknown>;
}
export interface TaskExpressionProvider {
    deliveryMaterial(agentId: string, taskId: string, jobId: string, target: Conversation): DeliveryMaterial;
    verifyDelivery(agentId: string, taskId: string, jobId: string, target: Conversation, answer: string, signal: AbortSignal, guard: () => void): Promise<void>;
    policy(agentId: string, input: z.output<typeof ExpressionPolicySchema>): Record<string, unknown>;
    prepare(agentId: string, taskId: string, input: z.output<typeof ExpressionPrepareSchema>): Record<string, unknown>;
    open(agentId: string, taskId: string, input: z.output<typeof ExpressionOpenSchema>): Record<string, unknown>;
    generate(agentId: string, taskId: string, input: z.output<typeof ExpressionGenerateSchema>, signal: AbortSignal, guard: () => void): Promise<Record<string, unknown>>;
    result(agentId: string, taskId: string, input: z.output<typeof ExpressionResultSchema>): Record<string, unknown>;
    withdraw(agentId: string, taskId: string, input: z.output<typeof ExpressionWithdrawSchema>): Record<string, unknown>;
}
