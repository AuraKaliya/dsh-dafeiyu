import { z } from 'zod';
import type { ActionContext,Json } from './index.js';
import type { OperationScope } from './history.js';

/** Explicit tool-owned facts, not a heuristic interpretation of arbitrary output text. */
export const ToolFeedbackSchema=z.strictObject({
  schemaVersion:z.literal(1),outcome:z.enum(['succeeded','failed','partial','unknown','running']),
  effects:z.enum(['none','applied','partial','unknown']),
  completeness:z.enum(['complete','partial','unknown']),resourceVersion:z.string().min(1).max(160),
  summary:z.string().max(1000),
  diagnostics:z.array(z.strictObject({code:z.string().regex(/^[A-Z0-9_.:-]{1,64}$/),message:z.string().max(1000)})).max(12),
  receipts:z.array(z.string().max(300)).max(16),
  sourceRefs:z.array(z.string().min(1).max(300)).max(8),
  data:z.json(),
});
export type ToolFeedback=z.infer<typeof ToolFeedbackSchema>;
export const FeedbackWitnessSchema=z.strictObject({id:z.uuid(),version:z.number().int().positive(),hash:z.string().regex(/^[a-f0-9]{64}$/),
  mode:z.enum(['normal','history','deleted']),view:z.enum(['brief','page']),traceId:z.string()});
export type FeedbackWitness=z.infer<typeof FeedbackWitnessSchema>;
export interface FeedbackRequest {
  readonly context:ActionContext;
  readonly pluginId:string;
  readonly pluginVersion:string;
  readonly action:string;
  readonly origin:'returned'|'exception';
}
export interface FeedbackDelivery {readonly value:Json;readonly witness:FeedbackWitness|null}
export interface FeedbackProvider {
  capture(request:FeedbackRequest,raw:Json):Promise<FeedbackDelivery>;
  /** Only this provider's own read actions may issue historical/deleted view witnesses. */
  present(context:ActionContext,raw:Json):FeedbackDelivery;
  validate(scope:Pick<OperationScope,'agentId'|'route'|'traceId'>,witness:FeedbackWitness):boolean;
}
export const FEEDBACK_RETIRED_TEXT=JSON.stringify({kind:'dafeiyu-feedback-retired',status:'unavailable',untrustedEvidence:true,
  note:'此前的工具反馈视图已失效。需要时通过归档接口重新核对，不能据此重放原操作。'});
export const FeedbackMetaSchema=z.strictObject({owner:z.string(),witness:FeedbackWitnessSchema,viewHash:z.string().regex(/^[a-f0-9]{64}$/)});
export type FeedbackMeta=z.infer<typeof FeedbackMetaSchema>;
export class FeedbackCaptureError extends Error {
  constructor(readonly code:'ARCHIVE_CAPACITY_EXCEEDED'){super(code);}
}
