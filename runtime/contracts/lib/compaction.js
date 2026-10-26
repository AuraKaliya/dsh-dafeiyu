import { z } from 'zod';
import { PersonaSourceRefSchema } from './persona.js';
const scopeFields = { agentId: z.string(), route: z.string() };
/** Immutable input dependencies, supplied by trusted producers rather than model citations. */
export const SourceDependencySchema = z.discriminatedUnion('kind', [
    z.strictObject({ ...scopeFields, kind: z.literal('capability'), ref: PersonaSourceRefSchema }),
    z.strictObject({ ...scopeFields, kind: z.literal('execution-source'), ref: PersonaSourceRefSchema }),
    z.strictObject({ ...scopeFields, kind: z.literal('execution-input'), runId: z.uuid(), hash: z.string().regex(/^[a-f0-9]{64}$/) }),
    z.strictObject({ ...scopeFields, kind: z.literal('execution-operation'), runId: z.uuid(), operationId: z.uuid(), hash: z.string().regex(/^[a-f0-9]{64}$/), inputHash: z.string().regex(/^[a-f0-9]{64}$/) }),
    z.strictObject({ ...scopeFields, kind: z.literal('memory'), id: z.string(), revision: z.number().int().positive(), version: z.number().int().positive(), hash: z.string() }),
    z.strictObject({ ...scopeFields, kind: z.literal('inbound'), id: z.string(), hash: z.string(), fence: z.string() }),
    z.strictObject({ ...scopeFields, kind: z.literal('timeline'), ref: z.string(), hash: z.string(), fence: z.string() }),
    z.strictObject({ ...scopeFields, kind: z.literal('working'), id: z.string(), taskId: z.string(), revision: z.number().int().positive(), hash: z.string() }),
    z.strictObject({ ...scopeFields, kind: z.literal('feedback'), id: z.string(), version: z.number().int().positive(), hash: z.string() }),
    z.strictObject({ ...scopeFields, kind: z.literal('context'), owner: z.string(), region: z.string(), id: z.string(), version: z.string(), hash: z.string() }),
    z.strictObject({ ...scopeFields, kind: z.literal('legacy'), epoch: z.string() }),
    z.strictObject({ ...scopeFields, kind: z.literal('ephemeral'), traceId: z.string() }),
    z.strictObject({ ...scopeFields, kind: z.literal('unavailable'), reason: z.string() }),
]);
export const SummaryFragmentSchema = z.strictObject({ kind: z.enum(['fact', 'decision', 'constraint', 'correction', 'pending', 'uncertainty', 'result', 'note']), text: z.string().trim().min(1).max(8000) });
