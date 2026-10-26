import { z } from 'zod';
export const BILI_SCENE = { channel: 'bilibili', account: 'public', kind: 'local', id: 'public' };
export const BiliConfigSchema = z.strictObject({
    minIntervalMs: z.number().int().min(100).max(60000).default(1000), timeoutMs: z.number().int().min(1000).max(60000).default(15000),
    backoffMs: z.number().int().min(60000).max(86400000).default(900000), maxResponseBytes: z.number().int().min(1024).max(16 * 1024 ** 2).default(4 * 1024 ** 2),
    maxMediaReadBytes: z.number().int().min(1024).max(256 * 1024 ** 2).default(64 * 1024 ** 2),
    maxPages: z.number().int().min(256).max(65536).default(4096),
    session: z.strictObject({ file: z.string().min(1), expectedUid: z.string().regex(/^[1-9]\d{0,19}$/) }).optional(),
    topics: z.array(z.strictObject({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/), text: z.string().trim().min(1).max(100) })).max(32).default([])
}).refine(c => new Set(c.topics.map(t => t.id)).size === c.topics.length, 'Duplicate topics');
export const BiliPluginConfigSchema = BiliConfigSchema;
export const BvidSchema = z.string().regex(/^BV[1-9A-HJ-NP-Za-km-z]{10}$/);
export const NumberIdSchema = z.string().regex(/^[1-9]\d{0,19}$/);
export const code = (error) => error instanceof z.ZodError ? 'BILI_INVALID_DATA' : error instanceof Error && /^[A-Z][A-Z0-9_]{0,99}$/.test(error.message) ? error.message : 'BILI_REQUEST_FAILED';
