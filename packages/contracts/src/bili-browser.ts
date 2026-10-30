import {z} from 'zod';
const bvid=z.string().regex(/^BV[1-9A-HJ-NP-Za-km-z]{10}$/),aid=z.string().regex(/^[1-9]\d{0,19}$/),order=z.enum(['totalrank','pubdate','click']);
export const BiliBrowserRequestSchema=z.strictObject({taskId:z.uuid(),runId:z.uuid(),operationId:z.uuid(),bvid:bvid.optional(),aid:aid.optional(),section:z.enum(['video','comments','discover','frame','frames','search']).default('video'),feed:z.enum(['home','popular']).optional(),positionMs:z.number().int().min(0).max(21600000).optional(),pointsMs:z.array(z.number().int().nonnegative().max(21600000)).min(1).max(6).optional(),keyword:z.string().trim().min(1).max(100).optional(),order:order.optional(),page:z.number().int().min(1).max(50).optional()}).superRefine((value,ctx)=>{
  const identified=value.bvid!==undefined||value.aid!==undefined,scoped=value.keyword!==undefined||value.order!==undefined||value.page!==undefined;
  if(value.section==='search'){
    if(value.keyword===undefined)ctx.addIssue({code:'custom',path:['keyword'],message:'Search reads require a keyword'});
    if(identified)ctx.addIssue({code:'custom',path:['bvid'],message:'Search reads must omit bvid and aid'});
    if(value.feed!==undefined)ctx.addIssue({code:'custom',path:['feed'],message:'Only discovery accepts a feed'});
    if(value.positionMs!==undefined)ctx.addIssue({code:'custom',path:['positionMs'],message:'Only a frame read requires an explicit video position'});
    return;
  }
  if(scoped)ctx.addIssue({code:'custom',path:['keyword'],message:'Only search reads accept keyword, order or page'});
  if(value.section==='frames'?(identified===false||value.pointsMs===undefined||value.positionMs!==undefined):value.pointsMs!==undefined)ctx.addIssue({code:'custom',path:['pointsMs'],message:'Batch frame reads require a video and 1-6 points, and only they accept pointsMs'});
  if(value.section==='discover'?identified:!identified)ctx.addIssue({code:'custom',path:['bvid'],message:'Video/comment reads require exactly one of bvid or aid; discovery must omit both'});
  if(value.bvid!==undefined&&value.aid!==undefined)ctx.addIssue({code:'custom',path:['bvid'],message:'Provide either bvid or aid, not both'});
  if(value.section==='frame'?value.positionMs===undefined:value.positionMs!==undefined)ctx.addIssue({code:'custom',path:['positionMs'],message:'Only a frame read requires an explicit video position'});
  if(value.section!=='discover'&&value.feed!==undefined)ctx.addIssue({code:'custom',path:['feed'],message:'Only discovery accepts a feed'});
});
export const BiliBrowserFrameSchema=z.strictObject({dataUrl:z.string().regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/).max(2000000),positionMs:z.number().int().nonnegative(),durationMs:z.number().int().positive()});
export const BiliBrowserSearchItemSchema=z.strictObject({bvid,title:z.string().max(160),author:z.string().max(80).default('')});
export const BiliBrowserResultSchema=z.strictObject({transport:z.literal('dsh-browser'),accountUid:z.string().regex(/^[1-9]\d{0,19}$/),bvid:bvid.nullable(),section:z.enum(['video','comments','discover','frame','frames','search']),feed:z.enum(['home','popular']).optional(),url:z.string().max(200),title:z.string().max(300),text:z.string().max(5000),truncated:z.boolean(),observedAt:z.iso.datetime(),frame:BiliBrowserFrameSchema.optional(),frames:z.array(BiliBrowserFrameSchema).max(6).optional(),frameErrors:z.array(z.strictObject({positionMs:z.number().int().nonnegative(),errorCode:z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/)})).max(6).optional(),keyword:z.string().max(100).optional(),order:order.optional(),page:z.number().int().min(1).max(50).optional(),items:z.array(BiliBrowserSearchItemSchema).max(20).optional()});
export type BiliBrowserRequest=z.infer<typeof BiliBrowserRequestSchema>;
export type BiliBrowserResult=z.infer<typeof BiliBrowserResultSchema>;
export type BiliBrowserSearchItem=z.infer<typeof BiliBrowserSearchItemSchema>;
export interface BiliBrowserPort {read(request:BiliBrowserRequest,signal:AbortSignal):Promise<BiliBrowserResult>}
