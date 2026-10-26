import type { GroupInfo, GroupSnapshot } from './groups.js';
import { QqCache } from './cache.js';
import type { QqCacheOptions } from './cache.js';
import type { MediaAttachment } from '#dafeiyu/contracts';
import { QqDeliveryLedger } from './delivery.js';
import { QqMediaStore } from './media-store.js';
import { QqMediaDeliveryLedger } from './media-delivery.js';
export declare class QqStore {
    private readonly db;
    readonly cache: QqCache;
    readonly delivery: QqDeliveryLedger;
    readonly media: QqMediaStore;
    readonly mediaDelivery: QqMediaDeliveryLedger;
    constructor(file: string, options?: {
        migrate?: boolean;
        cache?: QqCacheOptions;
    });
    remember(route: string, id: string, sender: string, text: string, metadata?: {
        occurredAt: string | null;
        unsupported: readonly string[];
        media?: readonly MediaAttachment[];
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
    saveGroups(account: string, groups: readonly GroupInfo[], at: string): GroupSnapshot;
    close(): void;
}
