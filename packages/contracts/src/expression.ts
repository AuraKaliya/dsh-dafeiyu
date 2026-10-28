import { z } from 'zod';
import { ConversationSchema } from './conversation.js';
import type { Conversation } from './conversation.js';
const key=z.string().regex(/^[a-zA-Z0-9._:-]{1,120}$/);
export const ExpressionPolicySchema=z.strictObject({requestId:key,id:key,expectedVersion:z.number().int().nonnegative(),enabled:z.boolean(),target:ConversationSchema,
  sources:z.array(z.strictObject({conversation:ConversationSchema,id:z.uuid(),revision:z.number().int().positive(),version:z.number().int().positive(),contentHash:z.string().regex(/^[a-f0-9]{64}$/)})).min(1).max(16),reason:z.string().min(1).max(300)});
