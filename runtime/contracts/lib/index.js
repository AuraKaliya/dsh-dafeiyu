import { z } from 'zod';
import { ConversationSchema } from './conversation.js';
import { MediaAttachmentSchema } from './media.js';
export * from './conversation.js';
export * from './redaction.js';
export * from './history.js';
export * from './context.js';
export * from './feedback.js';
export * from './compaction.js';
export * from './semantic.js';
export * from './memory-boundary.js';
export * from './observation.js';
export * from './task-workspace.js';
export * from './task-memory.js';
export * from './expression.js';
export * from './delivery.js';
export * from './lifecycle.js';
export * from './execution.js';
export * from './external-execution.js';
export * from './host-config.js';
export * from './execution-event.js';
export * from './execution-ports.js';
export * from './persona.js';
export * from './execution-memory.js';
export * from './resource-observation.js';
export * from './message-task.js';
export * from './native-expression.js';
export * from './memory-maintenance.js';
export * from './activity.js';
export * from './media.js';
export * from './media-delivery.js';
export const API_VERSION = 2;
const id = z.string().min(1).max(160);
export const MessageSchema = z.strictObject({
    id, occurredAt: z.iso.datetime({ offset: true }),
    conversation: ConversationSchema,
    sender: z.strictObject({ id, displayName: z.string().max(200) }),
    text: z.string().min(1).max(32_000),
    mainText: z.string().max(32_000).optional(),
    media: z.array(MediaAttachmentSchema).max(8).optional(),
    replyTo: id.optional(),
});
export const ObservationSchema = z.strictObject({
    conversation: ConversationSchema,
    type: z.enum(['connection.opened', 'connection.closed', 'connection.rejected', 'message.ignored', 'message.unsupported', 'message.recalled']),
    data: z.record(z.string(), z.union([z.string().max(200), z.number().finite(), z.boolean(), z.null()])),
});
/** Collision-free identity; group participants share one conversation, never one global transcript. */
export function conversationKey(agentId, c) {
    return JSON.stringify([agentId, c.channel, c.account, c.kind, c.id]);
}
