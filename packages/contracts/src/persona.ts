import { z } from 'zod';
import { ActionOutcomeSchema, ExecutionScopeSchema } from './execution.js';
import type { ExecutionView } from './execution.js';
import type { ExecutionInput } from './execution-ports.js';
import type { ContextItem } from './context.js';
import type { SourceDependency } from './compaction.js';
import { TaskMemoryAuthorizationSchema } from './task-memory.js';

const hash=z.string().regex(/^[a-f0-9]{64}$/),id=z.uuid(),version=z.number().int().positive();
export const PersonaRequestIdSchema=z.string().regex(/^[a-zA-Z0-9._:-]{1,120}$/);
const source={id,agentId:z.string().min(1).max(100),scopeKey:z.string().min(1).max(2000),version,contentHash:hash};
export const PersonaSourceRefSchema=z.discriminatedUnion('kind',[
  z.strictObject({...source,kind:z.literal('memory'),collection:z.literal('autobiography').optional(),revision:version,authorization:TaskMemoryAuthorizationSchema.optional(),selectionId:id.optional(),
    range:z.strictObject({start:z.number().int().nonnegative(),end:z.number().int().positive()}).optional()}),
  z.strictObject({...source,kind:z.literal('execution-source')}),
]);
export type PersonaSourceRef=z.infer<typeof PersonaSourceRefSchema>;
/** Assigned by a trusted source producer/resolver, never inferred from a model's reason text. */
export const PersonaSourceNatureSchema=z.enum(['observed','synthetic','hypothetical','self-report','derived','unknown']);
export type PersonaSourceNature=z.infer<typeof PersonaSourceNatureSchema>;
export const PersonaSourceEvidenceSchema=z.strictObject({source:PersonaSourceRefSchema,nature:PersonaSourceNatureSchema,
  coverage:z.array(z.string().min(1).max(300)).max(32),completeness:z.enum(['complete','partial','unknown']),
  roots:z.array(z.strictObject({key:z.string().min(1).max(2200),nature:PersonaSourceNatureSchema})).max(64)})
  .refine(value=>new Set(value.roots.map(root=>root.key)).size===value.roots.length,'Duplicate source root');
export type PersonaSourceEvidence=z.infer<typeof PersonaSourceEvidenceSchema>;
export const MotivationSchema=z.strictObject({kind:z.enum(['explicit-task','self-exploration','conversation-invitation','maintenance','mixed','unknown']),
  basis:z.array(z.string().min(1).max(300)).max(16).default([])});
export type Motivation=z.infer<typeof MotivationSchema>;
export const PersonaKindSchema=z.enum(['interest','preference','view','habit','relationship','value-application']);
export const ExperienceBasisSchema=z.strictObject({id,sourceId:id,taskEpoch:version});
export const PersonaEntryRefSchema=z.strictObject({id,version});
export type PersonaEntryRef=z.infer<typeof PersonaEntryRefSchema>;
export const PersonaManifestSchema=z.strictObject({schemaVersion:z.literal(1),agentId:z.string(),runId:id,
  foundationHash:hash,foundationIdentity:hash,stageRevision:z.number().int().nonnegative(),selectionVersion:z.number().int().nonnegative(),
  stageStatus:z.enum(['empty','selected']),omittedCandidates:z.number().int().nonnegative().default(0),
  entries:z.array(z.strictObject({memory:PersonaEntryRefSchema,contentRef:PersonaSourceRefSchema,dependencies:z.array(PersonaSourceRefSchema).max(64)})).max(64),
  continuityCheckpointId:id.nullable(),policyVersion:hash,modelRouteHash:hash});
export type PersonaManifest=z.infer<typeof PersonaManifestSchema>;
export const ContinuityCheckpointSchema=z.strictObject({schemaVersion:z.literal(1),id,agentId:z.string().min(1).max(100),runId:id,taskId:id,taskEpoch:version,
  scope:ExecutionScopeSchema,foundationHash:hash,stageRevision:z.number().int().nonnegative(),sessionId:z.string().min(1).max(300),throughSeq:z.number().int().nonnegative(),
  dependencies:z.array(PersonaSourceRefSchema).max(64),completedOperations:z.array(id).max(1000),unknownOperations:z.array(id).max(1000),
  historyHash:hash.optional(),intentEvents:z.array(id).max(1000).optional(),
  summary:z.string().max(8000),gaps:z.array(z.string().min(1).max(1000)).max(32),createdAt:z.iso.datetime()})
  .refine(value=>value.scope.kind==='task'&&value.scope.agentId===value.agentId&&value.scope.taskId===value.taskId,'Checkpoint scope mismatch');
export type ContinuityCheckpoint=z.infer<typeof ContinuityCheckpointSchema>;
export const TaskIntentEventSchema=z.strictObject({schemaVersion:z.literal(1),id,agentId:z.string().min(1).max(100),taskId:id,taskEpoch:version,runId:id,
  requestId:PersonaRequestIdSchema,producer:z.string().min(1).max(100),kind:z.enum(['accepted','objection','resolved']),motivation:MotivationSchema,
  category:z.enum(['preference','method','premise','missing-information','scope','none']),blocking:z.boolean(),reason:z.string().min(1).max(1000),
  actions:z.array(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)).max(32).optional(),
  historyHash:hash.optional(),
  evidence:z.array(PersonaSourceRefSchema).max(32),resolves:id.nullable(),createdAt:z.iso.datetime()});
export type TaskIntentEvent=z.infer<typeof TaskIntentEventSchema>;

/** Native service access is issued by core; serializing this value conveys no authority. */
export interface PersonaAccess {
  readonly view:ExecutionView;readonly producer:string;readonly operationId:string;readonly startedEventId:string|null;
  readonly intentVersion:number;readonly motivation:Motivation;readonly inputs:readonly ExecutionInput[];
  readonly admittedSources:readonly PersonaSourceRef[];readonly guard:()=>void;readonly commitGuard?:()=>void;
  readonly sourceRules?:readonly string[];
  readonly historyDependencies?:readonly SourceDependency[];
  readonly historyTracked?:boolean;
  readonly validateHistory?:(dependencies:readonly SourceDependency[])=>boolean;
  readonly operationFinished?:(id:string)=>boolean;
  readonly verifyMemorySource?:(ref:PersonaSourceRef)=>{text:string;rootSources:readonly string[]}|null;
  readonly resourceAllowed?:(scene:import('./conversation.js').Conversation)=>boolean;
}
export interface PreparedPersonaEntry {
  readonly memory:PersonaEntryRef;readonly contentRef:PersonaSourceRef;readonly dependencies:readonly PersonaSourceRef[];readonly item:ContextItem;
}
export interface PreparedPersona {readonly stageRevision:number;readonly selectionVersion:number;readonly entries:readonly PreparedPersonaEntry[];readonly omitted:number}
/** Personality is a projection of retained memory, with no independent mutable persona store. */
export interface MemoryGrowthProvider {
  ready():boolean;
  expressionPreferences?(conversation:import('./conversation.js').Conversation,query?:string):readonly ContextItem[];
  prepare(access:PersonaAccess):PreparedPersona;
  validate(access:PersonaAccess,entry:PreparedPersonaEntry):boolean;
  read(access:PersonaAccess,ref:PersonaSourceRef):PreparedPersonaEntry|null;
  validateHistorical(access:PersonaAccess,dependency:Extract<SourceDependency,{kind:'context'}>):boolean;
}
