import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ConversationSchema,TaskResultAnchorSchema } from '@dafeiyu/contracts';
import type { Json } from '@dafeiyu/contracts';

export const BILI_OWNER_EXTENSION='channel-bili-owner';
export const BILI_OWNER_VERSION='0.1.0';
export const BILI_PUBLIC_SCENE=Object.freeze({channel:'bilibili',account:'public',kind:'local' as const,id:'public'});
export const BiliOwnerHashSchema=z.string().regex(/^[a-f0-9]{64}$/);
export const BiliOwnerCodeSchema=z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/);
export const BiliOwnerIdSchema=z.string().regex(/^[1-9][0-9]{0,19}$/);
export const BiliOwnerRequestSchema=z.string().regex(/^[A-Za-z0-9._:-]{1,120}$/);
export const BiliOwnerIdentitySchema=z.strictObject({agentId:z.string().min(1).max(100),profileId:z.string().regex(/^[a-z][a-z0-9._-]{0,79}$/),accountUid:BiliOwnerIdSchema,ownerUid:BiliOwnerIdSchema});
export type BiliOwnerIdentity=z.infer<typeof BiliOwnerIdentitySchema>;
export const BiliOwnerBindingSchema=z.strictObject({accountUid:BiliOwnerIdSchema,ownerUid:BiliOwnerIdSchema,loggedIn:z.literal(true),bindingStamp:BiliOwnerHashSchema});
export const BiliOwnerMessageSchema=z.strictObject({id:BiliOwnerIdSchema,seqno:BiliOwnerIdSchema,senderUid:BiliOwnerIdSchema,receiverUid:BiliOwnerIdSchema,
  type:z.number().int().nonnegative(),timestamp:z.number().int().nonnegative().max(253402300799),text:z.string().max(32000)})
;
export type BiliOwnerMessage=z.infer<typeof BiliOwnerMessageSchema>;
export const BiliOwnerPageSchema=BiliOwnerBindingSchema.extend({messages:z.array(BiliOwnerMessageSchema).max(30),hasMore:z.boolean(),nextBeforeSeqno:BiliOwnerIdSchema.nullable()})
  .refine(value=>value.messages.every(message=>message.senderUid===value.ownerUid&&message.receiverUid===value.accountUid||message.senderUid===value.accountUid&&message.receiverUid===value.ownerUid),'Unexpected private message participants')
  .refine(value=>!value.hasMore||value.messages.length>0&&value.nextBeforeSeqno!==null,'Incomplete page cursor')
  .refine(value=>new Set(value.messages.map(message=>message.id)).size===value.messages.length,'Duplicate page IDs');
export type BiliOwnerPage=z.infer<typeof BiliOwnerPageSchema>;
export const BiliOwnerSendResultSchema=z.discriminatedUnion('status',[
  z.strictObject({status:z.literal('sent'),receiptId:BiliOwnerIdSchema,accountUid:BiliOwnerIdSchema,ownerUid:BiliOwnerIdSchema,requestId:z.string().regex(/^[A-Za-z0-9_-]{8,100}$/),wireHash:BiliOwnerHashSchema}),
  z.strictObject({status:z.literal('not-dispatched'),code:BiliOwnerCodeSchema}),z.strictObject({status:z.literal('unknown'),code:BiliOwnerCodeSchema}),
]);
export type BiliOwnerSendResult=z.infer<typeof BiliOwnerSendResultSchema>;
/** Program port only. No production factory is supplied in this package substep. */
export interface BiliOwnerTransport {
  readonly identityHash:string;
  guard():void;
  verify(signal:AbortSignal,guard:()=>void):Promise<z.infer<typeof BiliOwnerBindingSchema>>;
  readOwnerPage(input:{beforeSeqno?:string;limit:number},signal:AbortSignal,guard:()=>void):Promise<BiliOwnerPage>;
  sendOwnerText(input:{requestId:string;text:string;wireHash:string},signal:AbortSignal,guard:()=>void):Promise<BiliOwnerSendResult>;
  close?():void|Promise<void>;
}
/** Acquired by the trusted launcher across profiles; the epoch is persistent ownership, not a process nonce. */
export interface BiliOwnerConsumerLease {readonly key:string;readonly epoch:number;guard():void;release():void|Promise<void>}
export interface BiliOwnerPorts {readonly transport:BiliOwnerTransport;readonly lease:BiliOwnerConsumerLease;readonly now?:()=>number}

export const BiliOwnerReplySchema=z.strictObject({id:z.string().min(1).max(200),conversation:ConversationSchema,sourceMessageId:BiliOwnerIdSchema,text:z.string().max(32000),taskResult:TaskResultAnchorSchema.optional()});
export const BiliOwnerInboundStateSchema=z.enum(['before-start','pending','accepted','unsupported','recalled']);
export const BiliOwnerDeliveryStateSchema=z.enum(['prepared','blocked','sending','sent','unknown']);
export const BiliOwnerDeliveryPlanSchema=z.strictObject({schemaVersion:z.literal(1),replyId:z.string().min(1).max(200),requestId:z.string().regex(/^[A-Za-z0-9_-]{8,100}$/),
  scene:ConversationSchema,sourceMessageId:BiliOwnerIdSchema,sourceHash:BiliOwnerHashSchema,coreInboundId:z.uuid(),anchor:TaskResultAnchorSchema.nullable(),bodyHash:BiliOwnerHashSchema,wireHash:BiliOwnerHashSchema,text:z.string().max(32000)});
export type BiliOwnerDeliveryPlan=z.infer<typeof BiliOwnerDeliveryPlanSchema>;
export interface BiliOwnerDelivery {readonly plan:BiliOwnerDeliveryPlan;readonly hash:string;readonly version:number;readonly state:z.infer<typeof BiliOwnerDeliveryStateSchema>;readonly receiptId:string|null;readonly code:string|null}
function canonical(value:Json):string{return value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key]!)).join(',')+'}';}
export const biliOwnerHash=(value:unknown)=>createHash('sha256').update(canonical(z.json().parse(value))).digest('hex');
export const biliOwnerTextHash=(value:string)=>createHash('sha256').update(value).digest('hex');
export function biliOwnerCode(error:unknown,fallback='BILI_OWNER_FAILED'):string{return error instanceof Error&&/^[A-Z][A-Z0-9_]{0,99}$/.test(error.message)?error.message:fallback;}

export type BiliOwnerAccount=Pick<BiliOwnerIdentity,'accountUid'|'ownerUid'>;
export function biliOwnerScene(identity:BiliOwnerAccount){return Object.freeze({channel:'bilibili',account:identity.accountUid,kind:'private' as const,id:identity.ownerUid});}
export function biliOwnerConsumerKey(identity:BiliOwnerAccount){return 'bilibili-owner:'+BiliOwnerIdSchema.parse(identity.accountUid)+':'+BiliOwnerIdSchema.parse(identity.ownerUid);}
