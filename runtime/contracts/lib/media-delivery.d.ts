import { z } from 'zod';
import { ConversationSchema } from './conversation.js';
import type { PersonaAccess } from './persona.js';
import type { NativeMediaMaterial } from './media.js';
export declare const ReplyMediaPartSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
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
}, z.core.$strict>], "kind">;
export type ReplyMediaPart = z.infer<typeof ReplyMediaPartSchema>;
/** Integrity data only: a transport also needs the core's live authorization and authoritative manifest lookup. */
export declare const ReplyMediaManifestSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    id: z.ZodUUID;
    replyId: z.ZodString;
    runId: z.ZodUUID;
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
export type ReplyMediaManifest = z.infer<typeof ReplyMediaManifestSchema>;
export declare const MediaReplyAuthoritySchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    id: z.ZodUUID;
    runId: z.ZodUUID;
    operationId: z.ZodUUID;
    scope: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"conversation">;
        agentId: z.ZodString;
        route: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"task">;
        agentId: z.ZodString;
        taskId: z.ZodUUID;
        scopeKey: z.ZodString;
    }, z.core.$strict>], "kind">;
    intentVersion: z.ZodNumber;
    hash: z.ZodString;
}, z.core.$strict>;
export type MediaReplyAuthority = z.infer<typeof MediaReplyAuthoritySchema>;
export declare const MediaReplyDraftInputSchema: z.ZodObject<{
    requestId: z.ZodString;
    expectedVersion: z.ZodNumber;
    parts: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"asset">;
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
        as: z.ZodOptional<z.ZodEnum<{
            record: "record";
            file: "file";
            image: "image";
        }>>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"final-voice">;
    }, z.core.$strict>], "kind">>;
}, z.core.$strict>;
/** Core-created, short-lived access to a persisted completed reply. Never constructed from model input. */
export interface MediaReplyAccess {
    readonly execution: PersonaAccess;
    readonly authority: MediaReplyAuthority;
    readonly payloadHash: string;
    readonly replyId: string;
    readonly text: string;
    readonly target: z.infer<typeof ConversationSchema>;
    readonly sourceMessageId: string;
    readonly inboundId: string;
    readonly anchor: z.infer<typeof ReplyMediaManifestSchema>['anchor'];
    readonly expiresAt: string;
    readonly approvedMedia?: NativeMediaMaterial;
    guard(): void;
    release(): void;
}
