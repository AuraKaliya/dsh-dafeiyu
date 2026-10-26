import type { ExecutorCall, ExecutorPermit, ExecutorSettlement, ExecutorRoute } from './protocol.js';
export interface ExecutionBudgetRequest extends ExecutorCall {
    readonly authorizationId: string;
    readonly jobId: string;
    readonly deadline: number;
}
/** The injected parent owns prices, total balance, lease and original clock. This module owns none of them. */
export interface ExecutionBudgetPort {
    reserve(input: ExecutionBudgetRequest, signal: AbortSignal): Promise<ExecutorPermit>;
    settle(input: ExecutorSettlement & {
        readonly authorizationId: string;
        readonly jobId: string;
    }, signal: AbortSignal): Promise<{
        unknown: boolean;
    }>;
}
export interface ExecutorBudgetRecord {
    readonly call: ExecutorCall;
    readonly permit: ExecutorPermit;
    state: 'reserved' | 'settled' | 'unknown';
    settlement: ExecutorSettlement | null;
    accountingError: string | null;
}
export declare class ExecutorBudgetBroker {
    private readonly port;
    private readonly route;
    private readonly guard;
    private readonly authorizationId;
    private readonly jobId;
    private readonly deadline;
    private readonly lifetime;
    private readonly records;
    private readonly seen;
    private readonly pending;
    private readonly settlements;
    private busy;
    private closing;
    constructor(options: {
        port: ExecutionBudgetPort;
        route: ExecutorRoute;
        guard: () => void;
        authorizationId: string;
        jobId: string;
        deadline: number;
    });
    private track;
    reserve(raw: ExecutorCall): Promise<ExecutorPermit>;
    private admit;
    settle(raw: ExecutorSettlement): Promise<{
        unknown: boolean;
    }>;
    private complete;
    snapshot(): readonly ExecutorBudgetRecord[];
    get idle(): boolean;
    close(code?: string): Promise<void>;
}
