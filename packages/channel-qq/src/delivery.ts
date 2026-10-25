import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { ConversationSchema,TaskResultAnchorSchema } from '@dafeiyu/contracts';
import type { Reply } from '@dafeiyu/contracts';

const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const replySchema=z.strictObject({id:z.string().min(1).max(200),conversation:ConversationSchema,sourceMessageId:z.string().min(1).max(80),text:z.string().min(1).max(32000),taskResult:TaskResultAnchorSchema.optional()});
const segmentState=z.enum(['pending','sending','sent','unknown']);
const segmentSchema=z.object({position:z.number().int().nonnegative(),state:segmentState,receipt:z.string().nullable(),code:z.string().nullable()});
const planSchema=z.strictObject({version:z.literal(1),replyId:z.string(),target:ConversationSchema,anchor:z.discriminatedUnion('kind',[z.strictObject({kind:z.literal('reply'),messageId:z.string()}),TaskResultAnchorSchema.extend({messageId:z.string()})]),bodyHash:z.string(),segments:z.array(z.string().min(1).max(4000)).min(1).max(64)});
export type QqDeliveryPlan=z.infer<typeof planSchema>;
export interface QqDeliveryProgress {replyId:string;planHash:string|null;state:'ready'|'sending'|'partial'|'uncertain'|'sent';total:number;confirmed:number;pending:number;unknown:number;legacy:boolean;segments:z.infer<typeof segmentSchema>[]}

/** Fixed UTF-16 transport budget, Unicode-safe boundaries, exact reconstruction. */
export function splitQqText(text:string):string[]{
  if(!text||text.length>32000)throw new Error('TEXT_SIZE_UNSUPPORTED');
  for(const char of text){const code=char.codePointAt(0)!;if(code>=0xd800&&code<=0xdfff)throw new Error('INVALID_TEXT_ENCODING');}
  const result:string[]=[];let start=0;
  while(start<text.length){let end=Math.min(start+4000,text.length);
    if(end<text.length){if(text.charCodeAt(end-1)>=0xd800&&text.charCodeAt(end-1)<=0xdbff)end--;
      const newline=text.lastIndexOf('\n',end-1);if(newline>=start)end=newline+1;
      // Keep a CRLF pair together even when no LF fits in this window.
      if(text[end-1]==='\r'&&text[end]==='\n')end--;
    }
    result.push(text.slice(start,end));start=end;
  }
  return result;
}
export function qqDeliveryPlan(reply:Reply):QqDeliveryPlan {const value=replySchema.parse(reply);return planSchema.parse({version:1,replyId:value.id,target:value.conversation,anchor:value.taskResult?{...value.taskResult,messageId:value.sourceMessageId}:{kind:'reply',messageId:value.sourceMessageId},bodyHash:digest(value.text),segments:splitQqText(value.text)});}

