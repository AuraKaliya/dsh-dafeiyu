import { z } from 'zod';
import { ConversationSchema } from './conversation.js';
const key = z.string().regex(/^[a-zA-Z0-9._:-]{1,120}$/);
const source = z.strictObject({ conversation: ConversationSchema, memoryIds: z.array(z.uuid()).min(1).max(128).optional() });
export const TaskMemoryPolicySchema = z.strictObject({ requestId: key, id: key, expectedVersion: z.number().int().nonnegative(), enabled: z.boolean(),
    sources: z.array(source).min(1).max(8), reason: z.string().trim().min(1).max(300) });
export const TaskMemoryGrantSchema = z.strictObject({ requestId: key, policyId: key, expectedPolicyVersion: z.number().int().positive(), sources: z.array(source).min(1).max(8),
    expiresAt: z.iso.datetime({ offset: true }), reason: z.string().trim().min(1).max(300) });
export const TaskMemoryRevokeSchema = z.strictObject({ requestId: key, id: z.uuid(), expectedVersion: z.number().int().positive() });
export const TaskMemoryQuerySchema = z.strictObject({ query: z.string().trim().min(1).max(2000), strategy: z.enum(['lexical', 'semantic', 'hybrid']).default('hybrid'), limit: z.number().int().min(1).max(20).default(5) });
export const TaskMemoryOpenSchema = z.strictObject({ hitId: z.uuid(), offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(4000).default(2000) });
export const TaskMemorySelectSchema = z.strictObject({ requestId: key, expectedVersion: z.number().int().positive(), hitIds: z.array(z.uuid()).min(1).max(8) });
export const TaskMemoryAuthorizationSchema = z.strictObject({ taskId: z.uuid(), taskEpoch: z.number().int().positive(), grantId: z.uuid(), grantVersion: z.number().int().positive(), policyId: key, policyVersion: z.number().int().positive() });
