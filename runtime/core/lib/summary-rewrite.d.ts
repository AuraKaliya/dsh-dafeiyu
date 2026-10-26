import type { Context } from '@deepseek-ai/cordis';
import type { Session } from '@deepseek-ai/dsh-session';
import type { CompactionProvider, CompactionScope, SemanticRequest, SourceDependency, SemanticResult } from '#dafeiyu/contracts';
import type { FragmentManifest, ResolvedFragmentView, SummaryRewrite } from './summary-fragments.js';
type Validate = (deps: readonly SourceDependency[]) => boolean;
export interface RewriteOptions {
    owner: string;
    version: string;
    protectedTaskId: string | null;
    maxChars: number;
    maxBytes: number;
    maxConsecutive: number;
}
export interface RewritePlan {
    scope: CompactionScope;
    ref: string;
    parent: ResolvedFragmentView;
    group: string;
    mode: 'fusion' | 'rebuild';
    options: RewriteOptions;
    inputs: SummaryRewrite['inputs'];
    request: SemanticRequest;
    dependencies: SourceDependency[];
    surfaceGeneration: number;
}
/** Planning filters original records without exposing retired summary prose to a model. */
export declare function prepareSummaryRewrite(session: Session, scope: CompactionScope, ref: string, groupId: string, mode: 'fusion' | 'rebuild', options: RewriteOptions, validate: Validate): RewritePlan | null;
export declare function assertRewriteCurrent(session: Session, plan: RewritePlan, validate: Validate): void;
export declare function buildRewriteManifest(session: Session, plan: RewritePlan, value: unknown): FragmentManifest;
/** Separate generation from commit so the runtime can enforce its measured benefit gate. */
export declare function generateSummaryRewrite(session: Session, plan: RewritePlan, provider: CompactionProvider, signal: AbortSignal, validate: Validate): Promise<SemanticResult>;
export declare function commitSummaryRewrite(ctx: Context, session: Session, plan: RewritePlan, result: SemanticResult, validate: Validate): ResolvedFragmentView;
export {};
