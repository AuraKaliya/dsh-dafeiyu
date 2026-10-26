import type { ExecutorIpcEndpoint, ExecutorRoute, ExecutorToolRecord } from './protocol.js';
import { ExecutorBudgetBroker } from './budget.js';
import type { ExecutionBudgetPort } from './budget.js';
export interface ExecutorParentOptions {
    endpoint: ExecutorIpcEndpoint;
    port: ExecutionBudgetPort;
    jobId: string;
    nonce: string;
    profileHash: string;
    route: ExecutorRoute;
    authorizationId: string;
    deadline: number;
    guard: () => void;
    onReady?: () => Promise<void>;
    onStop?: (code: string) => void;
    handshakeTimeoutMs?: number;
    allowedTools?: readonly string[];
}
/** A live parent grant and its unique ledger stay in this process. The child only receives one-call permits. */
export declare class ExecutorParentTransport {
    readonly signal: AbortSignal;
    readonly budget: ExecutorBudgetBroker;
    private readonly abort;
    private readonly options;
    private readonly binding;
    private readonly unsubscribe;
    private readonly timer;
    private readonly monitor;
    private readonly readyPromise;
    private resolveReady;
    private rejectReady;
    private phase;
    private closing;
    private graceful;
    private readonly allowedTools;
    private readonly tools;
    constructor(options: ExecutorParentOptions);
    private send;
    private envelope;
    private receive;
    private stop;
    ready(): Promise<void>;
    get finished(): boolean;
    toolSnapshot(): readonly ExecutorToolRecord[];
    close(code?: string): Promise<void>;
}
