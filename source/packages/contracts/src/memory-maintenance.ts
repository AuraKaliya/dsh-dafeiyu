import { z } from 'zod';
import { ExecutionScopeSchema, RunOriginSchema } from './execution.js';
import { MotivationSchema, PersonaRequestIdSchema, PersonaSourceRefSchema, PersonaKindSchema } from './persona.js';
import { SourceDependencySchema } from './compaction.js';

const version = z.number().int().positive();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const short = z.string().trim().min(1).max(2000);
export const MaintenanceLifecycleSchema = z.strictObject({
  id:z.uuid(), scope:ExecutionScopeSchema, runId:z.uuid(), taskEpoch:version,
  origin:RunOriginSchema, motivation:MotivationSchema,
  type:z.enum(['run.running','run.completed','run.waiting','run.failed','run.cancelled','run.interrupted','evidence.changed']),
  goal:z.string().max(2000), at:z.iso.datetime(),
  operations:z.array(z.strictObject({id:z.uuid(),action:z.string().max(100),
    status:z.enum(['started','succeeded','partial','failed','cancelled','unknown']),
    effects:z.enum(['none','confirmed','unknown']),completeness:z.enum(['complete','partial','unknown'])})).max(256),
  omittedOperations:z.number().int().nonnegative(),
});
export type MaintenanceLifecycle = z.infer<typeof MaintenanceLifecycleSchema>;
export const MaintenanceRequestInputSchema = z.strictObject({requestId:PersonaRequestIdSchema,
  sources:z.array(PersonaSourceRefSchema).max(32),reason:short,
  targets:z.array(z.strictObject({id:z.uuid(),version})).max(8).default([])});
export const MaintenanceSnapshotSchema = z.strictObject({schemaVersion:z.literal(1),id:z.uuid(),
  scope:ExecutionScopeSchema,taskEpoch:version,runId:z.uuid(),requestId:PersonaRequestIdSchema,
  reason:short,goal:z.string().max(2000),motivation:MotivationSchema,
  sources:z.array(PersonaSourceRefSchema).max(64),history:z.array(SourceDependencySchema).max(4096),
  targets:z.array(z.strictObject({id:z.uuid(),version})).max(8),
  event:MaintenanceLifecycleSchema.nullable(),watermark:hash,createdAt:z.iso.datetime(),expiresAt:z.iso.datetime(),
  omittedSources:z.number().int().nonnegative().optional(),
});
export type MaintenanceSnapshot = z.infer<typeof MaintenanceSnapshotSchema>;
export const MaintenanceStateSchema=z.enum(['waiting-scheduler','ready','running','completed','failed','cancelled','stale']);
export type MaintenanceState=z.infer<typeof MaintenanceStateSchema>;
export const ExperienceContentSchema=z.strictObject({observation:short,action:short,outcome:short,
  interpretation:short,conditions:z.array(short).min(1).max(12),unknowns:z.array(short).max(12)});
export const ExperienceRevisionSchema=z.strictObject({schemaVersion:z.literal(1),id:z.uuid(),version,
  state:z.enum(['proposed','held','accepted','rejected','withdrawn']),scope:ExecutionScopeSchema,taskEpoch:version,
  runId:z.uuid(),maintenanceId:z.uuid(),goal:z.string().max(2000),motivation:MotivationSchema,
  content:ExperienceContentSchema,contentRef:PersonaSourceRefSchema,
  supports:z.array(PersonaSourceRefSchema).max(32),counters:z.array(PersonaSourceRefSchema).max(32),
  dependencies:z.array(PersonaSourceRefSchema).max(64),rootSources:z.array(z.string().max(2200)).max(64),
  reason:short,createdAt:z.iso.datetime(),policy:z.literal('experience-e-v1'),
  evidenceStatus:z.literal('source-bound-inference'),
});
export type ExperienceRevision=z.infer<typeof ExperienceRevisionSchema>;
export const ExperienceRelationSchema=z.strictObject({kind:z.enum(['supports','counters','revises','same-entity','interest-related']),
  from:PersonaSourceRefSchema,to:PersonaSourceRefSchema,reason:short});
export const ExperienceReviewSchema=z.strictObject({requestId:PersonaRequestIdSchema,id:z.uuid(),expectedVersion:version,
  state:z.enum(['held','accepted','rejected','withdrawn']),reason:short});

const citation=z.strictObject({sourceId:z.string().regex(/^S(?:[1-9]|[1-5][0-9]|6[0-4])$/),quote:z.string().min(1).max(4000)});
/** Model suggestions never contain authority, program outcomes, confidence scores or adoption commands. */
export const MaintenanceAnalysisSchema=z.strictObject({schemaVersion:z.literal(1),
  summary:z.string().max(2000),gaps:z.array(short).max(12),
  experiences:z.array(z.strictObject({content:ExperienceContentSchema,supports:z.array(citation).min(1).max(16),
    counters:z.array(citation).max(16),target:z.strictObject({id:z.uuid(),version}).nullable()})).max(8),
  relations:z.array(z.strictObject({kind:ExperienceRelationSchema.shape.kind,from: citation,to:citation,reason:short})).max(16),
  persona:z.array(z.strictObject({kind:PersonaKindSchema,text:short,applicability:short,
    reason:short,supports:z.array(citation).min(1).max(16),counters:z.array(citation).max(16)})).max(8),
});
export type MaintenanceAnalysis=z.infer<typeof MaintenanceAnalysisSchema>;

export const MaintenanceSchedulingItemSchema=z.strictObject({id:z.uuid(),scope:ExecutionScopeSchema,taskEpoch:version,runId:z.uuid(),watermark:hash,
  expiresAt:z.iso.datetime(),state:MaintenanceStateSchema,version,reason:z.string().max(2000),retainedSources:z.number().int().nonnegative(),omittedSources:z.number().int().nonnegative()});
export type MaintenanceSchedulingItem=z.infer<typeof MaintenanceSchedulingItemSchema>;
/** Program-only metadata bridge. It conveys no content-reading or execution authority. */
export interface MemoryMaintenanceSchedulingPort {
  ready():boolean;
  pending(after:number,limit:number):{items:MaintenanceSchedulingItem[];next:number|null};
  inspect(id:string):MaintenanceSchedulingItem|null;
  coalesce(id:string):MaintenanceSchedulingItem|null;
  settleMetadata(id:string):boolean;
  connect():()=>void;
}
