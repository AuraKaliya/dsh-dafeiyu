import {z} from 'zod';
import {TaskDeliveryCountsSchema} from './task-progress.js';

export const DELIVERY_MAX_DRAFTS = 3;
export const DeliveryRecoveryRequestSchema = z.strictObject({
  requestId: z.string().regex(/^[a-zA-Z0-9._:-]{1,120}$/),
  expectedVersion: z.number().int().positive(),
});
export type DeliveryRecoveryRequest = z.infer<typeof DeliveryRecoveryRequestSchema>;
export const DeliveryRecoveryReceiptSchema = DeliveryRecoveryRequestSchema.extend({
  runId: z.uuid(), deliveryId: z.uuid(), phase: z.enum(['rendering','verification','sending']),
  transportCounts:TaskDeliveryCountsSchema.nullable().default(null),
  requestedAt: z.iso.datetime(),
});
export type DeliveryRecoveryReceipt = z.infer<typeof DeliveryRecoveryReceiptSchema>;
export const DeliveryRecoveryViewSchema = z.strictObject({
  available: z.boolean(), phase: z.enum(['rendering','verification','sending']).nullable(),
  reason: z.string().nullable(), pendingRequestId: z.string().nullable(),
  lastError: z.string().nullable(),
  draftCount: z.number().int().nonnegative(),
});
export type DeliveryRecoveryView = z.infer<typeof DeliveryRecoveryViewSchema>;
