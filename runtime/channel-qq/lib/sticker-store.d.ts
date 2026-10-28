import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { Conversation, MediaAssetRef, ResourceProof } from '#dafeiyu/contracts';
export declare const QQ_STICKER_PROVIDER = "qq-stickers";
export declare const QqStickersConfigSchema: z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    maxBytes: z.ZodDefault<z.ZodNumber>;
    maxEntries: z.ZodDefault<z.ZodNumber>;
}, z.core.$strict>;
export declare const StickerMetadataSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodString;
    tags: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
declare const bodySchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodString;
    tags: z.ZodArray<z.ZodString>;
    scope: z.ZodEnum<{
        conversation: "conversation";
        global: "global";
    }>;
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
    origin: z.ZodObject<{
        messageId: z.ZodString;
        sender: z.ZodString;
    }, z.core.$strict>;
    mime: z.ZodEnum<{
        "image/gif": "image/gif";
        "image/png": "image/png";
        "image/jpeg": "image/jpeg";
        "image/webp": "image/webp";
    }>;
    bytes: z.ZodNumber;
    enabled: z.ZodBoolean;
    deleted: z.ZodBoolean;
    collectedAt: z.ZodISODateTime;
    uses: z.ZodNumber;
    lastUsedAt: z.ZodNullable<z.ZodISODateTime>;
}, z.core.$strict>;
type Sticker = {
    id: string;
    sha256: string;
    version: number;
    body: z.infer<typeof bodySchema>;
};
/** Persistent original bytes, independent of the disposable media cache. No model paths or URLs. */
export declare class QqStickerStore {
    private readonly db;
    private readonly config;
    private readonly root;
    constructor(db: DatabaseSync, directory: string, config: z.output<typeof QqStickersConfigSchema>);
    private file;
    private rows;
    private row;
    get(id: string): Sticker;
    private visible;
    list(scene: Conversation, query?: string): {
        name: string;
        description: string;
        tags: string[];
        scope: "conversation" | "global";
        mime: "image/gif" | "image/png" | "image/jpeg" | "image/webp";
        bytes: number;
        enabled: boolean;
        deleted: boolean;
        collectedAt: string;
        uses: number;
        lastUsedAt: string | null;
        id: string;
        version: number;
        sha256: string;
    }[];
    summary(row: Sticker): {
        name: string;
        description: string;
        tags: string[];
        scope: "conversation" | "global";
        mime: "image/gif" | "image/png" | "image/jpeg" | "image/webp";
        bytes: number;
        enabled: boolean;
        deleted: boolean;
        collectedAt: string;
        uses: number;
        lastUsedAt: string | null;
        id: string;
        version: number;
        sha256: string;
    };
    managementList(query?: string): {
        id: string;
        name: string;
        version: number;
        scope: "conversation" | "global";
        enabled: boolean;
        sourceScene: {
            channel: string;
            account: string;
            kind: "private" | "group" | "local";
            id: string;
        };
    }[];
    collect(scene: Conversation, origin: {
        messageId: string;
        sender: string;
    }, metadata: z.infer<typeof StickerMetadataSchema>, data: Uint8Array, mime: string): {
        duplicate: boolean;
        name: string;
        description: string;
        tags: string[];
        scope: "conversation" | "global";
        mime: "image/gif" | "image/png" | "image/jpeg" | "image/webp";
        bytes: number;
        enabled: boolean;
        deleted: boolean;
        collectedAt: string;
        uses: number;
        lastUsedAt: string | null;
        id: string;
        version: number;
        sha256: string;
    };
    bytes(row: Sticker): NonSharedBuffer;
    lease(id: string, scene: Conversation, requestKey: string): {
        ref: {
            provider: string;
            key: string;
        };
        origin: {
            provider: string;
            scene: {
                channel: string;
                account: string;
                kind: "private" | "group" | "local";
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
        sourceFrame?: {
            positionMs: number;
            durationMs: number;
        } | undefined;
    };
    describe(key: string): {
        ref: {
            provider: string;
            key: string;
        };
        origin: {
            provider: string;
            scene: {
                channel: string;
                account: string;
                kind: "private" | "group" | "local";
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
        sourceFrame?: {
            positionMs: number;
            durationMs: number;
        } | undefined;
    } | null;
    current(proof: ResourceProof): boolean;
    open(key: string): {
        data: NonSharedBuffer;
        description: {
            ref: {
                provider: string;
                key: string;
            };
            origin: {
                provider: string;
                scene: {
                    channel: string;
                    account: string;
                    kind: "private" | "group" | "local";
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
            sourceFrame?: {
                positionMs: number;
                durationMs: number;
            } | undefined;
        };
    };
    bind(key: string, asset: MediaAssetRef): void;
    permits(scene: Conversation, asset: MediaAssetRef): boolean;
    used(scene: Conversation, asset: MediaAssetRef, replyId: string): void;
    manage(target: string, action: 'global' | 'disable' | 'enable' | 'delete' | 'rename' | 'tags', value?: string): {
        name: string;
        description: string;
        tags: string[];
        scope: "conversation" | "global";
        mime: "image/gif" | "image/png" | "image/jpeg" | "image/webp";
        bytes: number;
        enabled: boolean;
        deleted: boolean;
        collectedAt: string;
        uses: number;
        lastUsedAt: string | null;
        id: string;
        version: number;
        sha256: string;
    };
    revokeSource(scene: Conversation, messageId: string): void;
    epoch(): string;
}
export {};
