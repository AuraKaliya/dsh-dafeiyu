import { Service } from '@deepseek-ai/cordis';
import type { Context } from '@deepseek-ai/cordis';
import { z } from 'zod';
import type { ActionOutcome, Conversation, ExecutionContextV3, ExecutionScope, ResourceProof, ResourceTargetView } from '#dafeiyu/contracts';
import { ServerExecutorConfigSchema } from './config.js';
import type { ServerExecutorConfig } from './config.js';
import { ExecutorStore } from './store.js';
import type { ExecutionBudgetPort } from './budget.js';
import { runExecutorNode } from './runner.js';
import type { ExecutorNodeCommand, ExecutorProcessControl } from './runner.js';
export declare const SERVER_EXECUTOR_ACTIONS: readonly ["dafeiyu_server_execute_owner", "dafeiyu_server_execute_autonomous", "dafeiyu_server_execution_status", "dafeiyu_server_execution_result"];
export interface ExecutorProfilePermission {
    readonly allowedTools: readonly string[];
    guard(): void;
}
/** These ports are supplied by the Host, never parsed from model or plugin settings. Test replacements require the offline Host profile. */
export interface ServerExecutorDependencies {
    readonly budget: ExecutionBudgetPort;
    readonly processControl: ExecutorProcessControl;
    readonly run?: typeof runExecutorNode;
    readonly clock?: () => number;
    readonly loadProfile?: (command: ExecutorNodeCommand) => Promise<ExecutorProfilePermission>;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        dafeiyuServerExecutor: ServerExecutorService;
    }
}
/** Owns the adapter and immutable receipts, not the parent ledger, platform delivery, or a second model loop. */
export declare class ServerExecutorService extends Service {
    private readonly deps;
    readonly config: z.output<typeof ServerExecutorConfigSchema>;
    readonly configHash: string;
    readonly store: ExecutorStore;
    private readonly root;
    private readonly gate;
    private readonly handle;
    private readonly now;
    private readonly run;
    private readonly pending;
    private readonly active;
    private closing;
    private closed;
    private finalCounts;
    constructor(ctx: Context, raw: ServerExecutorConfig, deps: ServerExecutorDependencies);
    private storageGuard;
    private access;
    private inputMaterials;
    private checkMaterials;
    private track;
    executeOwner(context: ExecutionContextV3, raw: unknown): Promise<ActionOutcome>;
    executeAutonomous(context: ExecutionContextV3, raw: unknown): Promise<ActionOutcome>;
    private execute;
    private budgetPort;
    private reconcileBudget;
    private terminal;
    private writeEnvelope;
    private envelope;
    private sourceCurrent;
    private page;
    private proof;
    current(proof: ResourceProof): boolean;
    targetView(proof: ResourceProof, view: string, target: Conversation, scope: ExecutionScope): ResourceTargetView | null;
    private pageOutcome;
    private jobOutcome;
    status(context: ExecutionContextV3, raw: unknown): ActionOutcome;
    result(context: ExecutionContextV3, raw: unknown): ActionOutcome;
    private actions;
    recover(): {
        state: "unknown" | "completed" | "cancelled" | "failed";
        effects: "unknown" | "none" | "confirmed";
        sessionId: string | null;
        exit: {
            code: number | null;
            signal: string | null;
            verified: boolean;
        } | null;
        output: {
            relative: string;
            hash: string;
            bytes: number;
        } | null;
        gaps: string[];
        schemaVersion: 1;
        id: string;
        jobId: string;
        createdAt: string;
        nonceHash: string | null;
        process: {
            pid: number;
            creationId: string;
            executableHash: string;
        } | null;
    }[];
    activate(): void;
    quiesce(): void;
    cancelRunning(): void;
    whenIdle(): Promise<void>;
    get lifecycleState(): import("#dafeiyu/contracts").ServicePhase;
    get health(): {
        lifecycle: import("#dafeiyu/contracts").ServicePhase;
        active: number;
        counts: Record<string, number>;
        mode: "production" | "offline";
    };
    close(): Promise<void>;
}
