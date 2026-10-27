import { z } from 'zod';
import type { Context } from '@deepseek-ai/cordis';
import type { Conversation, MediaAttachment } from '#dafeiyu/contracts';
import { QqMediaConfigSchema } from './media-reader.js';
import type { QqStore } from './store.js';
import type { OneBot } from './onebot.js';
export declare const QQ_MEDIA_ACTIONS: readonly ["qq_media_list"];
interface Host {
    agentId: string;
    store: QqStore;
    api: OneBot;
    settings: z.output<typeof QqMediaConfigSchema>;
    allowed(scene: Conversation): boolean;
    available(): boolean;
    sourceEpoch(): string;
    rejectIdentity(): void;
}
export declare class QqMedia {
    private readonly ctx;
    private readonly host;
    private readonly handle;
    private readonly unregister;
    private readonly controller;
    constructor(ctx: Context, host: Host);
    private current;
    remember(scene: Conversation, messageId: string, sender: string, envelope: unknown, parts: readonly {
        type: string;
        data: Record<string, unknown>;
    }[], positionOffset?: number): {
        attachments: MediaAttachment[];
        positions: Set<number>;
    };
    private list;
    close(): void;
}
export {};
