import { z } from 'zod';
import type { BiliConfig } from './config.js';
import type { BiliStore } from './store.js';
import type { HttpTransport, HttpResponse } from './http.js';
import type { BiliBrowserPort, BiliBrowserRequest } from '#dafeiyu/contracts';
declare const endpoints: {
    readonly nav: {
        readonly path: "/x/web-interface/nav";
        readonly schema: z.ZodObject<{}, z.core.$strict>;
        readonly signed: false;
    };
    readonly discover: {
        readonly path: "/x/web-interface/popular";
        readonly schema: z.ZodObject<{
            pn: z.ZodNumber;
            ps: z.ZodNumber;
        }, z.core.$strict>;
        readonly signed: false;
    };
    readonly search: {
        readonly path: "/x/web-interface/search/type";
        readonly schema: z.ZodObject<{
            search_type: z.ZodLiteral<"video">;
            keyword: z.ZodString;
            page: z.ZodNumber;
            page_size: z.ZodNumber;
            order: z.ZodEnum<{
                totalrank: "totalrank";
                pubdate: "pubdate";
                click: "click";
            }>;
        }, z.core.$strict>;
        readonly signed: false;
    };
    readonly video: {
        readonly path: "/x/web-interface/view";
        readonly schema: z.ZodObject<{
            bvid: z.ZodString;
        }, z.core.$strict>;
        readonly signed: false;
    };
    readonly comments: {
        readonly path: "/x/v2/reply";
        readonly schema: z.ZodObject<{
            type: z.ZodLiteral<1>;
            oid: z.ZodString;
            pn: z.ZodNumber;
            ps: z.ZodNumber;
            sort: z.ZodUnion<readonly [z.ZodLiteral<0>, z.ZodLiteral<2>]>;
        }, z.core.$strict>;
        readonly signed: false;
    };
    readonly replies: {
        readonly path: "/x/v2/reply/reply";
        readonly schema: z.ZodObject<{
            type: z.ZodLiteral<1>;
            oid: z.ZodString;
            root: z.ZodString;
            pn: z.ZodNumber;
            ps: z.ZodNumber;
        }, z.core.$strict>;
        readonly signed: false;
    };
    readonly player: {
        readonly path: "/x/player/wbi/v2";
        readonly schema: z.ZodObject<{
            bvid: z.ZodString;
            cid: z.ZodString;
        }, z.core.$strict>;
        readonly signed: true;
    };
    readonly play: {
        readonly path: "/x/player/wbi/playurl";
        readonly schema: z.ZodObject<{
            bvid: z.ZodString;
            cid: z.ZodString;
            qn: z.ZodLiteral<64>;
            fnval: z.ZodLiteral<4048>;
            fourk: z.ZodLiteral<0>;
        }, z.core.$strict>;
        readonly signed: true;
    };
    readonly danmaku: {
        readonly path: "/x/v2/dm/web/seg.so";
        readonly schema: z.ZodObject<{
            type: z.ZodLiteral<1>;
            oid: z.ZodString;
            segment_index: z.ZodNumber;
        }, z.core.$strict>;
        readonly signed: false;
    };
};
export type Endpoint = keyof typeof endpoints;
export declare function wbiQuery(params: Readonly<Record<string, string | number>>, img: string, sub: string, seconds: number): string;
export declare class BiliClient {
    readonly config: BiliConfig;
    private readonly store;
    private readonly transport;
    private readonly context;
    constructor(config: BiliConfig, store: BiliStore, transport?: HttpTransport);
    withContext<T>(context: {
        taskId: string | null;
        runId: string;
        operationId: string;
    }, work: () => T): T;
    accountStamp(): string;
    private anonymousHttpCondition;
    status(): {
        http: {
            identity: string;
            state: string;
        };
        browser: {
            configured: boolean;
            state: string;
        };
        pause: {
            scope: string;
            kind: string | null;
            endpoint: string | null;
            failures: number;
            held: boolean;
            waitUntil: string | null;
            automaticProbe: boolean;
        };
        note: string;
    };
    browserRead(port: BiliBrowserPort, request: BiliBrowserRequest, signal: AbortSignal, guard: () => void): Promise<{
        transport: "dsh-browser";
        accountUid: string;
        bvid: string | null;
        section: "discover" | "video" | "comments" | "frame";
        url: string;
        title: string;
        text: string;
        truncated: boolean;
        observedAt: string;
        feed?: "home" | "popular" | undefined;
        frame?: {
            dataUrl: string;
            positionMs: number;
            durationMs: number;
        } | undefined;
    }>;
    private session;
    private slot;
    private request;
    private json;
    read(endpoint: Endpoint, input: unknown, caller: AbortSignal, guard: () => void): Promise<unknown>;
    external(urlValue: string, kind: 'media' | 'subtitle', range: {
        start: number;
        end: number;
    } | null, caller: AbortSignal, guard: () => void, options?: {
        allowWhole?: boolean;
        etag?: string;
    }): Promise<{
        response: HttpResponse;
        signal: AbortSignal;
    }>;
}
export {};
