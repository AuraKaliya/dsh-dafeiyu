import { z } from 'zod';
import { ConversationSchema } from './conversation.js';
import { PersonaRequestIdSchema } from './persona.js';
import type { InboundMessage } from './index.js';

export const MessageTaskSubmitSchema=z.strictObject({requestId:PersonaRequestIdSchema,title:z.string().trim().min(1).max(200),kind:z.enum(['explicit-task','self-exploration']).default('explicit-task'),goal:z.string().trim().min(1).max(2000).optional()})
  .refine(value=>value.kind==='self-exploration'?value.goal!==undefined:value.goal===undefined,'Explicit goals must come from the real message');
export const MessageTaskStatusSchema=z.strictObject({taskId:z.uuid()});
export const MessageTaskSourceSchema=z.strictObject({schemaVersion:z.literal(1),bindingId:z.string(),authorityVersion:z.string().length(64),inboundId:z.uuid(),messageHash:z.string().length(64),
  conversation:ConversationSchema,kind:z.enum(['explicit-task','self-exploration']),resources:z.array(ConversationSchema).max(64)});
export type MessageTaskSource=z.infer<typeof MessageTaskSourceSchema>;
/** Program-owned registration, never model parameters. The classifier sees only the real main body. */
export interface MessageTaskBinding {id:string;pluginId:string;channelExtensionId:string;channel:string;account:string;ownerId:string;policyId:string;version:string;
  classify(message:InboundMessage):{kind:'submit'|'cancel'|'revise'|'resolve'|'none';text:string};active():boolean;}
