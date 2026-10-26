import { z } from 'zod';
export const ContextItemSchema = z.strictObject({
    id: z.string().min(1).max(160), version: z.string().min(1).max(160), text: z.string().min(1).max(16000),
    sources: z.array(z.strictObject({ ref: z.string().min(1).max(300), version: z.string().max(160), hash: z.string().max(160) })).min(1).max(16),
    expiresAt: z.iso.datetime(),
});
