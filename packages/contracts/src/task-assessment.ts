import { z } from 'zod';

/** Model judgments are persisted separately from execution facts and delivery receipts. */
export const TaskAssessmentSchema=z.strictObject({
  goalStatus:z.enum(['met','partial','unmet','uncertain']).describe('对当前目标满足程度的判断，不改变任何程序操作状态。'),
  summary:z.string().trim().min(1).max(8000).describe('成果、意义与依据；可以提出有依据的评价，保留未知与局限。'),
  evidenceIds:z.array(z.uuid()).max(12).default([]).describe('选择与最终判断有关的实际操作标识；来源与权限由程序复核。'),
  limitations:z.array(z.string().max(1000)).max(24),unfinished:z.array(z.string().max(1000)).max(24),
  next:z.enum(['deliver','continue','wait','capability-change']).describe('建议交付、继续探索、等待补充或等待能力变更；程序验证并推进。'),
});
export type TaskAssessment=z.infer<typeof TaskAssessmentSchema>;
export const PhaseTimeoutsSchema=z.strictObject({assessment:z.number().int().min(50).max(120000).default(60000),render:z.number().int().min(50).max(120000).default(60000),verification:z.number().int().min(50).max(60000).default(30000),feedback:z.number().int().min(50).max(60000).default(15000)}).prefault({});
export function outputContract(schema:z.ZodType){return z.toJSONSchema(schema,{io:'input'});}
