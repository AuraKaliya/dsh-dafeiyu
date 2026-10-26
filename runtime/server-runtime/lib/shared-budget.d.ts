import type { ExecutorPermit } from '#dafeiyu/server-executor/protocol';
import type { ExecutionBudgetPort } from '#dafeiyu/server-executor/budget';
import type { ModelBudgetAuthority, ModelBudgetRequest, ModelBudgetSettlement, RuntimeCallRecord } from './types.js';
/** Shared parent/child admission, never a second balance, authorization, lease or execution clock. */
export declare class SharedModelBudget {
    readonly authorizationId: string;
    readonly route: Readonly<ModelBudgetAuthority['route']>;
    private readonly authority;
    private readonly gate;
    private readonly dispatch;
    private readonly seen;
    private readonly reservations;
    private readonly calls;
    private readonly cancellations;
    private interrupted;
    constructor(authority: ModelBudgetAuthority);
    assertReady(): void;
    remainingMs(): number;
    onInterrupt(listener: (code: string) => void): () => void;
    quiesce(code?: string): void;
    cancel(code?: string): void;
    get status(): {
        pending: number;
        stopped: string | null;
        interrupted: string | null;
    };
    snapshot(): readonly RuntimeCallRecord[];
    whenIdle(timeoutMs?: number): Promise<void>;
    reserve(raw: ModelBudgetRequest, signal: AbortSignal): Promise<ExecutorPermit>;
    /** Scope only the actual iterator step, so a later tool round may obtain its own permit. */
    dispatchStep<T>(callId: string, operation: () => T): T;
    settle(raw: ModelBudgetSettlement): Promise<{
        unknown: boolean;
    }>;
    private complete;
    /** Called only by ServerExecutorService's job-bound, live-grant port; IPC is not an authorization source. */
    executorPort(): ExecutionBudgetPort;
}
