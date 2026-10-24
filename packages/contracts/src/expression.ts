import { z } from 'zod';
import { ConversationSchema } from './conversation.js';
const key=z.string().regex(/^[a-zA-Z0-9._:-]{1,120}$/);
export const ExpressionPolicySchema=z.strictObject({requestId:key,id:key,expectedVersion:z.number().int().nonnegative(),enabled:z.boolean(),target:ConversationSchema,
  sources:z.array(z.strictObject({conversation:ConversationSchema,id:z.uuid(),revision:z.number().int().positive(),version:z.number().int().positive(),contentHash:z.string().regex(/^[a-f0-9]{64}$/)})).min(1).max(16),reason:z.string().min(1).max(300)});
export const ExpressionPrepareSchema=z.strictObject({requestId:key,inboundId:z.uuid(),linkIds:z.array(z.uuid()).max(16),slots:z.array(key).max(8).default([]),
  policy:z.strictObject({id:key,version:z.number().int().positive()}).optional()});
export const ExpressionOpenSchema=z.strictObject({packetId:z.uuid(),target:ConversationSchema});
export const ExpressionGenerateSchema=z.strictObject({requestId:key,packetId:z.uuid(),target:ConversationSchema});
export const ExpressionResultSchema=z.strictObject({jobId:z.uuid(),target:ConversationSchema});
export const ExpressionWithdrawSchema=z.strictObject({requestId:key,packetId:z.uuid(),expectedVersion:z.number().int().positive()});
/** Target-bound materials, not send authorization. Only the native coordinator owns this API. */
export interface TaskExpressionControl {
  prepare(input:unknown):Record<string,unknown>;
  open(input:unknown):Record<string,unknown>;
  generate(input:unknown,signal?:AbortSignal):Promise<Record<string,unknown>>;
  result(input:unknown):Record<string,unknown>;
  withdraw(input:unknown):Record<string,unknown>;
}
export interface TaskExpressionProvider {
  policy(agentId:string,input:z.output<typeof ExpressionPolicySchema>):Record<string,unknown>;
  prepare(agentId:string,taskId:string,input:z.output<typeof ExpressionPrepareSchema>):Record<string,unknown>;
  open(agentId:string,taskId:string,input:z.output<typeof ExpressionOpenSchema>):Record<string,unknown>;
  generate(agentId:string,taskId:string,input:z.output<typeof ExpressionGenerateSchema>,signal:AbortSignal,guard:()=>void):Promise<Record<string,unknown>>;
  result(agentId:string,taskId:string,input:z.output<typeof ExpressionResultSchema>):Record<string,unknown>;
  withdraw(agentId:string,taskId:string,input:z.output<typeof ExpressionWithdrawSchema>):Record<string,unknown>;
}
