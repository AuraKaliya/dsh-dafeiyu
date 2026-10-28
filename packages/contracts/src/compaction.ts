import type { TimelineScope } from './history.js';
import { z } from 'zod';
import type { ContextItem } from './context.js';
import type { SemanticRequest,SemanticResult } from './semantic.js';
import { PersonaSourceRefSchema } from './persona.js';

const scopeFields={agentId:z.string(),route:z.string()};
/** Immutable input dependencies, supplied by trusted producers rather than model citations. */
export const SourceDependencySchema=z.discriminatedUnion('kind',[
  z.strictObject({...scopeFields,kind:z.literal('capability'),ref:PersonaSourceRefSchema}),
  z.strictObject({...scopeFields,kind:z.literal('execution-source'),ref:PersonaSourceRefSchema}),
  z.strictObject({...scopeFields,kind:z.literal('execution-input'),runId:z.uuid(),hash:z.string().regex(/^[a-f0-9]{64}$/)}),
  z.strictObject({...scopeFields,kind:z.literal('execution-operation'),runId:z.uuid(),operationId:z.uuid(),hash:z.string().regex(/^[a-f0-9]{64}$/),inputHash:z.string().regex(/^[a-f0-9]{64}$/)}),
  z.strictObject({...scopeFields,kind:z.literal('memory'),id:z.string(),revision:z.number().int().positive(),version:z.number().int().positive(),hash:z.string()}),
  z.strictObject({...scopeFields,kind:z.literal('inbound'),id:z.string(),hash:z.string(),fence:z.string()}),
  z.strictObject({...scopeFields,kind:z.literal('timeline'),ref:z.string(),hash:z.string(),fence:z.string()}),
  z.strictObject({...scopeFields,kind:z.literal('working'),id:z.string(),taskId:z.string(),revision:z.number().int().positive(),hash:z.string()}),
  z.strictObject({...scopeFields,kind:z.literal('context'),owner:z.string(),region:z.string(),id:z.string(),version:z.string(),hash:z.string()}),
  z.strictObject({...scopeFields,kind:z.literal('ephemeral'),traceId:z.string()}),
  z.strictObject({...scopeFields,kind:z.literal('unavailable'),reason:z.string()}),
]);
export type SourceDependency=z.infer<typeof SourceDependencySchema>;
export interface SourcePolicy {
  inbound(scope:CompactionScope,messageId:string):readonly SourceDependency[];
  context(scope:CompactionScope,region:string,item:ContextItem):readonly SourceDependency[];
  tool(scope:CompactionScope,name:string,text:string,meta:unknown):readonly SourceDependency[];
  validate(scope:CompactionScope,dependency:SourceDependency):boolean;
  /** One synchronous traversal; results stay aligned with the supplied dependencies. */
  validateMany?(scope:CompactionScope,dependencies:readonly SourceDependency[]):readonly boolean[];
}

/** Trusted extension seam. Routes are supplied by the core, never by model arguments. */
export interface CompactionScope extends TimelineScope { readonly traceId: string }
export interface CompactionBasis {
  /** Monotonic scope state fingerprint; restoring data must produce a new fingerprint. */
  readonly epoch: string;
  readonly taskId: string | null;
  /** Native tasks keep their current input outside compression while completed earlier Runs may compact. */
  readonly protectedRunId?:string;
  readonly versions: Readonly<Record<string, number>>;
}
export interface CompactionPolicy {
  readonly enabled?:boolean;
  readonly inputTokens: number;
  readonly thresholdRatio: number;
  readonly targetRatio: number;
  readonly minGrowthTokens: number;
  readonly minSavingsTokens: number;
  readonly cooldownMs: number;
  readonly retainTurns: number;
  readonly maxSourceBytes: number;
  readonly maxSummaryChars: number;
  readonly maxFragmentGroups?:number;
  readonly maxFragments?:number;
  /** Initial work batches may be smaller than the total active composition capacity. */
  readonly initialMaxGroups?:number;
  readonly initialMaxFragments?:number;
  readonly semanticEnabled?:boolean;
  readonly semanticMaxConsecutive?:number;
  readonly semanticMaxOutputTokens?:number;
}
export const SummaryFragmentSchema=z.strictObject({kind:z.enum(['fact','decision','constraint','correction','pending','uncertainty','result','note']),text:z.string().trim().min(1).max(8000)});
export type SummaryFragment=z.infer<typeof SummaryFragmentSchema>;
export interface CompactionSource { readonly seq: number; readonly role: 'user' | 'assistant'; readonly text: string; readonly hash: string }
export interface CompactionProvider {
  readonly policy: CompactionPolicy;
  basis(scope: CompactionScope): CompactionBasis;
  readonly sources:SourcePolicy;
  summarizeFragments(scope:CompactionScope,sources:readonly CompactionSource[],signal:AbortSignal,checkSources:()=>void,maxChars:number,maxFragments?:number,targetChars?:number):Promise<readonly SummaryFragment[]>;
  rewrite?(scope:CompactionScope,request:SemanticRequest,signal:AbortSignal,checkSources:()=>void):Promise<SemanticResult>;
}
