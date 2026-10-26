import { z } from 'zod';
import { ConversationSchema } from './conversation.js';
export const ResourceProofSchema = z.strictObject({ provider: z.string().regex(/^[a-z][a-z0-9._-]{0,79}$/), scene: ConversationSchema,
    key: z.string().min(1).max(240), version: z.number().int().positive(), hash: z.string().regex(/^[a-f0-9]{64}$/),
    roots: z.array(z.string().min(1).max(600)).min(1).max(64), detail: z.json() }).refine(value => JSON.stringify(value.detail).length <= 16000);
export const ResourceTargetViewSchema = z.strictObject({ kind: z.enum(['reported', 'inference']), stamp: z.string().regex(/^[a-f0-9]{64}$/) });
export const CapabilityObservationSchema = z.strictObject({ requestId: z.string().regex(/^[a-zA-Z0-9._:-]{1,120}$/), proof: ResourceProofSchema,
    text: z.string().min(1).max(8000), occurredAt: z.iso.datetime(), coverage: z.array(z.string().max(300)).max(24),
    counts: z.strictObject({ received: z.number().int().nonnegative(), processed: z.number().int().nonnegative() }) })
    .refine(value => value.counts.processed <= value.counts.received);
export const CapabilitySelectionSchema = z.strictObject({ requestId: z.string().regex(/^[a-zA-Z0-9._:-]{1,120}$/), observationId: z.uuid(),
    version: z.number().int().positive(), mode: z.enum(['none', 'original', 'fragment', 'summary']),
    start: z.number().int().nonnegative().optional(), end: z.number().int().positive().optional(), text: z.string().trim().min(1).max(8000).optional(),
    reason: z.string().trim().min(1).max(500) });
