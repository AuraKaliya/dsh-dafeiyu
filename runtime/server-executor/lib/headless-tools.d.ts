import type { Context } from '@deepseek-ai/cordis';
import type { ExecutorChildBudgetClient } from './child.js';
/** Runs inside the dedicated official ToolRuntime, including nested dispatches; no parameter/result text crosses IPC. */
export declare function installHeadlessToolGuard(ctx: Context, client: ExecutorChildBudgetClient, allowedTools: readonly string[], guard: () => void): () => void;
