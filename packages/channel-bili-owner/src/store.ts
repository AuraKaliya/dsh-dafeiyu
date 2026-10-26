import { DatabaseSync } from 'node:sqlite';
import { existsSync,mkdirSync } from 'node:fs';
import { dirname,join } from 'node:path';
import { z } from 'zod';
import { configureSqlite } from '@dafeiyu/journal';
import type { Reply } from '@dafeiyu/contracts';
import { BILI_OWNER_ACCOUNT,BILI_OWNER_UID,BILI_OWNER_SCENE,BiliOwnerIdentitySchema,BiliOwnerHashSchema,BiliOwnerIdSchema,BiliOwnerCodeSchema,
  BiliOwnerMessageSchema,BiliOwnerPageSchema,BiliOwnerReplySchema,BiliOwnerRequestSchema,BiliOwnerInboundStateSchema,BiliOwnerDeliveryPlanSchema,BiliOwnerDeliveryStateSchema,biliOwnerHash,biliOwnerTextHash } from './types.js';
import type { BiliOwnerIdentity,BiliOwnerMessage,BiliOwnerDelivery,BiliOwnerDeliveryPlan } from './types.js';

export const BILI_OWNER_SCHEMA_VERSION=2;
export const BILI_OWNER_APPLICATION_ID=0x4446424f;
export const BILI_OWNER_TABLES=['bili_owner_binding','bili_owner_handover','bili_owner_inbound','bili_owner_deliveries','bili_owner_poll','bili_owner_events'] as const;
const immutable=['bili_owner_binding','bili_owner_handover','bili_owner_events'] as const;
const tickSchema=z.number().int().nonnegative().max(8640000000000000);
function check(value:unknown,code:string):asserts value{if(!value)throw new Error(code);}
const sourceSchema=z.object({id:BiliOwnerIdSchema,state:BiliOwnerInboundStateSchema,version:z.number().int().positive(),coreInboundId:z.uuid().nullable(),message:BiliOwnerMessageSchema.nullable(),hash:BiliOwnerHashSchema.nullable(),bindingStamp:BiliOwnerHashSchema.nullable()});
export type BiliOwnerInbound=z.infer<typeof sourceSchema>;
const cursorSchema=z.object({since:tickSchema.nullable(),frontier:BiliOwnerIdSchema.nullable(),before:BiliOwnerIdSchema.nullable(),upper:BiliOwnerIdSchema.nullable(),version:z.number().int().positive(),nextAt:tickSchema,error:BiliOwnerCodeSchema.nullable()});
export type BiliOwnerCursor=z.infer<typeof cursorSchema>;
function handoverReady(db:DatabaseSync){const poll=db.prepare('SELECT since FROM bili_owner_poll WHERE id=1').get(),row=db.prepare('SELECT kind,body,body_hash,source_hash FROM bili_owner_handover WHERE id=1').get();if(!poll||!row)return false;
  const body:unknown=JSON.parse(String(row.body));check(biliOwnerHash(body)===row.body_hash,'BILI_OWNER_EVIDENCE_CHANGED');
  check(row.kind==='fresh','BILI_OWNER_EVIDENCE_CHANGED');const input=z.strictObject({requestId:BiliOwnerRequestSchema,since:tickSchema,cutoverHash:BiliOwnerHashSchema}).parse(body);
  check(input.cutoverHash===row.source_hash&&input.since===poll.since,'BILI_OWNER_EVIDENCE_CHANGED');return true;
}
function currentBindingFault(db:DatabaseSync):string|null{const row=db.prepare("SELECT body,body_hash FROM bili_owner_events WHERE object_id='binding-fault' ORDER BY version DESC LIMIT 1").get();if(!row)return null;
  const body=z.strictObject({code:BiliOwnerCodeSchema}).parse(JSON.parse(String(row.body)));check(biliOwnerHash(body)===row.body_hash,'BILI_OWNER_EVIDENCE_CHANGED');return body.code;}
function verifiedBindingStamp(db:DatabaseSync):string|null{const row=db.prepare("SELECT version,body,body_hash FROM bili_owner_events WHERE object_id='binding-verified' ORDER BY version DESC LIMIT 1").get();if(!row)return null;
  const body=z.strictObject({stamp:BiliOwnerHashSchema}).parse(JSON.parse(String(row.body)));check(row.version===1&&biliOwnerHash(body)===row.body_hash,'BILI_OWNER_EVIDENCE_CHANGED');return body.stamp;}
