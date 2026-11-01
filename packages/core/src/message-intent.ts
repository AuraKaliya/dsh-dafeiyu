import {z} from 'zod';
import {MessageTaskSourceSchema,ToolStageSchema} from '@dafeiyu/contracts';

/** A frozen program decision. Replaying it applies the same task revision and scheduling request. */
export const MessageIntentPlanSchema=z.strictObject({
  schemaVersion:z.literal(1),bindingId:z.string(),inboundId:z.uuid(),messageHash:z.string().length(64),
  relation:z.enum(['new','amend','confirm','continue','retry','status']),
  targetRunId:z.uuid().nullable(),taskId:z.uuid().nullable(),expectedVersion:z.number().int().positive().nullable(),
  revise:z.boolean(),goal:z.string().min(1),title:z.string().min(1).max(200),
  source:MessageTaskSourceSchema,toolStage:ToolStageSchema.optional(),
});
export type MessageIntentPlan=z.infer<typeof MessageIntentPlanSchema>;
