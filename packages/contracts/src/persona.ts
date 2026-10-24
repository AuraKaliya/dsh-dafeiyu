import { z } from 'zod';
import { ExecutionScopeSchema } from './execution.js';
import { TaskMemoryAuthorizationSchema } from './task-memory.js';

const hash=z.string().regex(/^[a-f0-9]{64}$/),id=z.uuid(),version=z.number().int().positive();
export const PersonaRequestIdSchema=z.string().regex(/^[a-zA-Z0-9._:-]{1,120}$/);
const source={id,agentId:z.string().min(1).max(100),scopeKey:z.string().min(1).max(2000),version,contentHash:hash};
export const PersonaSourceRefSchema=z.discriminatedUnion('kind',[
  z.strictObject({...source,kind:z.literal('memory'),revision:version,authorization:TaskMemoryAuthorizationSchema.optional()}),
  z.strictObject({...source,kind:z.literal('execution-source')}),
]);
export type PersonaSourceRef=z.infer<typeof PersonaSourceRefSchema>;
export const MotivationSchema=z.strictObject({kind:z.enum(['explicit-task','self-exploration','conversation-invitation','maintenance','mixed','unknown']),
  basis:z.array(z.string().min(1).max(300)).max(16).default([])});
export type Motivation=z.infer<typeof MotivationSchema>;
export const PersonaKindSchema=z.enum(['interest','preference','view','habit','relationship','value-application']);
export const PersonaCandidateStateSchema=z.enum(['proposed','held','trial','adopted','rejected','withdrawn','dormant','superseded']);
export const PersonaProposalSchema=z.strictObject({requestId:PersonaRequestIdSchema,kind:PersonaKindSchema,contentRef:PersonaSourceRefSchema,
  supports:z.array(PersonaSourceRefSchema).max(32),counters:z.array(PersonaSourceRefSchema).max(32).default([]),
  applicability:z.string().trim().min(1).max(1000),reason:z.string().trim().min(1).max(1000)});
export const PersonaCandidateRevisionSchema=z.strictObject({schemaVersion:z.literal(1),id,agentId:z.string().min(1).max(100),version,state:PersonaCandidateStateSchema,
  kind:PersonaKindSchema,contentRef:PersonaSourceRefSchema,supports:z.array(PersonaSourceRefSchema).max(32),counters:z.array(PersonaSourceRefSchema).max(32),
  dependencies:z.array(PersonaSourceRefSchema).max(64),rootSources:z.array(z.string().min(1).max(2200)).max(64),
  scope:ExecutionScopeSchema,motivation:MotivationSchema,applicability:z.string().min(1).max(1000),reason:z.string().min(1).max(1000),
  runId:id,producer:z.string().min(1).max(100),createdAt:z.iso.datetime(),policyVersion:hash});
export type PersonaCandidate=z.infer<typeof PersonaCandidateRevisionSchema>;
export const PersonaEntryRefSchema=z.strictObject({id,version});
export const PersonaStageSchema=z.strictObject({schemaVersion:z.literal(1),agentId:z.string().min(1).max(100),revision:z.number().int().nonnegative(),
  entries:z.array(PersonaEntryRefSchema).max(128),createdAt:z.iso.datetime(),policyVersion:hash});
export type PersonaStage=z.infer<typeof PersonaStageSchema>;
export const PersonaManifestSchema=z.strictObject({schemaVersion:z.literal(1),agentId:z.string().min(1).max(100),runId:id,
  foundationHash:hash,foundationIdentity:hash,stageRevision:z.number().int().nonnegative(),selectionVersion:z.number().int().nonnegative(),
  stageStatus:z.enum(['not-configured','empty','selected']),
  entries:z.array(z.strictObject({candidate:PersonaEntryRefSchema,contentRef:PersonaSourceRefSchema,dependencies:z.array(PersonaSourceRefSchema).max(64)})).max(64),
  continuityCheckpointId:id.nullable(),policyVersion:hash,modelRouteHash:hash,assemblyVersion:z.literal('1')});
export type PersonaManifest=z.infer<typeof PersonaManifestSchema>;
export const ContinuityCheckpointSchema=z.strictObject({schemaVersion:z.literal(1),id,agentId:z.string().min(1).max(100),runId:id,taskId:id,taskEpoch:version,
  scope:ExecutionScopeSchema,foundationHash:hash,stageRevision:z.number().int().nonnegative(),sessionId:z.string().min(1).max(300),throughSeq:z.number().int().nonnegative(),
  dependencies:z.array(PersonaSourceRefSchema).max(64),completedOperations:z.array(id).max(1000),unknownOperations:z.array(id).max(1000),
  summary:z.string().max(8000),gaps:z.array(z.string().min(1).max(1000)).max(32),createdAt:z.iso.datetime()})
  .refine(value=>value.scope.kind==='task'&&value.scope.agentId===value.agentId&&value.scope.taskId===value.taskId,'Checkpoint scope mismatch');
export type ContinuityCheckpoint=z.infer<typeof ContinuityCheckpointSchema>;
export const TaskIntentEventSchema=z.strictObject({schemaVersion:z.literal(1),id,agentId:z.string().min(1).max(100),taskId:id,taskEpoch:version,runId:id,
  requestId:PersonaRequestIdSchema,producer:z.string().min(1).max(100),kind:z.enum(['accepted','objection','resolved']),motivation:MotivationSchema,
  category:z.enum(['preference','method','premise','missing-information','scope','none']),blocking:z.boolean(),reason:z.string().min(1).max(1000),
  evidence:z.array(PersonaSourceRefSchema).max(32),resolves:id.nullable(),createdAt:z.iso.datetime()});
export type TaskIntentEvent=z.infer<typeof TaskIntentEventSchema>;
