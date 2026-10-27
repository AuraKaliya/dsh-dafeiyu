import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { Reply } from '#dafeiyu/contracts';
export declare const qqMediaHash: (value: unknown) => string;
export declare const qqTextHash: (text: string) => string;
declare const planSchema: z.ZodObject<{
    version: z.ZodLiteral<2>;
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
    sourceMessageId: z.ZodString;
    textHash: z.ZodString;
    manifest: z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        id: z.ZodUUID;
        replyId: z.ZodString;
        runId: z.ZodUUID;
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
        sourceMessageId: z.ZodString;
        anchor: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"reply">;
            inboundId: z.ZodUUID;
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
        }, z.core.$strict>], "kind">;
        textHash: z.ZodString;
        draft: z.ZodObject<{
            id: z.ZodUUID;
            version: z.ZodNumber;
        }, z.core.$strict>;
        parts: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"image">;
            asset: z.ZodObject<{
                schemaVersion: z.ZodLiteral<1>;
                id: z.ZodUUID;
                version: z.ZodNumber;
                kind: z.ZodEnum<{
                    image: "image";
                    audio: "audio";
                    video: "video";
                    document: "document";
                }>;
                sha256: z.ZodString;
                bytes: z.ZodNumber;
                mime: z.ZodString;
            }, z.core.$strict>;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"record">;
            asset: z.ZodObject<{
                schemaVersion: z.ZodLiteral<1>;
                id: z.ZodUUID;
                version: z.ZodNumber;
                kind: z.ZodEnum<{
                    image: "image";
                    audio: "audio";
                    video: "video";
                    document: "document";
                }>;
                sha256: z.ZodString;
                bytes: z.ZodNumber;
                mime: z.ZodString;
            }, z.core.$strict>;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"file">;
            asset: z.ZodObject<{
                schemaVersion: z.ZodLiteral<1>;
                id: z.ZodUUID;
                version: z.ZodNumber;
                kind: z.ZodEnum<{
                    image: "image";
                    audio: "audio";
                    video: "video";
                    document: "document";
                }>;
                sha256: z.ZodString;
                bytes: z.ZodNumber;
                mime: z.ZodString;
            }, z.core.$strict>;
            name: z.ZodString;
        }, z.core.$strict>], "kind">>;
        sourceStamp: z.ZodString;
        credential: z.ZodString;
        expiresAt: z.ZodISODateTime;
    }, z.core.$strict>;
    parts: z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        kind: z.ZodLiteral<"text">;
        text: z.ZodString;
    }, z.core.$strict>, z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"image">;
        asset: z.ZodObject<{
            schemaVersion: z.ZodLiteral<1>;
            id: z.ZodUUID;
            version: z.ZodNumber;
            kind: z.ZodEnum<{
                image: "image";
                audio: "audio";
                video: "video";
                document: "document";
            }>;
            sha256: z.ZodString;
            bytes: z.ZodNumber;
            mime: z.ZodString;
        }, z.core.$strict>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"record">;
        asset: z.ZodObject<{
            schemaVersion: z.ZodLiteral<1>;
            id: z.ZodUUID;
            version: z.ZodNumber;
            kind: z.ZodEnum<{
                image: "image";
                audio: "audio";
                video: "video";
                document: "document";
            }>;
            sha256: z.ZodString;
            bytes: z.ZodNumber;
            mime: z.ZodString;
        }, z.core.$strict>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"file">;
        asset: z.ZodObject<{
            schemaVersion: z.ZodLiteral<1>;
            id: z.ZodUUID;
            version: z.ZodNumber;
            kind: z.ZodEnum<{
                image: "image";
                audio: "audio";
                video: "video";
                document: "document";
            }>;
            sha256: z.ZodString;
            bytes: z.ZodNumber;
            mime: z.ZodString;
        }, z.core.$strict>;
        name: z.ZodString;
    }, z.core.$strict>], "kind">]>>;
}, z.core.$strict>;
export type QqMediaDeliveryPlan = z.infer<typeof planSchema>;
declare const progressPart: z.ZodObject<{
    position: z.ZodNumber;
    state: z.ZodEnum<{
        unknown: "unknown";
        sending: "sending";
        sent: "sent";
        pending: "pending";
    }>;
    receipt: z.ZodNullable<z.ZodString>;
    code: z.ZodNullable<z.ZodString>;
}, z.core.$strict>;
export interface QqMediaDeliveryProgress {
    replyId: string;
    planHash: string;
    state: 'ready' | 'sending' | 'partial' | 'uncertain' | 'sent';
    total: number;
    confirmed: number;
    pending: number;
    unknown: number;
    parts: z.infer<typeof progressPart>[];
}
/** Builds fixed bytes/identity metadata, never authorizes those bytes or invokes a platform. */
export declare function qqMediaDeliveryPlan(reply: Reply): QqMediaDeliveryPlan;
export declare class QqMediaDeliveryLedger {
    private readonly db;
    constructor(db: DatabaseSync);
    private atomic;
    plan(id: string): {
        version: 2;
        replyId: string;
        target: {
            channel: string;
            account: string;
            kind: "private" | "group" | "local";
            id: string;
        };
        sourceMessageId: string;
        textHash: string;
        manifest: {
            schemaVersion: 1;
            id: string;
            replyId: string;
            runId: string;
            target: {
                channel: string;
                account: string;
                kind: "private" | "group" | "local";
                id: string;
            };
            sourceMessageId: string;
            anchor: {
                kind: "reply";
                inboundId: string;
            } | {
                kind: "task-result";
                schemaVersion: 1;
                taskId: string;
                runId: string;
                inboundId: string;
                target: {
                    channel: string;
                    account: string;
                    kind: "private" | "group" | "local";
                    id: string;
                };
                intentVersion: number;
                authorityVersion: string;
                expiresAt: string;
                outcome?: "waiting" | undefined;
            };
            textHash: string;
            draft: {
                id: string;
                version: number;
            };
            parts: ({
                kind: "image";
                asset: {
                    schemaVersion: 1;
                    id: string;
                    version: number;
                    kind: "image" | "audio" | "video" | "document";
                    sha256: string;
                    bytes: number;
                    mime: string;
                };
            } | {
                kind: "record";
                asset: {
                    schemaVersion: 1;
                    id: string;
                    version: number;
                    kind: "image" | "audio" | "video" | "document";
                    sha256: string;
                    bytes: number;
                    mime: string;
                };
            } | {
                kind: "file";
                asset: {
                    schemaVersion: 1;
                    id: string;
                    version: number;
                    kind: "image" | "audio" | "video" | "document";
                    sha256: string;
                    bytes: number;
                    mime: string;
                };
                name: string;
            })[];
            sourceStamp: string;
            credential: string;
            expiresAt: string;
        };
        parts: ({
            kind: "text";
            text: string;
        } | {
            kind: "image";
            asset: {
                schemaVersion: 1;
                id: string;
                version: number;
                kind: "image" | "audio" | "video" | "document";
                sha256: string;
                bytes: number;
                mime: string;
            };
        } | {
            kind: "record";
            asset: {
                schemaVersion: 1;
                id: string;
                version: number;
                kind: "image" | "audio" | "video" | "document";
                sha256: string;
                bytes: number;
                mime: string;
            };
        } | {
            kind: "file";
            asset: {
                schemaVersion: 1;
                id: string;
                version: number;
                kind: "image" | "audio" | "video" | "document";
                sha256: string;
                bytes: number;
                mime: string;
            };
            name: string;
        })[];
    } | null;
    prepare(reply: Reply): {
        version: 2;
        replyId: string;
        target: {
            channel: string;
            account: string;
            kind: "private" | "group" | "local";
            id: string;
        };
        sourceMessageId: string;
        textHash: string;
        manifest: {
            schemaVersion: 1;
            id: string;
            replyId: string;
            runId: string;
            target: {
                channel: string;
                account: string;
                kind: "private" | "group" | "local";
                id: string;
            };
            sourceMessageId: string;
            anchor: {
                kind: "reply";
                inboundId: string;
            } | {
                kind: "task-result";
                schemaVersion: 1;
                taskId: string;
                runId: string;
                inboundId: string;
                target: {
                    channel: string;
                    account: string;
                    kind: "private" | "group" | "local";
                    id: string;
                };
                intentVersion: number;
                authorityVersion: string;
                expiresAt: string;
                outcome?: "waiting" | undefined;
            };
            textHash: string;
            draft: {
                id: string;
                version: number;
            };
            parts: ({
                kind: "image";
                asset: {
                    schemaVersion: 1;
                    id: string;
                    version: number;
                    kind: "image" | "audio" | "video" | "document";
                    sha256: string;
                    bytes: number;
                    mime: string;
                };
            } | {
                kind: "record";
                asset: {
                    schemaVersion: 1;
                    id: string;
                    version: number;
                    kind: "image" | "audio" | "video" | "document";
                    sha256: string;
                    bytes: number;
                    mime: string;
                };
            } | {
                kind: "file";
                asset: {
                    schemaVersion: 1;
                    id: string;
                    version: number;
                    kind: "image" | "audio" | "video" | "document";
                    sha256: string;
                    bytes: number;
                    mime: string;
                };
                name: string;
            })[];
            sourceStamp: string;
            credential: string;
            expiresAt: string;
        };
        parts: ({
            kind: "text";
            text: string;
        } | {
            kind: "image";
            asset: {
                schemaVersion: 1;
                id: string;
                version: number;
                kind: "image" | "audio" | "video" | "document";
                sha256: string;
                bytes: number;
                mime: string;
            };
        } | {
            kind: "record";
            asset: {
                schemaVersion: 1;
                id: string;
                version: number;
                kind: "image" | "audio" | "video" | "document";
                sha256: string;
                bytes: number;
                mime: string;
            };
        } | {
            kind: "file";
            asset: {
                schemaVersion: 1;
                id: string;
                version: number;
                kind: "image" | "audio" | "video" | "document";
                sha256: string;
                bytes: number;
                mime: string;
            };
            name: string;
        })[];
    };
    progress(id: string): QqMediaDeliveryProgress | null;
    begin(id: string, position: number): void;
    confirm(id: string, position: number, receipt: string): void;
    unknown(id: string, position: number, code: string): void;
    defer(id: string, position: number, code: string): void;
    private code;
    recover(): number;
    counts(): {
        plans: number;
        pending: number;
        unknown: number;
    };
}
export {};
