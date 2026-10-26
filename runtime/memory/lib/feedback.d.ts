import { z } from 'zod';
import type { Context } from '@deepseek-ai/cordis';
import type { ActionContext, FeedbackDelivery, FeedbackRequest, FeedbackWitness, FeedbackProvider, ToolFeedback, Json, OperationScope } from '#dafeiyu/contracts';
import type { FeedbackHeaderRecord } from './feedback-store.js';
import type { Evidence } from './types.js';
import { MemoryStore } from './store.js';
export declare const feedbackConfigSchema: z.ZodObject<{
    maxArchiveBytes: z.ZodDefault<z.ZodNumber>;
    maxBriefBytes: z.ZodDefault<z.ZodNumber>;
    maxPageChars: z.ZodDefault<z.ZodNumber>;
}, z.core.$strict>;
type Scope = Pick<OperationScope, 'agentId' | 'route' | 'traceId'>;
export declare function unknownFeedback(code: string): ToolFeedback;
/** Opt-in, deterministic presentation. No model summarizer and no tool replay. */
export declare class ToolFeedbackArchive implements FeedbackProvider {
    private readonly ctx;
    private readonly memories;
    private readonly evidence;
    private readonly strictSources;
    private readonly store;
    private readonly config;
    constructor(ctx: Context, memories: MemoryStore, directory: string, config: z.input<typeof feedbackConfigSchema>, evidence: (context: ActionContext, refs: readonly string[]) => Promise<Evidence[]>, strictSources?: boolean);
    private scope;
    mutationEpoch(scope: Scope): number;
    sourceRecord(scope: Scope, id: string): FeedbackHeaderRecord | null;
    private match;
    private id;
    private state;
    private admitted;
    validate(scope: Scope, witness: FeedbackWitness): boolean;
    private witness;
    private brief;
    capture(request: FeedbackRequest, raw: Json): Promise<FeedbackDelivery>;
    open(context: ActionContext, raw: unknown, deleted?: boolean): Json;
    present(context: ActionContext, raw: Json): FeedbackDelivery;
    list(context: ActionContext, raw: unknown): Json;
    change(context: ActionContext, raw: unknown, deleted: boolean): Json;
    private flush;
    close(): void;
}
export {};
