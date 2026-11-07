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
  idleAfterMs:z.number().int().min(0).max(86400000).default(60000),
  tickMs:z.number().int().min(50).max(60000).default(5000),minIntervalMs:z.number().int().min(60000).max(86400000).default(60000),
  explorationIntervalMs:z.number().int().min(60000).max(7*86400000).default(1800000),restMs:z.number().int().min(60000).max(7*86400000).default(3600000),
  ownerSharing:z.strictObject({enabled:z.boolean().default(true),cooldownMs:z.number().int().min(60000).max(86400000).default(1800000)}).prefault({}),
  maxPlans:z.number().int().min(1).max(1000).default(100),maxConcurrent:z.literal(1).default(1),
  roundTokens:z.number().int().min(1).max(100000000).default(100000),roundDurationMs:z.number().int().min(1).max(86400000).default(900000),
  backoffBaseMs:z.number().int().min(1000).max(3600000).default(60000),maxBackoffMs:z.number().int().min(1000).max(86400000).default(3600000),
  timeZone:ActivityTimeZoneSchema.default('Asia/Shanghai'),quiet:z.array(QuietWindowSchema).max(8).default([]),
  explorationPolicy:ExtensionIdSchema.default('activity-explore'),maintenancePolicy:ExtensionIdSchema.default('activity-maintenance'),
  maintenance:z.boolean().default(false),plans:z.boolean().default(true),exploration:z.boolean().default(true),allowedCapabilities:z.array(z.enum(['bilibili','media','dsh-tools'])).max(3).default(['bilibili','media']),
}).refine(value=>value.maxBackoffMs>=value.backoffBaseMs,'Invalid backoff range');
/** Serialized anchor is a locator; core must resolve and verify its durable record. */
export const ActivityAnchorSchema=z.strictObject({schemaVersion:z.literal(1),id:z.uuid(),runId:z.uuid(),operationId:z.uuid(),scope:ExecutionScopeSchema,
  intentVersion:version,kind:z.enum(['execution','maintenance']),hash});
export type ActivityAnchor=z.infer<typeof ActivityAnchorSchema>;
export const GroupWatchSchema=z.strictObject({mode:z.enum(['joined','fixed']).default('joined'),groupIds:z.array(z.string().regex(/^[1-9]\d{4,19}$/)).default([]),reply:z.boolean().default(false)});
export const ActivityScheduleBodySchema=z.strictObject({schemaVersion:z.literal(1),id:z.uuid(),agentId:z.string().min(1).max(100),version,
  owner:ExecutionScopeSchema,purpose:z.enum(['exploration','maintenance','group-watch']),goal:z.string().trim().min(1).max(2000),watch:GroupWatchSchema.optional(),
  basis:z.array(PersonaSourceRefSchema).max(8),anchor:ActivityAnchorSchema.nullable(),maintenanceId:z.uuid().nullable(),
  policyId:ExtensionIdSchema,configHash:hash,taskGeneration:version,
  trigger:ActivityTriggerSchema,missed:z.enum(['skip','coalesce','run-once']),timeZone:ActivityTimeZoneSchema,
  quiet:z.array(QuietWindowSchema).max(8),state:z.enum(['active','paused','cancelled']),createdAt:at,updatedAt:at,
});
export type ActivityScheduleBody=z.infer<typeof ActivityScheduleBodySchema>;
export const ACTIVITY_PLAN_COMPLETION_RULE='计划配置保存与计划实际执行是两个阶段。只要求创建或修改配置时，取得保存后的版本回执即可结束设置任务并汇报配置；后台计划要等待来源任务结束或让出、前台空闲后才参与调度。不要在同一个设置任务里用sleep、等待命令或轮询来等它首次执行，否则会等待自己的结束。要求沿用原计划时必须保留计划ID，更新失败不能自行用取消旧计划再新建来替代；需要重新绑定来源时仍在原ID上更新，并说明当前授权目标。配置回执不代表已经巡视或发送，实际执行仍受到期时间、静默、权限和资源状态约束。';
const activationPolicy=z.strictObject({sourceTaskMustSettle:z.literal(true),foregroundMustBeIdle:z.literal(true),evidence:z.literal('configuration-only'),note:z.string().min(1).max(1000)});
/** Safe facts about the recorded plan revision, with no goal, source content or condition key. */
export const ActivityPlanReceiptSchema=z.strictObject({id:z.uuid(),version,purpose:ActivityScheduleBodySchema.shape.purpose,state:ActivityScheduleBodySchema.shape.state,
  trigger:z.discriminatedUnion('kind',[ActivityTriggerSchema.options[0],ActivityTriggerSchema.options[1],ActivityTriggerSchema.options[2].omit({key:true})]),
  timeZone:ActivityTimeZoneSchema,quiet:z.array(QuietWindowSchema).max(8),watch:GroupWatchSchema.omit({groupIds:true}).optional(),recordedAt:at,activationPolicy:activationPolicy.optional()});
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
