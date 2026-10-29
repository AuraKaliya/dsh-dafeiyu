import {z} from 'zod';
const bvid=z.string().regex(/^BV[1-9A-HJ-NP-Za-km-z]{10}$/),aid=z.string().regex(/^[1-9]\d{0,19}$/);
export const BiliBrowserRequestSchema=z.strictObject({taskId:z.uuid(),runId:z.uuid(),operationId:z.uuid(),bvid:bvid.optional(),aid:aid.optional(),section:z.enum(['video','comments','discover','frame']).default('video'),feed:z.enum(['home','popular']).optional(),positionMs:z.number().int().min(0).max(21600000).optional()}).superRefine((value,ctx)=>{
  const identified=value.bvid!==undefined||value.aid!==undefined;
  if(value.section==='discover'?identified:!identified)ctx.addIssue({code:'custom',path:['bvid'],message:'Video/comment reads require exactly one of bvid or aid; discovery must omit both'});
  if(value.bvid!==undefined&&value.aid!==undefined)ctx.addIssue({code:'custom',path:['bvid'],message:'Provide either bvid or aid, not both'});
  if(value.section==='frame'?value.positionMs===undefined:value.positionMs!==undefined)ctx.addIssue({code:'custom',path:['positionMs'],message:'Only a frame read requires an explicit video position'});
  if(value.section!=='discover'&&value.feed!==undefined)ctx.addIssue({code:'custom',path:['feed'],message:'Only discovery accepts a feed'});
});
export const BiliBrowserFrameSchema=z.strictObject({dataUrl:z.string().regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/).max(2000000),positionMs:z.number().int().nonnegative(),durationMs:z.number().int().positive()});
export const BiliBrowserResultSchema=z.strictObject({transport:z.literal('dsh-browser'),accountUid:z.string().regex(/^[1-9]\d{0,19}$/),bvid:bvid.nullable(),section:z.enum(['video','comments','discover','frame']),feed:z.enum(['home','popular']).optional(),url:z.string().max(160),title:z.string().max(300),text:z.string().max(5000),truncated:z.boolean(),observedAt:z.iso.datetime(),frame:BiliBrowserFrameSchema.optional()});
export type BiliBrowserRequest=z.infer<typeof BiliBrowserRequestSchema>;
export type BiliBrowserResult=z.infer<typeof BiliBrowserResultSchema>;
export interface BiliBrowserPort {read(request:BiliBrowserRequest,signal:AbortSignal):Promise<BiliBrowserResult>}
