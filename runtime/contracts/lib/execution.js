import { z } from 'zod';
import { ConversationSchema } from './conversation.js';
export const EXTENSION_PROTOCOL_VERSION = 3;
export const FeatureSchema = z.string().regex(/^[a-z][a-z0-9.-]{1,100}$/);
export const ExtensionIdSchema = z.string().regex(/^[a-z][a-z0-9._-]{0,79}$/);
const requestId = z.string().regex(/^[a-zA-Z0-9._:-]{1,120}$/);
const actor = z.string().min(1).max(100);
export const WakeOriginSchema = z.strictObject({ kind: z.literal('wake'), producerId: ExtensionIdSchema, scheduleId: z.string().min(1).max(160), scheduleVersion: z.number().int().positive(), occurrenceId: requestId, dueAt: z.iso.datetime({ offset: true }) });
export const RunOriginSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('message'), inboundId: z.uuid(), conversation: ConversationSchema }),
    z.strictObject({ kind: z.literal('native'), producerId: ExtensionIdSchema, requestId }),
    WakeOriginSchema,
    z.strictObject({ kind: z.literal('continuation'), parentRunId: z.uuid(), checkpointId: z.uuid() }),
    z.strictObject({ kind: z.literal('maintenance'), producerId: ExtensionIdSchema, requestId }),
]);
export function taskScopeKey(agentId, taskId) { return JSON.stringify(['dafeiyu-scope-v1', 'task', actor.parse(agentId), z.uuid().parse(taskId)]); }
export const ExecutionScopeSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('conversation'), agentId: actor, route: z.string().min(1).max(2000) }),
    z.strictObject({ kind: z.literal('task'), agentId: actor, taskId: z.uuid(), scopeKey: z.string().max(2000) })
        .refine(value => value.scopeKey === JSON.stringify(['dafeiyu-scope-v1', 'task', value.agentId, value.taskId]), 'Invalid task scope key'),
]);
export const ActionOutcomeSchema = z.strictObject({
    status: z.enum(['succeeded', 'partial', 'failed', 'cancelled', 'unknown']),
    effects: z.enum(['none', 'confirmed', 'unknown']), completeness: z.enum(['complete', 'partial', 'unknown']),
    data: z.json(), sources: z.array(z.strictObject({ id: z.string().min(1).max(300), scopeKey: z.string().min(1).max(2000), version: z.number().int().positive(), contentHash: z.string().regex(/^[a-f0-9]{64}$/) })).max(64),
    receipts: z.array(z.strictObject({ id: z.string().min(1).max(256), kind: z.string().min(1).max(80) })).max(64),
    errorCode: z.string().regex(/^[A-Z0-9_]{1,100}$/).optional(),
});
export const ExtensionMetadataV3Schema = z.strictObject({ protocolVersion: z.literal(3), id: ExtensionIdSchema,
    version: z.string().min(1).max(80), agentId: actor, provides: z.array(FeatureSchema).max(64).default([]), requires: z.array(FeatureSchema).max(64).default([]) });
export const TaskSubmitSchema = z.strictObject({ requestId, title: z.string().trim().min(1).max(200), goal: z.string().trim().min(1).max(2000),
    policyId: ExtensionIdSchema, inputRefs: z.array(z.string().min(1).max(300)).max(16).default([]),
    data: z.json().refine(value => new TextEncoder().encode(JSON.stringify(value)).byteLength <= 16384, 'Task data exceeds 16 KiB').optional() });
