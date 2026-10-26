import type { Context } from '@deepseek-ai/cordis';
import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent';
import type { UserMessage } from '@deepseek-ai/dsh-llm';
import type { RunResultRef } from './runtime-store.js';
/** The two execution origins share DSH ownership, flush and final-message rules. */
export declare function openAgentSession(ctx: Context, id: string, model: AgentOptions, cwd: string, setup: (scope: Context) => void): Promise<import("@deepseek-ai/dsh-agent").AgentHandle>;
export declare function runAgentTurn(ctx: Context, agent: Agent, input: UserMessage, signal: AbortSignal, afterIdle?: () => void): Promise<{
    text: string;
    events: import("@deepseek-ai/dsh-session").SessionEvent[];
    messageSeq: import("@deepseek-ai/dsh-session").SessionSeq;
    turnEndSeq: import("@deepseek-ai/dsh-session").SessionSeq;
}>;
export declare function readPersistedResult(ctx: Context, ref: RunResultRef): Promise<string>;
