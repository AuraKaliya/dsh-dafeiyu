import { z } from 'zod';
import type { Context } from '@deepseek-ai/cordis';
import type { MediaReplyAccess, ResourceProof, MediaAssetRef } from '#dafeiyu/contracts';
import type { MediaStore } from './store.js';
import type { MediaFiles } from './files.js';
import type { AudioWorker } from './audio.js';
export declare const replySpeechConfigSchema: z.ZodObject<{
    powershell: z.ZodString;
    voice: z.ZodString;
}, z.core.$strict>;
export declare class ReplySpeech {
    private readonly ctx;
    private readonly store;
    private readonly files;
    readonly hash: string;
    private readonly engine;
    private readonly bindings;
    constructor(ctx: Context, store: MediaStore, files: MediaFiles, settings: z.output<typeof replySpeechConfigSchema>, worker?: AudioWorker);
    private binding;
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
    } | null;
    current(proof: ResourceProof): boolean;
    source(access: MediaReplyAccess, expected: string): {
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
    prepare(access: MediaReplyAccess, expected: string): Promise<{
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
    }>;
    verify(access: MediaReplyAccess, expected: string, asset: MediaAssetRef): {
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
    release(access: MediaReplyAccess): void;
    close(): void;
}
