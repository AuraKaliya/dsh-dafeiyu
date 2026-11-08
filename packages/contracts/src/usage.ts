import {z} from 'zod';

const count=z.number().int().nonnegative().safe();
export const ModelUsagePhaseSchema=z.enum(['conversation','task','media','review','rendering','verification','recovery','compaction','feedback','external','other']);
export type ModelUsagePhase=z.infer<typeof ModelUsagePhaseSchema>;
export const ModelUsageWorkTypeSchema=z.enum(['conversation','owner-task','patrol','exploration','maintenance','unassigned']);
export type ModelUsageWorkType=z.infer<typeof ModelUsageWorkTypeSchema>;
export const ModelUsageBreakdownSchema=z.strictObject({inputTokens:count,cacheReadTokens:count,cacheWriteTokens:count,outputTokens:count,totalTokens:count})
  .refine(value=>value.totalTokens===value.inputTokens+value.cacheReadTokens+value.cacheWriteTokens+value.outputTokens,'Usage components must sum to the reported total');
export const ModelUsageTotalsSchema=z.strictObject({calls:count,pending:count,unknownCalls:count,knownTokens:count,tokens:count.nullable(),breakdown:ModelUsageBreakdownSchema});
export const ModelUsageEnvironmentSchema=z.enum(['runtime','deterministic-test','real-validation','observation']);
export const ModelInputMeasurementSchema=z.strictObject({schemaVersion:z.literal(1),stage:z.literal('sdk-pre-adapter'),environment:ModelUsageEnvironmentSchema,inputHash:z.string().regex(/^[a-f0-9]{64}$/),
  bytes:count,messagesBytes:count,toolsBytes:count,toolHistoryBytes:count,messageCount:count,toolCount:count,measurement:z.literal('utf8-serialized-input-not-billable-tokens')});
export type ModelInputMeasurement=z.infer<typeof ModelInputMeasurementSchema>;
export const ModelInputOverviewSchema=z.strictObject({measuredCalls:count,unmeasuredCalls:count,totalBytes:count,peakBytes:count,largeInputCalls:count,repeatedInputGroups:count,
  byEnvironment:z.record(z.string(),ModelUsageTotalsSchema),warningsOnly:z.literal(true)});
export const ModelUsageOverviewSchema=ModelUsageTotalsSchema.extend({scope:z.literal('observed-local-requests'),since:z.iso.datetime().nullable(),lastAt:z.iso.datetime().nullable(),unassignedCalls:count,
  byPhase:z.partialRecord(ModelUsagePhaseSchema,ModelUsageTotalsSchema),byWorkType:z.partialRecord(ModelUsageWorkTypeSchema,ModelUsageTotalsSchema).default({}),unknownReasons:z.record(z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/),count).default({}),legacyHistory:z.literal('not-reconstructed'),inputContext:ModelInputOverviewSchema.optional()});
export type ModelUsageOverview=z.infer<typeof ModelUsageOverviewSchema>;
