import { z } from 'zod';
import type { Conversation, SourceRef } from '#dafeiyu/contracts';
import type { Journal } from '#dafeiyu/journal';
export declare const deliveryDigest: (v: unknown) => string;
declare const stateSchema: z.ZodEnum<{
    interrupted: "interrupted";
    rejected: "rejected";
    rendering: "rendering";
    ready: "ready";
    sending: "sending";
    sent: "sent";
    "not-sent": "not-sent";
    uncertain: "uncertain";
}>;
export type TaskDeliveryState = z.infer<typeof stateSchema>;
export declare const deliveryBindingSchema: z.ZodObject<{
    material: z.ZodObject<{
        jobId: z.ZodUUID;
        packetId: z.ZodUUID;
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
        question: z.ZodString;
        draft: z.ZodString;
        evidence: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            text: z.ZodString;
        }, z.core.$strict>>;
        sourceStamp: z.ZodString;
        selectionVersion: z.ZodNumber;
        expiresAt: z.ZodString;
    }, z.core.$strict>;
    route: z.ZodString;
    sessionId: z.ZodString;
    extensionId: z.ZodString;
    extensionVersion: z.ZodString;
    personaVersion: z.ZodString;
    modelHash: z.ZodString;
}, z.core.$strict>;
export type DeliveryBinding = z.infer<typeof deliveryBindingSchema>;
export declare class DeliveryStore {
    private readonly agentId;
    private readonly journal;
    private readonly db;
    constructor(file: string, agentId: string, journal: Journal, deferRecovery?: boolean);
    recover(): void;
    private transaction;
    private event;
    find(taskId: string, input: {
        requestId: string;
        jobId: string;
        target: Conversation;
    }): {
        id: string;
        taskId: string;
        state: "interrupted" | "rejected" | "rendering" | "ready" | "sending" | "sent" | "not-sent" | "uncertain";
        binding: {
            material: {
                jobId: string;
                packetId: string;
                inboundId: string;
                target: {
                    channel: string;
                    account: string;
                    kind: "group" | "private" | "local";
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
            route: string;
            sessionId: string;
            extensionId: string;
            extensionVersion: string;
            personaVersion: string;
            modelHash: string;
        };
        reply: string | null;
        credential: unknown;
        receipt: string | null;
    } | null;
    create(taskId: string, input: {
        requestId: string;
        jobId: string;
        target: Conversation;
    }, binding: DeliveryBinding): {
        id: string;
        taskId: string;
        state: "interrupted" | "rejected" | "rendering" | "ready" | "sending" | "sent" | "not-sent" | "uncertain";
        binding: {
            material: {
                jobId: string;
                packetId: string;
                inboundId: string;
                target: {
                    channel: string;
                    account: string;
                    kind: "group" | "private" | "local";
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
            route: string;
            sessionId: string;
            extensionId: string;
            extensionVersion: string;
            personaVersion: string;
            modelHash: string;
        };
        reply: string | null;
        credential: unknown;
        receipt: string | null;
    };
    get(id: string): {
        id: string;
        taskId: string;
        state: "interrupted" | "rejected" | "rendering" | "ready" | "sending" | "sent" | "not-sent" | "uncertain";
        binding: {
            material: {
                jobId: string;
                packetId: string;
                inboundId: string;
                target: {
                    channel: string;
                    account: string;
                    kind: "group" | "private" | "local";
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
            route: string;
            sessionId: string;
            extensionId: string;
            extensionVersion: string;
            personaVersion: string;
            modelHash: string;
        };
        reply: string | null;
        credential: unknown;
        receipt: string | null;
    };
    status(taskId: string, id: string): {
        deliveryId: string;
        jobId: string;
        status: "interrupted" | "rejected" | "rendering" | "ready" | "sending" | "sent" | "not-sent" | "uncertain";
        receiptId: string | null;
        simulationOnly: boolean;
    };
    private transitionInside;
    transition(id: string, from: TaskDeliveryState, to: TaskDeliveryState, receipt?: string): void;
    ready(id: string, reply: string, sources: readonly SourceRef[]): void;
    verifyCredential(id: string): string;
    flush(): void;
    close(): void;
}
export {};
