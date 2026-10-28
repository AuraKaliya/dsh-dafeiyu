import type { Context } from '@deepseek-ai/cordis';
import type { ContextContributor, ContextItem, ContextRequest, OperationScope, ExecutionView } from '#dafeiyu/contracts';
import type { MemoryStore } from './store.js';
import type { MemoryRetrieval } from './retrieval.js';
type RecallStatus = {
    mode: 'lexical' | 'hybrid';
    degraded: boolean;
    partial: boolean;
    candidates: number;
    selected: number;
    queryHash: string;
};
/** A bounded, read-only view. Recall never writes selected evidence, memory or personality. */
export declare class AutomaticRecall {
    private readonly ctx;
    private readonly memory;
    private readonly retrieval;
    private readonly cache;
    private readonly prepared;
    private readonly validations;
    constructor(ctx: Context, memory: MemoryStore, retrieval: MemoryRetrieval | null);
    private current;
    prepare(request: ContextRequest): Promise<ContextItem[]>;
    private build;
    validate(request: ContextRequest, item: ContextItem): boolean;
    prepareNative(view: ExecutionView): Promise<ContextItem[]>;
    validateNative(view: ExecutionView, item: ContextItem): boolean;
    contributor(): ContextContributor;
    status(scope: Pick<OperationScope, 'route'>): RecallStatus | null;
}
export {};
