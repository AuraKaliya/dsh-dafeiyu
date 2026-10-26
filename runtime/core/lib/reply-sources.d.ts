import type { Context } from '@deepseek-ai/cordis';
import type { PendingMessage, SourceRef, SourceDependency } from '#dafeiyu/contracts';
import type { ContextCoordinator } from './context.js';
import type { CompactionBinding } from './compaction-runtime.js';
/** Rehydrate captured program dependencies without borrowing an expired tool invocation. */
export declare function prepareCapturedReplySources(agentId: string, item: PendingMessage, dependencies: readonly SourceDependency[], contexts: ContextCoordinator, binding: () => CompactionBinding | undefined, signal: AbortSignal): Promise<{
    guard: () => void;
    release: () => void;
}>;
/** Rebind persisted answer evidence after the model turn has released its transient grants. */
export declare function prepareReplySources(ctx: Context, agentId: string, item: PendingMessage, refs: readonly SourceRef[], contexts: ContextCoordinator, binding: () => CompactionBinding | undefined, signal: AbortSignal): Promise<{
    guard: () => void;
    release: () => void;
}>;
