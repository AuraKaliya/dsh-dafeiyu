import { z } from 'zod';
import type { GroupInput, GroupSnapshot } from './groups.js';
import { QqCache } from './cache.js';
import type { QqCacheOptions } from './cache.js';
import type { MediaAttachment } from '#dafeiyu/contracts';
import { QqDeliveryLedger } from './delivery.js';
import { QqMediaStore } from './media-store.js';
import { QqMediaDeliveryLedger } from './media-delivery.js';
import { QqMessageBatches, QqBatchConfigSchema } from './batch.js';
import type { QqBatchHost } from './batch.js';
import { QqStickerStore, QqStickersConfigSchema } from './sticker-store.js';
declare const quoteSchema: z.ZodObject<{
    route: z.ZodString;
    messageId: z.ZodString;
    observedAt: z.ZodISODateTime;
    occurredAt: z.ZodISODateTime;
    expiresAt: z.ZodISODateTime;
    proof: z.ZodObject<{
        route: z.ZodString;
        parts: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            version: z.ZodNumber;
            hash: z.ZodString;
        }, z.core.$strict>>;
        hash: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare class QqStore {
    private readonly db;
    readonly cache: QqCache;
    readonly delivery: QqDeliveryLedger;
    readonly media: QqMediaStore;
    readonly mediaDelivery: QqMediaDeliveryLedger;
    readonly stickers: QqStickerStore;
    batches(config: z.output<typeof QqBatchConfigSchema>, host: QqBatchHost, clock?: () => number): QqMessageBatches;
    constructor(file: string, options?: {
        migrate?: boolean;
        cache?: QqCacheOptions;
        stickers?: z.input<typeof QqStickersConfigSchema>;
    });
    remember(route: string, id: string, sender: string, text: string, metadata?: {
        occurredAt: string | null;
        unsupported: readonly string[];
        media?: readonly MediaAttachment[];
        groupGeneration?: number;
        forwardIds?: readonly string[];
    }): boolean;
    selectReplyQuote(replyId: string, value: z.infer<typeof quoteSchema>): void;
    replyQuote(replyId: string, route: string): string | null;
    appendHistory(route: string, id: string, sender: string, text: string, metadata: {
        occurredAt: string;
        unsupported: readonly string[];
        media?: readonly MediaAttachment[];
        forwardIds?: readonly string[];
    }): boolean;
    find(route: string, id: string): {
        text: string;
        id: string;
        sender: string;
    } | null;
    receipt(id: string): string | null;
    handled(route: string, id: string): boolean;
    acknowledge(route: string, id: string): void;
    sent(replyId: string, platformId: string): void;
    groupSnapshot(account: string): GroupSnapshot | null;
    saveGroups(account: string, groups: readonly GroupInput[], at: string): GroupSnapshot;
    close(): void;
}
export {};
