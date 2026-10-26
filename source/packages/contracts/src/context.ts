import { z } from 'zod';
import type { Conversation } from './index.js';

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
