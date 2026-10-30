import { z } from 'zod';

export const FeedbackReceiptLookupSchema = z.strictObject({
  feedbackId: z.uuid(),
  route: z.string().min(1).max(2000),
  deliveryId: z.string().min(1).max(300),
});
export type FeedbackReceiptLookup = z.infer<typeof FeedbackReceiptLookupSchema>;

/**
 * Optional deployment port. A channel that can query a delivery receipt by deliveryId
 * may resolve an unknown feedback send; absence leaves the record parked for manual review.
 */
export interface FeedbackReceiptPort {
  lookup(input: FeedbackReceiptLookup): Promise<{ state: 'sent' | 'not-sent' | 'unknown'; receiptId?: string }>;
}
