import { z } from 'zod';
import type { ResourceProof, ExecutionContextV3, MediaSourceDescription, PersonaSourceRef } from '#dafeiyu/contracts';
export declare const BILI_APPLICATION_ID = 1145455158, BILI_SCHEMA_VERSION = 1;
export declare const BILI_TABLES: readonly ["bili_metadata", "bili_clock", "bili_requests", "bili_sources", "bili_revisions", "bili_pages", "bili_media", "bili_outbox"];
declare const identitySchema: z.ZodObject<{
    agentId: z.ZodString;
    profileId: z.ZodString;
}, z.core.$strict>;
export declare const biliHash: (value: unknown) => string;
export declare const biliOwner: (context: Pick<ExecutionContextV3, "scope" | "intentVersion">) => string;
export declare const BiliPageSchema: z.ZodObject<{
    id: z.ZodUUID;
    owner: z.ZodString;
    kind: z.ZodEnum<{
        media: "media";
        video: "video";
        search: "search";
        discover: "discover";
        comments: "comments";
        subtitles: "subtitles";
        danmaku: "danmaku";
    }>;
    sourceKey: z.ZodString;
    sourceVersion: z.ZodNumber;
    fetchedAt: z.ZodISODateTime;
    data: z.ZodJSONSchema;
    coverage: z.ZodArray<z.ZodString>;
    fields: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        text: z.ZodString;
    }, z.core.$strict>>;
    parents: z.ZodOptional<z.ZodArray<z.ZodObject<{
        provider: z.ZodString;
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
        key: z.ZodString;
        version: z.ZodNumber;
        hash: z.ZodString;
        roots: z.ZodArray<z.ZodString>;
        detail: z.ZodJSONSchema;
    }, z.core.$strict>>>;
}, z.core.$strict>;
export type BiliPage = z.infer<typeof BiliPageSchema>;
export declare class BiliStore {
    private readonly maxPages;
    private readonly db;
    private readonly checking;
    readonly identity: z.infer<typeof identitySchema>;
    constructor(file: string, identity: z.infer<typeof identitySchema>, create?: boolean, maxPages?: number);
    private initialize;
    private atomic;
    private check;
    begin(context: ExecutionContextV3, requestId: string, input: unknown): {
        id: string;
        owner: string;
        kind: "media" | "video" | "search" | "discover" | "comments" | "subtitles" | "danmaku";
        sourceKey: string;
        sourceVersion: number;
        fetchedAt: string;
        data: z.core.util.JSONType;
        coverage: string[];
        fields: {
            id: string;
            text: string;
        }[];
        parents?: {
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
        }[] | undefined;
    } | null;
    private source;
    complete(context: ExecutionContextV3, requestId: string, value: Omit<BiliPage, 'id' | 'owner' | 'fetchedAt' | 'sourceVersion'>, now?: number, related?: (page: BiliPage) => void): {
        id: string;
        owner: string;
        kind: "media" | "video" | "search" | "discover" | "comments" | "subtitles" | "danmaku";
        sourceKey: string;
        sourceVersion: number;
        fetchedAt: string;
        data: z.core.util.JSONType;
        coverage: string[];
        fields: {
            id: string;
            text: string;
        }[];
        parents?: {
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
        }[] | undefined;
    };
    fail(context: ExecutionContextV3, requestId: string, error: string): void;
    page(owner: string, id: string): BiliPage;
    pages(owner: string): {
        id: string;
        owner: string;
        kind: "media" | "video" | "search" | "discover" | "comments" | "subtitles" | "danmaku";
        sourceKey: string;
        sourceVersion: number;
        fetchedAt: string;
        data: z.core.util.JSONType;
        coverage: string[];
        fields: {
            id: string;
            text: string;
        }[];
        parents?: {
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
        }[] | undefined;
    }[];
    sourceCurrent(key: string, version: number): boolean;
    unavailable(key: string): void;
    proof(page: BiliPage): ResourceProof;
    current(raw: ResourceProof): boolean;
    bindObservation(page: BiliPage, source: PersonaSourceRef): void;
    observation(page: BiliPage): {
        kind: "memory";
        revision: number;
        id: string;
        agentId: string;
        scopeKey: string;
        version: number;
        contentHash: string;
        authorization?: {
            taskId: string;
            taskEpoch: number;
            grantId: string;
            grantVersion: number;
            policyId: string;
            policyVersion: number;
        } | undefined;
        selectionId?: string | undefined;
        range?: {
            start: number;
            end: number;
        } | undefined;
    } | {
        kind: "execution-source";
        id: string;
        agentId: string;
        scopeKey: string;
        version: number;
        contentHash: string;
    } | null;
    registerMedia(key: string, description: MediaSourceDescription, locator: unknown, expiresAt: number): void;
    media(key: string, now?: number, historical?: boolean): {
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
        };
        locator: z.core.util.JSONType;
        expiresAt: number;
    } | null;
    reserveRequest(now: number, interval: number, timeout: number): number;
    backoff(now: number, duration: number, error?: string): void;
    get clock(): {
        nextAt: number;
        blockedUntil: number;
        error: string | null;
    };
    private audit;
    drain(write: (body: unknown, id: string) => void): void;
    recover(): number;
    get counts(): {
        pages: number;
        requests: number;
        pending: number;
    };
    close(): void;
}
export {};
