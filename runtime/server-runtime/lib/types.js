import { z } from 'zod';
import { ExecutorCallSchema, ExecutorSettlementSchema } from '#dafeiyu/server-executor/protocol';
export const RuntimeIdentitySchema = z.string().regex(/^[A-Za-z0-9._:-]{1,120}$/);
export const ModelCallOwnerSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('host'), profileId: RuntimeIdentitySchema }),
    z.strictObject({ kind: z.literal('executor'), jobId: z.uuid() }),
]);
export const ModelBudgetRequestSchema = ExecutorCallSchema.safeExtend({ authorizationId: RuntimeIdentitySchema, owner: ModelCallOwnerSchema, deadline: z.number().int().positive().safe() });
export const ModelBudgetSettlementSchema = ExecutorSettlementSchema.safeExtend({ authorizationId: RuntimeIdentitySchema, owner: ModelCallOwnerSchema });
export function runtimeCode(error, fallback = 'RUNTIME_BUDGET_FAILED') {
    return error instanceof Error && /^[A-Z][A-Z0-9_]{0,99}$/.test(error.message) ? error.message : fallback;
}
