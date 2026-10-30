import { z } from 'zod';

/**
 * Per-request budget for a long reading task. The program decides before the
 * next model call; it never asks the model whether it is running out of room.
 */
export const SegmentBudgetSchema = z.strictObject({
    softTokens: z.number().int().min(1000).max(200000).default(24000),
    hardTokens: z.number().int().min(1000).max(400000).default(32000),
    reserveTokens: z.number().int().min(0).max(64000).default(4000),
}).refine(value => value.softTokens < value.hardTokens, 'softTokens must be below hardTokens');
export type SegmentBudget = z.infer<typeof SegmentBudgetSchema>;

export interface SegmentBudgetInput {
    /** Estimated input tokens of the next request, including tool definitions. */
    readonly inputTokens: number;
    /** Tokens reserved for the response; subtracted from the hard limit. */
    readonly outputReserveTokens: number;
    /** A smaller model window lowers both limits. */
    readonly modelWindowTokens?: number | undefined;
    readonly budget?: Partial<SegmentBudget> | undefined;
}

export type SegmentBudgetDecision = 'send' | 'compact-then-send' | 'yield' | 'block';

export interface SegmentBudgetResult {
    readonly decision: SegmentBudgetDecision;
    readonly hardTokens: number;
    readonly softTokens: number;
    readonly reason: 'within-soft' | 'above-soft' | 'at-hard' | 'output-reserve-exceeds-window';
}

/** Deterministic decision; the caller owns compaction and segment switching. */
export function segmentBudgetDecision(input: SegmentBudgetInput): SegmentBudgetResult {
    const budget = SegmentBudgetSchema.parse(input.budget ?? {});
    const window = input.modelWindowTokens;
    const hardTokens = Math.min(budget.hardTokens, window === undefined ? budget.hardTokens : Math.max(0, window - input.outputReserveTokens));
    const softTokens = Math.min(budget.softTokens, hardTokens);
    if (input.outputReserveTokens > 0 && hardTokens <= 0) return { decision: 'block', hardTokens, softTokens, reason: 'output-reserve-exceeds-window' };
    if (input.inputTokens >= hardTokens) return { decision: 'yield', hardTokens, softTokens, reason: 'at-hard' };
    if (input.inputTokens >= softTokens) return { decision: 'compact-then-send', hardTokens, softTokens, reason: 'above-soft' };
    return { decision: 'send', hardTokens, softTokens, reason: 'within-soft' };
}

/** Conservative bytes-per-token used only to compare measured request bytes with a token budget. */
export const BYTES_PER_TOKEN = 4;
export function bytesOverBudget(bytes: number, hardTokens: number) {
    return bytes > hardTokens * BYTES_PER_TOKEN;
}

/** Enforce the limit before the request is sent; the caller turns the throw into a segment yield. */
export function assertSegmentBudget(bytes: number, hardTokens: number) {
    if (bytesOverBudget(bytes, hardTokens)) throw new Error('SEGMENT_YIELD');
}