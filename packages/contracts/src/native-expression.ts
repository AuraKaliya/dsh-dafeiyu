import { z } from 'zod';
import type { TaskReview } from './task-review.js';
import type {ContextHandoff} from './context.js';
import { ConversationSchema } from './conversation.js';
import { PersonaSourceRefSchema } from './persona.js';
import type { PersonaAccess } from './persona.js';
import { NativeMediaMaterialSchema } from './media.js';
import type { NativeMediaMaterial } from './media.js';
export const OBSERVATION_EVIDENCE_RULES='涉及事实或任务汇报时，数字、单位、时间及时区应与证据一致；不能可靠换算时保留原数值和单位。空缓存、零条查询结果、缺少日志只证明本次可读范围没有观察到，不能单凭它断言消息未发生、没到入口、平台未投递，或排除插件过滤等原因。代码中的一般处理条件不能替代事发时每个条件的实际取值。接收、保存缓存、触发回复、加入上下文和允许跨会话查询是不同阶段；例如只有被提及时才触发回复，不能据此断言未提及的消息不会保存，也不能由分会话存储断言主人私聊无权查询群消息。解释条件时必须核对该条件前后的实际动作。未验证的原因不能被“要么A、要么B”式的封闭列举排除；末尾笼统的范围声明也不能纠正正文中的确定性归因。模型写出的检查脚本、注释和反思不是被检查系统的独立事实；历史聊天中的机器人旧结论也不能循环证明当前结论。采样画面或局部音频应明确观察范围，不能声称完整看完或听完全片。';
const resultAnchor=z.strictObject({schemaVersion:z.literal(1),taskId:z.uuid(),runId:z.uuid(),target:ConversationSchema,
  intentVersion:z.number().int().positive(),authorityVersion:z.string().length(64),expiresAt:z.iso.datetime(),outcome:z.literal('waiting').optional()});
export const TaskResultAnchorSchema=z.discriminatedUnion('kind',[resultAnchor.extend({kind:z.literal('task-result'),inboundId:z.uuid()}),resultAnchor.extend({kind:z.literal('activity-result'),shareId:z.uuid()})]);
export type TaskResultAnchor=z.infer<typeof TaskResultAnchorSchema>;
export const NativeExpressionCandidateSchema=z.strictObject({source:PersonaSourceRefSchema,view:z.string().max(32000).nullable()});
export const NativeExpressionPacketSchema=z.strictObject({id:z.uuid(),version:z.number().int().positive(),anchor:TaskResultAnchorSchema,question:z.string(),
  evidence:z.array(z.strictObject({id:z.string(),kind:z.enum(['reported','inference']),text:z.string()})).min(1),sourceStamp:z.string().length(64),resultIncluded:z.boolean(),media:NativeMediaMaterialSchema.optional()});
export type NativeExpressionPacket=z.infer<typeof NativeExpressionPacketSchema>;
export const NativeVerificationFeedbackSchema=z.strictObject({kind:z.literal('delivery-fidelity'),issues:z.array(z.string().min(1).max(600)).min(1).max(16)});
/** Created by the core from persisted, verified native execution facts, never model-supplied. */
export interface NativeExpressionAccess {readonly execution:PersonaAccess;readonly anchor:TaskResultAnchor;readonly question:string;readonly output:string;
  readonly handoff?:ContextHandoff;
  readonly review?:TaskReview;
  readonly operationalEvidence?:readonly NativeExpressionPacket['evidence'][number][];
  /** Core-owned synchronous read scope only; caller rechecks guard after it returns. */
  readSources?(read:()=>void):void;
  readonly candidates:readonly z.infer<typeof NativeExpressionCandidateSchema>[];readonly opaqueInfluence:boolean;
  /** Only the Core source walk can attest that a derived target page has no unclassified input influence. */
  readonly derivedInputComplete?:boolean;readonly requestMaxBytes:number;readonly maxTokens:number;readonly expressionPolicy?:{id:string;version:number};readonly media?:NativeMediaMaterial;guard():void;}
export interface NativeExpressionPort {readonly signal?:AbortSignal;ready():boolean;prepare(access:NativeExpressionAccess):NativeExpressionPacket;open(access:NativeExpressionAccess,id:string,purpose?:'send'|'context'):NativeExpressionPacket;
  withdraw(access:NativeExpressionAccess,id:string,version:number):void;verify(access:NativeExpressionAccess,id:string,answer:string,signal:AbortSignal,guard:()=>void):Promise<void>;}
