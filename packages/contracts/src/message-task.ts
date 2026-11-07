import { z } from 'zod';
import { ConversationSchema } from './conversation.js';
import { ToolStageSchema } from './execution.js';
import type { ToolStage } from './execution.js';
import { PersonaRequestIdSchema } from './persona.js';
import type { InboundMessage } from './index.js';
import { MediaVoiceEvidenceSchema } from './media.js';
import type { MediaVoiceEvidence } from './media.js';
import type { ExecutionContext } from './execution.js';
import type { Conversation } from './conversation.js';

/** Model-side interpretation of how the current message relates to an existing task.
 * It never supplies authority: Core binds the message, owner, conversation and task version. */
const MessageTaskIntentSchema=z.strictObject({
  relation:z.enum(['new','amend','confirm','continue','retry','status']).default('new').describe('已有任务用对应关系承接。业务已结束但生成或核验中断时，continue/retry仅请求原成果交付接续；status只查询，不重跑业务。'),
  targetTaskId:z.uuid().optional(),
  expectedVersion:z.number().int().positive().optional(),
  resolvedGoal:z.string().trim().min(1).describe('已有任务修订后的完整目标；新任务仍以当前用户原话为准。').optional(),
  constraints:z.array(z.string().trim().min(1).max(500)).max(32).optional(),
  delegatedDecisions:z.array(z.string().trim().min(1).max(200)).max(16).optional(),
  proposalRef:z.string().trim().min(1).max(200).optional(),
}).refine(value=>value.relation==='new'?value.targetTaskId===undefined:true,'A new task cannot retarget an existing task');
export type MessageTaskIntent=z.infer<typeof MessageTaskIntentSchema>;
export const MessageTaskSubmitSchema=z.strictObject({requestId:PersonaRequestIdSchema,title:z.string().trim().min(1).max(200).optional(),kind:z.enum(['explicit-task','self-exploration']).default('explicit-task'),goal:z.string().trim().min(1).max(2000).optional(),voiceExposureId:z.uuid().optional(),toolStage:ToolStageSchema.optional(),intent:MessageTaskIntentSchema.optional()})
  .refine(value=>value.kind==='self-exploration'?value.goal!==undefined&&value.voiceExposureId===undefined:value.goal===undefined,'Explicit goals must come from the real message');
export const MessageInstructionSubmitSchema=z.strictObject({requestId:MessageTaskSubmitSchema.shape.requestId,title:MessageTaskSubmitSchema.shape.title,kind:z.literal('explicit-task').optional(),voiceExposureId:MessageTaskSubmitSchema.shape.voiceExposureId,toolStage:MessageTaskSubmitSchema.shape.toolStage,intent:MessageTaskSubmitSchema.shape.intent});
export const MessageExplorationSubmitSchema=z.strictObject({requestId:MessageTaskSubmitSchema.shape.requestId,title:MessageTaskSubmitSchema.shape.title,goal:MessageTaskSubmitSchema.shape.goal.unwrap()});
export const MessageTaskStatusSchema=z.strictObject({taskId:z.uuid().optional(),offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(50).default(20)});
export const MessageTaskControlSchema=z.strictObject({requestId:PersonaRequestIdSchema,taskId:z.uuid(),expectedVersion:z.number().int().positive(),action:z.enum(['cancel','revise','resolve','resume']),objectionId:z.uuid().optional(),voiceExposureId:z.uuid().optional()})
  .refine(value=>value.action==='resolve'?value.objectionId!==undefined:value.objectionId===undefined);
const voiceSourceSchema=z.strictObject({bindingVersion:z.string().min(1).max(100),evidence:MediaVoiceEvidenceSchema});
const intentRequestSource=z.strictObject({inboundId:z.uuid(),messageHash:z.string().length(64),conversation:ConversationSchema,messageId:z.string().max(200),occurredAt:z.iso.datetime({offset:true}),text:z.string().max(32000)});
/** Durable, program-verified continuation of one owner task across messages and intent versions. */
const MessageIntentSnapshotSchema=z.strictObject({schemaVersion:z.literal(1),
  relation:z.enum(['new','amend','confirm','continue','retry','status']),
  taskId:z.uuid().optional(),intentVersion:z.number().int().positive().optional(),
  originalRequest:intentRequestSource.nullable(),
  previousGoal:z.string().optional(),
  resolvedGoal:z.string().optional(),
  constraints:z.array(z.string().max(500)).default([]),
  delegatedDecisions:z.array(z.string().max(200)).default([]),
  amendments:z.array(z.strictObject({inboundId:z.uuid(),messageHash:z.string().length(64),text:z.string().min(1).max(32000),
    kind:z.enum(['amend','confirm','continue','retry','status']),at:z.iso.datetime({offset:true})})).default([]),
  proposalRef:z.string().max(200).optional()});
export type MessageIntentSnapshot=z.infer<typeof MessageIntentSnapshotSchema>;
export const MessageTaskSourceSchema=z.strictObject({schemaVersion:z.literal(1),bindingId:z.string(),authorityVersion:z.string().length(64),inboundId:z.uuid(),messageHash:z.string().length(64),
  conversation:ConversationSchema,kind:z.enum(['explicit-task','self-exploration']),resources:z.array(ConversationSchema).max(64),voice:voiceSourceSchema.optional(),intent:MessageIntentSnapshotSchema.optional(),control:z.strictObject({inboundId:z.uuid(),messageHash:z.string().length(64),voice:voiceSourceSchema.optional()}).optional()});
export type MessageTaskSource=z.infer<typeof MessageTaskSourceSchema>;
/** Program-owned registration, never model parameters. The classifier sees only the real main body. */
export interface MessageTaskBinding {id:string;pluginId:string;channelExtensionId:string;channel:string;account:string;ownerId:string;policyId:string;version:string;
  explorationResources?:readonly Conversation[];
  expressionPolicy?:{id:string;version:number};
  toolStage?:ToolStage;
  autoDeliver?:boolean;
  voice?:{version:string;resolve(context:ExecutionContext,message:InboundMessage,exposureId:string):{text:string;evidence:MediaVoiceEvidence};current(message:InboundMessage,evidence:MediaVoiceEvidence):boolean};
  classify(message:InboundMessage):{kind:'submit'|'cancel'|'revise'|'resolve'|'none';text:string};active():boolean;}
