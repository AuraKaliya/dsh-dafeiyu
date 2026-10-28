import { z } from 'zod';

/** Model judgments are persisted separately from execution facts and delivery receipts. */
export const TaskReviewSchema=z.strictObject({
  goalStatus:z.enum(['met','partial','unmet','uncertain']).describe('对当前目标满足程度的判断，不改变任何程序操作状态。'),
  summary:z.string().trim().min(1).max(8000).describe('成果、意义与依据；可以提出有依据的评价，保留未知与局限。'),
  evidenceIds:z.array(z.uuid()).max(12).default([]).describe('选择与最终判断有关的实际操作标识；来源与权限由程序复核。'),
  limitations:z.array(z.string().max(1000)).max(24),unfinished:z.array(z.string().max(1000)).max(24),
  requiredCapabilities:z.array(z.string().min(1).max(160)).max(16).default([]).describe('等待能力变更时，恢复前需要实际可用的能力名称。'),
  next:z.enum(['deliver','continue','wait','capability-change']).describe('建议交付、继续探索、等待补充或等待能力变更；仅供主Agent参考，不改变任务状态。'),
});
export type TaskReview=z.infer<typeof TaskReviewSchema>;
export const PhaseTimeoutsSchema=z.strictObject({review:z.number().int().min(50).max(120000).default(60000),render:z.number().int().min(50).max(120000).default(60000),verification:z.number().int().min(50).max(60000).default(30000),feedback:z.number().int().min(50).max(60000).default(15000)}).prefault({});
export function outputContract(schema:z.ZodType){return z.toJSONSchema(schema,{io:'input'});}

export const TaskDispositionSchema=z.strictObject({next:z.enum(['complete','wait']),reason:z.string().trim().min(1).max(1000),requiredCapabilities:z.array(z.string().min(1).max(160)).max(16).default([])}).refine(value=>value.next==='wait'||value.requiredCapabilities.length===0,'Only waiting work can require capabilities');
