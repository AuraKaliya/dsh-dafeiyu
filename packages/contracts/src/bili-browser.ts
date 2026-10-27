import {z} from 'zod';
export const BiliBrowserRequestSchema=z.strictObject({taskId:z.uuid(),runId:z.uuid(),operationId:z.uuid(),bvid:z.string().regex(/^BV[1-9A-HJ-NP-Za-km-z]{10}$/),section:z.enum(['video','comments']).default('video')});
export const BiliBrowserResultSchema=z.strictObject({transport:z.literal('dsh-browser'),accountUid:z.string().regex(/^[1-9]\d{0,19}$/),bvid:BiliBrowserRequestSchema.shape.bvid,section:z.enum(['video','comments']),url:z.string().max(160),title:z.string().max(300),text:z.string().max(5000),truncated:z.boolean(),observedAt:z.iso.datetime()});
export type BiliBrowserRequest=z.infer<typeof BiliBrowserRequestSchema>;
export type BiliBrowserResult=z.infer<typeof BiliBrowserResultSchema>;
export interface BiliBrowserPort {read(request:BiliBrowserRequest,signal:AbortSignal):Promise<BiliBrowserResult>}
