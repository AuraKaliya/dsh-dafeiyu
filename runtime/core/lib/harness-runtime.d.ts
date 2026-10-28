import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { DshToolsPort, Json } from '#dafeiyu/contracts';
import type { NativeAction } from './execution-frame.js';
export declare const CAPABILITY_CONTEXT = "dafeiyu:configured-capabilities:v1";
export declare const CAPABILITY_QUERY = "dafeiyu_capabilities";
export declare const CAPABILITY_OWNER = "core-capabilities";
/** Reuses DSH assembly, native schemas and its tool loop. No model or second planner here. */
export declare class HarnessRuntime {
    private readonly configured;
    private readonly sections;
    private readonly standardSections;
    constructor(configured?: () => Json);
    /** Program-only registration for trusted deployment guidance; never accepted through a tool. */
    allowSection(name: string): () => void;
    acceptsSection(name: string): boolean;
    private provider;
    bind(provider: Pick<DshToolsPort, 'catalog'>): () => void;
    install(scope: Context, agent: Agent, actions: readonly NativeAction[], signal: AbortSignal, taskId?: string): () => void;
}
