import { z } from 'zod';
import type { DatabaseSync } from 'node:sqlite';
import type { Conversation, ResourceProof } from '#dafeiyu/contracts';
import type { QqCache } from './cache.js';
export declare const QQ_MEDIA_PROVIDER = "qq-media";
declare const locatorSchema: z.ZodObject<{
    file: z.ZodOptional<z.ZodString>;
    fileId: z.ZodOptional<z.ZodString>;
    url: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export type QqMediaLocator = z.infer<typeof locatorSchema>;
export declare class QqMediaStore {
    private readonly db;
    private readonly cache;
    constructor(db: DatabaseSync, cache: QqCache);
    remember(scene: Conversation, messageId: string, sender: string, envelopeHash: string, parts: readonly {
        type: string;
        data: Record<string, unknown>;
    }[]): string[];
    private row;
    describe(id: string): {
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
    };
    reference(key: string): {
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
    };
    locator(key: string): {
        file?: string | undefined;
        fileId?: string | undefined;
        url?: string | undefined;
    };
    list(scene: Conversation, messageId: string): {
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
    }[];
    current(proof: ResourceProof): boolean;
    revoke(scene: Conversation, messageId: string): number | bigint;
    prune(maximum?: number, oldest?: number): void;
    epoch(): string;
}
export {};
