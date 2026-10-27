import type { DatabaseSync } from 'node:sqlite';
import type { Context } from '@deepseek-ai/cordis';
import { z } from 'zod';
import type { TaskExpressionProvider, Conversation, PersonaSourceRef } from '#dafeiyu/contracts';
import type { MemoryStore } from './store.js';
import { TaskWorkspace } from './task-workspace.js';
declare const packetSchema: z.ZodObject<{
    taskEpoch: z.ZodNumber;
    question: z.ZodObject<{
        inboundId: z.ZodUUID;
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
        route: z.ZodString;
        text: z.ZodString;
        ref: z.ZodString;
        hash: z.ZodString;
        fence: z.ZodString;
    }, z.core.$strict>;
    policy: z.ZodNullable<z.ZodObject<{
        id: z.ZodString;
        version: z.ZodNumber;
    }, z.core.$strict>>;
    evidence: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        text: z.ZodString;
        proof: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"memory">;
            route: z.ZodString;
            id: z.ZodUUID;
            revision: z.ZodNumber;
            version: z.ZodNumber;
            contentHash: z.ZodString;
            ancestors: z.ZodArray<z.ZodObject<{
                id: z.ZodUUID;
                revision: z.ZodNumber;
                version: z.ZodNumber;
                contentHash: z.ZodString;
            }, z.core.$strict>>;
            fences: z.ZodArray<z.ZodObject<{
                ref: z.ZodString;
                contentHash: z.ZodString;
                fence: z.ZodString;
            }, z.core.$strict>>;
            authorization: z.ZodOptional<z.ZodObject<{
                taskId: z.ZodUUID;
                taskEpoch: z.ZodNumber;
                grantId: z.ZodUUID;
                grantVersion: z.ZodNumber;
                policyId: z.ZodString;
                policyVersion: z.ZodNumber;
            }, z.core.$strict>>;
            range: z.ZodOptional<z.ZodObject<{
                start: z.ZodNumber;
                end: z.ZodNumber;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"observation">;
            route: z.ZodString;
            id: z.ZodUUID;
            contentHash: z.ZodString;
        }, z.core.$strict>], "kind">;
    }, z.core.$strict>>;
    conclusions: z.ZodArray<z.ZodObject<{
        slot: z.ZodString;
        version: z.ZodNumber;
        jobId: z.ZodString;
        text: z.ZodString;
        proofs: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"memory">;
            route: z.ZodString;
            id: z.ZodUUID;
            revision: z.ZodNumber;
            version: z.ZodNumber;
            contentHash: z.ZodString;
            ancestors: z.ZodArray<z.ZodObject<{
                id: z.ZodUUID;
                revision: z.ZodNumber;
                version: z.ZodNumber;
                contentHash: z.ZodString;
            }, z.core.$strict>>;
            fences: z.ZodArray<z.ZodObject<{
                ref: z.ZodString;
                contentHash: z.ZodString;
                fence: z.ZodString;
            }, z.core.$strict>>;
            authorization: z.ZodOptional<z.ZodObject<{
                taskId: z.ZodUUID;
                taskEpoch: z.ZodNumber;
                grantId: z.ZodUUID;
                grantVersion: z.ZodNumber;
                policyId: z.ZodString;
                policyVersion: z.ZodNumber;
            }, z.core.$strict>>;
            range: z.ZodOptional<z.ZodObject<{
                start: z.ZodNumber;
                end: z.ZodNumber;
            }, z.core.$strict>>;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"observation">;
            route: z.ZodString;
            id: z.ZodUUID;
            contentHash: z.ZodString;
        }, z.core.$strict>], "kind">>;
    }, z.core.$strict>>;
    expiresAt: z.ZodString;
}, z.core.$strict>;
type Packet = z.infer<typeof packetSchema>;
export declare function migrateExpression(db: DatabaseSync): void;
export declare class TaskExpression {
    private readonly db;
    private readonly transaction;
    private readonly store;
    private readonly tasks;
    private readonly ctx;
    private readonly stop;
    private readonly pending;
    constructor(db: DatabaseSync, transaction: <T>(work: () => T) => T, store: MemoryStore, tasks: TaskWorkspace, ctx: Context);
    private audit;
    private request;
    policy(agentId: string, input: Parameters<TaskExpressionProvider['policy']>[1]): {
        id: string;
        version: number;
    };
    private expressionPolicy;
    private allowed;
    nativeMemoryMaterial(agentId: string, ref: PersonaSourceRef, target: Conversation, policy: Packet['policy']): string | null;
    private question;
    prepare(agentId: string, taskId: string, input: Parameters<TaskExpressionProvider['prepare']>[2]): {
        packetId: `${string}-${string}-${string}-${string}-${string}`;
        version: number;
        target: {
            channel: string;
            account: string;
            kind: "private" | "group" | "local";
            id: string;
        };
        decisions: {
            kind: string;
            id: string;
            allowed: boolean;
        }[];
        usage: string;
        sendAuthorized: boolean;
    };
    private packet;
    open(agentId: string, taskId: string, input: Parameters<TaskExpressionProvider['open']>[2]): {
        packetId: string;
        target: {
            channel: string;
            account: string;
            kind: "private" | "group" | "local";
            id: string;
        };
        usage: string;
        sendAuthorized: boolean;
        question: string;
        evidence: {
            id: string;
            text: string;
        }[];
        conclusions: {
            slot: string;
            text: string;
        }[];
    };
    withdraw(agentId: string, taskId: string, input: Parameters<TaskExpressionProvider['withdraw']>[2]): {
        packetId: string;
        version: number;
    };
    generate(agentId: string, taskId: string, input: Parameters<TaskExpressionProvider['generate']>[2], signal: AbortSignal, outerGuard: () => void): Promise<{
        jobId: string;
        packetId: string;
        target: {
            channel: string;
            account: string;
            kind: "private" | "group" | "local";
            id: string;
        };
        answer: string;
        citations: string[];
        insufficient: boolean;
        usage: string;
        sendAuthorized: boolean;
    }>;
    close(): Promise<void>;
    private execute;
    result(agentId: string, taskId: string, input: Parameters<TaskExpressionProvider['result']>[2]): {
        jobId: string;
        packetId: string;
        target: {
            channel: string;
            account: string;
            kind: "private" | "group" | "local";
            id: string;
        };
        answer: string;
        citations: string[];
        insufficient: boolean;
        usage: string;
        sendAuthorized: boolean;
    };
    deliveryMaterial(agentId: string, taskId: string, jobId: string, target: Conversation): {
        jobId: string;
        packetId: string;
        inboundId: string;
        target: {
            channel: string;
            account: string;
            kind: "private" | "group" | "local";
            id: string;
        };
        question: string;
        draft: string;
        evidence: {
            id: string;
            text: string;
        }[];
        sourceStamp: string;
        selectionVersion: number;
        expiresAt: string;
    };
    verifyDelivery(agentId: string, taskId: string, jobId: string, target: Conversation, answer: string, signal: AbortSignal, guard: () => void): Promise<void>;
    recover(agentId: string): void;
}
export {};
