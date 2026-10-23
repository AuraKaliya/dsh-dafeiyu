import type { TimelineScope } from './history.js';
import { z } from 'zod';
import type { ContextItem } from './context.js';

const scopeFields={agentId:z.string(),route:z.string()};
/** Immutable input dependencies, supplied by trusted producers rather than model citations. */
export const SourceDependencySchema=z.discriminatedUnion('kind',[
  z.strictObject({...scopeFields,kind:z.literal('memory'),id:z.string(),revision:z.number().int().positive(),version:z.number().int().positive(),hash:z.string()}),
  z.strictObject({...scopeFields,kind:z.literal('inbound'),id:z.string(),hash:z.string(),fence:z.string()}),
  z.strictObject({...scopeFields,kind:z.literal('timeline'),ref:z.string(),hash:z.string(),fence:z.string()}),
  z.strictObject({...scopeFields,kind:z.literal('working'),id:z.string(),taskId:z.string(),revision:z.number().int().positive(),hash:z.string()}),
  z.strictObject({...scopeFields,kind:z.literal('feedback'),id:z.string(),version:z.number().int().positive(),hash:z.string()}),
  z.strictObject({...scopeFields,kind:z.literal('context'),owner:z.string(),region:z.string(),id:z.string(),version:z.string(),hash:z.string()}),
  z.strictObject({...scopeFields,kind:z.literal('legacy'),epoch:z.string()}),
  z.strictObject({...scopeFields,kind:z.literal('ephemeral'),traceId:z.string()}),
  z.strictObject({...scopeFields,kind:z.literal('unavailable'),reason:z.string()}),
]);
export type SourceDependency=z.infer<typeof SourceDependencySchema>;
export interface SourcePolicy {
  inbound(scope:CompactionScope,messageId:string):readonly SourceDependency[];
  context(scope:CompactionScope,region:string,item:ContextItem):readonly SourceDependency[];
  tool(scope:CompactionScope,name:string,text:string,meta:unknown):readonly SourceDependency[];
  validate(scope:CompactionScope,dependency:SourceDependency):boolean;
}

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
  readonly sources?:SourcePolicy;
  summarize(scope: CompactionScope, sources: readonly CompactionSource[], signal: AbortSignal,checkSources?:()=>void): Promise<string>;
}
