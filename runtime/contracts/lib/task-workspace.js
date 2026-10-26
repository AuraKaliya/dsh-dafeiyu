import { z } from 'zod';
import { ConversationSchema } from './conversation.js';
const key = z.string().regex(/^[a-zA-Z0-9._:-]{1,120}$/), version = z.number().int().nonnegative();
export const TaskCreateSchema = z.strictObject({ requestId: key, title: z.string().min(1).max(200), goal: z.string().min(1).max(2000) });
export const TaskUpdateSchema = z.strictObject({ requestId: key, expectedVersion: version, title: z.string().min(1).max(200).optional(), goal: z.string().min(1).max(2000).optional(), status: z.enum(['active', 'paused', 'completed']).optional() })
    .refine(v => v.title !== undefined || v.goal !== undefined || v.status !== undefined, 'Empty task update');
export const TaskSceneSchema = z.strictObject({ requestId: key, conversation: ConversationSchema });
export const TaskActivateSchema = TaskSceneSchema.extend({ expectedVersion: version });
export const TaskLinkSchema = TaskSceneSchema.extend({ expectedVersion: version, items: z.array(z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('memory'), id: z.uuid(), revision: z.number().int().positive(), version: z.number().int().positive(), contentHash: z.string().length(64) }),
        z.strictObject({ kind: z.literal('observation'), id: z.uuid() }),
    ])).min(1).max(8) });
export const TaskBeginSchema = TaskSceneSchema.extend({ slot: key, expectedSlotVersion: version, inputs: z.array(z.uuid()).max(16) });
export const TaskCompleteSchema = z.strictObject({ requestId: key, text: z.string().min(1).max(4000) });
