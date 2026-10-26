import { z } from 'zod';
import { PersonaRequestIdSchema, PersonaSourceRefSchema, MotivationSchema, PersonaSourceNatureSchema } from './persona.js';
export const ExecutionObservationSchema = z.strictObject({ requestId: PersonaRequestIdSchema, occurredAt: z.iso.datetime({ offset: true }),
    text: z.string().min(1).max(32000), kind: z.enum(['primary', 'digest']), completeness: z.enum(['complete', 'partial', 'unknown']),
    resource: z.string().regex(/^[a-z][a-z0-9.-]{0,31}:[a-zA-Z0-9._:-]{1,200}$/), coverage: z.array(z.string().min(1).max(300)).max(32),
    dependencies: z.array(PersonaSourceRefSchema).max(64).default([]), nature: PersonaSourceNatureSchema.optional() });
export const ExecutionContributionSchema = z.strictObject({ requestId: PersonaRequestIdSchema, source: z.uuid(), version: z.number().int().positive(),
    mode: z.enum(['original', 'excerpt', 'summary']), start: z.number().int().nonnegative().optional(), end: z.number().int().positive().optional(),
    text: z.string().trim().min(1).max(8000).optional(), reason: z.string().trim().min(1).max(1000) });
export const ExecutionToolReceiptSchema = z.strictObject({ schemaVersion: z.literal(1), runId: z.uuid(), operationId: z.uuid(), callId: z.string(), outcomeHash: z.string().regex(/^[a-f0-9]{64}$/), inputHash: z.string().regex(/^[a-f0-9]{64}$/), sources: z.array(PersonaSourceRefSchema).max(64) });
export const TaskObjectionSchema = z.strictObject({ requestId: PersonaRequestIdSchema, category: z.enum(['preference', 'method', 'premise', 'missing-information', 'scope']),
    blocking: z.boolean(), actions: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)).max(32).default([]), reason: z.string().trim().min(1).max(1000), evidence: z.array(PersonaSourceRefSchema).max(32).default([]) });
export const TaskResolutionSchema = z.strictObject({ requestId: PersonaRequestIdSchema, objectionId: z.uuid(), reason: z.string().trim().min(1).max(1000) });
export const ExecutionMotivationSchema = MotivationSchema;
