import { z } from 'zod';
import type { Conversation } from './index.js';
import {ConversationSchema} from './conversation.js';

export const ContextStageSchema=z.enum(['conversation','exploration','assessment','feedback','delivery','verification','recovery']);
export type ContextStage=z.infer<typeof ContextStageSchema>;
const requestSource=z.strictObject({conversation:ConversationSchema,messageId:z.string(),occurredAt:z.iso.datetime(),text:z.string().max(32000)});
export const ContextHandoffSchema=z.strictObject({schemaVersion:z.literal(1),stage:ContextStageSchema,
  task:z.strictObject({taskId:z.uuid(),runId:z.uuid(),intentVersion:z.number().int().nonnegative()}).nullable(),
  goal:z.string().max(32000),originalRequest:requestSource.nullable(),latestRequest:requestSource.nullable(),
  facts:z.record(z.string(),z.json()),note:z.string().max(2000)});
export type ContextHandoff=z.infer<typeof ContextHandoffSchema>;
export const ContextAssemblySchema=z.strictObject({
  mode:z.enum(['legacy','unified']).default('legacy'),
  deadlineMs:z.number().int().min(50).max(30000).default(5000),
  recall:z.strictObject({enabled:z.boolean().default(true),strategy:z.enum(['lexical','hybrid']).default('lexical'),
    candidates:z.number().int().min(1).max(64).default(32),limit:z.number().int().min(1).max(12).default(6),
    maxBytes:z.number().int().min(256).max(16000).default(5000),timeoutMs:z.number().int().min(50).max(5000).default(500)}).prefault({}),
  background:z.strictObject({enabled:z.boolean().default(true),windowMs:z.number().int().min(1000).max(86400000).default(900000),
    limit:z.number().int().min(1).max(32).default(12),maxBytes:z.number().int().min(256).max(16000).default(4000)}).prefault({}),
  recentState:z.strictObject({enabled:z.boolean().default(true),shared:z.boolean().default(false),maxBytes:z.number().int().min(256).max(8000).default(3000)}).prefault({}),
});
export type ContextAssembly=z.infer<typeof ContextAssemblySchema>;
export const ContextRegionPolicySchema=z.strictObject({maxBytes:z.number().int().min(0).max(128000).default(4000),
  priority:z.number().int().min(0).max(1000).default(100),required:z.boolean().default(false)});
export const ContextBudgetSchema=z.strictObject({maxBytes:z.number().int().min(0).max(256000).default(16000),
  requestMaxBytes:z.number().int().min(1000).max(2000000).default(1000000),
  outputReserveBytes:z.number().int().min(0).max(256000).default(16000),
  prepareTimeoutMs:z.number().int().min(50).max(30000).default(5000),
  regions:z.record(z.string().min(1).max(160),ContextRegionPolicySchema).default({}),assembly:ContextAssemblySchema.prefault({})});
export type ContextBudget=z.infer<typeof ContextBudgetSchema>;

/** Opaque by identity at the core boundary; only issued during a context preparation cycle. */
export interface ContextRequest {
  readonly conversation: Conversation;
  readonly sourceMessageId: string;
  readonly signal: AbortSignal;
}
export const ContextItemSchema=z.strictObject({
  id:z.string().min(1).max(160),version:z.string().min(1).max(160),text:z.string().min(1).max(16000),
  sources:z.array(z.strictObject({ref:z.string().min(1).max(300),version:z.string().max(160),hash:z.string().max(160)})).min(1).max(16),
  expiresAt:z.iso.datetime(),
});
export type ContextItem=z.infer<typeof ContextItemSchema>;
export interface ContextContributor {
  readonly id:string;
  readonly kind:'working-state'|'evidence'|'operational-fact';
  /** Return only selected atomic entries. Never return a whole analysis report or search hit list. */
  prepare(request:ContextRequest):Promise<readonly ContextItem[]>;
  /** Synchronous admission check; false retires the entry without affecting other contributors. */
  validate(request:ContextRequest,item:Readonly<ContextItem>):boolean;
}
