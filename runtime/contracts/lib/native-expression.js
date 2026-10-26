import { z } from 'zod';
import { ConversationSchema } from './conversation.js';
import { PersonaSourceRefSchema } from './persona.js';
import { NativeMediaMaterialSchema } from './media.js';
export const TaskResultAnchorSchema = z.strictObject({ kind: z.literal('task-result'), schemaVersion: z.literal(1), taskId: z.uuid(), runId: z.uuid(), inboundId: z.uuid(), target: ConversationSchema,
    intentVersion: z.number().int().positive(), authorityVersion: z.string().length(64), expiresAt: z.iso.datetime(), outcome: z.literal('waiting').optional() });
export const NativeExpressionCandidateSchema = z.strictObject({ source: PersonaSourceRefSchema, view: z.string().max(32000).nullable() });
export const NativeExpressionPacketSchema = z.strictObject({ id: z.uuid(), version: z.number().int().positive(), anchor: TaskResultAnchorSchema, question: z.string().max(2000),
    evidence: z.array(z.strictObject({ id: z.string(), kind: z.enum(['reported', 'inference']), text: z.string().max(32000) })).min(1).max(19), sourceStamp: z.string().length(64), resultIncluded: z.boolean(), media: NativeMediaMaterialSchema.optional() });
