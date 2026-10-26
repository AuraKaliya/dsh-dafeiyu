import { z } from 'zod';
export declare const BILI_OWNER_EXTENSION = "channel-bili-owner";
export declare const BILI_OWNER_VERSION = "0.1.0";
export declare const BILI_PUBLIC_SCENE: Readonly<{
    channel: "bilibili";
    account: "public";
    kind: "local";
    id: "public";
}>;
export declare const BiliOwnerHashSchema: z.ZodString;
export declare const BiliOwnerCodeSchema: z.ZodString;
export declare const BiliOwnerIdSchema: z.ZodString;
export declare const BiliOwnerRequestSchema: z.ZodString;
export declare const BiliOwnerIdentitySchema: z.ZodObject<{
    agentId: z.ZodString;
    profileId: z.ZodString;
    accountUid: z.ZodString;
    ownerUid: z.ZodString;
}, z.core.$strict>;
export type BiliOwnerIdentity = z.infer<typeof BiliOwnerIdentitySchema>;
export declare const BiliOwnerBindingSchema: z.ZodObject<{
    accountUid: z.ZodString;
    ownerUid: z.ZodString;
    loggedIn: z.ZodLiteral<true>;
    bindingStamp: z.ZodString;
}, z.core.$strict>;
export declare const BiliOwnerMessageSchema: z.ZodObject<{
    id: z.ZodString;
    seqno: z.ZodString;
    senderUid: z.ZodString;
    receiverUid: z.ZodString;
    type: z.ZodNumber;
    timestamp: z.ZodNumber;
    text: z.ZodString;
}, z.core.$strict>;
export type BiliOwnerMessage = z.infer<typeof BiliOwnerMessageSchema>;
export declare const BiliOwnerPageSchema: z.ZodObject<{
    accountUid: z.ZodString;
    ownerUid: z.ZodString;
    loggedIn: z.ZodLiteral<true>;
    bindingStamp: z.ZodString;
    messages: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        seqno: z.ZodString;
        senderUid: z.ZodString;
        receiverUid: z.ZodString;
        type: z.ZodNumber;
        timestamp: z.ZodNumber;
        text: z.ZodString;
    }, z.core.$strict>>;
    hasMore: z.ZodBoolean;
    nextBeforeSeqno: z.ZodNullable<z.ZodString>;
}, z.core.$strict>;
export type BiliOwnerPage = z.infer<typeof BiliOwnerPageSchema>;
export declare const BiliOwnerSendResultSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    status: z.ZodLiteral<"sent">;
    receiptId: z.ZodString;
    accountUid: z.ZodString;
    ownerUid: z.ZodString;
    requestId: z.ZodString;
    wireHash: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    status: z.ZodLiteral<"not-dispatched">;
    code: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    status: z.ZodLiteral<"unknown">;
    code: z.ZodString;
}, z.core.$strict>], "status">;
export type BiliOwnerSendResult = z.infer<typeof BiliOwnerSendResultSchema>;
/** Program port only. No production factory is supplied in this package substep. */
export interface BiliOwnerTransport {
    readonly identityHash: string;
    guard(): void;
    verify(signal: AbortSignal, guard: () => void): Promise<z.infer<typeof BiliOwnerBindingSchema>>;
    readOwnerPage(input: {
        beforeSeqno?: string;
        limit: number;
    }, signal: AbortSignal, guard: () => void): Promise<BiliOwnerPage>;
    sendOwnerText(input: {
        requestId: string;
        text: string;
        wireHash: string;
    }, signal: AbortSignal, guard: () => void): Promise<BiliOwnerSendResult>;
    close?(): void | Promise<void>;
}
/** Acquired by the trusted launcher across profiles; the epoch is persistent ownership, not a process nonce. */
export interface BiliOwnerConsumerLease {
    readonly key: string;
    readonly epoch: number;
    guard(): void;
    release(): void | Promise<void>;
}
export interface BiliOwnerPorts {
    readonly transport: BiliOwnerTransport;
    readonly lease: BiliOwnerConsumerLease;
    readonly now?: () => number;
}
export declare const BiliOwnerReplySchema: z.ZodObject<{
    id: z.ZodString;
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
    sourceMessageId: z.ZodString;
    text: z.ZodString;
    taskResult: z.ZodOptional<z.ZodObject<{
        kind: z.ZodLiteral<"task-result">;
        schemaVersion: z.ZodLiteral<1>;
        taskId: z.ZodUUID;
        runId: z.ZodUUID;
        inboundId: z.ZodUUID;
        target: z.ZodObject<{
            channel: z.ZodString;
            account: z.ZodString;
            kind: z.ZodEnum<{
                local: "local";
                private: "private";
                group: "group";
            }>;
            id: z.ZodString;
        }, z.core.$strict>;
        intentVersion: z.ZodNumber;
        authorityVersion: z.ZodString;
        expiresAt: z.ZodISODateTime;
        outcome: z.ZodOptional<z.ZodLiteral<"waiting">>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const BiliOwnerInboundStateSchema: z.ZodEnum<{
    "before-start": "before-start";
    pending: "pending";
    accepted: "accepted";
    unsupported: "unsupported";
    recalled: "recalled";
}>;
export declare const BiliOwnerDeliveryStateSchema: z.ZodEnum<{
    unknown: "unknown";
    sent: "sent";
    prepared: "prepared";
    blocked: "blocked";
    sending: "sending";
}>;
export declare const BiliOwnerDeliveryPlanSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    replyId: z.ZodString;
    requestId: z.ZodString;
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
    sourceMessageId: z.ZodString;
    sourceHash: z.ZodString;
    coreInboundId: z.ZodUUID;
    anchor: z.ZodNullable<z.ZodObject<{
        kind: z.ZodLiteral<"task-result">;
        schemaVersion: z.ZodLiteral<1>;
        taskId: z.ZodUUID;
        runId: z.ZodUUID;
        inboundId: z.ZodUUID;
        target: z.ZodObject<{
            channel: z.ZodString;
            account: z.ZodString;
            kind: z.ZodEnum<{
                local: "local";
                private: "private";
                group: "group";
            }>;
            id: z.ZodString;
        }, z.core.$strict>;
        intentVersion: z.ZodNumber;
        authorityVersion: z.ZodString;
        expiresAt: z.ZodISODateTime;
        outcome: z.ZodOptional<z.ZodLiteral<"waiting">>;
    }, z.core.$strict>>;
    bodyHash: z.ZodString;
    wireHash: z.ZodString;
    text: z.ZodString;
}, z.core.$strict>;
export type BiliOwnerDeliveryPlan = z.infer<typeof BiliOwnerDeliveryPlanSchema>;
export interface BiliOwnerDelivery {
    readonly plan: BiliOwnerDeliveryPlan;
    readonly hash: string;
    readonly version: number;
    readonly state: z.infer<typeof BiliOwnerDeliveryStateSchema>;
    readonly receiptId: string | null;
    readonly code: string | null;
}
export declare const biliOwnerHash: (value: unknown) => string;
export declare const biliOwnerTextHash: (value: string) => string;
export declare function biliOwnerCode(error: unknown, fallback?: string): string;
export type BiliOwnerAccount = Pick<BiliOwnerIdentity, 'accountUid' | 'ownerUid'>;
export declare function biliOwnerScene(identity: BiliOwnerAccount): Readonly<{
    channel: "bilibili";
    account: string;
    kind: "private";
    id: string;
}>;
export declare function biliOwnerConsumerKey(identity: BiliOwnerAccount): string;
