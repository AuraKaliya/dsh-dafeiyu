import { z } from 'zod';
import { ExecutionScopeSchema,ExtensionIdSchema } from './execution.js';
import { PersonaRequestIdSchema,PersonaSourceRefSchema } from './persona.js';

const version=z.number().int().positive(),hash=z.string().regex(/^[a-f0-9]{64}$/),at=z.iso.datetime({offset:true});
export const ActivityTimeZoneSchema=z.string().max(100).refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value}).format(0);return true;}catch{return false;}},'Unknown time zone');
export const QuietWindowSchema=z.strictObject({start:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),end:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)})
  .refine(value=>value.start!==value.end,'Use pause for an all-day rest');
export const ActivityTriggerSchema=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('once'),at}),
  z.strictObject({kind:z.literal('interval'),anchorAt:at,intervalMs:z.number().int().min(60000).max(366*86400000)}),
  z.strictObject({kind:z.literal('condition'),event:z.enum(['task-settled','memory-pending','resource-restored']),key:z.string().min(1).max(2000)}),
]);
export const ActivityConfigSchema=z.strictObject({
  tickMs:z.number().int().min(50).max(60000).default(5000),minIntervalMs:z.number().int().min(60000).max(86400000).default(60000),
  maxPlans:z.number().int().min(1).max(1000).default(100),maxConcurrent:z.number().int().min(1).max(4).default(1),
  maxActiveMs:z.number().int().min(100).max(3600000).default(300000),dailyActiveMs:z.number().int().min(100).max(86400000).default(3600000),
  backoffBaseMs:z.number().int().min(1000).max(3600000).default(60000),maxBackoffMs:z.number().int().min(1000).max(86400000).default(3600000),
  timeZone:ActivityTimeZoneSchema.default('Asia/Shanghai'),quiet:z.array(QuietWindowSchema).max(8).default([]),
  explorationPolicy:ExtensionIdSchema.default('activity-explore'),maintenancePolicy:ExtensionIdSchema.default('activity-maintenance'),
  maintenance:z.boolean().default(false),
}).refine(value=>value.maxBackoffMs>=value.backoffBaseMs,'Invalid backoff range');
/** Serialized anchor is a locator; core must resolve and verify its durable record. */
export const ActivityAnchorSchema=z.strictObject({schemaVersion:z.literal(1),id:z.uuid(),runId:z.uuid(),operationId:z.uuid(),scope:ExecutionScopeSchema,
  intentVersion:version,kind:z.enum(['execution','maintenance']),hash});
export type ActivityAnchor=z.infer<typeof ActivityAnchorSchema>;
export const ActivityScheduleBodySchema=z.strictObject({schemaVersion:z.literal(1),id:z.uuid(),agentId:z.string().min(1).max(100),version,
  owner:ExecutionScopeSchema,purpose:z.enum(['exploration','maintenance']),goal:z.string().trim().min(1).max(2000),
  basis:z.array(PersonaSourceRefSchema).max(8),anchor:ActivityAnchorSchema.nullable(),maintenanceId:z.uuid().nullable(),
  policyId:ExtensionIdSchema,configHash:hash,taskGeneration:version,
  trigger:ActivityTriggerSchema,missed:z.enum(['skip','coalesce','run-once']),timeZone:ActivityTimeZoneSchema,
  quiet:z.array(QuietWindowSchema).max(8),state:z.enum(['active','paused','cancelled']),createdAt:at,updatedAt:at,
});
export type ActivityScheduleBody=z.infer<typeof ActivityScheduleBodySchema>;
export const ActivityDomainEventSchema=z.strictObject({id:PersonaRequestIdSchema,type:z.enum(['task-settled','memory-pending','resource-restored']),
  key:z.string().min(1).max(2000),watermark:z.string().min(1).max(200),occurredAt:at,origin:z.enum(['primary','activity','maintenance']),causedBy:z.string().max(200).nullable()});
export type ActivityDomainEvent=z.infer<typeof ActivityDomainEventSchema>;
export const WakeOccurrenceBodySchema=z.strictObject({schemaVersion:z.literal(1),id:PersonaRequestIdSchema,scheduleId:z.uuid(),scheduleVersion:version,
  taskId:z.uuid(),taskEpoch:version,taskGeneration:version,dueAt:at,createdAt:at,
  reason:z.enum(['time','condition','maintenance','resume']),eventId:PersonaRequestIdSchema.nullable(),configHash:hash,
});
export type WakeOccurrenceBody=z.infer<typeof WakeOccurrenceBodySchema>;
export const ActivityOccurrenceStateSchema=z.enum(['pending','accepted','running','completed','waiting','failed','cancelled','blocked']);
export type ActivityOccurrenceState=z.infer<typeof ActivityOccurrenceStateSchema>;
