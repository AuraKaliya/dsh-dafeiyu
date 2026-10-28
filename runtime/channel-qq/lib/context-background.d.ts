import type { Context } from '@deepseek-ai/cordis';
import type { ContextContributor, Conversation } from '#dafeiyu/contracts';
import type { QqStore } from './store.js';
export declare function backgroundContributor(ctx: Context, host: {
    store: QqStore;
    allowed(scene: Conversation): boolean;
    accepts(scene: Conversation, time: number, generation: number | undefined): boolean;
}): ContextContributor;
