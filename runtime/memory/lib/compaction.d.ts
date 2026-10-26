import type { Context } from '@deepseek-ai/cordis';
import type { CompactionProvider, CompactionScope, CompactionSource, SourcePolicy } from '#dafeiyu/contracts';
import { z } from 'zod';
import type { SemanticRequest } from '#dafeiyu/contracts';
/** inputTokens is the usable input budget AFTER reserving completion space for this route. */
export declare const compactionConfigSchema: z.ZodPipe<z.ZodObject<{
    inputTokens: z.ZodNumber;
    thresholdRatio: z.ZodDefault<z.ZodNumber>;
    targetRatio: z.ZodDefault<z.ZodNumber>;
    minGrowthTokens: z.ZodDefault<z.ZodNumber>;
    minSavingsTokens: z.ZodDefault<z.ZodNumber>;
    cooldownMs: z.ZodDefault<z.ZodNumber>;
    retainTurns: z.ZodDefault<z.ZodNumber>;
    maxSourceBytes: z.ZodDefault<z.ZodNumber>;
    maxSummaryChars: z.ZodDefault<z.ZodNumber>;
    summaryMaxOutputTokens: z.ZodDefault<z.ZodNumber>;
    maxFragmentGroups: z.ZodDefault<z.ZodNumber>;
    maxFragments: z.ZodDefault<z.ZodNumber>;
    initialMaxGroups: z.ZodOptional<z.ZodNumber>;
    initialMaxFragments: z.ZodOptional<z.ZodNumber>;
    semanticEnabled: z.ZodDefault<z.ZodBoolean>;
    semanticMaxConsecutive: z.ZodDefault<z.ZodNumber>;
    semanticMaxOutputTokens: z.ZodDefault<z.ZodNumber>;
    timeoutMs: z.ZodDefault<z.ZodNumber>;
}, z.core.$strict>, z.ZodTransform<{
    initialMaxGroups: number;
    initialMaxFragments: number;
    inputTokens: number;
    thresholdRatio: number;
    targetRatio: number;
    minGrowthTokens: number;
    minSavingsTokens: number;
    cooldownMs: number;
    retainTurns: number;
    maxSourceBytes: number;
    maxSummaryChars: number;
    summaryMaxOutputTokens: number;
    maxFragmentGroups: number;
    maxFragments: number;
    semanticEnabled: boolean;
    semanticMaxConsecutive: number;
    semanticMaxOutputTokens: number;
    timeoutMs: number;
}, {
    inputTokens: number;
    thresholdRatio: number;
    targetRatio: number;
    minGrowthTokens: number;
    minSavingsTokens: number;
    cooldownMs: number;
    retainTurns: number;
    maxSourceBytes: number;
    maxSummaryChars: number;
    summaryMaxOutputTokens: number;
    maxFragmentGroups: number;
    maxFragments: number;
    semanticEnabled: boolean;
    semanticMaxConsecutive: number;
    semanticMaxOutputTokens: number;
    timeoutMs: number;
    initialMaxGroups?: number | undefined;
    initialMaxFragments?: number | undefined;
}>>;
/** A purpose-specific, tool-free auxiliary call through DSH's LLM seam, like its compactor.
 * It uses a fresh non-chat request identity. No bypass of the main session's context guards. */
export declare class MemoryCompaction implements CompactionProvider {
    private readonly ctx;
    readonly basis: CompactionProvider['basis'];
    readonly sources: SourcePolicy;
    readonly policy: z.output<typeof compactionConfigSchema> & {
        enabled?: boolean;
    };
    constructor(ctx: Context, config: z.input<typeof compactionConfigSchema>, basis: CompactionProvider['basis'], sources: SourcePolicy, trackingOnly?: boolean);
    summarize(scope: CompactionScope, sources: readonly CompactionSource[], signal: AbortSignal, checkSources?: () => void): Promise<string>;
    summarizeFragments(scope: CompactionScope, sources: readonly CompactionSource[], signal: AbortSignal, checkSources: () => void, maxChars: number, maxFragments?: number, targetChars?: number): Promise<{
        text: string;
        kind: "decision" | "result" | "fact" | "constraint" | "correction" | "pending" | "uncertainty" | "note";
    }[]>;
    rewrite(_scope: CompactionScope, request: SemanticRequest, signal: AbortSignal, checkSources: () => void): Promise<{
        fragment: {
            kind: "decision" | "result" | "fact" | "constraint" | "correction" | "pending" | "uncertainty" | "note";
            text: string;
        };
        qualifiers: {
            seq: number;
            role: "user" | "assistant";
            start: number;
            end: number;
            text: string;
        }[];
        verification: {
            compatible: true;
            faithful: true;
            issues: string[];
        };
        model: {
            provider: string;
            model: string;
            reasoningEffort?: string | undefined;
        };
    }>;
    private generate;
}
