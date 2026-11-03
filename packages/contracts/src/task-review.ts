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
export const PhaseTimeoutsSchema=z.strictObject({review:z.number().int().min(50).max(1200000).default(300000),render:z.number().int().min(50).max(1200000).default(300000),verification:z.number().int().min(50).max(1200000).default(300000),feedback:z.number().int().min(50).max(300000).default(60000)}).prefault({});
export function outputContract(schema:z.ZodType){return z.toJSONSchema(schema,{io:'input'});}

export const TaskDispositionSchema=z.strictObject({next:z.enum(['complete','wait']).describe('当前安排已经完成时用complete；持久计划会独立继续执行，不需要让创建计划的任务一直等待。wait仅用于当前任务确实还缺少输入或外部条件。'),reason:z.string().trim().min(1).max(1000),requiredCapabilities:z.array(z.string().min(1).max(160)).max(16).default([]).describe('仅等待尚未提供的具体工具变更时填写缺失工具名；不能填写已经可调用的工具或qq.browse.v1等协议标签。等待计划下一次触发应留空。')}).refine(value=>value.next==='wait'||value.requiredCapabilities.length===0,'Only waiting work can require capabilities');
