import type { Context } from '@deepseek-ai/cordis';
import type { GenerateOptions } from '@deepseek-ai/dsh-llm';
import type { ExecutorCall, ExecutorPermit, ExecutorSettlement, ExecutorIpcEndpoint, ExecutorRoute, ExecutorToolCall, ExecutorToolReceipt } from './protocol.js';
export declare class ExecutorChildBudgetClient {
    readonly signal: AbortSignal;
    private readonly abort;
    private readonly endpoint;
    private readonly profileHash;
    private readonly unsubscribe;
    private readonly pending;
    private binding;
    private active;
    private resolveBinding;
    private rejectBinding;
    private readonly readyPromise;
    private timer;
    constructor(endpoint: ExecutorIpcEndpoint, profileHash: string);
    private fail;
    private message;
    ready(): Promise<{
        jobId: string;
        route: ExecutorRoute;
        deadline: number;
    }>;
    private request;
    reserve(raw: ExecutorCall): Promise<ExecutorPermit>;
    settle(raw: ExecutorSettlement): Promise<{
        unknown: boolean;
    }>;
    authorizeTool(raw: ExecutorToolCall): Promise<string>;
    finishTool(raw: ExecutorToolReceipt): Promise<void>;
    finish(): Promise<void>;
    close(): void;
}
/** Mount globally in the dedicated child profile; no call count limit and no credentials in telemetry. */
export declare function installExecutorChildBilling(ctx: Context, client: ExecutorChildBudgetClient, cancelActive: () => void, admitInput?: (options: GenerateOptions) => void): () => void;
