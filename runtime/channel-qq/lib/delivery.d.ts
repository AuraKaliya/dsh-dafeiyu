import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { Reply } from '#dafeiyu/contracts';
declare const segmentSchema: z.ZodObject<{
    position: z.ZodNumber;
    state: z.ZodEnum<{
        unknown: "unknown";
        sent: "sent";
        pending: "pending";
        sending: "sending";
    }>;
    receipt: z.ZodNullable<z.ZodString>;
    code: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
declare const planSchema: z.ZodObject<{
    version: z.ZodLiteral<1>;
    replyId: z.ZodString;
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
    anchor: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"reply">;
        messageId: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"task-result">;
        schemaVersion: z.ZodLiteral<1>;
        taskId: z.ZodUUID;
        runId: z.ZodUUID;
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
        intentVersion: z.ZodNumber;
        authorityVersion: z.ZodString;
        expiresAt: z.ZodISODateTime;
        outcome: z.ZodOptional<z.ZodLiteral<"waiting">>;
        messageId: z.ZodString;
    }, z.core.$strict>], "kind">;
    bodyHash: z.ZodString;
    segments: z.ZodArray<z.ZodString>;
    originalText: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export type QqDeliveryPlan = z.infer<typeof planSchema>;
export interface QqDeliveryProgress {
    replyId: string;
    planHash: string | null;
    state: 'ready' | 'sending' | 'partial' | 'uncertain' | 'sent';
    total: number;
    confirmed: number;
    pending: number;
    unknown: number;
    legacy: boolean;
    segments: z.infer<typeof segmentSchema>[];
}
/** Conservative short-message budget, Unicode-safe boundaries, exact reconstruction. */
export declare function splitQqText(text: string): string[];
export declare function qqDeliveryPlan(reply: Reply): QqDeliveryPlan;
/** Ledger only: no network, automatic retransmission, model calls or source authority. */
export declare class QqDeliveryLedger {
    private readonly db;
    constructor(db: DatabaseSync);
    private atomic;
    private readPlan;
    prepare(reply: Reply): QqDeliveryPlan | null;
    progress(id: string): QqDeliveryProgress | null;
    begin(id: string, position: number): void;
    confirm(id: string, position: number, receipt: string): void;
    unknown(id: string, position: number, code: string): void;
    defer(id: string, position: number, code: string): void;
    private updateCode;
    recover(): number;
    counts(): {
        plans: number;
        pending: number;
        unknown: number;
    };
}
export {};
