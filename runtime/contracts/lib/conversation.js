import { z } from 'zod';
const id = z.string().min(1).max(160);
export const ConversationSchema = z.strictObject({ channel: id, account: id, kind: z.enum(['private', 'group', 'local']), id });
