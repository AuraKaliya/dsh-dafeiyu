import { z } from 'zod';
export const MEMORY_VERSION = '0.15.0';
export const kindSchema = z.enum(['experience', 'knowledge', 'preference', 'procedure']);
export const claimSchema = z.enum(['observation', 'self_report', 'reported_claim', 'inference']);
export const versionSchema = z.number().int().positive().safe();
export const sourceVersionSchema = z.strictObject({ id: z.uuid(), revision: versionSchema, version: versionSchema, contentHash: z.string() });
export const sourceFenceSchema = z.strictObject({ ref: z.string(), contentHash: z.string(), fence: z.string() });
export const keySchema = z.string().regex(/^[a-zA-Z0-9._:-]{1,120}$/);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const evidenceSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('capability'), ref: z.string().regex(/^dafeiyu:capability:[a-f0-9-]{36}$/), version: versionSchema, contentHash: hashSchema }),
    z.strictObject({ kind: z.literal('execution'), ref: z.string().regex(/^dafeiyu:execution-source:[a-f0-9-]{36}$/), version: versionSchema, contentHash: hashSchema }),
    z.strictObject({ kind: z.literal('observation'), ref: z.string().regex(/^dafeiyu:observation-source:[a-f0-9-]{36}$/), version: versionSchema, contentHash: hashSchema }),
    z.strictObject({ kind: z.literal('timeline'), ref: z.string().max(300), contentHash: hashSchema }),
    z.strictObject({ kind: z.literal('memory'), id: z.uuid(), revision: versionSchema, contentHash: hashSchema }),
]);
export const revisionSchema = z.strictObject({
    id: z.uuid(), revision: versionSchema, kind: kindSchema, claimType: claimSchema,
    content: z.string().min(1).max(8000), contentHash: hashSchema,
    sources: z.array(evidenceSchema).min(1).max(8), createdAt: z.iso.datetime(),
    analysisStatus: z.enum(['not_analyzed', 'evidence_checked']),
    analysis: z.strictObject({ jobId: z.uuid(), candidateId: z.uuid(), policyVersion: z.literal('literal-evidence-v1') }).optional(),
});
export const receiptSchema = z.strictObject({ id: z.uuid(), version: versionSchema, revision: versionSchema, eventId: z.uuid(), generation: versionSchema.optional() });
export class MemoryError extends Error {
    code;
    constructor(code) {
        super(code);
        this.code = code;
    }
}
export const memoryRef = (id, revision) => `dafeiyu:memory:${id}:${revision}`;
export const memoryRefPattern = /^dafeiyu:memory:([a-f0-9-]{36}):([1-9][0-9]*)$/;
