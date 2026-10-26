import { z } from 'zod';
import { ConversationSchema } from './conversation.js';
const key = z.string().regex(/^[a-zA-Z0-9._:-]{1,120}$/);
export const ExpressionPolicySchema = z.strictObject({ requestId: key, id: key, expectedVersion: z.number().int().nonnegative(), enabled: z.boolean(), target: ConversationSchema,
    sources: z.array(z.strictObject({ conversation: ConversationSchema, id: z.uuid(), revision: z.number().int().positive(), version: z.number().int().positive(), contentHash: z.string().regex(/^[a-f0-9]{64}$/) })).min(1).max(16), reason: z.string().min(1).max(300) });
export const ExpressionPrepareSchema = z.strictObject({ requestId: key, inboundId: z.uuid(), linkIds: z.array(z.uuid()).max(16), slots: z.array(key).max(8).default([]),
    policy: z.strictObject({ id: key, version: z.number().int().positive() }).optional() });
export const ExpressionOpenSchema = z.strictObject({ packetId: z.uuid(), target: ConversationSchema });
export const ExpressionGenerateSchema = z.strictObject({ requestId: key, packetId: z.uuid(), target: ConversationSchema });
export const ExpressionResultSchema = z.strictObject({ jobId: z.uuid(), target: ConversationSchema });
export const ExpressionWithdrawSchema = z.strictObject({ requestId: key, packetId: z.uuid(), expectedVersion: z.number().int().positive() });
