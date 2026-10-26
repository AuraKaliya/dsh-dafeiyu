import type { Context } from '@deepseek-ai/cordis';
import type { OperationScope } from '#dafeiyu/contracts';
import { MemoryStore } from './store.js';
import type { AnalysisSource } from './analysis-types.js';
export declare class AnalysisSources {
    private readonly ctx;
    private readonly store;
    constructor(ctx: Context, store: MemoryStore);
    private scope;
    read(grantId: string, ref: string, sourceId: string, signal: AbortSignal): Promise<AnalysisSource>;
    validate(grantId: string, sources: readonly AnalysisSource[], signal: AbortSignal): Promise<OperationScope>;
}
