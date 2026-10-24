import { z } from 'zod';
import { ConversationSchema } from './conversation.js';
const key=z.string().regex(/^[a-zA-Z0-9._:-]{1,120}$/);
export const TaskDeliverySubmitSchema=z.strictObject({requestId:key,jobId:z.uuid(),target:ConversationSchema});
export const TaskDeliveryStatusSchema=z.strictObject({deliveryId:z.uuid()});
export const DeliveryMaterialSchema=z.strictObject({jobId:z.uuid(),packetId:z.uuid(),inboundId:z.uuid(),target:ConversationSchema,
  question:z.string(),draft:z.string().min(1).max(4000),evidence:z.array(z.strictObject({id:z.string(),text:z.string()})).max(16),
  sourceStamp:z.string().length(64),selectionVersion:z.number().int().nonnegative(),expiresAt:z.string()});
export type DeliveryMaterial=z.infer<typeof DeliveryMaterialSchema>;
/** Native coordinator only. This stage supports explicitly simulated channels. */
export interface TaskDeliveryControl {submit(input:unknown,signal?:AbortSignal):Promise<Record<string,unknown>>;status(input:unknown):Record<string,unknown>}
