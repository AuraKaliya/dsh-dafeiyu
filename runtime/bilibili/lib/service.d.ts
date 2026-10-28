import { Service } from '@deepseek-ai/cordis';
import type { Context } from '@deepseek-ai/cordis';
import { z } from 'zod';
import type { BiliBrowserPort } from '#dafeiyu/contracts';
import { BiliStore } from './store.js';
import type { BiliPage } from './store.js';
import { BiliClient } from './client.js';
import type { HttpTransport } from './http.js';
export declare const BILI_ACTIONS: readonly ["bili_status", "bili_discover", "bili_search_sources", "bili_search", "bili_video", "bili_comments", "bili_subtitles", "bili_danmaku", "bili_media", "bili_observe_select"];
export declare const biliServiceConfigSchema: z.ZodObject<{
    agentId: z.ZodString;
    profileId: z.ZodString;
    dataDir: z.ZodString;
    createStore: z.ZodDefault<z.ZodBoolean>;
    settings: z.ZodPrefault<z.ZodObject<{
        minIntervalMs: z.ZodDefault<z.ZodNumber>;
        timeoutMs: z.ZodDefault<z.ZodNumber>;
        backoffMs: z.ZodOptional<z.ZodNumber>;
        retry: z.ZodPrefault<z.ZodObject<{
            rateDelaysMs: z.ZodDefault<z.ZodArray<z.ZodNumber>>;
            riskDelayMs: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strict>>;
        maxResponseBytes: z.ZodDefault<z.ZodNumber>;
        maxMediaReadBytes: z.ZodDefault<z.ZodNumber>;
        maxPages: z.ZodDefault<z.ZodNumber>;
        session: z.ZodOptional<z.ZodObject<{
            file: z.ZodString;
            expectedUid: z.ZodString;
        }, z.core.$strict>>;
        browser: z.ZodOptional<z.ZodObject<{
            expectedUid: z.ZodString;
        }, z.core.$strict>>;
        topics: z.ZodDefault<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            text: z.ZodString;
        }, z.core.$strict>>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type Config = z.input<typeof biliServiceConfigSchema>;
export declare function pageView(page: BiliPage): {
    kind: "video" | "comments" | "discover" | "browser" | "search" | "subtitles" | "danmaku" | "media";
    fetchedAt: string;
    data: z.core.util.JSONType;
    coverage: string[];
};
declare module '@deepseek-ai/cordis' {
    interface Context {
        dafeiyuBilibili: BiliService;
    }
}
export declare class BiliService extends Service {
    private readonly browser?;
    readonly config: z.output<typeof biliServiceConfigSchema>;
    readonly store: BiliStore;
    readonly client: BiliClient;
    private readonly gate;
    private readonly controller;
    private readonly handle;
    private tail;
    private closing;
    private finalHealth;
    private media;
    private unbindMedia;
    private finalBackoff;
    private finalHeld;
    constructor(ctx: Context, config: Config, transport?: HttpTransport, browser?: BiliBrowserPort | undefined);
    ready(): boolean;
    private access;
    private guard;
    private exposed;
    private ownerQuery;
    private sources;
    private query;
    private observed;
    private readPage;
    private publicView;
    private videoPart;
    private timedRange;
    private select;
    private serial;
    private actions;
    flush(): void;
    recover(): void;
    activate(): void;
    whenIdle(): Promise<unknown>;
    cancelRunning(): void;
    get health(): {
        lifecycle: import("#dafeiyu/contracts").ServicePhase;
        media: boolean;
        counts: {
            pages: number;
            requests: number;
            pending: number;
        };
        backoffUntil: number | null;
        diagnosticRequired: boolean;
    };
    close(): Promise<void>;
}
