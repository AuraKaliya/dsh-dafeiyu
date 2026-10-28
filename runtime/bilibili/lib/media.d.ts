import type { MediaSourceDescription, MediaSourceProvider, MediaByteStream } from '#dafeiyu/contracts';
import type { BiliClient } from './client.js';
import { BiliStore } from './store.js';
import type { BiliPage } from './store.js';
export declare function rejectRestricted(raw: unknown): void;
/** Platform locators stay private. Media receives versioned public descriptors and verified byte streams. */
export declare class BiliMedia implements MediaSourceProvider {
    private readonly store;
    private readonly client;
    private readonly ready;
    readonly id = "bilibili";
    constructor(store: BiliStore, client: BiliClient, ready: () => boolean);
    describe(key: string): MediaSourceDescription | null;
    prepareBrowserFrame(raw: unknown): {
        data: {
            source: {
                provider: string;
                key: string;
            };
            kind: string;
            positionMs: number;
            durationMs: number;
            bytes: number;
            sha256: string;
            next: string;
            coverage: string;
        };
        register: (page: BiliPage) => void;
    };
    private probe;
    prepare(raw: unknown, part: {
        bvid: string;
        cid: string;
        durationMs: number;
    }, signal: AbortSignal, guard: () => void): Promise<{
        data: {
            bvid: string;
            cid: string;
            durationMs: number;
            streams: {
                source: {
                    provider: string;
                    key: string;
                };
                kind: "video" | "audio";
                codec: string;
                quality: number;
                bytes: number | null;
                rangeReadable: boolean;
            }[];
        };
        fields: never[];
        coverage: string[];
        register: (page: BiliPage) => void;
    }>;
    open(key: string, range: {
        start: number;
        end: number;
    } | null, signal: AbortSignal): Promise<MediaByteStream>;
}
