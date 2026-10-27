import type { ChannelCapability, Conversation, PendingMessage, PersonaSnapshot, TaskExpressionProvider } from '#dafeiyu/contracts';
import type { Journal } from '#dafeiyu/journal';
import type { ContextCoordinator } from './context.js';
import type { DshRuntime } from './runtime.js';
export interface DeliveryChannel {
    identity: object;
    id: string;
    version: string;
    capability: ChannelCapability;
    signal: AbortSignal;
}
interface DeliveryHost {
    agentId: string;
    journal: Journal;
    contexts: ContextCoordinator;
    runtime: DshRuntime;
    signal: AbortSignal;
    turnTimeoutMs: number;
    deliveryTimeoutMs: number;
    assertOpen(): void;
    persona(): PersonaSnapshot;
    model(): unknown;
    provider(): TaskExpressionProvider | undefined;
    sourceTracking(): boolean;
    channel(item: PendingMessage): DeliveryChannel | null;
    enqueue<T>(route: string, work: () => Promise<T>): Promise<T>;
}
type Submit = {
    requestId: string;
    jobId: string;
    target: Conversation;
};
/** One terminal transport attempt per intent. No uncertain or unsent intent is replayed. */
export declare class TaskDelivery {
    private readonly host;
    private readonly store;
    private readonly active;
    private unregister;
    constructor(file: string, host: DeliveryHost, deferRecovery?: boolean);
    recover(): void;
    private context;
    status(taskId: string, id: string): {
        deliveryId: string;
        jobId: string;
        status: "rejected" | "interrupted" | "ready" | "sending" | "uncertain" | "sent" | "not-sent" | "rendering";
        receiptId: string | null;
        simulationOnly: boolean;
    };
    submit(taskId: string, input: Submit, signal: AbortSignal, authority: () => void): Promise<{
        deliveryId: string;
        jobId: string;
        status: "rejected" | "interrupted" | "ready" | "sending" | "uncertain" | "sent" | "not-sent" | "rendering";
        receiptId: string | null;
        simulationOnly: boolean;
    }>;
    private execute;
    close(): void;
}
export {};
