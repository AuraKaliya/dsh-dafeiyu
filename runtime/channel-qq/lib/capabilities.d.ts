import type { Context } from '@deepseek-ai/cordis';
import { z } from 'zod';
import type { Conversation } from '#dafeiyu/contracts';
import type { QqStore } from './store.js';
import type { GroupDirectory } from './groups.js';
export declare const QQ_OBSERVATION_ACTIONS: readonly ["qq_groups", "qq_browse", "qq_observe_select"];
export declare const QQ_ACTIONS: readonly ["qq_groups", "qq_browse", "qq_observe_select", "qq_forward_read", "qq_reply_quote"];
export declare const QqCapabilitiesConfigSchema: z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    snapshotTtlMs: z.ZodDefault<z.ZodNumber>;
    maxSnapshots: z.ZodDefault<z.ZodNumber>;
}, z.core.$strict>;
export declare const qqResourceRoute: (scene: Conversation) => string;
interface Host {
    agentId: string;
    botId: string;
    ownerId: string;
    store: QqStore;
    groups: GroupDirectory;
    allowed(scene: Conversation): boolean;
    available(): boolean;
    readHistory?(scene: Conversation, signal: AbortSignal): Promise<unknown>;
    readForward?(scene: Conversation, messageId: string, index: number, signal: AbortSignal): Promise<unknown>;
}
/** A v3 capability extension, separate from the v2 transport. It never sends a QQ message. */
export declare class QqCapabilities {
    private readonly ctx;
    private readonly host;
    private readonly handle;
    private readonly observed;
    private closed;
    constructor(ctx: Context, host: Host);
    private owner;
    private assertAvailable;
    private allowed;
    private current;
    private roots;
    private epoch;
    private groups;
    private browse;
    private select;
    private forward;
    private quote;
    private actions;
    close(): void;
}
export {};