/** Ledger only: no network, automatic retransmission, model calls or source authority. */
export class QqDeliveryLedger {
  constructor(private readonly db:DatabaseSync){}
  private atomic<T>(work:()=>T):T {this.db.exec('BEGIN IMMEDIATE');try{const result=work();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  private readPlan(id:string):QqDeliveryPlan|null{const row=this.db.prepare('SELECT body,plan_hash FROM qq_delivery_plans WHERE reply_id=?').get(id);if(!row)return null;
    const plan=planSchema.parse(JSON.parse(String(row.body)));if(plan.replyId!==id||digest(plan)!==row.plan_hash)throw new Error('DELIVERY_LEDGER_CORRUPT');return plan;}
  prepare(reply:Reply):QqDeliveryPlan|null {
    const plan=qqDeliveryPlan(reply),body=JSON.stringify(plan);
    return this.atomic(()=>{const previous=this.readPlan(reply.id);if(previous){if(JSON.stringify(previous)!==body)throw new Error('DELIVERY_PLAN_CONFLICT');return previous;}
      if(this.db.prepare('SELECT 1 FROM qq_media_deliveries WHERE reply_id=?').get(reply.id))throw new Error('DELIVERY_PROTOCOL_CONFLICT');
      if(this.db.prepare('SELECT 1 FROM receipts WHERE reply_id=?').get(reply.id))return null;
      this.db.prepare('INSERT INTO qq_delivery_plans VALUES(?,?,?)').run(reply.id,digest(plan),body);
      const insert=this.db.prepare("INSERT INTO qq_delivery_segments VALUES(?,?,'pending',NULL,NULL)");plan.segments.forEach((_,position)=>insert.run(reply.id,position));return plan;
    });
  }
  progress(id:string):QqDeliveryProgress|null {
    const plan=this.readPlan(id);if(!plan){const legacy=this.db.prepare('SELECT platform_id FROM receipts WHERE reply_id=?').get(id);return legacy?{replyId:id,planHash:null,state:'sent',total:1,confirmed:1,pending:0,unknown:0,legacy:true,segments:[{position:0,state:'sent',receipt:String(legacy.platform_id),code:null}]}:null;}
    const segments=this.db.prepare('SELECT position,state,receipt,code FROM qq_delivery_segments WHERE reply_id=? ORDER BY position').all(id).map(row=>segmentSchema.parse(row));
    if(segments.length!==plan.segments.length||segments.some((segment,index)=>segment.position!==index||(segment.state==='sent'?!segment.receipt||segment.receipt.length>80||!/^[-]?\d+$/.test(segment.receipt):segment.receipt!==null)))throw new Error('DELIVERY_LEDGER_CORRUPT');
    const count=(state:z.infer<typeof segmentState>)=>segments.filter(segment=>segment.state===state).length,confirmed=count('sent'),pending=count('pending'),unknown=count('unknown');
    return {replyId:id,planHash:digest(plan),state:unknown?'uncertain':count('sending')?'sending':confirmed===segments.length?'sent':confirmed?'partial':'ready',total:segments.length,confirmed,pending,unknown,legacy:false,segments};
  }
  begin(id:string,position:number):void {this.atomic(()=>{const progress=this.progress(id);if(!progress||progress.legacy||progress.unknown||progress.state==='sending'||progress.segments.some(segment=>segment.position<position&&segment.state!=='sent'))throw new Error('DELIVERY_NOT_RESUMABLE');
    if(this.db.prepare("UPDATE qq_delivery_segments SET state='sending',code=NULL WHERE reply_id=? AND position=? AND state='pending'").run(id,position).changes!==1)throw new Error('DELIVERY_STATE_CONFLICT');});}
  confirm(id:string,position:number,receipt:string):void {z.string().regex(/^-?\d+$/).max(80).parse(receipt);this.atomic(()=>{
    if(this.db.prepare("UPDATE qq_delivery_segments SET state='sent',receipt=?,code=NULL WHERE reply_id=? AND position=? AND state='sending'").run(receipt,id,position).changes!==1)throw new Error('DELIVERY_STATE_CONFLICT');
    const progress=this.progress(id)!;if(progress.state==='sent')this.db.prepare('INSERT INTO receipts VALUES(?,?)').run(id,progress.segments[0]!.receipt!);
  });}
  unknown(id:string,position:number,code:string):void{this.updateCode(id,position,'sending','unknown',code);}
  defer(id:string,position:number,code:string):void{this.updateCode(id,position,'pending','pending',code);}
  private updateCode(id:string,position:number,from:string,to:string,code:string){z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/).parse(code);
    if(this.db.prepare('UPDATE qq_delivery_segments SET state=?,code=? WHERE reply_id=? AND position=? AND state=?').run(to,code,id,position,from).changes!==1)throw new Error('DELIVERY_STATE_CONFLICT');}
  recover():number{return Number(this.db.prepare("UPDATE qq_delivery_segments SET state='unknown',code='PROCESS_INTERRUPTED' WHERE state='sending'").run().changes);}
  counts(){return {plans:Number(this.db.prepare('SELECT count(*) AS n FROM qq_delivery_plans').get()?.n),pending:Number(this.db.prepare("SELECT count(*) AS n FROM qq_delivery_segments WHERE state='pending'").get()?.n),unknown:Number(this.db.prepare("SELECT count(*) AS n FROM qq_delivery_segments WHERE state='unknown'").get()?.n)};}
}
