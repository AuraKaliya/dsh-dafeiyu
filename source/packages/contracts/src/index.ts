import { z } from 'zod';
import { ConversationSchema } from './conversation.js';
import { MediaAttachmentSchema } from './media.js';
import type { Conversation } from './conversation.js';
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
import type { TaskExpressionProvider } from './expression.js';
import type { TaskMemoryProvider } from './task-memory.js';
import type { TaskPluginAPI,TaskWorkspaceProvider } from './task-workspace.js';
import type { MemoryObservationProvider,ObservationReceipt } from './observation.js';
import type { CompactionProvider } from './compaction.js';
import type { ContextContributor } from './context.js';
import type { FeedbackProvider } from './feedback.js';
import type { TaskResultAnchor } from './native-expression.js';
import type { ReplyMediaManifest } from './media-delivery.js';

export const API_VERSION = 2 as const;
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const id = z.string().min(1).max(160);
export const MessageSchema = z.strictObject({
  id, occurredAt: z.iso.datetime({ offset: true }),
  conversation: ConversationSchema,
  sender: z.strictObject({ id, displayName: z.string().max(200) }),
  text: z.string().min(1).max(32_000),
  mainText: z.string().max(32_000).optional(),
  media:z.array(MediaAttachmentSchema).max(8).optional(),
  replyTo: id.optional(),
});
export type InboundMessage = z.infer<typeof MessageSchema>;
export const ObservationSchema = z.strictObject({
  conversation: ConversationSchema,
  type: z.enum(['connection.opened', 'connection.closed', 'connection.rejected', 'message.ignored', 'message.unsupported', 'message.recalled']),
  data: z.record(z.string(), z.union([z.string().max(200), z.number().finite(), z.boolean(), z.null()])),
});
export type Observation = z.infer<typeof ObservationSchema>;

/** Collision-free identity; group participants share one conversation, never one global transcript. */
export function conversationKey(agentId: string, c: Conversation): string {
  return JSON.stringify([agentId, c.channel, c.account, c.kind, c.id]);
}
export interface PersonaSnapshot { readonly text: string; readonly version: string }
export interface SourceRef {
  readonly kind: 'message' | 'session' | 'event'; readonly id: string; readonly seq?: number;
  /** Explicit origin on new evidence. Legacy references inherit their anchor's route. */
  readonly route?: string;
}
export interface Reply {
  readonly id: string;
  readonly conversation: Conversation;
  readonly sourceMessageId: string;
  readonly text: string;
  readonly taskResult?:TaskResultAnchor;
  readonly media?:ReplyMediaManifest;
}
export type DeliveryResult =
  | { readonly status: 'sent'; readonly receiptId: string }
  | { readonly status: 'not-sent'; readonly code: string }
  | { readonly status: 'unknown'; readonly code: string };
export interface ChannelCapability {
  readonly channel: string;
  readonly account: string;
  /** Actual transport capabilities/limits, independent of the model's own modalities. */
  readonly description?: string;
  readonly taskDelivery?:'simulated';
  /** Opt-in for persistent reply source rebinding and checks before every transport part. */
  readonly deliveryValidation?:'per-segment';
  readonly mediaDelivery?:'parts-v1';
  /** Throwing means unknown delivery, not confirmed failure. Must respect cancellation. */
  deliver(reply: Reply, signal: AbortSignal, authority?: () => void): Promise<DeliveryResult>;
  deliverMedia?(reply:Reply&{media:ReplyMediaManifest},signal:AbortSignal,authority:()=>void,bytes:(mediaPosition:number)=>Promise<Uint8Array>):Promise<DeliveryResult>;
  /** Separate from the legacy simulated-task contract; caller supplies a verified task-result anchor. */
  deliverTaskResult?(reply:Reply,anchor:TaskResultAnchor,signal:AbortSignal,authority:()=>void):Promise<DeliveryResult>;
}
export interface ActionContext {
  readonly operationId: string;
  readonly conversation: Conversation;
  readonly sourceMessageId: string;
  readonly signal: AbortSignal;
}
/** Phase one supports named string fields only; richer schemas require an interface version change. */
export interface ActionCapability {
  readonly name: string;
  readonly description: string;
  readonly fields: Readonly<Record<string, { readonly description: string; readonly required: boolean }>>;
  execute(args: Readonly<Record<string, string>>, context: ActionContext): Promise<Json>;
  /** Opt in to structured feedback, or declare a provider-owned archive reader. Legacy tools are unchanged. */
  readonly feedback?: 'structured-v1'|'archive-view';
}
export interface Extension {
  readonly id: string;
  readonly version: string;
  readonly apiVersion: number;
  readonly agentId: string;
  /** Optional managed-host readiness; no change to legacy action or message contracts. */
  readonly lifecycleReady?: () => boolean;
  readonly channels?: readonly ChannelCapability[];
  readonly actions?: readonly ActionCapability[];
  readonly contexts?: readonly ContextContributor[];
  readonly feedbackProvider?:FeedbackProvider;
  readonly compactionProvider?: CompactionProvider;
  readonly memoryObservationProvider?:MemoryObservationProvider;
  readonly taskWorkspaceProvider?:TaskWorkspaceProvider;
  readonly taskMemoryProvider?:TaskMemoryProvider;
  readonly taskExpressionProvider?:TaskExpressionProvider;
}
export type MessageState = 'accepted' | 'processing' | 'reply-ready' | 'sending' | 'delivered' | 'failed' | 'uncertain';
export interface Receipt { readonly id: string; readonly duplicate: boolean; readonly state: MessageState }
/** An opaque handle binds ingestion to the registered extension, never to a claimed payload plugin ID. */
export interface ExtensionHandle {
  readonly tasks:TaskPluginAPI;
  ingest(message: unknown): Receipt;
  /** Records transport/processing facts without opening a model turn. */
  observe(event: Observation): string;
  /** Completed producer-selected observation; never starts a model turn. */
  observeMemory(input:unknown,context?:ActionContext):ObservationReceipt;
  openObservationSource(input:unknown,context?:ActionContext):Record<string,unknown>;
  changeObservationSource(input:unknown,context?:ActionContext):Record<string,unknown>;
  dispose(): void;
}
export interface EventRecord {
  readonly schemaVersion: 1;
  readonly seq: number;
  readonly id: string;
  readonly agentId: string;
  readonly route: string;
  readonly traceId: string;
  readonly operationId: string;
  readonly causedBy: string | null;
  readonly type: string;
  readonly plugin: string;
  readonly pluginVersion: string;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly visibility: { readonly kind: 'conversation'; readonly route: string };
  readonly sources: readonly SourceRef[];
  /** Audit metadata only. Do not place credentials, arbitrary tool output, or model reasoning here. */
  readonly data: Readonly<Record<string, Json>>;
}
export interface PendingMessage {
  readonly id: string;
  readonly route: string;
  readonly extensionId: string;
  readonly message: InboundMessage;
  readonly state: MessageState;
  readonly sessionId: string;
  readonly reply: Reply | null;
}
