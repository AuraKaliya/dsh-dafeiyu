import { Context } from '@deepseek-ai/cordis';
import type { AnalysisJob, AnalysisResult, ModelRoute } from './analysis-types.js';
/** A separate DSH composition: no inherited persona, tools, prompt sections or chat sessions. */
export declare class AnalysisRuntime {
    private readonly host;
    private readonly directory;
    private readonly maxOutputBytes?;
    private isolated;
    constructor(host: Context, directory: string, maxOutputBytes?: number | undefined);
    private context;
    run(job: AnalysisJob, signal: AbortSignal): Promise<AnalysisResult>;
    structured<T>(job: {
        id: string;
        model: ModelRoute;
        instructions: string;
        input: unknown;
        parse: (value: unknown) => T;
    }, signal: AbortSignal): Promise<T>;
    close(): Promise<void>;
}
