import { z } from 'zod';
import { ConversationSchema } from './conversation.js';
import { PersonaRequestIdSchema } from './persona.js';
import type { InboundMessage } from './index.js';
import { MediaVoiceEvidenceSchema } from './media.js';
import type { MediaVoiceEvidence } from './media.js';
import type { ExecutionContextV3 } from './execution.js';
import type { Conversation } from './conversation.js';

export const MessageTaskSubmitSchema=z.strictObject({requestId:PersonaRequestIdSchema,title:z.string().trim().min(1).max(200).optional(),kind:z.enum(['explicit-task','self-exploration']).default('explicit-task'),goal:z.string().trim().min(1).max(2000).optional(),voiceExposureId:z.uuid().optional()})
  .refine(value=>value.kind==='self-exploration'?value.goal!==undefined&&value.voiceExposureId===undefined:value.goal===undefined,'Explicit goals must come from the real message');
export const MessageTaskStatusSchema=z.strictObject({taskId:z.uuid()});
export const MessageTaskControlSchema=z.strictObject({requestId:PersonaRequestIdSchema,taskId:z.uuid(),expectedVersion:z.number().int().positive(),action:z.enum(['cancel','revise','resolve']),objectionId:z.uuid().optional(),voiceExposureId:z.uuid().optional()})
  .refine(value=>value.action==='resolve'?value.objectionId!==undefined:value.objectionId===undefined);
const voiceSourceSchema=z.strictObject({bindingVersion:z.string().min(1).max(100),evidence:MediaVoiceEvidenceSchema});
export const MessageTaskSourceSchema=z.strictObject({schemaVersion:z.literal(1),bindingId:z.string(),authorityVersion:z.string().length(64),inboundId:z.uuid(),messageHash:z.string().length(64),
  conversation:ConversationSchema,kind:z.enum(['explicit-task','self-exploration']),resources:z.array(ConversationSchema).max(64),voice:voiceSourceSchema.optional(),control:z.strictObject({inboundId:z.uuid(),messageHash:z.string().length(64),voice:voiceSourceSchema.optional()}).optional()});
export type MessageTaskSource=z.infer<typeof MessageTaskSourceSchema>;
/** Program-owned registration, never model parameters. The classifier sees only the real main body. */
export interface MessageTaskBinding {id:string;pluginId:string;channelExtensionId:string;channel:string;account:string;ownerId:string;policyId:string;version:string;
  explorationResources?:readonly Conversation[];
  expressionPolicy?:{id:string;version:number};
  autoDeliver?:boolean;
  voice?:{version:string;resolve(context:ExecutionContextV3,message:InboundMessage,exposureId:string):{text:string;evidence:MediaVoiceEvidence};current(message:InboundMessage,evidence:MediaVoiceEvidence):boolean};
  classify(message:InboundMessage):{kind:'submit'|'cancel'|'revise'|'resolve'|'none';text:string};active():boolean;}
