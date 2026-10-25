import { z } from 'zod';
import { ConversationSchema } from './conversation.js';
import { MediaAssetRefSchema } from './media.js';
import { TaskResultAnchorSchema } from './native-expression.js';
import { ExecutionScopeSchema } from './execution.js';
import { PersonaRequestIdSchema } from './persona.js';
import type { PersonaAccess } from './persona.js';

const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const ReplyMediaPartSchema=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('image'),asset:MediaAssetRefSchema.refine(a=>a.kind==='image')}),
  z.strictObject({kind:z.literal('record'),asset:MediaAssetRefSchema.refine(a=>a.kind==='audio')}),
  z.strictObject({kind:z.literal('file'),asset:MediaAssetRefSchema,name:z.string().min(1).max(160).refine(v=>!/[\\/\x00-\x1f:]/.test(v))}),
]);
export type ReplyMediaPart=z.infer<typeof ReplyMediaPartSchema>;
/** Integrity data only: a transport also needs the core's live authorization and authoritative manifest lookup. */
export const ReplyMediaManifestSchema=z.strictObject({schemaVersion:z.literal(1),id:z.uuid(),replyId:z.string().min(1).max(200),runId:z.uuid(),target:ConversationSchema,sourceMessageId:z.string().min(1).max(80),
  anchor:z.discriminatedUnion('kind',[z.strictObject({kind:z.literal('reply'),inboundId:z.uuid()}),TaskResultAnchorSchema]),
  textHash:hash,draft:z.strictObject({id:z.uuid(),version:z.number().int().positive()}),parts:z.array(ReplyMediaPartSchema).min(1).max(8),sourceStamp:hash,credential:hash,expiresAt:z.iso.datetime()})
  .refine(v=>v.parts.every(p=>p.asset.bytes<=16*1024**2)&&v.parts.reduce((n,p)=>n+p.asset.bytes,0)<=32*1024**2,'Media delivery byte budget exceeded');
export type ReplyMediaManifest=z.infer<typeof ReplyMediaManifestSchema>;
export const MediaReplyAuthoritySchema=z.strictObject({schemaVersion:z.literal(1),id:z.uuid(),runId:z.uuid(),operationId:z.uuid(),scope:ExecutionScopeSchema,intentVersion:z.number().int().nonnegative(),hash});
export type MediaReplyAuthority=z.infer<typeof MediaReplyAuthoritySchema>;
export const MediaReplyDraftInputSchema=z.strictObject({requestId:PersonaRequestIdSchema,expectedVersion:z.number().int().nonnegative(),
  parts:z.array(z.discriminatedUnion('kind',[z.strictObject({kind:z.literal('asset'),asset:MediaAssetRefSchema}),z.strictObject({kind:z.literal('final-voice')})])).max(8)});
/** Core-created, short-lived access to a persisted completed reply. Never constructed from model input. */
export interface MediaReplyAccess {readonly execution:PersonaAccess;readonly authority:MediaReplyAuthority;readonly payloadHash:string;
  readonly replyId:string;readonly text:string;readonly target:z.infer<typeof ConversationSchema>;readonly sourceMessageId:string;readonly inboundId:string;
  readonly anchor:z.infer<typeof ReplyMediaManifestSchema>['anchor'];readonly expiresAt:string;guard():void;release():void;}
