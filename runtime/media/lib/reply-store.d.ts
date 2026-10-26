import { z } from 'zod';
import type { DatabaseSync } from 'node:sqlite';
import { MediaReplyAuthoritySchema, MediaAssetRefSchema } from '#dafeiyu/contracts';
import type { PersonaAccess, ReplyMediaManifest } from '#dafeiyu/contracts';
export declare const MEDIA_REPLY_TABLES: readonly ["media_reply_drafts", "media_reply_heads", "media_reply_exports"];
export declare function migrateMediaReplies(db: DatabaseSync): void;
export declare const mediaDraftContentSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    runId: z.ZodUUID;
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
    taskEpoch: z.ZodNumber;
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
        source: z.ZodObject<{
            ref: z.ZodObject<{
                provider: z.ZodString;
                key: z.ZodString;
            }, z.core.$strict>;
            origin: z.ZodObject<{
                provider: z.ZodString;
                scene: z.ZodObject<{
                    channel: z.ZodString;
                    account: z.ZodString;
                    kind: z.ZodEnum<{
                        local: "local";
                        private: "private";
                        group: "group";
                    }>;
                    id: z.ZodString;
                }, z.core.$strict>;
                key: z.ZodString;
                version: z.ZodNumber;
                hash: z.ZodString;
                roots: z.ZodArray<z.ZodString>;
                detail: z.ZodJSONSchema;
            }, z.core.$strict>;
            kind: z.ZodEnum<{
                image: "image";
                audio: "audio";
                video: "video";
                document: "document";
            }>;
            name: z.ZodNullable<z.ZodString>;
            mimeHint: z.ZodNullable<z.ZodString>;
            bytesHint: z.ZodNullable<z.ZodNumber>;
            durationMsHint: z.ZodNullable<z.ZodNumber>;
            rangeReadable: z.ZodBoolean;
            publicContent: z.ZodDefault<z.ZodBoolean>;
        }, z.core.$strict>;
        as: z.ZodOptional<z.ZodEnum<{
            record: "record";
            file: "file";
            image: "image";
        }>>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"final-voice">;
        voiceHash: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>], "kind">>;
}, z.core.$strict>;
export declare const mediaDraftSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    runId: z.ZodUUID;
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
    taskEpoch: z.ZodNumber;
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
        source: z.ZodObject<{
            ref: z.ZodObject<{
                provider: z.ZodString;
                key: z.ZodString;
            }, z.core.$strict>;
            origin: z.ZodObject<{
                provider: z.ZodString;
                scene: z.ZodObject<{
                    channel: z.ZodString;
                    account: z.ZodString;
                    kind: z.ZodEnum<{
                        local: "local";
                        private: "private";
                        group: "group";
                    }>;
                    id: z.ZodString;
                }, z.core.$strict>;
                key: z.ZodString;
                version: z.ZodNumber;
                hash: z.ZodString;
                roots: z.ZodArray<z.ZodString>;
                detail: z.ZodJSONSchema;
            }, z.core.$strict>;
            kind: z.ZodEnum<{
                image: "image";
                audio: "audio";
                video: "video";
                document: "document";
            }>;
            name: z.ZodNullable<z.ZodString>;
            mimeHint: z.ZodNullable<z.ZodString>;
            bytesHint: z.ZodNullable<z.ZodNumber>;
            durationMsHint: z.ZodNullable<z.ZodNumber>;
            rangeReadable: z.ZodBoolean;
            publicContent: z.ZodDefault<z.ZodBoolean>;
        }, z.core.$strict>;
        as: z.ZodOptional<z.ZodEnum<{
            record: "record";
            file: "file";
            image: "image";
        }>>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"final-voice">;
        voiceHash: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>], "kind">>;
    id: z.ZodUUID;
    version: z.ZodNumber;
    requestId: z.ZodString;
    operationId: z.ZodUUID;
    authority: z.ZodObject<{
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
    createdAt: z.ZodISODateTime;
}, z.core.$strict>;
export type MediaDraft = z.infer<typeof mediaDraftSchema>;
declare const exportSchema: z.ZodObject<{
    manifest: z.ZodObject<{
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
    leases: z.ZodArray<z.ZodObject<{
        id: z.ZodUUID;
        owner: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>;
/** Append-only draft revisions and immutable export bodies; guards/byte checks are supplied by the owner. */
export declare class MediaReplyStore {
    private readonly db;
    private readonly atomic;
    private readonly hash;
    private readonly validAsset;
    constructor(db: DatabaseSync, atomic: <T>(work: () => T) => T, hash: (value: unknown) => string, validAsset: (asset: z.infer<typeof MediaAssetRefSchema>) => void);
    draft(id: string): {
        schemaVersion: 1;
        runId: string;
        scope: {
            kind: "conversation";
            agentId: string;
            route: string;
        } | {
            kind: "task";
            agentId: string;
            taskId: string;
            scopeKey: string;
        };
        taskEpoch: number;
        parts: ({
            kind: "asset";
            asset: {
                schemaVersion: 1;
                id: string;
                version: number;
                kind: "image" | "audio" | "video" | "document";
                sha256: string;
                bytes: number;
                mime: string;
            };
            source: {
                ref: {
                    provider: string;
                    key: string;
                };
                origin: {
                    provider: string;
                    scene: {
                        channel: string;
                        account: string;
                        kind: "local" | "private" | "group";
                        id: string;
                    };
                    key: string;
                    version: number;
                    hash: string;
                    roots: string[];
                    detail: z.core.util.JSONType;
                };
                kind: "image" | "audio" | "video" | "document";
                name: string | null;
                mimeHint: string | null;
                bytesHint: number | null;
                durationMsHint: number | null;
                rangeReadable: boolean;
                publicContent: boolean;
            };
            as?: "record" | "file" | "image" | undefined;
        } | {
            kind: "final-voice";
            voiceHash?: string | undefined;
        })[];
        id: string;
        version: number;
        requestId: string;
        operationId: string;
        authority: {
            schemaVersion: 1;
            id: string;
            runId: string;
            operationId: string;
            scope: {
                kind: "conversation";
                agentId: string;
                route: string;
            } | {
                kind: "task";
                agentId: string;
                taskId: string;
                scopeKey: string;
            };
            intentVersion: number;
            hash: string;
        };
        createdAt: string;
    };
    current(runId: string): {
        draft: {
            schemaVersion: 1;
            runId: string;
            scope: {
                kind: "conversation";
                agentId: string;
                route: string;
            } | {
                kind: "task";
                agentId: string;
                taskId: string;
                scopeKey: string;
            };
            taskEpoch: number;
            parts: ({
                kind: "asset";
                asset: {
                    schemaVersion: 1;
                    id: string;
                    version: number;
                    kind: "image" | "audio" | "video" | "document";
                    sha256: string;
                    bytes: number;
                    mime: string;
                };
                source: {
                    ref: {
                        provider: string;
                        key: string;
                    };
                    origin: {
                        provider: string;
                        scene: {
                            channel: string;
                            account: string;
                            kind: "local" | "private" | "group";
                            id: string;
                        };
                        key: string;
                        version: number;
                        hash: string;
                        roots: string[];
                        detail: z.core.util.JSONType;
                    };
                    kind: "image" | "audio" | "video" | "document";
                    name: string | null;
                    mimeHint: string | null;
                    bytesHint: number | null;
                    durationMsHint: number | null;
                    rangeReadable: boolean;
                    publicContent: boolean;
                };
                as?: "record" | "file" | "image" | undefined;
            } | {
                kind: "final-voice";
                voiceHash?: string | undefined;
            })[];
            id: string;
            version: number;
            requestId: string;
            operationId: string;
            authority: {
                schemaVersion: 1;
                id: string;
                runId: string;
                operationId: string;
                scope: {
                    kind: "conversation";
                    agentId: string;
                    route: string;
                } | {
                    kind: "task";
                    agentId: string;
                    taskId: string;
                    scopeKey: string;
                };
                intentVersion: number;
                hash: string;
            };
            createdAt: string;
        };
        frozen: boolean;
    } | null;
    prepare(access: PersonaAccess, input: {
        requestId: string;
        expectedVersion: number;
        content: z.infer<typeof mediaDraftContentSchema>;
        authority: z.infer<typeof MediaReplyAuthoritySchema>;
    }): {
        schemaVersion: 1;
        runId: string;
        scope: {
            kind: "conversation";
            agentId: string;
            route: string;
        } | {
            kind: "task";
            agentId: string;
            taskId: string;
            scopeKey: string;
        };
        taskEpoch: number;
        parts: ({
            kind: "asset";
            asset: {
                schemaVersion: 1;
                id: string;
                version: number;
                kind: "image" | "audio" | "video" | "document";
                sha256: string;
                bytes: number;
                mime: string;
            };
            source: {
                ref: {
                    provider: string;
                    key: string;
                };
                origin: {
                    provider: string;
                    scene: {
                        channel: string;
                        account: string;
                        kind: "local" | "private" | "group";
                        id: string;
                    };
                    key: string;
                    version: number;
                    hash: string;
                    roots: string[];
                    detail: z.core.util.JSONType;
                };
                kind: "image" | "audio" | "video" | "document";
                name: string | null;
                mimeHint: string | null;
                bytesHint: number | null;
                durationMsHint: number | null;
                rangeReadable: boolean;
                publicContent: boolean;
            };
            as?: "record" | "file" | "image" | undefined;
        } | {
            kind: "final-voice";
            voiceHash?: string | undefined;
        })[];
        id: string;
        version: number;
        requestId: string;
        operationId: string;
        authority: {
            schemaVersion: 1;
            id: string;
            runId: string;
            operationId: string;
            scope: {
                kind: "conversation";
                agentId: string;
                route: string;
            } | {
                kind: "task";
                agentId: string;
                taskId: string;
                scopeKey: string;
            };
            intentVersion: number;
            hash: string;
        };
        createdAt: string;
    };
    exported(replyId: string): {
        state: "unknown" | "ready" | "sent" | "blocked";
        manifest: {
            schemaVersion: 1;
            id: string;
            replyId: string;
            runId: string;
            target: {
                channel: string;
                account: string;
                kind: "local" | "private" | "group";
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
                    kind: "local" | "private" | "group";
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
        leases: {
            id: string;
            owner: string;
        }[];
    } | null;
    freeze(draft: MediaDraft, manifest: ReplyMediaManifest, leases: z.infer<typeof exportSchema>['leases'], guard: () => void): {
        state: "unknown" | "ready" | "sent" | "blocked";
        manifest: {
            schemaVersion: 1;
            id: string;
            replyId: string;
            runId: string;
            target: {
                channel: string;
                account: string;
                kind: "local" | "private" | "group";
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
                    kind: "local" | "private" | "group";
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
        leases: {
            id: string;
            owner: string;
        }[];
    };
    settle(replyId: string, status: 'sent' | 'unknown' | 'blocked'): void;
    counts(): {
        drafts: number;
        exports: number;
    };
    exports(): {
        state: "unknown" | "ready" | "sent" | "blocked";
        manifest: {
            schemaVersion: 1;
            id: string;
            replyId: string;
            runId: string;
            target: {
                channel: string;
                account: string;
                kind: "local" | "private" | "group";
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
                    kind: "local" | "private" | "group";
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
        leases: {
            id: string;
            owner: string;
        }[];
    }[];
}
export {};
