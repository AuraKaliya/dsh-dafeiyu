import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { ConversationSchema,TaskResultAnchorSchema,ReplyMediaManifestSchema,ReplyMediaPartSchema,qqMessageSequence } from '@dafeiyu/contracts';
import type { Reply } from '@dafeiyu/contracts';
import { splitQqText } from './delivery.js';

function canonical(value:unknown):string{const valid=z.json().parse(value);if(valid===null||typeof valid!=='object')return JSON.stringify(valid);if(Array.isArray(valid))return '['+valid.map(canonical).join(',')+']';return '{'+Object.keys(valid).sort().map(key=>JSON.stringify(key)+':'+canonical(valid[key])).join(',')+'}';}
export const qqMediaHash=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
export const qqTextHash=(text:string)=>createHash('sha256').update(text).digest('hex');
const state=z.enum(['pending','sending','sent','unknown']);
const part=z.union([z.strictObject({kind:z.literal('text'),text:z.string().min(1).max(4000)}),ReplyMediaPartSchema]);
const planSchema=z.strictObject({version:z.literal(2),replyId:z.string(),target:ConversationSchema,sourceMessageId:z.string(),textHash:z.string().length(64),manifest:ReplyMediaManifestSchema,parts:z.array(part).min(1).max(72),originalText:z.string().max(32000).optional()});
export type QqMediaDeliveryPlan=z.infer<typeof planSchema>;
function semanticPlanHash(plan:QqMediaDeliveryPlan):string{const parts:QqMediaDeliveryPlan['parts']=[];for(const part of plan.parts){const last=parts.at(-1);if(part.kind==='text'&&last?.kind==='text')last.text+=part.text;else parts.push({...part});}return qqMediaHash({...plan,parts});}
const progressPart=z.strictObject({position:z.number().int().nonnegative(),state,receipt:z.string().nullable(),code:z.string().nullable()});
export interface QqMediaDeliveryProgress {replyId:string;planHash:string;state:'ready'|'sending'|'partial'|'uncertain'|'sent';total:number;confirmed:number;pending:number;unknown:number;parts:z.infer<typeof progressPart>[]}