function verify(db:DatabaseSync,identity:BiliOwnerIdentity){check(db.prepare('PRAGMA user_version').get()?.user_version===BILI_OWNER_SCHEMA_VERSION&&db.prepare('PRAGMA application_id').get()?.application_id===BILI_OWNER_APPLICATION_ID,'BILI_OWNER_SCHEMA_UNSUPPORTED');
  for(const table of BILI_OWNER_TABLES)db.prepare(`SELECT * FROM ${table} LIMIT 0`).all();
  db.prepare('SELECT logical_key FROM bili_owner_deliveries LIMIT 0').all();
  const row=db.prepare('SELECT body,body_hash FROM bili_owner_binding WHERE id=1').get();check(row&&row.body_hash===biliOwnerHash(identity)&&biliOwnerHash(JSON.parse(String(row.body)))===row.body_hash,'BILI_OWNER_IDENTITY_MISMATCH');
  for(const name of [...immutable.flatMap(table=>[table+'_immutable',table+'_retain']),'bili_owner_inbound_body','bili_owner_inbound_binding','bili_owner_inbound_retain','bili_owner_delivery_plan','bili_owner_delivery_terminal','bili_owner_deliveries_retain','bili_owner_since_immutable'])
    check(db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?").get(name),'BILI_OWNER_SCHEMA_UNSUPPORTED');
}
export function inspectBiliOwnerStorage(file:string,rawIdentity:BiliOwnerIdentity){const identity=BiliOwnerIdentitySchema.parse(rawIdentity);
  if(!existsSync(file))return {exists:false,supported:false,identityMatches:false,bindingReady:false,version:null,codes:['BILI_OWNER_INITIALIZATION_REQUIRED']};
  const db=new DatabaseSync(file,{readOnly:true});try{const version=Number(db.prepare('PRAGMA user_version').get()?.user_version);verify(db,identity);
    const ready=handoverReady(db);
    const fault=currentBindingFault(db);return {exists:true,supported:true,identityMatches:true,bindingReady:ready&&!fault,version,codes:fault?['BILI_OWNER_BINDING_REJECTED']:ready?[]:['BILI_OWNER_HANDOVER_REQUIRED']};
  }catch(error){const code=error instanceof Error&&/^BILI_OWNER_/.test(error.message)?error.message:'BILI_OWNER_STORAGE_INVALID';return {exists:true,supported:false,identityMatches:code!=='BILI_OWNER_IDENTITY_MISMATCH',bindingReady:false,version:Number(db.prepare('PRAGMA user_version').get()?.user_version),codes:[code]};}finally{db.close();}}

/** Authoritative local facts only. Opening existing storage never initializes a cursor, dispatches work. */
export class BiliOwnerStore {
  private readonly db:DatabaseSync;private closed=false;readonly identity:BiliOwnerIdentity;
  constructor(file:string,rawIdentity:BiliOwnerIdentity,create=false){this.identity=Object.freeze(BiliOwnerIdentitySchema.parse(rawIdentity));
    if(!existsSync(file)&&!create)throw new Error('BILI_OWNER_INITIALIZATION_REQUIRED');if(create)mkdirSync(dirname(file),{recursive:true});this.db=new DatabaseSync(file);
    try{const version=Number(this.db.prepare('PRAGMA user_version').get()?.user_version),app=Number(this.db.prepare('PRAGMA application_id').get()?.application_id),empty=Number(this.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get()?.n)===0;
      if(version===0&&app===0&&empty&&create){configureSqlite(this.db);this.atomic(()=>this.initialize());}verify(this.db,this.identity);configureSqlite(this.db);
    }catch(error){this.db.close();throw error;}}
  private initialize(){this.db.exec(`
    CREATE TABLE bili_owner_binding(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL,body_hash TEXT NOT NULL);
    CREATE TABLE bili_owner_handover(id INTEGER PRIMARY KEY CHECK(id=1),kind TEXT NOT NULL,request_id TEXT NOT NULL UNIQUE,source_hash TEXT NOT NULL,body TEXT NOT NULL,body_hash TEXT NOT NULL);
    CREATE TABLE bili_owner_inbound(id TEXT PRIMARY KEY,body TEXT,body_hash TEXT,binding_stamp TEXT,state TEXT NOT NULL,version INTEGER NOT NULL,core_inbound_id TEXT UNIQUE);
    CREATE TABLE bili_owner_deliveries(reply_id TEXT PRIMARY KEY,request_id TEXT NOT NULL UNIQUE,logical_key TEXT NOT NULL UNIQUE,source_id TEXT NOT NULL REFERENCES bili_owner_inbound(id),plan TEXT NOT NULL,plan_hash TEXT NOT NULL,state TEXT NOT NULL,version INTEGER NOT NULL,receipt TEXT,code TEXT);
    CREATE TABLE bili_owner_poll(id INTEGER PRIMARY KEY CHECK(id=1),since INTEGER,frontier TEXT,before_seq TEXT,upper_seq TEXT,version INTEGER NOT NULL,next_at INTEGER NOT NULL,error TEXT);
    INSERT INTO bili_owner_poll VALUES(1,NULL,NULL,NULL,NULL,1,0,NULL);
    CREATE TABLE bili_owner_events(seq INTEGER PRIMARY KEY AUTOINCREMENT,object_id TEXT NOT NULL,version INTEGER NOT NULL,at TEXT NOT NULL,type TEXT NOT NULL,body TEXT NOT NULL,body_hash TEXT NOT NULL,UNIQUE(object_id,version));
    CREATE INDEX bili_owner_inbound_state ON bili_owner_inbound(state);
    CREATE INDEX bili_owner_delivery_state ON bili_owner_deliveries(state);
    CREATE TRIGGER bili_owner_inbound_body BEFORE UPDATE OF id,body,body_hash ON bili_owner_inbound BEGIN SELECT RAISE(ABORT,'Immutable inbound');END;
    CREATE TRIGGER bili_owner_inbound_binding BEFORE UPDATE OF core_inbound_id ON bili_owner_inbound WHEN OLD.core_inbound_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'Immutable Core inbound');END;
    CREATE TRIGGER bili_owner_inbound_retain BEFORE DELETE ON bili_owner_inbound BEGIN SELECT RAISE(ABORT,'Retain inbound');END;
    CREATE TRIGGER bili_owner_delivery_plan BEFORE UPDATE OF reply_id,request_id,logical_key,source_id,plan,plan_hash ON bili_owner_deliveries BEGIN SELECT RAISE(ABORT,'Immutable delivery');END;
    CREATE TRIGGER bili_owner_delivery_terminal BEFORE UPDATE ON bili_owner_deliveries WHEN OLD.state IN ('sent','unknown','blocked') BEGIN SELECT RAISE(ABORT,'Retain terminal delivery');END;
    CREATE TRIGGER bili_owner_deliveries_retain BEFORE DELETE ON bili_owner_deliveries BEGIN SELECT RAISE(ABORT,'Retain delivery');END;
    CREATE TRIGGER bili_owner_since_immutable BEFORE UPDATE OF since ON bili_owner_poll WHEN OLD.since IS NOT NULL BEGIN SELECT RAISE(ABORT,'Immutable handover boundary');END;
    PRAGMA user_version=${BILI_OWNER_SCHEMA_VERSION};PRAGMA application_id=${BILI_OWNER_APPLICATION_ID};`);
    for(const table of immutable)this.db.exec(`CREATE TRIGGER ${table}_immutable BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Immutable channel evidence');END;CREATE TRIGGER ${table}_retain BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Retain channel evidence');END;`);
    this.db.prepare('INSERT INTO bili_owner_binding VALUES(1,?,?)').run(JSON.stringify(this.identity),biliOwnerHash(this.identity));}
  private open(){check(!this.closed,'BILI_OWNER_CLOSED');}
  private atomic<T>(work:()=>T):T{this.open();this.db.exec('BEGIN IMMEDIATE');try{const value=work();this.db.exec('COMMIT');return value;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  private event(objectId:string,version:number,type:string,body:unknown,now:number){const at=new Date(tickSchema.parse(now)).toISOString();this.db.prepare('INSERT INTO bili_owner_events(object_id,version,at,type,body,body_hash) VALUES(?,?,?,?,?,?)').run(objectId,version,at,type,JSON.stringify(body),biliOwnerHash(body));}
  private tail(objectId:string,version:number,body:unknown){const row=this.db.prepare('SELECT version,body,body_hash FROM bili_owner_events WHERE object_id=? ORDER BY version DESC LIMIT 1').get(objectId);check(row&&row.version===version&&row.body_hash===biliOwnerHash(body)&&biliOwnerHash(JSON.parse(String(row.body)))===row.body_hash,'BILI_OWNER_EVIDENCE_CHANGED');}
  cursor():BiliOwnerCursor{this.open();const row=this.db.prepare('SELECT * FROM bili_owner_poll WHERE id=1').get();check(row,'BILI_OWNER_SCHEMA_UNSUPPORTED');return cursorSchema.parse({since:row.since,frontier:row.frontier,before:row.before_seq,upper:row.upper_seq,version:row.version,nextAt:row.next_at,error:row.error});}
  bindingReady():boolean{this.open();return handoverReady(this.db);}
  bindingFault():string|null{this.open();return currentBindingFault(this.db);}
  verifiedBinding():string|null{this.open();return verifiedBindingStamp(this.db);}
  bindVerified(stamp:string,now=Date.now()){BiliOwnerHashSchema.parse(stamp);return this.atomic(()=>{check(!this.bindingFault(),'BILI_OWNER_BINDING_REJECTED');const previous=this.verifiedBinding();
    if(previous!==null){check(previous===stamp,'BILI_OWNER_BINDING_CHANGED');return false;}this.event('binding-verified',1,'binding.verified',{stamp},now);return true;});}
  rejectBinding(code:string,now=Date.now()){BiliOwnerCodeSchema.parse(code);this.atomic(()=>{if(this.bindingFault()===code)return;const version=Number(this.db.prepare("SELECT coalesce(max(version),0) AS n FROM bili_owner_events WHERE object_id='binding-fault'").get()?.n)+1;this.event('binding-fault',version,'binding.rejected',{code},now);});}
  private handover(kind:'fresh',requestId:string,sourceHash:string,body:unknown):boolean{const old=this.db.prepare('SELECT kind,body_hash,body FROM bili_owner_handover WHERE id=1').get();
    if(old){check(old.kind===kind&&old.body_hash===biliOwnerHash(body)&&biliOwnerHash(JSON.parse(String(old.body)))===old.body_hash,'BILI_OWNER_HANDOVER_CONFLICT');return false;}
    check(!this.db.prepare('SELECT 1 FROM bili_owner_inbound LIMIT 1').get()&&!this.db.prepare('SELECT 1 FROM bili_owner_deliveries LIMIT 1').get()&&this.cursor().since===null,'BILI_OWNER_HANDOVER_CONFLICT');
    this.db.prepare('INSERT INTO bili_owner_handover VALUES(1,?,?,?,?,?)').run(kind,requestId,sourceHash,JSON.stringify(body),biliOwnerHash(body));return true;}
  initializeFresh(raw:unknown,now=Date.now()){const input=z.strictObject({requestId:BiliOwnerRequestSchema,since:tickSchema,cutoverHash:BiliOwnerHashSchema}).parse(raw);return this.atomic(()=>{
    const changed=this.handover('fresh',input.requestId,input.cutoverHash,input);if(changed){this.db.prepare('UPDATE bili_owner_poll SET since=? WHERE id=1').run(input.since);this.event('handover',1,'fresh',input,now);}return {duplicate:!changed,bindingReady:this.bindingReady()};});}
  private sourceBody(source:BiliOwnerInbound){return {id:source.id,state:source.state,version:source.version,coreInboundId:source.coreInboundId,hash:source.hash,bindingStamp:source.bindingStamp};}
  private insertSource(id:string,message:BiliOwnerMessage|null,state:BiliOwnerInbound['state'],bindingStamp:string|null,now:number){BiliOwnerIdSchema.parse(id);const hash=message?biliOwnerHash(message):null;
    this.db.prepare('INSERT INTO bili_owner_inbound VALUES(?,?,?,?,?,1,NULL)').run(id,message?JSON.stringify(message):null,hash,bindingStamp,state);this.event('in:'+id,1,'inbound.'+state,{id,state,version:1,coreInboundId:null,hash,bindingStamp},now);}
  source(id:string):BiliOwnerInbound|null{this.open();BiliOwnerIdSchema.parse(id);const row=this.db.prepare('SELECT * FROM bili_owner_inbound WHERE id=?').get(id);if(!row)return null;
    const message=row.body===null?null:BiliOwnerMessageSchema.parse(JSON.parse(String(row.body))),value=sourceSchema.parse({id:row.id,state:row.state,version:row.version,coreInboundId:row.core_inbound_id,message,hash:row.body_hash,bindingStamp:row.binding_stamp});
    check((message===null?null:biliOwnerHash(message))===value.hash,'BILI_OWNER_EVIDENCE_CHANGED');this.tail('in:'+id,value.version,this.sourceBody(value));return value;}
  private updateSource(value:BiliOwnerInbound,state:BiliOwnerInbound['state'],coreInboundId:string|null,bindingStamp:string|null,now:number){const next={...value,state,coreInboundId,bindingStamp,version:value.version+1};
    if(value.coreInboundId===null&&coreInboundId!==null)this.db.prepare('UPDATE bili_owner_inbound SET state=?,version=?,binding_stamp=?,core_inbound_id=? WHERE id=?').run(state,next.version,bindingStamp,coreInboundId,value.id);
    else this.db.prepare('UPDATE bili_owner_inbound SET state=?,version=?,binding_stamp=? WHERE id=?').run(state,next.version,bindingStamp,value.id);
    this.event('in:'+value.id,next.version,'inbound.'+state,this.sourceBody(next),now);return next;}
  private observe(message:BiliOwnerMessage,stamp:string,maxPending:number,now:number){const current=this.source(message.id),since=this.cursor().since;check(since!==null,'BILI_OWNER_HANDOVER_REQUIRED');
    if(message.senderUid!==BILI_OWNER_UID)return;
    if(current){if(current.message)check(current.hash===biliOwnerHash(message),'BILI_OWNER_MESSAGE_CONFLICT');return;}
    const state=message.timestamp*1000<since?'before-start':message.type===1&&message.text.trim()?'pending':'unsupported';if(state==='pending')check(this.pending().length<maxPending,'BILI_OWNER_CAPACITY');this.insertSource(message.id,state==='before-start'?null:message,state,stamp,now);}
  acceptPage(raw:unknown,expectedVersion:number,maxPending=1000,now=Date.now()){const page=BiliOwnerPageSchema.parse(raw);z.number().int().min(1).max(10000).parse(maxPending);return this.atomic(()=>{const cursor=this.cursor();check(this.bindingReady(),'BILI_OWNER_HANDOVER_REQUIRED');check(cursor.version===expectedVersion,'BILI_OWNER_CURSOR_CONFLICT');
    const sorted=[...page.messages].sort((a,b)=>BigInt(a.seqno)<BigInt(b.seqno)?1:BigInt(a.seqno)>BigInt(b.seqno)?-1:0),smallest=sorted.at(-1)?.seqno??null,largest=sorted[0]?.seqno??null;
    if(page.hasMore)check(smallest===page.nextBeforeSeqno&&(!cursor.before||BigInt(smallest!)<BigInt(cursor.before)),'BILI_OWNER_CURSOR_INVALID');
    for(const message of sorted)this.observe(message,page.bindingStamp,maxPending,now);
    const upper=cursor.upper??largest,complete=!page.hasMore||sorted.some(message=>message.timestamp*1000<cursor.since!||cursor.frontier!==null&&BigInt(message.seqno)<=BigInt(cursor.frontier));
    const frontier=complete&&upper&&(cursor.frontier===null||BigInt(upper)>BigInt(cursor.frontier))?upper:cursor.frontier;
    this.db.prepare('UPDATE bili_owner_poll SET frontier=?,before_seq=?,upper_seq=?,version=version+1,next_at=0,error=NULL WHERE id=1').run(frontier,complete?null:page.nextBeforeSeqno,complete?null:upper);
    return {complete,cursor:this.cursor()};});}
  pending():BiliOwnerInbound[]{this.open();return this.db.prepare("SELECT id FROM bili_owner_inbound WHERE state='pending'").all().map(row=>this.source(String(row.id))!).sort((a,b)=>a.message!.timestamp-b.message!.timestamp||(BigInt(a.message!.seqno)<BigInt(b.message!.seqno)?-1:BigInt(a.message!.seqno)>BigInt(b.message!.seqno)?1:0));}
  accepted(id:string,coreInboundId:string,now=Date.now()){z.uuid().parse(coreInboundId);return this.atomic(()=>{const value=this.source(id);check(value,'BILI_OWNER_SOURCE_MISSING');if(value.state==='accepted'){check(value.coreInboundId===coreInboundId,'BILI_OWNER_CORE_BINDING_CONFLICT');return value;}
    check(value.state==='pending'&&value.message,'BILI_OWNER_SOURCE_NOT_READY');return this.updateSource(value,'accepted',coreInboundId,value.bindingStamp,now);});}
  recall(id:string,now=Date.now()){return this.atomic(()=>{const value=this.source(id);check(value,'BILI_OWNER_SOURCE_MISSING');return value.state==='recalled'?value:this.updateSource(value,'recalled',value.coreInboundId,value.bindingStamp,now);});}
  recalled():readonly string[]{this.open();return this.db.prepare("SELECT id FROM bili_owner_inbound WHERE state='recalled' ORDER BY rowid").all().map(row=>{const source=this.source(String(row.id));check(source?.state==='recalled','BILI_OWNER_EVIDENCE_CHANGED');return source.id;});}
  backoff(code:string,until:number){BiliOwnerCodeSchema.parse(code);tickSchema.parse(until);this.atomic(()=>this.db.prepare('UPDATE bili_owner_poll SET next_at=?,error=?,version=version+1 WHERE id=1').run(until,code));}
  private deliveryBody(value:BiliOwnerDelivery){return {hash:value.hash,version:value.version,state:value.state,receiptId:value.receiptId,code:value.code};}
  delivery(replyId:string):BiliOwnerDelivery|null{this.open();const row=this.db.prepare('SELECT * FROM bili_owner_deliveries WHERE reply_id=?').get(z.string().min(1).max(200).parse(replyId));if(!row)return null;
    const plan=BiliOwnerDeliveryPlanSchema.parse(JSON.parse(String(row.plan))),hash=biliOwnerHash(plan);check(plan.replyId===replyId&&row.plan_hash===hash&&row.request_id===plan.requestId&&row.source_id===plan.sourceMessageId&&row.logical_key===this.logicalKey(plan),'BILI_OWNER_EVIDENCE_CHANGED');
    const value:BiliOwnerDelivery={plan,hash,state:BiliOwnerDeliveryStateSchema.parse(row.state),version:z.number().int().positive().parse(row.version),receiptId:row.receipt===null?null:BiliOwnerIdSchema.parse(row.receipt),code:row.code===null?null:BiliOwnerCodeSchema.parse(row.code)};
    this.tail('out:'+replyId,value.version,this.deliveryBody(value));return value;}
  private logicalKey(plan:BiliOwnerDeliveryPlan){return plan.anchor?'task-result:'+plan.anchor.runId:'reply:'+plan.coreInboundId;}
  prepareReply(raw:Reply,now=Date.now()):BiliOwnerDelivery{const reply=BiliOwnerReplySchema.parse(raw);check(biliOwnerHash(reply.conversation)===biliOwnerHash(BILI_OWNER_SCENE),'BILI_OWNER_TARGET_DENIED');return this.atomic(()=>{
    const source=this.source(reply.sourceMessageId);check(source?.state==='accepted'&&source.coreInboundId&&source.hash,'BILI_OWNER_SOURCE_NOT_READY');
    if(reply.taskResult)check(reply.taskResult.inboundId===source.coreInboundId&&reply.taskResult.target.channel==='bilibili'&&biliOwnerHash(reply.taskResult.target)===biliOwnerHash(BILI_OWNER_SCENE),'BILI_OWNER_TARGET_DENIED');
    const text=reply.text.trim(),plan=BiliOwnerDeliveryPlanSchema.parse({schemaVersion:1,replyId:reply.id,requestId:'bili1_'+biliOwnerHash([this.identity,reply.id]),scene:BILI_OWNER_SCENE,sourceMessageId:reply.sourceMessageId,sourceHash:source.hash,
      coreInboundId:source.coreInboundId,anchor:reply.taskResult??null,bodyHash:biliOwnerTextHash(reply.text),wireHash:biliOwnerTextHash(text),text}),hash=biliOwnerHash(plan),old=this.delivery(reply.id);
    if(old){check(old.hash===hash,'BILI_OWNER_DELIVERY_CONFLICT');return old;}
    check(!this.db.prepare('SELECT 1 FROM bili_owner_deliveries WHERE logical_key=?').get(this.logicalKey(plan)),'BILI_OWNER_LOGICAL_DELIVERY_CONFLICT');
    const invalidUnicode=[...text].some(char=>{const value=char.codePointAt(0)!;return value>=0xd800&&value<=0xdfff;}),code=!text?'BILI_OWNER_TEXT_EMPTY':invalidUnicode?'BILI_OWNER_TEXT_INVALID':Array.from(text).length>1000?'BILI_OWNER_TEXT_LIMIT':null,state=code?'blocked':'prepared';
    this.db.prepare('INSERT INTO bili_owner_deliveries VALUES(?,?,?,?,?,?,?,1,NULL,?)').run(reply.id,plan.requestId,this.logicalKey(plan),reply.sourceMessageId,JSON.stringify(plan),hash,state,code);
    this.event('out:'+reply.id,1,'delivery.'+state,{hash,version:1,state,receiptId:null,code},now);return this.delivery(reply.id)!;});}
  private transition(replyId:string,from:'prepared'|'sending',state:BiliOwnerDelivery['state'],receiptId:string|null,code:string|null,now:number){const old=this.delivery(replyId);check(old?.state===from,'BILI_OWNER_DELIVERY_STATE');if(receiptId)BiliOwnerIdSchema.parse(receiptId);if(code)BiliOwnerCodeSchema.parse(code);
    const next={...old,version:old.version+1,state,receiptId,code};this.db.prepare('UPDATE bili_owner_deliveries SET state=?,version=?,receipt=?,code=? WHERE reply_id=?').run(state,next.version,receiptId,code,replyId);this.event('out:'+replyId,next.version,'delivery.'+state,this.deliveryBody(next),now);return next;}
  begin(replyId:string,now=Date.now()){return this.atomic(()=>this.transition(replyId,'prepared','sending',null,null,now));}
  confirm(replyId:string,receiptId:string,now=Date.now()){return this.atomic(()=>this.transition(replyId,'sending','sent',receiptId,null,now));}
  unknown(replyId:string,code:string,now=Date.now()){return this.atomic(()=>this.transition(replyId,'sending','unknown',null,code,now));}
  notDispatched(replyId:string,code:string,now=Date.now()){return this.atomic(()=>this.transition(replyId,'sending','prepared',null,code,now));}
  recover(now=Date.now()){return this.atomic(()=>{const rows=this.db.prepare("SELECT reply_id FROM bili_owner_deliveries WHERE state='sending'").all();for(const row of rows)this.transition(String(row.reply_id),'sending','unknown',null,'BILI_OWNER_PROCESS_INTERRUPTED',now);return {unknown:rows.length};});}
  counts(){this.open();const grouped=(table:string)=>Object.fromEntries(this.db.prepare(`SELECT state,count(*) AS n FROM ${table} GROUP BY state`).all().map(row=>[String(row.state),Number(row.n)]));return {inbound:grouped('bili_owner_inbound'),deliveries:grouped('bili_owner_deliveries')};}
  close(){if(this.closed)return;this.closed=true;this.db.close();}
}

/** Explicit schema creation only. A fresh start boundary is a separate program step. */
export function initializeBiliOwnerStorage(dataDir:string,identity:BiliOwnerIdentity){const file=join(dataDir,'bili-owner.sqlite'),store=new BiliOwnerStore(file,identity,true);store.close();return inspectBiliOwnerStorage(file,identity);}
