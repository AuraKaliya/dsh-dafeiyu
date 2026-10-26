import { z } from 'zod';
import { claimSchema, kindSchema, keySchema, evidenceSchema, receiptSchema, revisionSchema } from './types.js';
export const analysisConfigSchema = z.strictObject({
    timeoutMs: z.number().int().min(100).max(300000).default(120000),
    maxPending: z.number().int().min(1).max(100).default(20),
});
export const submitSchema = z.strictObject({ requestId: keySchema,
    sourceRefs: z.array(z.string().min(1).max(300)).min(1).max(8),
    targetIds: z.array(z.uuid()).max(8).default([]),
});
const supportSchema = z.strictObject({ sourceId: z.string().regex(/^S[1-8]$/), quote: z.string().min(1).max(4000) });
export const resultSchema = z.strictObject({ schemaVersion: z.literal(1), overview: z.string().max(2000),
    gaps: z.array(z.string().max(500)).max(12), claims: z.array(z.strictObject({
        action: z.enum(['add', 'revise', 'none']), kind: kindSchema, claimType: claimSchema,
        subject: z.string().min(1).max(200), content: z.string().min(1).max(4000),
        support: z.array(supportSchema).min(1).max(8), opposition: z.array(supportSchema).max(8),
        uncertainties: z.array(z.string().max(500)).max(8), explicit: z.boolean(),
        temporal: z.enum(['durable', 'temporary', 'uncertain']), targetId: z.uuid().nullable(),
    })).max(12) });
export const sourceSchema = z.strictObject({ sourceId: z.string(), evidence: evidenceSchema,
    text: z.string().max(12000), origin: z.enum(['user', 'tool', 'memory', 'event']),
    authorId: z.string().optional(), version: z.number().int().positive().optional(),
});
const targetItemSchema = revisionSchema.extend({ version: z.number().int().positive() });
export class AnalysisError extends Error {
    code;
    constructor(code) {
        super(code);
        this.code = code;
    }
}
const writeSchema = z.strictObject({ kind: kindSchema, claimType: claimSchema, content: z.string().min(1).max(8000),
    sources: z.array(evidenceSchema).min(1).max(8), analysis: z.strictObject({ jobId: z.uuid(), candidateId: z.uuid(), policyVersion: z.literal('literal-evidence-v1') }) });
const commandBase = { requestId: keySchema, expectedGeneration: z.number().int().nonnegative(), value: writeSchema };
const commandSchema = z.discriminatedUnion('action', [
    z.strictObject({ ...commandBase, action: z.literal('create') }),
    z.strictObject({ ...commandBase, action: z.literal('revise'), id: z.uuid(), expectedVersion: z.number().int().positive() }),
]);
export const authoritySchema = z.strictObject({ agentId: z.string(), route: z.string(), traceId: z.string(), operationId: z.string(), startedEventId: z.string() });
export const jobSchema = z.strictObject({
    id: z.uuid(), requestId: keySchema, fingerprint: z.string(), grantId: z.uuid(), agentId: z.string(), route: z.string(),
    authority: authoritySchema,
    model: z.strictObject({ provider: z.string(), model: z.string(), reasoningEffort: z.string().optional() }),
    inputGeneration: z.number().int().nonnegative(), generation: z.number().int().nonnegative(), state: z.enum(['queued', 'running', 'committing', 'completed', 'failed', 'cancelled']),
    sources: z.array(sourceSchema), targets: z.array(z.strictObject({ item: targetItemSchema, authorIds: z.array(z.string()) })),
    result: resultSchema.optional(), candidates: z.array(z.strictObject({ id: z.uuid(), claim: resultSchema.shape.claims.element,
        status: z.enum(['needs_review', 'ready', 'committed', 'duplicate', 'stale']), reason: z.string(), command: commandSchema.optional(), receipt: receiptSchema.optional() })),
    error: z.string().optional(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), attempts: z.number().int().nonnegative(),
});
export const targetSnapshot = (item) => targetItemSchema.strip().parse(item);
