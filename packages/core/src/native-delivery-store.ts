import { createHash,randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { TaskResultAnchorSchema } from '@dafeiyu/contracts';
import type { Json,TaskResultAnchor,Conversation } from '@dafeiyu/contracts';
const canonical=(value:Json):string=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(canonical).join(',')}]`:`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key]!)}`).join(',')}}`;
export const nativeDeliveryHash=(value:unknown)=>createHash('sha256').update(canonical(z.json().parse(value))).digest('hex');
const stateSchema=z.enum(['accepted','rendering','verifying','ready','sending','sent','not-sent','partial','uncertain','rejected','interrupted']);
export type NativeDeliveryState=z.infer<typeof stateSchema>;
const materialSchema=z.strictObject({packetId:z.uuid(),sourceStamp:z.string().length(64),foundationHash:z.string().length(64),personaHash:z.string().length(64),modelHash:z.string().length(64),mediaStamp:z.string().length(64).optional()});
export type NativeDeliveryMaterial=z.infer<typeof materialSchema>;
const renderRef=z.strictObject({sessionId:z.string(),messageSeq:z.number().int().positive(),turnEndSeq:z.number().int().positive(),textHash:z.string().length(64)});
const rowSchema=z.object({id:z.uuid(),run_id:z.uuid(),state:stateSchema,version:z.number().int().positive(),anchor:z.string(),material:z.string().nullable(),render_ref:z.string().nullable(),body:z.string().nullable(),credential:z.string().nullable(),receipt:z.string().nullable(),error:z.string().nullable()});
export function migrateNativeDeliveries(db:DatabaseSync){const version=Number(db.prepare('PRAGMA user_version').get()?.user_version);
  if(version===3||version===4){db.prepare('SELECT * FROM native_deliveries LIMIT 0').all();return;}if(version!==2)throw new Error('RUNTIME_SCHEMA_UNSUPPORTED');
  db.exec(`CREATE TABLE native_deliveries(id TEXT PRIMARY KEY,run_id TEXT NOT NULL UNIQUE REFERENCES runs(id),state TEXT NOT NULL,version INTEGER NOT NULL,anchor TEXT NOT NULL,material TEXT,render_ref TEXT,body TEXT,credential TEXT,receipt TEXT,error TEXT);
    CREATE TRIGGER native_delivery_anchor_immutable BEFORE UPDATE OF id,run_id,anchor ON native_deliveries BEGIN SELECT RAISE(ABORT,'Immutable delivery anchor'); END;
    CREATE TRIGGER native_delivery_material_immutable BEFORE UPDATE OF material ON native_deliveries WHEN OLD.material IS NOT NULL BEGIN SELECT RAISE(ABORT,'Immutable delivery material'); END;
    CREATE TRIGGER native_delivery_render_immutable BEFORE UPDATE OF render_ref ON native_deliveries WHEN OLD.render_ref IS NOT NULL BEGIN SELECT RAISE(ABORT,'Immutable rendering result'); END;
    CREATE TRIGGER native_delivery_body_immutable BEFORE UPDATE OF body,credential ON native_deliveries WHEN OLD.credential IS NOT NULL BEGIN SELECT RAISE(ABORT,'Immutable delivery credential'); END;
    CREATE TRIGGER native_delivery_retain BEFORE DELETE ON native_deliveries BEGIN SELECT RAISE(ABORT,'Retain native delivery'); END;
    PRAGMA user_version=3;`);
}
export class NativeDeliveryStore {
  constructor(private readonly db:DatabaseSync,private readonly atomic:<T>(work:()=>T)=>T,private readonly event:(runId:string,type:string,data:Record<string,Json>)=>unknown){}
  get(runId:string){const raw=this.db.prepare('SELECT * FROM native_deliveries WHERE run_id=?').get(z.uuid().parse(runId));if(!raw)return null;const row=rowSchema.parse(raw);
    return {id:row.id,runId:row.run_id,state:row.state,version:row.version,anchor:TaskResultAnchorSchema.parse(JSON.parse(row.anchor)),material:row.material?materialSchema.parse(JSON.parse(row.material)):null,
      renderRef:row.render_ref?renderRef.parse(JSON.parse(row.render_ref)):null,body:row.body,credential:row.credential,receipt:row.receipt,error:row.error};}
  create(anchor:TaskResultAnchor){return this.atomic(()=>{anchor=TaskResultAnchorSchema.parse(anchor);const old=this.get(anchor.runId);if(old){if(nativeDeliveryHash(old.anchor)!==nativeDeliveryHash(anchor))throw new Error('DELIVERY_BINDING_CONFLICT');return old;}
    const id=randomUUID();this.db.prepare("INSERT INTO native_deliveries VALUES(?,?,'accepted',1,?,NULL,NULL,NULL,NULL,NULL,NULL)").run(id,anchor.runId,JSON.stringify(anchor));this.event(anchor.runId,'native.delivery.accepted',{deliveryId:id});return this.get(anchor.runId)!;});}
  private advance(runId:string,from:NativeDeliveryState,to:NativeDeliveryState,error:string|null=null){const current=this.get(runId);if(!current||current.state!==from)throw new Error('DELIVERY_STATE_CONFLICT');
    if(error!==null)z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/).parse(error);
    this.db.prepare('UPDATE native_deliveries SET state=?,version=version+1,error=? WHERE run_id=? AND version=?').run(to,error,runId,current.version);this.event(runId,`native.delivery.${to}`,{deliveryId:current.id,error});return this.get(runId)!;}
  start(runId:string,raw:NativeDeliveryMaterial){return this.atomic(()=>{const current=this.get(runId);if(!current||current.state!=='accepted')throw new Error('DELIVERY_STATE_CONFLICT');this.db.prepare('UPDATE native_deliveries SET material=? WHERE run_id=?').run(JSON.stringify(materialSchema.parse(raw)),runId);return this.advance(runId,'accepted','rendering');});}
  candidate(runId:string,raw:z.infer<typeof renderRef>){return this.atomic(()=>{const row=this.get(runId);if(row?.state!=='rendering'||row.renderRef||row.credential)throw new Error('DELIVERY_STATE_CONFLICT');this.event(runId,'native.delivery.candidate',{renderRef:renderRef.parse(raw)});return this.advance(runId,'rendering','verifying');});}
  repair(runId:string){return this.atomic(()=>{const row=this.get(runId);if(row?.state!=='verifying'||row.renderRef||row.credential)throw new Error('DELIVERY_STATE_CONFLICT');return this.advance(runId,'verifying','rendering');});}
  rendered(runId:string,raw:z.infer<typeof renderRef>){return this.atomic(()=>{const row=this.get(runId);if(!row||!['rendering','verifying'].includes(row.state)||row.renderRef)throw new Error('DELIVERY_STATE_CONFLICT');this.db.prepare('UPDATE native_deliveries SET render_ref=? WHERE run_id=?').run(JSON.stringify(renderRef.parse(raw)),runId);return this.advance(runId,row.state,'verifying');});}
  approve(runId:string,body:string){return this.atomic(()=>{const current=this.get(runId);if(!current||current.state!=='verifying'||!current.material||!current.renderRef)throw new Error('DELIVERY_STATE_CONFLICT');z.string().min(1).max(32000).parse(body);
    if(createHash('sha256').update(body).digest('hex')!==current.renderRef.textHash)throw new Error('DELIVERY_BODY_MISMATCH');
    const credential=nativeDeliveryHash({id:current.id,anchor:current.anchor,material:current.material,body});this.db.prepare('UPDATE native_deliveries SET body=?,credential=? WHERE run_id=?').run(body,credential,runId);return this.advance(runId,'verifying','ready');});}
  verifyCredential(runId:string){const row=this.get(runId);if(!row?.body||!row.material||!row.credential||row.credential!==nativeDeliveryHash({id:row.id,anchor:row.anchor,material:row.material,body:row.body}))throw new Error('DELIVERY_CREDENTIAL_INVALID');return row.body;}
  sending(runId:string){return this.atomic(()=>this.advance(runId,'ready','sending'));}
  notSentBeforeDispatch(runId:string,code:string){return this.atomic(()=>this.advance(runId,'ready','not-sent',code));}
  sendAttempted(runId:string):boolean{return !!this.db.prepare("SELECT 1 FROM runtime_outbox WHERE json_extract(body,'$.runId')=? AND json_extract(body,'$.type')='native.delivery.sending' LIMIT 1").get(z.uuid().parse(runId));}
  finish(runId:string,state:'sent'|'not-sent'|'partial'|'uncertain',receipt:string|null,code:string|null){return this.atomic(()=>{if(this.get(runId)?.state!=='sending')throw new Error('DELIVERY_STATE_CONFLICT');if(state==='sent'&&!receipt)throw new Error('DELIVERY_RECEIPT_REQUIRED');this.db.prepare('UPDATE native_deliveries SET receipt=? WHERE run_id=?').run(receipt,runId);return this.advance(runId,'sending',state,code);});}
  reject(runId:string,code:string){return this.atomic(()=>{const row=this.get(runId);if(!row||!['accepted','rendering','verifying','ready'].includes(row.state))throw new Error('DELIVERY_STATE_CONFLICT');return this.advance(runId,row.state,'rejected',code);});}
  interrupt(runId:string){return this.atomic(()=>{const row=this.get(runId);if(!row||!['accepted','rendering','verifying','ready'].includes(row.state))throw new Error('DELIVERY_STATE_CONFLICT');return this.advance(runId,row.state,'interrupted','DELIVERY_CANCELLED');});}
  recover(){return this.atomic(()=>{for(const row of this.list(['rendering','verifying','sending']))this.advance(row.runId,row.state,row.state==='sending'?'uncertain':'interrupted','PROCESS_INTERRUPTED');});}
  list(states?:readonly NativeDeliveryState[]){const filtered=states?.map(state=>stateSchema.parse(state));if(filtered?.length===0)return [];return this.db.prepare('SELECT run_id FROM native_deliveries'+(filtered?' WHERE state IN ('+filtered.map(()=>'?').join(',')+')':'')+' ORDER BY rowid').all(...(filtered??[])).map(row=>this.get(String(row.run_id))!);}
  recent(target:Conversation){return this.db.prepare("SELECT run_id FROM native_deliveries WHERE json_extract(anchor,'$.target.channel')=? AND json_extract(anchor,'$.target.account')=? AND json_extract(anchor,'$.target.kind')=? AND json_extract(anchor,'$.target.id')=? ORDER BY rowid DESC LIMIT 4").all(target.channel,target.account,target.kind,target.id).map(row=>this.get(String(row.run_id))!);}
  counts(){const values=new Map(this.db.prepare('SELECT state,count(*) AS n FROM native_deliveries GROUP BY state').all().map(row=>[stateSchema.parse(row.state),Number(row.n)])),sum=(states:readonly NativeDeliveryState[])=>states.reduce((n,state)=>n+(values.get(state)??0),0);
    return {total:[...values.values()].reduce((a,b)=>a+b,0),pending:sum(['accepted','rendering','verifying','ready','sending']),sent:sum(['sent']),partial:sum(['partial']),uncertain:sum(['uncertain']),blocked:sum(['not-sent','rejected','interrupted'])};}
  mediaSettlementPending(runId:string,manifestId:string){z.uuid().parse(manifestId);this.atomic(()=>{const row=this.get(runId);if(!row)throw new Error('DELIVERY_STATE_CONFLICT');this.event(runId,'native.delivery.media-settlement-pending',{manifestId,state:row.state});});}
  status(runId:string){const row=this.get(runId);return row?{deliveryId:row.id,runId:row.runId,taskId:row.anchor.taskId,state:row.state,version:row.version,receiptId:row.receipt,error:row.error}:null;}
}
