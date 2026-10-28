import {z} from 'zod';
import {ExecutionScopeSchema} from './execution.js';
import {SourceDependencySchema} from './compaction.js';

export const RecentStateSaveSchema=z.strictObject({requestId:z.string().regex(/^[a-zA-Z0-9._:-]{1,120}$/),id:z.uuid().optional(),expectedVersion:z.number().int().nonnegative(),
  text:z.string().trim().min(1).max(1200),topics:z.array(z.string().trim().min(1).max(48)).max(8),
  motivation:z.enum(['delegated','self-directed','mixed','unknown']),status:z.enum(['active','dormant','withdrawn']),expiresAt:z.iso.datetime()});
export const RecentStatePublishSchema=z.strictObject({requestId:z.string().regex(/^[a-zA-Z0-9._:-]{1,120}$/),id:z.uuid(),expectedVersion:z.number().int().positive(),
  view:z.string().trim().min(1).max(800)});
export const RecentStateUnpublishSchema=z.strictObject({requestId:z.string().regex(/^[a-zA-Z0-9._:-]{1,120}$/),publication:z.uuid(),expectedVersion:z.number().int().positive()});
export const RecentStateRecordSchema=z.strictObject({schemaVersion:z.literal(1),id:z.uuid(),version:z.number().int().positive(),scope:ExecutionScopeSchema,
  runId:z.uuid(),operationId:z.string(),text:z.string().max(1200),topics:z.array(z.string().max(48)).max(8),motivation:z.enum(['delegated','self-directed','mixed','unknown']),
  originMotivation:z.string().max(60),status:z.enum(['active','dormant','withdrawn']),expiresAt:z.iso.datetime(),createdAt:z.iso.datetime(),updatedAt:z.iso.datetime(),
  sources:z.array(SourceDependencySchema).min(1).max(128),claimType:z.literal('self_report')});
export type RecentStateRecord=z.infer<typeof RecentStateRecordSchema>;
