import type { Context } from '@deepseek-ai/cordis';
import type { SourceDependency, SourcePolicy, CompactionScope, ContextItem } from '#dafeiyu/contracts';
import type { MemoryStore } from './store.js';
import type { WorkingMemory } from './working.js';
import type { ToolFeedbackArchive } from './feedback.js';
/** Checks authoritative stores, never a model-authored citation or an index's cached state. */
export declare class MemorySourcePolicy implements SourcePolicy {
    private readonly ctx;
    private readonly memory;
    private readonly working;
    private readonly feedback;
    private readonly epoch;
    constructor(ctx: Context, memory: MemoryStore, working: WorkingMemory | null, feedback: ToolFeedbackArchive | null, epoch: (scope: CompactionScope) => string);
    private missing;
    private match;
    private inboundMatch;
    private message;
    inbound(scope: CompactionScope, id: string): SourceDependency[];
    private timeline;
    private roots;
    context(scope: CompactionScope, region: string, item: ContextItem): SourceDependency[];
    tool(scope: CompactionScope, name: string, text: string, meta: unknown): SourceDependency[];
    validate(scope: CompactionScope, dep: SourceDependency): boolean;
}
