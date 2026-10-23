import type { TimelineScope } from './history.js';

/** Trusted extension seam. Routes are supplied by the core, never by model arguments. */
export interface CompactionScope extends TimelineScope { readonly traceId: string }
export interface CompactionBasis {
  /** Monotonic scope state fingerprint; restoring data must produce a new fingerprint. */
  readonly epoch: string;
  readonly taskId: string | null;
  readonly versions: Readonly<Record<string, number>>;
}
export interface CompactionPolicy {
  readonly inputTokens: number;
  readonly thresholdRatio: number;
  readonly targetRatio: number;
  readonly minGrowthTokens: number;
  readonly minSavingsTokens: number;
  readonly cooldownMs: number;
  readonly retainTurns: number;
  readonly maxSourceBytes: number;
  readonly maxSummaryChars: number;
}
export interface CompactionSource { readonly seq: number; readonly role: 'user' | 'assistant'; readonly text: string; readonly hash: string }
export interface CompactionProvider {
  readonly policy: CompactionPolicy;
  basis(scope: CompactionScope): CompactionBasis;
  summarize(scope: CompactionScope, sources: readonly CompactionSource[], signal: AbortSignal): Promise<string>;
}
