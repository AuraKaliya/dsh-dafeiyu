import { z } from 'zod';

const source = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.enum(['message', 'event']), id: z.string().min(1).max(300), route: z.string().max(2000).optional() }),
  z.strictObject({ kind: z.literal('session'), id: z.string().min(1).max(300), seq: z.number().int().nonnegative(), route: z.string().max(2000).optional() }),
  z.strictObject({ kind: z.literal('execution-source'), id: z.string().min(1).max(300), scopeKey: z.string().max(2000), version: z.number().int().positive(), contentHash: z.string().regex(/^[a-f0-9]{64}$/) }),
]);
const fields = {
  agentId: z.string().min(1).max(100), taskId: z.uuid(), runId: z.uuid(), route: z.string().max(2000),
  traceId: z.string().min(1).max(160), operationId: z.string().min(1).max(160), causedBy: z.string().max(160).nullable(),
  type: z.string().regex(/^[a-z][a-z0-9.-]{1,120}$/), plugin: z.string().min(1).max(100), pluginVersion: z.string().min(1).max(80),
  occurredAt: z.iso.datetime({ offset: true }), sources: z.array(source).max(64), data: z.record(z.string(), z.json()),
};
export const ExecutionEventInputSchema = z.strictObject(fields).refine(value => value.route === JSON.stringify(['dafeiyu-scope-v1','task',value.agentId,value.taskId]), 'Execution event scope mismatch');
export const ExecutionEventSchema = z.strictObject({ ...fields, schemaVersion: z.literal(2), id: z.uuid(), recordedAt: z.iso.datetime({ offset: true }),
  visibility: z.strictObject({ kind: z.literal('task'), agentId: z.string(), taskId: z.uuid() }) })
  .refine(value => value.route === JSON.stringify(['dafeiyu-scope-v1','task',value.agentId,value.taskId])
    && value.visibility.agentId === value.agentId && value.visibility.taskId === value.taskId, 'Execution event scope mismatch');
export type NewExecutionEvent = z.infer<typeof ExecutionEventInputSchema>;
export type ExecutionEvent = z.infer<typeof ExecutionEventSchema> & { readonly seq: number };
