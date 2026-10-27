import {z} from 'zod';
const bvid=z.string().regex(/^BV[1-9A-HJ-NP-Za-km-z]{10}$/);
export const BiliBrowserRequestSchema=z.strictObject({taskId:z.uuid(),runId:z.uuid(),operationId:z.uuid(),bvid:bvid.optional(),section:z.enum(['video','comments','discover']).default('video')}).superRefine((value,ctx)=>{
  if(value.section==='discover'?value.bvid!==undefined:value.bvid===undefined)ctx.addIssue({code:'custom',path:['bvid'],message:'Video/comment reads require bvid; discovery must omit it'});
});
export const BiliBrowserResultSchema=z.strictObject({transport:z.literal('dsh-browser'),accountUid:z.string().regex(/^[1-9]\d{0,19}$/),bvid:bvid.nullable(),section:z.enum(['video','comments','discover']),url:z.string().max(160),title:z.string().max(300),text:z.string().max(5000),truncated:z.boolean(),observedAt:z.iso.datetime()});
export type BiliBrowserRequest=z.infer<typeof BiliBrowserRequestSchema>;
export type BiliBrowserResult=z.infer<typeof BiliBrowserResultSchema>;
export interface BiliBrowserPort {read(request:BiliBrowserRequest,signal:AbortSignal):Promise<BiliBrowserResult>}
