import { z } from 'zod';
import { ConversationSchema } from './conversation.js';
import { PersonaSourceRefSchema } from './persona.js';
import type { PersonaAccess } from './persona.js';
import { NativeMediaMaterialSchema } from './media.js';
import type { NativeMediaMaterial } from './media.js';
export const TaskResultAnchorSchema=z.strictObject({kind:z.literal('task-result'),schemaVersion:z.literal(1),taskId:z.uuid(),runId:z.uuid(),inboundId:z.uuid(),target:ConversationSchema,
  intentVersion:z.number().int().positive(),authorityVersion:z.string().length(64),expiresAt:z.iso.datetime(),outcome:z.literal('waiting').optional()});
export type TaskResultAnchor=z.infer<typeof TaskResultAnchorSchema>;
export const NativeExpressionCandidateSchema=z.strictObject({source:PersonaSourceRefSchema,view:z.string().max(32000).nullable()});
export const NativeExpressionPacketSchema=z.strictObject({id:z.uuid(),version:z.number().int().positive(),anchor:TaskResultAnchorSchema,question:z.string().max(2000),
  evidence:z.array(z.strictObject({id:z.string(),kind:z.enum(['reported','inference']),text:z.string().max(32000)})).min(1).max(19),sourceStamp:z.string().length(64),resultIncluded:z.boolean(),media:NativeMediaMaterialSchema.optional()});
export type NativeExpressionPacket=z.infer<typeof NativeExpressionPacketSchema>;
/** Created by the core from persisted, verified native execution facts, never model-supplied. */
export interface NativeExpressionAccess {readonly execution:PersonaAccess;readonly anchor:TaskResultAnchor;readonly question:string;readonly output:string;
  readonly candidates:readonly z.infer<typeof NativeExpressionCandidateSchema>[];readonly opaqueInfluence:boolean;
  /** Only the Core source walk can attest that a derived target page has no unclassified input influence. */
  readonly derivedInputComplete?:boolean;readonly requestMaxBytes:number;readonly expressionPolicy?:{id:string;version:number};readonly media?:NativeMediaMaterial;guard():void;}
export interface NativeExpressionPort {readonly signal?:AbortSignal;ready():boolean;prepare(access:NativeExpressionAccess):NativeExpressionPacket;open(access:NativeExpressionAccess,id:string,purpose?:'send'|'context'):NativeExpressionPacket;
  withdraw(access:NativeExpressionAccess,id:string,version:number):void;verify(access:NativeExpressionAccess,id:string,answer:string,signal:AbortSignal,guard:()=>void):Promise<void>;}
