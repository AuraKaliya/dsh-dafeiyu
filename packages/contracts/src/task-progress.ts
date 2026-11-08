import {z} from 'zod';

const count=z.number().int().nonnegative();
export const TASK_PROGRESS_RULE='任务进度以progress.goal、progress.execution和progress.delivery分别解释：state/completed只表示执行结束，不证明目标全部满足或结果送达。goalStatus是主Agent的明确判断，复核建议单列；未作判断时保持uncertain。计划保存只证明配置版本，工具目录不证明实际读取；发送以渠道回执为准。';
export const TaskDeliveryCountsSchema=z.strictObject({total:z.number().int().positive().max(72),confirmed:count,pending:count,sending:count,unknown:count,
  receiptIds:z.array(z.string().min(1))}).refine(value=>value.total===value.confirmed+value.pending+value.sending+value.unknown&&value.confirmed===value.receiptIds.length,'Inconsistent delivery counts');
export const TaskProgressSchema=z.strictObject({schemaVersion:z.literal(1),taskId:z.uuid(),runId:z.uuid(),version:z.string().length(64),
  currentIntent:z.boolean(),currentRun:z.boolean(),latestRunId:z.uuid(),taskState:z.enum(['active','paused','completed']),
  goal:z.strictObject({status:z.enum(['met','partial','unmet','uncertain']),source:z.enum(['agent','none']),reviewStatus:z.enum(['met','partial','unmet','uncertain']).nullable(),programVerified:z.literal(false)}),
  execution:z.strictObject({state:z.enum(['accepted','queued','running','waiting','cancelling','continued','completed','failed','cancelled','interrupted']),phase:z.string().nullable(),version:count}),
  delivery:z.strictObject({state:z.enum(['none','accepted','rendering','verifying','ready','sending','sent','not-sent','partial','uncertain','rejected','interrupted']),version:count,counts:TaskDeliveryCountsSchema.nullable()}),
  facts:z.strictObject({confirmedOperations:count,unknownEffects:count,
    plans:z.array(z.strictObject({id:z.uuid(),version:count,intervalMs:count.nullable(),configurationOnly:z.literal(true)})),
    inspection:z.strictObject({catalogCalls:count,dispatchCalls:count,resultReads:count,partialReads:count,failedCalls:count,failedCommands:count})}),
  blocked:z.strictObject({code:z.string().nullable(),reason:z.string()}),
  next:z.strictObject({action:z.enum(['none','wait','resume-task','resume-delivery','verify-delivery','review-result','review-source']),label:z.string()}),
  labels:z.strictObject({goal:z.string(),execution:z.string(),delivery:z.string()}),
});
export type TaskProgress=z.infer<typeof TaskProgressSchema>;
