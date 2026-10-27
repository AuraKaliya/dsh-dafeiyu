import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { MediaAttachment } from '#dafeiyu/contracts';
export declare const QqCacheProofSchema: z.ZodObject<{
    route: z.ZodString;
    parts: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        version: z.ZodNumber;
        hash: z.ZodString;
    }, z.core.$strict>>;
    hash: z.ZodString;
}, z.core.$strict>;
export type QqCacheProof = z.infer<typeof QqCacheProofSchema>;
export declare const QqBrowseInputSchema: z.ZodObject<{
    requestId: z.ZodString;
    limit: z.ZodDefault<z.ZodNumber>;
    cursor: z.ZodOptional<z.ZodUUID>;
    includeRecentHistory: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strict>;
export interface QqCacheOptions {
    clock?: () => number;
    snapshotTtlMs?: number;
    maxSnapshots?: number;
}
/** Actual received text, bounded short-lived views, and durable version facts; no model or long-term memory decisions. */
export declare class QqCache {
    private readonly db;
    private readonly instance;
    private readonly now;
    private readonly ttl;
    private readonly max;
    constructor(db: DatabaseSync, options?: QqCacheOptions);
    private atomic;
    private epoch;
    generation(route?: string): number;
    known(route: string, id: string): boolean;
    completeHistoryMetadata(route: string, id: string, occurredAt: string, forwardIds?: readonly string[]): void;
    messageProof(route: string, id: string): QqCacheProof;
    forward(route: string, id: string, index: number): string;
    groupAccess(route: string, id: string): {
        generation: number;
        occurredAt: string;
    } | null;
    recalled(route: string, id: string): boolean;
    private bump;
    private meta;
    remember(route: string, id: string, sender: string, raw: string, metadata?: {
        occurredAt: string | null;
        unsupported: readonly string[];
        media?: readonly MediaAttachment[];
        groupGeneration?: number;
        history?: true;
        forwardIds?: readonly string[];
    }): boolean;
    revoke(route: string, id: string): boolean;
    proofCurrent(raw: unknown): boolean;
    snapshot(owner: string, id: string): {
        expiresAt: string;
        page: {
            order: "received-newest-first";
            watermark: number;
            oldestCachedSequence: number;
            messages: {
                id: string;
                sender: string;
                receivedSequence: number;
                text: string;
                occurredAt: string | null;
                unsupported: string[];
                legacyMetadata: boolean;
                cacheTextTruncated: boolean | null;
                range: {
                    start: number;
                    end: number;
                    total: number;
                };
                media?: {
                    schemaVersion: 1;
                    source: {
                        provider: string;
                        key: string;
                    };
                    kind: "image" | "audio" | "video" | "document";
                    name: string | null;
                }[] | undefined;
                history?: true | undefined;
            }[];
            limitations: string[];
        };
        proof: {
            route: string;
            parts: {
                id: string;
                version: number;
                hash: string;
            }[];
            hash: string;
        };
        next: {
            watermark: number;
            sequence: number;
            offset: number;
            epoch: number;
            limit: number;
            observedAt?: string | undefined;
        } | null;
        createdAt: string;
        id: string;
    };
    browse(route: string, owner: string, raw: unknown, recentOnly?: boolean): {
        expiresAt: string;
        page: {
            order: "received-newest-first";
            watermark: number;
            oldestCachedSequence: number;
            messages: {
                id: string;
                sender: string;
                receivedSequence: number;
                text: string;
                occurredAt: string | null;
                unsupported: string[];
                legacyMetadata: boolean;
                cacheTextTruncated: boolean | null;
                range: {
                    start: number;
                    end: number;
                    total: number;
                };
                media?: {
                    schemaVersion: 1;
                    source: {
                        provider: string;
                        key: string;
                    };
                    kind: "image" | "audio" | "video" | "document";
                    name: string | null;
                }[] | undefined;
                history?: true | undefined;
            }[];
            limitations: string[];
        };
        proof: {
            route: string;
            parts: {
                id: string;
                version: number;
                hash: string;
            }[];
            hash: string;
        };
        next: {
            watermark: number;
            sequence: number;
            offset: number;
            epoch: number;
            limit: number;
            observedAt?: string | undefined;
        } | null;
        createdAt: string;
        id: string;
    };
}
