import { z } from 'zod';
import { ExecutionScopeSchema, ExtensionIdSchema, WakeOriginSchema } from './execution.js';
import { ConversationSchema } from './conversation.js';
import { MotivationSchema } from './persona.js';
import { ActivityAnchorSchema } from './activity.js';
const id = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), version = z.string().min(1).max(80);
const actionId = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
/** Omission denies external actions and must stay omitted in historical policy hashes. */
export const ExternalActionPolicySchema = z.strictObject({ extensionId: ExtensionIdSchema, actionId, actionVersion: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/)
        .refine(value => value === value.trim(), 'External action version cannot contain surrounding whitespace') });
export const ExternalActionPoliciesSchema = z.array(ExternalActionPolicySchema).max(32)
    .refine(values => new Set(values.map(value => JSON.stringify([value.extensionId, value.actionId, value.actionVersion]))).size === values.length, 'Duplicate external action');
export const ExternalTaskSourceSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('owner-message'), bindingId: ExtensionIdSchema, inboundId: id, messageId: z.string().min(1).max(160), messageHash: hash,
        conversation: ConversationSchema, senderId: z.string().min(1).max(160), modality: z.enum(['text', 'voice']), sourceHash: hash }),
    z.strictObject({ kind: z.literal('activity-wake'), origin: WakeOriginSchema, anchor: ActivityAnchorSchema, sourceHash: hash }),
]);
/** Plain evidence describes a live authorization; parsing or copying it grants no capability. */
export const ExternalTaskAuthorizationSchema = z.strictObject({ schemaVersion: z.literal(1), agentId: z.string().min(1).max(100), taskId: id, runId: id,
    operationId: id, intentVersion: z.number().int().positive(), parentRunId: id.nullable(), scope: ExecutionScopeSchema.options[1], goal: z.string().min(1).max(2000), motivation: MotivationSchema,
    policy: z.strictObject({ producer: ExtensionIdSchema, id: ExtensionIdSchema, hash }),
    action: z.strictObject({ owner: ExtensionIdSchema, id: actionId, version, pluginVersion: version, effects: z.literal('external-write'), hash }),
    source: ExternalTaskSourceSchema })
    .refine(value => value.scope.agentId === value.agentId && value.scope.taskId === value.taskId, 'External task identity mismatch')
    .refine(value => value.source.kind === 'owner-message' ? value.motivation.kind === 'explicit-task' : value.motivation.kind === 'self-exploration', 'External task motivation mismatch');
