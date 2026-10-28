import { z } from 'zod';
import type { Reply } from '#dafeiyu/contracts';
import type { BiliOwnerIdentity, BiliOwnerDelivery, BiliOwnerDeliveryPlan } from './types.js';
export declare const BILI_OWNER_SCHEMA_VERSION = 2;
export declare const BILI_OWNER_APPLICATION_ID = 1145455183;
export declare const BILI_OWNER_TABLES: readonly ["bili_owner_binding", "bili_owner_handover", "bili_owner_inbound", "bili_owner_deliveries", "bili_owner_poll", "bili_owner_events"];
declare const sourceSchema: z.ZodObject<{
    id: z.ZodString;
    state: z.ZodEnum<{
        pending: "pending";
        "before-start": "before-start";
        accepted: "accepted";
        unsupported: "unsupported";
        recalled: "recalled";
    }>;
    version: z.ZodNumber;
    coreInboundId: z.ZodNullable<z.ZodUUID>;
    message: z.ZodNullable<z.ZodObject<{
        id: z.ZodString;
        seqno: z.ZodString;
        senderUid: z.ZodString;
        receiverUid: z.ZodString;
        type: z.ZodNumber;
        timestamp: z.ZodNumber;
        text: z.ZodString;
    }, z.core.$strict>>;
    hash: z.ZodNullable<z.ZodString>;
    bindingStamp: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export type BiliOwnerInbound = z.infer<typeof sourceSchema>;
declare const cursorSchema: z.ZodObject<{
    since: z.ZodNullable<z.ZodNumber>;
    frontier: z.ZodNullable<z.ZodString>;
    before: z.ZodNullable<z.ZodString>;
    upper: z.ZodNullable<z.ZodString>;
    version: z.ZodNumber;
    nextAt: z.ZodNumber;
    error: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export type BiliOwnerCursor = z.infer<typeof cursorSchema>;
export declare function inspectBiliOwnerStorage(file: string, rawIdentity: BiliOwnerIdentity): {
    exists: boolean;
    supported: boolean;
    identityMatches: boolean;
    bindingReady: boolean;
    version: null;
    codes: string[];
} | {
    exists: boolean;
    supported: boolean;
    identityMatches: boolean;
    bindingReady: boolean;
    version: number;
    codes: string[];
};
/** Authoritative local facts only. Opening existing storage never initializes a cursor, dispatches work. */
export declare class BiliOwnerStore {
    private readonly db;
    private closed;
    readonly identity: BiliOwnerIdentity;
    constructor(file: string, rawIdentity: BiliOwnerIdentity, create?: boolean);
    private initialize;
    private open;
    private atomic;
    private event;
    private tail;
    cursor(): BiliOwnerCursor;
    bindingReady(): boolean;
    bindingFault(): string | null;
    verifiedBinding(): string | null;
    bindVerified(stamp: string, now?: number): boolean;
    rejectBinding(code: string, now?: number): void;
    private handover;
    initializeFresh(raw: unknown, now?: number): {
        duplicate: boolean;
        bindingReady: boolean;
    };
    private sourceBody;
    private insertSource;
    source(id: string): BiliOwnerInbound | null;
    private updateSource;
    private observe;
    acceptPage(raw: unknown, expectedVersion: number, maxPending?: number, now?: number): {
        complete: boolean;
        cursor: {
            since: number | null;
            frontier: string | null;
            before: string | null;
            upper: string | null;
            version: number;
            nextAt: number;
            error: string | null;
        };
    };
    pending(): BiliOwnerInbound[];
    accepted(id: string, coreInboundId: string, now?: number): {
        id: string;
        state: "pending" | "before-start" | "accepted" | "unsupported" | "recalled";
        version: number;
        coreInboundId: string | null;
        message: {
            id: string;
            seqno: string;
            senderUid: string;
            receiverUid: string;
            type: number;
            timestamp: number;
            text: string;
        } | null;
        hash: string | null;
        bindingStamp: string | null;
    };
    recall(id: string, now?: number): {
        id: string;
        state: "pending" | "before-start" | "accepted" | "unsupported" | "recalled";
        version: number;
        coreInboundId: string | null;
        message: {
            id: string;
            seqno: string;
            senderUid: string;
            receiverUid: string;
            type: number;
            timestamp: number;
            text: string;
        } | null;
        hash: string | null;
        bindingStamp: string | null;
    };
    recalled(): readonly string[];
    backoff(code: string, until: number): void;
    private deliveryBody;
    delivery(replyId: string): BiliOwnerDelivery | null;
    private logicalKey;
    prepareReply(raw: Reply, now?: number): BiliOwnerDelivery;
    private transition;
    begin(replyId: string, now?: number): {
        version: number;
        state: "unknown" | "blocked" | "sent" | "prepared" | "sending";
        receiptId: string | null;
        code: string | null;
        plan: BiliOwnerDeliveryPlan;
        hash: string;
    };
    confirm(replyId: string, receiptId: string, now?: number): {
        version: number;
        state: "unknown" | "blocked" | "sent" | "prepared" | "sending";
        receiptId: string | null;
        code: string | null;
        plan: BiliOwnerDeliveryPlan;
        hash: string;
    };
    unknown(replyId: string, code: string, now?: number): {
        version: number;
        state: "unknown" | "blocked" | "sent" | "prepared" | "sending";
        receiptId: string | null;
        code: string | null;
        plan: BiliOwnerDeliveryPlan;
        hash: string;
    };
    notDispatched(replyId: string, code: string, now?: number): {
        version: number;
        state: "unknown" | "blocked" | "sent" | "prepared" | "sending";
        receiptId: string | null;
        code: string | null;
        plan: BiliOwnerDeliveryPlan;
        hash: string;
    };
    recover(now?: number): {
        unknown: number;
    };
    counts(): {
        inbound: {
            [k: string]: number;
        };
        deliveries: {
            [k: string]: number;
        };
    };
    close(): void;
}
/** Explicit schema creation only. A fresh start boundary is a separate program step. */
export declare function initializeBiliOwnerStorage(dataDir: string, identity: BiliOwnerIdentity): {
    exists: boolean;
    supported: boolean;
    identityMatches: boolean;
    bindingReady: boolean;
    version: null;
    codes: string[];
} | {
    exists: boolean;
    supported: boolean;
    identityMatches: boolean;
    bindingReady: boolean;
    version: number;
    codes: string[];
};
export {};
