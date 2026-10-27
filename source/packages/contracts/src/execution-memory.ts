import { z } from 'zod';
import { PersonaRequestIdSchema,PersonaSourceRefSchema,MotivationSchema,PersonaSourceNatureSchema } from './persona.js';
import type { PersonaAccess,PersonaSourceRef,ContinuityCheckpoint } from './persona.js';
import type { ExecutionSourceRef } from './execution.js';
import type { ContextItem } from './context.js';
import type { CompactionProvider,SourceDependency } from './compaction.js';

export const ExecutionObservationSchema=z.strictObject({requestId:PersonaRequestIdSchema,occurredAt:z.iso.datetime({offset:true}),
  text:z.string().min(1).max(32000),kind:z.enum(['primary','digest']),completeness:z.enum(['complete','partial','unknown']),
  resource:z.string().regex(/^[a-z][a-z0-9.-]{0,31}:[a-zA-Z0-9._:-]{1,200}$/),coverage:z.array(z.string().min(1).max(300)).max(32),
  dependencies:z.array(PersonaSourceRefSchema).max(64).default([]),nature:PersonaSourceNatureSchema.optional()});
export const ExecutionContributionSchema=z.strictObject({requestId:PersonaRequestIdSchema,source:z.uuid(),version:z.number().int().positive(),
  mode:z.enum(['original','excerpt','summary']),start:z.number().int().nonnegative().optional(),end:z.number().int().positive().optional(),
  text:z.string().trim().min(1).max(8000).optional(),reason:z.string().trim().min(1).max(1000)});
export interface ExecutionMemoryPort {
  ready():boolean;
  /** Optional durable consumer; core acknowledges its event only after this returns. */
  recordLifecycle?(event:import('./memory-maintenance.js').MaintenanceLifecycle):void;
  recordAssessment?(access:PersonaAccess,assessment:import('./task-assessment.js').TaskAssessment):PersonaSourceRef;
  resourceEpoch?(access:PersonaAccess):string;
  validate(access:PersonaAccess,ref:PersonaSourceRef):boolean;
  operationSources(access:PersonaAccess,operationId:string):readonly PersonaSourceRef[];
  outcomeSources(access:PersonaAccess,refs:readonly ExecutionSourceRef[]):readonly PersonaSourceRef[];
  prepareContext(access:PersonaAccess):readonly ContextItem[];
  validateContext(access:PersonaAccess,item:ContextItem):boolean;
  captureContinuity(access:PersonaAccess,checkpoint:ContinuityCheckpoint):{id:string;hash:string};
  checkpoint(access:PersonaAccess,id:string,historical?:boolean):ContinuityCheckpoint|null;
  bindResult(taskId:string,runId:string,epoch:number,body:unknown):void;
  generation(access:PersonaAccess):number;
  acceptIntent(access:PersonaAccess):void;
  intent(access:PersonaAccess):{motivation:PersonaAccess['motivation'];blocking:boolean;events:readonly import('./persona.js').TaskIntentEvent[]};
  resolveIntent(access:PersonaAccess,input:unknown):unknown;
  readonly compactionPolicy?:CompactionProvider['policy'];
  summarize:CompactionProvider['summarize'];
  summarizeFragments?:CompactionProvider['summarizeFragments'];
  /** Optional checked semantic rewrite; native tasks retain the same provenance guard. */
  rewrite?:CompactionProvider['rewrite'];
}
export const ExecutionToolReceiptSchema=z.strictObject({schemaVersion:z.literal(1),runId:z.uuid(),operationId:z.uuid(),callId:z.string(),outcomeHash:z.string().regex(/^[a-f0-9]{64}$/),inputHash:z.string().regex(/^[a-f0-9]{64}$/),sources:z.array(PersonaSourceRefSchema).max(64)});
export type ExecutionToolReceipt=z.infer<typeof ExecutionToolReceiptSchema>;
export const TaskObjectionSchema=z.strictObject({requestId:PersonaRequestIdSchema,category:z.enum(['preference','method','premise','missing-information','scope']),
  blocking:z.boolean(),actions:z.array(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)).max(32).default([]),reason:z.string().trim().min(1).max(1000),evidence:z.array(PersonaSourceRefSchema).max(32).default([])});
export const TaskResolutionSchema=z.strictObject({requestId:PersonaRequestIdSchema,objectionId:z.uuid(),reason:z.string().trim().min(1).max(1000)});
export const ExecutionMotivationSchema=MotivationSchema;
export interface ExecutionSourceAdmission {readonly dependencies:readonly SourceDependency[];readonly sources:readonly PersonaSourceRef[]}
