import type { Context } from '@deepseek-ai/cordis';
import type { Conversation } from '#dafeiyu/contracts';
import type { QqStickerStore } from './sticker-store.js';
export declare const QQ_STICKER_ACTIONS: readonly ["qq_sticker_list", "qq_sticker_collect", "qq_sticker_use", "qq_sticker_manage"];
interface Host {
    agentId: string;
    botId: string;
    ownerId: string;
    store: QqStickerStore;
    allowed(scene: Conversation): boolean;
}
/** Local selection/collection only. Core binds the target, final reply and delivery authority. */
export declare class QqStickers {
    private readonly ctx;
    private readonly host;
    private readonly handle;
    private readonly unregister;
    private closed;
    constructor(ctx: Context, host: Host);
    private current;
    private target;
    private list;
    private collect;
    private use;
    private manage;
    private actions;
    close(): void;
}
export {};
