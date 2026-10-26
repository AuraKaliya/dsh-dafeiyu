import { z } from 'zod';
import { ExecutorHashSchema,ExecutorCodeSchema } from './types.js';

const count=z.number().int().nonnegative().safe();
export const EXECUTOR_IPC_VERSION=1;
export const ExecutorRouteSchema=z.strictObject({provider:z.string().min(1).max(100),model:z.string().min(1).max(160),reasoningEffort:z.string().min(1).max(80).nullable(),
  contextWindow:count.min(1024).max(2000000),maxOutputTokens:count.positive(),maxRequestBytes:count.min(1024).max(8000000)})
  .refine(route=>route.maxOutputTokens<=route.contextWindow,'Output bound exceeds context window');
export type ExecutorRoute=z.infer<typeof ExecutorRouteSchema>;
export const ExecutorCallSchema=z.strictObject({callId:z.uuid(),provider:z.string().min(1).max(100),model:z.string().min(1).max(160),reasoningEffort:z.string().min(1).max(80).nullable(),
  requestHash:ExecutorHashSchema,sessionHash:ExecutorHashSchema,inputBound:count.positive(),outputBound:count.positive(),requestBytes:count.max(8000000),purpose:z.enum(['task','compaction','session-title'])});
export type ExecutorCall=z.infer<typeof ExecutorCallSchema>;
export const ExecutorUsageSchema=z.strictObject({inputTokens:count,outputTokens:count,uncachedInputTokens:count,cacheReadTokens:count,cacheWriteTokens:count,reasoningTokens:count.nullable()})
  .refine(value=>Number.isSafeInteger(value.uncachedInputTokens+value.cacheReadTokens+value.cacheWriteTokens)&&value.inputTokens===value.uncachedInputTokens+value.cacheReadTokens+value.cacheWriteTokens&&
    (value.reasoningTokens===null||value.reasoningTokens<=value.outputTokens),'Inconsistent usage');
export type ExecutorUsage=z.infer<typeof ExecutorUsageSchema>;
export const ExecutorSettlementSchema=z.strictObject({callId:z.uuid(),reservationId:z.uuid(),usage:ExecutorUsageSchema.nullable(),finish:z.enum(['stop','tool-calls','max-tokens','error','aborted','interrupted']),durationMs:count,error:ExecutorCodeSchema.nullable()});
export type ExecutorSettlement=z.infer<typeof ExecutorSettlementSchema>;
export const ExecutorPermitSchema=z.strictObject({reservationId:z.uuid(),dispatchPermit:z.uuid()});
export type ExecutorPermit=z.infer<typeof ExecutorPermitSchema>;
const envelope={version:z.literal(EXECUTOR_IPC_VERSION),jobId:z.uuid(),nonce:ExecutorHashSchema};
export const ChildMessageSchema=z.discriminatedUnion('type',[
  z.strictObject({version:z.literal(EXECUTOR_IPC_VERSION),type:z.literal('online'),profileHash:ExecutorHashSchema}),
  z.strictObject({...envelope,type:z.literal('ready'),profileHash:ExecutorHashSchema}),
  z.strictObject({...envelope,type:z.literal('reserve'),call:ExecutorCallSchema}),
  z.strictObject({...envelope,type:z.literal('settle'),settlement:ExecutorSettlementSchema}),
  z.strictObject({...envelope,type:z.literal('done'),callId:z.uuid()}),
]);
export type ChildMessage=z.infer<typeof ChildMessageSchema>;
export const ParentMessageSchema=z.discriminatedUnion('type',[
  z.strictObject({...envelope,type:z.literal('bind'),profileHash:ExecutorHashSchema,deadline:count.positive(),route:ExecutorRouteSchema}),
  z.strictObject({...envelope,type:z.literal('active')}),
  z.strictObject({...envelope,type:z.literal('reserved'),callId:z.uuid(),permit:ExecutorPermitSchema}),
  z.strictObject({...envelope,type:z.literal('settled'),callId:z.uuid(),unknown:z.boolean()}),
  z.strictObject({...envelope,type:z.literal('denied'),callId:z.uuid(),code:ExecutorCodeSchema}),
  z.strictObject({...envelope,type:z.literal('finished'),callId:z.uuid()}),
  z.strictObject({...envelope,type:z.literal('cancel'),code:ExecutorCodeSchema}),
]);
export type ParentMessage=z.infer<typeof ParentMessageSchema>;
export interface ExecutorIpcEndpoint {send(value:unknown):Promise<void>;subscribe(message:(value:unknown)=>void,disconnected:()=>void):()=>void;disconnect():void}
export const executorError=(error:unknown,fallback='EXECUTOR_IPC_FAILED'):string=>error instanceof Error&&/^(EXECUTOR|EVALUATION)_[A-Z0-9_]{1,80}$/.test(error.message)?error.message:fallback;

/** TokenUsage input buckets are disjoint; reasoning is already included in output. */
export function normalizeExecutorUsage(raw:unknown):ExecutorUsage{
  const value=z.object({inputTokens:count,outputTokens:count,cacheReadTokens:count.optional(),cacheWriteTokens:count.optional(),reasoningTokens:count.optional(),totalTokens:count.optional()}).parse(raw),
    inputTokens=value.inputTokens+(value.cacheReadTokens??0)+(value.cacheWriteTokens??0);
  if(value.totalTokens!==undefined&&value.totalTokens!==inputTokens+value.outputTokens)throw new Error('EXECUTOR_USAGE_INVALID');
  return ExecutorUsageSchema.parse({inputTokens,outputTokens:value.outputTokens,uncachedInputTokens:value.inputTokens,cacheReadTokens:value.cacheReadTokens??0,cacheWriteTokens:value.cacheWriteTokens??0,reasoningTokens:value.reasoningTokens??null});
}
