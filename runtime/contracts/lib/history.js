import { z } from 'zod';
export const TimelineQuerySchema = z.strictObject({
    query: z.string().max(200).default(''),
    plugin: z.string().min(1).max(100).optional(),
    type: z.string().min(1).max(100).optional(),
    actorId: z.string().min(1).max(160).optional(),
    traceId: z.string().min(1).max(160).optional(),
    operationId: z.string().min(1).max(160).optional(),
    since: z.iso.datetime({ offset: true }).optional(),
    until: z.iso.datetime({ offset: true }).optional(),
    clock: z.enum(['occurredAt', 'recordedAt']).default('occurredAt'),
    limit: z.number().int().min(1).max(50).default(20),
    cursor: z.string().max(2048).optional(),
}).refine(value => !value.since || !value.until || Date.parse(value.since) <= Date.parse(value.until), 'Invalid time range');
