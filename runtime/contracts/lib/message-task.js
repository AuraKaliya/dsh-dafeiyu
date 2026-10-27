import { z } from 'zod';
import { ConversationSchema } from './conversation.js';
import { PersonaRequestIdSchema } from './persona.js';
import { MediaVoiceEvidenceSchema } from './media.js';
export const MessageTaskSubmitSchema = z.strictObject({ requestId: PersonaRequestIdSchema, title: z.string().trim().min(1).max(200).optional(), kind: z.enum(['explicit-task', 'self-exploration']).default('explicit-task'), goal: z.string().trim().min(1).max(2000).optional(), voiceExposureId: z.uuid().optional() })
    .refine(value => value.kind === 'self-exploration' ? value.goal !== undefined && value.voiceExposureId === undefined : value.goal === undefined, 'Explicit goals must come from the real message');
export const MessageInstructionSubmitSchema = z.strictObject({ requestId: MessageTaskSubmitSchema.shape.requestId, title: MessageTaskSubmitSchema.shape.title, kind: z.literal('explicit-task').optional(), voiceExposureId: MessageTaskSubmitSchema.shape.voiceExposureId });
export const MessageExplorationSubmitSchema = z.strictObject({ requestId: MessageTaskSubmitSchema.shape.requestId, title: MessageTaskSubmitSchema.shape.title, goal: MessageTaskSubmitSchema.shape.goal.unwrap() });
export const MessageTaskStatusSchema = z.strictObject({ taskId: z.uuid() });
export const MessageTaskControlSchema = z.strictObject({ requestId: PersonaRequestIdSchema, taskId: z.uuid(), expectedVersion: z.number().int().positive(), action: z.enum(['cancel', 'revise', 'resolve', 'resume']), objectionId: z.uuid().optional(), voiceExposureId: z.uuid().optional() })
    .refine(value => value.action === 'resolve' ? value.objectionId !== undefined : value.objectionId === undefined);
const voiceSourceSchema = z.strictObject({ bindingVersion: z.string().min(1).max(100), evidence: MediaVoiceEvidenceSchema });
export const MessageTaskSourceSchema = z.strictObject({ schemaVersion: z.literal(1), bindingId: z.string(), authorityVersion: z.string().length(64), inboundId: z.uuid(), messageHash: z.string().length(64),
    conversation: ConversationSchema, kind: z.enum(['explicit-task', 'self-exploration']), resources: z.array(ConversationSchema).max(64), voice: voiceSourceSchema.optional(), control: z.strictObject({ inboundId: z.uuid(), messageHash: z.string().length(64), voice: voiceSourceSchema.optional() }).optional() });
