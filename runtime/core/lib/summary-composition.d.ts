import type { Context } from '@deepseek-ai/cordis';
import type { Session } from '@deepseek-ai/dsh-session';
import type { SourceDependency, TimelineScope } from '#dafeiyu/contracts';
import type { FragmentManifest, ResolvedFragmentView } from './summary-fragments.js';
type Validate = (dependencies: readonly SourceDependency[]) => boolean;
export interface CompositionOptions {
    owner: string;
    version: string;
    protectedTaskId: string | null;
    maxFragments: number;
    maxGroups: number;
    maxBytes: number;
}
export interface CompositionPlan {
    scope: TimelineScope;
    options: CompositionOptions;
    manifest: FragmentManifest;
    parents: ResolvedFragmentView[];
    surfaceGeneration: number;
}
/** Prepare without side effects. Selection, source validity and proof validity are distinct. */
export declare function prepareSummaryComposition(session: Session, scope: TimelineScope, refs: readonly string[], options: CompositionOptions, validate: Validate): CompositionPlan | null;
/** One DSH surface replacement is the commit point. A manifest/view/prune without that
 * message is an orphan, so restart retains the parents. No multi-node dual write exists.
 * Caller must flush successfully before dispatching any model request. */
export declare function commitSummaryComposition(ctx: Context, session: Session, plan: CompositionPlan, validate: Validate): ResolvedFragmentView;
/** Foreign/native nodes and ordinary conversation are barriers, including empty views. */
export declare function summaryCompositionRuns(session: Session, scope: TimelineScope): string[][];
export {};
