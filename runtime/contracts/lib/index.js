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
export const MessagePartSchema = z.strictObject({
    id, occurredAt: z.iso.datetime({ offset: true }),
    conversation: ConversationSchema,
    sender: z.strictObject({ id, displayName: z.string().max(200) }),
    text: z.string().min(1).max(32_000),
    mainText: z.string().max(32_000).optional(),
    media: z.array(MediaAttachmentSchema).max(8).optional(),
    replyTo: id.optional(),
});
/** A batch is a program envelope. Each source remains an authentic platform message. */
export const MessageSchema = MessagePartSchema.extend({
    batch: z.strictObject({ sources: z.array(MessagePartSchema).min(2).max(10) }).optional(),
}).superRefine((message, ctx) => {
    if (!message.batch)
        return;
    const sources = message.batch.sources, last = sources.at(-1);
    if (new Set(sources.map(part => part.id)).size !== sources.length || sources.some(part => conversationKey('', part.conversation) !== conversationKey('', message.conversation) || part.sender.id !== message.sender.id)
        || JSON.stringify({ ...message, batch: undefined }) !== JSON.stringify(last) || sources.reduce((n, part) => n + part.text.length, 0) > 32000 || sources.reduce((n, part) => n + (part.media?.length ?? 0), 0) > 8)
        ctx.addIssue({ code: 'custom', message: 'Invalid authentic message batch' });
});
export const messageParts = (message) => message.batch?.sources ?? [message];
export const messageMainText = (message) => message.batch ? message.batch.sources.map(part => part.mainText ?? '').join('\n') : message.mainText ?? '';
export const messageDisplayText = (message) => message.batch ? message.batch.sources.map(part => `[原消息 ${part.id}；${part.occurredAt}${part.replyTo ? '；引用 ' + part.replyTo : ''}]\n${part.text}`).join('\n\n') : message.text;
export const ObservationSchema = z.strictObject({
    conversation: ConversationSchema,
    type: z.enum(['connection.opened', 'connection.closed', 'connection.rejected', 'message.ignored', 'message.unsupported', 'message.recalled']),
    data: z.record(z.string(), z.union([z.string().max(200), z.number().finite(), z.boolean(), z.null()])),
});
/** Collision-free identity; group participants share one conversation, never one global transcript. */
export function conversationKey(agentId, c) {
    return JSON.stringify([agentId, c.channel, c.account, c.kind, c.id]);
}
