/** One actual call at a time. A job/Run never owns this queue across tool execution. */
export declare class ModelCallGate {
    private readonly queue;
    private readonly idleWaiters;
    private busy;
    private closed;
    acquire(signal: AbortSignal, deadline: number): Promise<() => void>;
    private pump;
    close(code?: string): void;
    get idle(): boolean;
    get pending(): number;
    get stopped(): string | null;
    whenIdle(timeoutMs: number): Promise<void>;
}