/** Builds fixed bytes/identity metadata, never authorizes those bytes or invokes a platform. */
export function qqMediaDeliveryPlan(reply:Reply):QqMediaDeliveryPlan {const manifest=ReplyMediaManifestSchema.parse(reply.media);
  if(manifest.replyId!==reply.id||qqMediaHash(manifest.target)!==qqMediaHash(reply.conversation)||manifest.sourceMessageId!==reply.sourceMessageId||manifest.textHash!==qqTextHash(reply.text))throw new Error('DELIVERY_MANIFEST_MISMATCH');
  if(reply.taskResult){const anchor=TaskResultAnchorSchema.parse(reply.taskResult);if(manifest.anchor.kind!=='task-result'||qqMediaHash(anchor)!==qqMediaHash(manifest.anchor)||manifest.runId!==anchor.runId)throw new Error('DELIVERY_MANIFEST_MISMATCH');}
  else if(manifest.anchor.kind!=='reply'||reply.id!==manifest.anchor.inboundId+':reply')throw new Error('DELIVERY_MANIFEST_MISMATCH');
  const sequence=qqMessageSequence(reply.text),before=sequence.messages.slice(0,sequence.mediaAt).flatMap(splitQqText).map(text=>({kind:'text' as const,text})),after=sequence.messages.slice(sequence.mediaAt).flatMap(splitQqText).map(text=>({kind:'text' as const,text}));
  return planSchema.parse({version:2,replyId:reply.id,target:reply.conversation,sourceMessageId:reply.sourceMessageId,textHash:manifest.textHash,manifest,parts:[...before,...manifest.parts,...after],...(sequence.structured?{originalText:reply.text}:{})});
}
export class QqMediaDeliveryLedger {
  constructor(private readonly db:DatabaseSync){}
  private atomic<T>(work:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const result=work();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  plan(id:string){const row=this.db.prepare('SELECT body,plan_hash FROM qq_media_deliveries WHERE reply_id=?').get(id);if(!row)return null;const plan=planSchema.parse(JSON.parse(String(row.body)));
    if(plan.replyId!==id||qqMediaHash(plan)!==row.plan_hash)throw new Error('DELIVERY_LEDGER_CORRUPT');
    const expected=qqMediaDeliveryPlan({id:plan.replyId,conversation:plan.target,sourceMessageId:plan.sourceMessageId,text:plan.originalText??plan.parts.filter(p=>p.kind==='text').map(p=>p.text).join(''),media:plan.manifest,...(plan.manifest.anchor.kind==='task-result'?{taskResult:plan.manifest.anchor}:{})});
    if(semanticPlanHash(plan)!==semanticPlanHash(expected))throw new Error('DELIVERY_LEDGER_CORRUPT');return plan;}
  prepare(reply:Reply){const plan=qqMediaDeliveryPlan(reply);return this.atomic(()=>{const old=this.plan(reply.id);if(old){if(semanticPlanHash(old)!==semanticPlanHash(plan))throw new Error('DELIVERY_PLAN_CONFLICT');return old;}
    if(this.db.prepare('SELECT 1 FROM qq_delivery_plans WHERE reply_id=?').get(reply.id)||this.db.prepare('SELECT 1 FROM receipts WHERE reply_id=?').get(reply.id))throw new Error('DELIVERY_PROTOCOL_CONFLICT');
    this.db.prepare('INSERT INTO qq_media_deliveries VALUES(?,?,?)').run(reply.id,qqMediaHash(plan),JSON.stringify(plan));const insert=this.db.prepare("INSERT INTO qq_media_parts VALUES(?,?,'pending',NULL,NULL)");plan.parts.forEach((_part,index)=>insert.run(reply.id,index));return plan;});}
  progress(id:string):QqMediaDeliveryProgress|null {const plan=this.plan(id);if(!plan)return null;const parts=this.db.prepare('SELECT position,state,receipt,code FROM qq_media_parts WHERE reply_id=? ORDER BY position').all(id).map(r=>progressPart.parse(r));
    if(parts.length!==plan.parts.length||parts.some((p,i)=>p.position!==i||(p.state==='sent'?!p.receipt||!/^[-]?\d{1,79}$/.test(p.receipt):p.receipt!==null)))throw new Error('DELIVERY_LEDGER_CORRUPT');
    const count=(s:z.infer<typeof state>)=>parts.filter(p=>p.state===s).length,confirmed=count('sent'),pending=count('pending'),unknown=count('unknown');
    return {replyId:id,planHash:qqMediaHash(plan),state:unknown?'uncertain':count('sending')?'sending':confirmed===parts.length?'sent':confirmed?'partial':'ready',total:parts.length,confirmed,pending,unknown,parts};}
  begin(id:string,position:number){this.atomic(()=>{const status=this.progress(id);if(!status||status.unknown||status.state==='sending'||status.parts.some(p=>p.position<position&&p.state!=='sent'))throw new Error('DELIVERY_NOT_RESUMABLE');
    if(this.db.prepare("UPDATE qq_media_parts SET state='sending',code=NULL WHERE reply_id=? AND position=? AND state='pending'").run(id,position).changes!==1)throw new Error('DELIVERY_STATE_CONFLICT');});}
  confirm(id:string,position:number,receipt:string){z.string().regex(/^-?\d{1,79}$/).parse(receipt);this.atomic(()=>{if(this.db.prepare("UPDATE qq_media_parts SET state='sent',receipt=?,code=NULL WHERE reply_id=? AND position=? AND state='sending'").run(receipt,id,position).changes!==1)throw new Error('DELIVERY_STATE_CONFLICT');
    const status=this.progress(id)!;if(status.state==='sent')this.db.prepare('INSERT INTO receipts VALUES(?,?)').run(id,status.parts[0]!.receipt!);});}
  unknown(id:string,position:number,code:string){this.code(id,position,'sending','unknown',code);}
  defer(id:string,position:number,code:string){this.code(id,position,'pending','pending',code);}
  private code(id:string,position:number,from:string,to:string,code:string){z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/).parse(code);if(this.db.prepare('UPDATE qq_media_parts SET state=?,code=? WHERE reply_id=? AND position=? AND state=?').run(to,code,id,position,from).changes!==1)throw new Error('DELIVERY_STATE_CONFLICT');}
  recover(){return Number(this.db.prepare("UPDATE qq_media_parts SET state='unknown',code='PROCESS_INTERRUPTED' WHERE state='sending'").run().changes);}
  counts(){return {plans:Number(this.db.prepare('SELECT count(*) AS n FROM qq_media_deliveries').get()?.n),pending:Number(this.db.prepare("SELECT count(*) AS n FROM qq_media_parts WHERE state='pending'").get()?.n),unknown:Number(this.db.prepare("SELECT count(*) AS n FROM qq_media_parts WHERE state='unknown'").get()?.n)};}
}
