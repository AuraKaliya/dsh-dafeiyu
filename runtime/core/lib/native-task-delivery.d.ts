import type { Context } from '@deepseek-ai/cordis';
import type { AgentOptions } from '@deepseek-ai/dsh-agent';
import type { NativeExpressionAccess, NativeExpressionPort, PendingMessage, TaskResultAnchor, ContextItem, MediaPort, MediaReplyAccess, MediaReplyAuthority, Reply } from '#dafeiyu/contracts';
import type { ContextCoordinator } from './context.js';
import type { RuntimeStore } from './runtime-store.js';
import type { DeliveryChannel } from './task-delivery.js';
interface Host {
    ctx: Context;
    store: RuntimeStore;
    contexts: ContextCoordinator;
    cwd: string;
    signal: AbortSignal;
    timeoutMs: number;
    sendTimeoutMs: number;
    feedbackSource(runId: string): {
        item: PendingMessage;
        taskId: string;
        state: string;
        error: string | null;
        operations: readonly {
            state: string;
            status: string | null;
            effects: string | null;
        }[];
    } | null;
    describe(runId: string): {
        item: PendingMessage;
        anchor: TaskResultAnchor;
        autoDeliver: boolean | undefined;
    } | null;
    access(runId: string): Promise<NativeExpressionAccess>;
    expression(): NativeExpressionPort | undefined;
    persona(item: PendingMessage, id: string, signal: AbortSignal, guard: () => void): {
        text: string;
        foundationHash: string;
        stamp: string;
        items: readonly ContextItem[];
        guard(): void;
    };
    model(): AgentOptions;
    channel(item: PendingMessage): DeliveryChannel | null;
    accepting(): boolean;
    flush(): void;
    enqueue<T>(route: string, work: () => Promise<T>): Promise<T>;
    acquire(): Promise<() => void>;
    media(): MediaPort | undefined;
    mediaAccess(authority: MediaReplyAuthority, reply: Reply, signal: AbortSignal): Promise<MediaReplyAccess>;
}
/** One intent per completed native Run, a clean persona turn, verification, then anchored transport. */
export declare class NativeTaskDelivery {
    private readonly host;
    private readonly notices;
    private readonly active;
    private readonly views;
    private readonly unregister;
    constructor(host: Host);
    private context;
    request(runId: string, automatic?: boolean): Promise<{
        deliveryId: string;
        runId: string;
        taskId: string;
        state: "accepted" | "rendering" | "verifying" | "ready" | "sending" | "sent" | "not-sent" | "partial" | "uncertain" | "rejected" | "interrupted";
        version: number;
        receiptId: string | null;
        error: string | null;
    } | null>;
    activate(): void;
    whenIdle(): Promise<void>;
    get pending(): number;
    progress(runId: string): Promise<import('#dafeiyu/contracts').Json>;
    private statusNotice;
    close(): void;
    private execute;
    private feedback;
}
export {};
