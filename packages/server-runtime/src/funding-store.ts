import { closeSync,existsSync,mkdirSync,openSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { ExecutorPermitSchema,ExecutorUsageSchema } from '@dafeiyu/server-executor/protocol';
import type { ExecutorPermit } from '@dafeiyu/server-executor/protocol';
import { WindowsHostProofSchema } from '@dafeiyu/server-executor/windows-process';
import type { WindowsHostProof } from '@dafeiyu/server-executor/windows-process';
import { ModelBudgetRequestSchema,ModelBudgetSettlementSchema,runtimeCode } from './types.js';
import type { ModelBudgetRequest,ModelBudgetSettlement } from './types.js';
import { FundingAmendmentSchema,FundingHashSchema,FundingMicroCnySchema,checkFundingPurpose,fundingBoundCost,fundingCheck,fundingFreeze,fundingHash,fundingUsageCost } from './funding-config.js';
import type { FundingAmendment,FundingBinding,FundingMode } from './funding-config.js';
import { exclusiveFundingJson,fundingPathIdentity,readFundingJson,validateFundingFiles,verifyFundingReceipts } from './funding-files.js';
import type { ValidatedFunding } from './funding-files.js';
import { fundingReceiptHash } from './funding-receipt.js';

export const OPERATIONS_FUNDING_SCHEMA_VERSION=1;
const APPLICATION=0x44464f42;
const integer=z.number().int().nonnegative().safe(),decimal=z.string().max(100).regex(/^(0|[1-9]\d*)$/),time=z.number().int().nonnegative().max(8640000000000000);
const immutable=['funding_metadata','funding_authorizations','funding_reservations','funding_settlements','funding_events'];
const tables=[
  'CREATE TABLE funding_metadata(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL,hash TEXT NOT NULL)',
  'CREATE TABLE funding_authorizations(seq INTEGER PRIMARY KEY,id TEXT NOT NULL UNIQUE,body TEXT NOT NULL,hash TEXT NOT NULL,previous_hash TEXT)',
  'CREATE TABLE funding_reservations(call_id TEXT PRIMARY KEY,reservation_id TEXT NOT NULL UNIQUE,body TEXT NOT NULL,hash TEXT NOT NULL)',
  'CREATE TABLE funding_settlements(reservation_id TEXT PRIMARY KEY REFERENCES funding_reservations(reservation_id),body TEXT NOT NULL,hash TEXT NOT NULL)',
  'CREATE TABLE funding_events(seq INTEGER PRIMARY KEY AUTOINCREMENT,body TEXT NOT NULL,hash TEXT NOT NULL)',
  "CREATE TABLE funding_lease(id INTEGER PRIMARY KEY CHECK(id=1),nonce TEXT,pid INTEGER,phase TEXT NOT NULL CHECK(phase IN ('idle','starting','active')),proof TEXT,last_seen INTEGER NOT NULL,remaining_ms INTEGER NOT NULL,stop_code TEXT)",
];
const ddl=[...tables,...immutable.flatMap(table=>[`CREATE TRIGGER ${table}_immutable BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Immutable funding evidence');END`,
  `CREATE TRIGGER ${table}_retain BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Retain funding evidence');END`])];
const sql=(value:string)=>value.trim().replace(/;$/,'').replace(/\s+/g,' ');
const ReservationSchema=z.strictObject({request:ModelBudgetRequestSchema,reservationId:z.uuid(),dispatchPermitHash:FundingHashSchema,maximumMicroCny:decimal,leaseNonce:z.uuid(),at:z.iso.datetime()});
type Reservation=z.infer<typeof ReservationSchema>;
const SettlementSchema=z.strictObject({receipt:ModelBudgetSettlementSchema,requestReceiptHash:FundingHashSchema,normalizedReceiptHash:FundingHashSchema,actualMicroCny:decimal.nullable(),unknown:z.boolean(),reason:z.enum(['known','missing-usage','invalid-usage','bound-exceeded']),at:z.iso.datetime()});
type Settlement=z.infer<typeof SettlementSchema>;
const settlementEnvelope=ModelBudgetSettlementSchema.extend({usage:z.unknown()});
const clockStop=z.enum(['FUNDING_EXPIRED','FUNDING_CLOCK_MOVED_BACKWARDS','FUNDING_MONOTONIC_MOVED_BACKWARDS']);
export type FundingClockStop=z.infer<typeof clockStop>;
const LeaseSchema=z.strictObject({nonce:z.uuid().nullable(),pid:integer.positive().nullable(),phase:z.enum(['idle','starting','active']),proof:z.string().nullable(),last_seen:time,remaining_ms:integer,stop_code:clockStop.nullable()});
export interface FundingBalance {
  /** Decimal strings serialize exact integer micro-CNY, including a provider's anomalous oversized bill. */
  readonly maximumMicroCny:string;readonly spentMicroCny:string;readonly heldMicroCny:string;readonly remainingMicroCny:string;
  readonly reservedCalls:number;readonly unknownCalls:number;readonly settledCalls:number;
}
export interface FundingSnapshot {readonly fundingId:string;readonly purpose:FundingMode;readonly bindingHash:string;readonly authorizationHash:string;readonly authorizationCount:number;
  readonly notBefore:string;readonly expiresAt:string;readonly balance:FundingBalance;readonly lease:{readonly phase:'idle'|'starting'|'active';readonly pid:number|null;readonly lastSeen:number;readonly proofHash:string|null};
  readonly clock:{readonly highestObservedUtcMs:number;readonly remainingCeilingMs:number;readonly stopCode:FundingClockStop|null}}
export type FundingProcessState='alive'|'absent'|'unknown';

function checkedBody<T>(row:Readonly<Record<string,unknown>>,schema:z.ZodType<T>):T {
  const raw:unknown=JSON.parse(String(row.body));fundingCheck(fundingHash(raw)===row.hash,'FUNDING_EVIDENCE_CHANGED');return schema.parse(raw);
}
function approvalTime(value:{approval:{approvedAt:string}},now:number){fundingCheck(Date.parse(value.approval.approvedAt)<=now,'FUNDING_APPROVAL_IN_FUTURE');}
function interval(value:ValidatedFunding,now:number){time.parse(now);fundingCheck(now>=Date.parse(value.authorization.notBefore),'FUNDING_NOT_STARTED');fundingCheck(now<Date.parse(value.authorization.expiresAt),'FUNDING_EXPIRED');approvalTime(value.authorization,now);}

/** Explicit creation only. A partial claim is retained for operator investigation, never silently repaired. */
export function operatorInitializeFunding(binding:FundingBinding,options:{mode?:FundingMode}={}):FundingSnapshot {
  const mode=options.mode??'operations',value=validateFundingFiles(binding,mode),now=Date.now();interval(value,now);
  fundingCheck(!existsSync(value.paths.directory)&&!existsSync(value.paths.claim)&&!existsSync(value.paths.complete),'FUNDING_ALREADY_INITIALIZED');
  const receipt={schemaVersion:1 as const,fundingId:value.binding.fundingId,bindingHash:fundingHash(value.binding),authorizationHash:value.binding.authorization.hash,database:value.paths.database,at:new Date(now).toISOString()};
  exclusiveFundingJson(value.paths.claim,{...receipt,state:'initializing',databaseIdentity:null,directoryIdentity:null});
  mkdirSync(value.paths.directory);const file=openSync(value.paths.database,'wx');closeSync(file);
  const db=new DatabaseSync(value.paths.database);
  try{db.exec('PRAGMA foreign_keys=ON;PRAGMA journal_mode=DELETE;PRAGMA synchronous=FULL;BEGIN IMMEDIATE;');
    try{for(const statement of ddl)db.exec(statement);db.exec(`PRAGMA application_id=${APPLICATION};PRAGMA user_version=1;`);
      const metadata={binding:value.binding,authorization:value.authorization,price:value.price};db.prepare('INSERT INTO funding_metadata VALUES(1,?,?)').run(JSON.stringify(metadata),fundingHash(metadata));
      const initial={kind:'initial',authorization:value.authorization,sourceHash:value.binding.authorization.hash};db.prepare('INSERT INTO funding_authorizations VALUES(1,?,?,?,NULL)').run(value.binding.fundingId,JSON.stringify(initial),fundingHash(initial));
      db.prepare("INSERT INTO funding_lease VALUES(1,NULL,NULL,'idle',NULL,?,?,NULL)").run(now,Date.parse(value.authorization.expiresAt)-now);
      const event={kind:'initialized',at:new Date(now).toISOString(),bindingHash:fundingHash(value.binding)};db.prepare('INSERT INTO funding_events(body,hash) VALUES(?,?)').run(JSON.stringify(event),fundingHash(event));db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
  }finally{db.close();}
  exclusiveFundingJson(value.paths.complete,{...receipt,state:'initialized',databaseIdentity:fundingPathIdentity(value.paths.database,'file'),directoryIdentity:fundingPathIdentity(value.paths.directory,'directory'),at:new Date().toISOString()});
  const store=OperationsFundingStore.openExisting(binding,{mode,readOnly:true});try{return store.snapshot();}finally{store.close();}
}

/** Existing-only, one frozen authorization window. This is not the 7C ledger. */
export class OperationsFundingStore {
  readonly binding:FundingBinding;readonly mode:FundingMode;
  private readonly value:ValidatedFunding;private readonly db:DatabaseSync;private readonly identity:string;private readonly readOnly:boolean;private closed=false;
  private constructor(value:ValidatedFunding,mode:FundingMode,readOnly:boolean){
    this.value=value;this.binding=value.binding;this.mode=mode;this.readOnly=readOnly;verifyFundingReceipts(value);this.identity=fundingPathIdentity(value.paths.database,'file');
    // The first SQLite handle is read-only and cannot create a missing database. On Windows
    // it also pins the existing file while the writable connection is opened and identified.
    const pin=new DatabaseSync(value.paths.database,{readOnly:true});
    let target:DatabaseSync|undefined;
    try{fundingCheck(fundingPathIdentity(value.paths.database,'file')===this.identity,'FUNDING_DATABASE_REPLACED');target=readOnly?pin:new DatabaseSync(value.paths.database);this.db=target;
      this.db.exec('PRAGMA busy_timeout=5000;PRAGMA foreign_keys=ON;');this.verifySchema();this.snapshot();this.storageGuard();
    }catch(error){if(target&&target!==pin)target.close();pin.close();throw error;}
    if(!readOnly)pin.close();
  }
  static openExisting(binding:FundingBinding,options:{mode?:FundingMode;readOnly?:boolean}={}):OperationsFundingStore {
    const mode=options.mode??'operations';return new OperationsFundingStore(validateFundingFiles(binding,mode),mode,options.readOnly??false);
  }
  private storageGuard(){fundingCheck(!this.closed,'FUNDING_CLOSED');fundingCheck(fundingPathIdentity(this.value.paths.database,'file')===this.identity,'FUNDING_DATABASE_REPLACED');}
  private liveFiles(){this.storageGuard();validateFundingFiles(this.binding,this.mode);verifyFundingReceipts(this.value);}
  private verifySchema(){
    fundingCheck(this.db.prepare('PRAGMA application_id').get()?.application_id===APPLICATION&&this.db.prepare('PRAGMA user_version').get()?.user_version===1,'FUNDING_SCHEMA_UNSUPPORTED');
    const actual=this.db.prepare("SELECT sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>sql(String(row.sql))).sort();
    fundingCheck(JSON.stringify(actual)===JSON.stringify(ddl.map(sql).sort()),'FUNDING_SCHEMA_UNSUPPORTED');
    fundingCheck(Object.values(this.db.prepare('PRAGMA quick_check').get()??{})[0]==='ok','FUNDING_DATABASE_INVALID');
    const row=this.db.prepare('SELECT body,hash FROM funding_metadata WHERE id=1').get();fundingCheck(row,'FUNDING_METADATA_MISSING');
    const expected={binding:this.value.binding,authorization:this.value.authorization,price:this.value.price};fundingCheck(row.hash===fundingHash(expected)&&fundingHash(JSON.parse(String(row.body)))===row.hash,'FUNDING_BINDING_MISMATCH');
  }
  private atomic<T>(work:()=>T):T {this.storageGuard();fundingCheck(!this.readOnly,'FUNDING_READ_ONLY');this.db.exec('BEGIN IMMEDIATE');try{const result=work();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  private lease(){const row=this.db.prepare('SELECT nonce,pid,phase,proof,last_seen,remaining_ms,stop_code FROM funding_lease WHERE id=1').get();const lease=LeaseSchema.parse(row);
    fundingCheck(lease.phase==='idle'?lease.nonce===null&&lease.pid===null&&lease.proof===null:lease.nonce!==null&&lease.pid!==null&&(lease.phase==='starting'?lease.proof===null:lease.proof!==null),'FUNDING_LEASE_CORRUPT');return lease;}
  private append(kind:string,now:number,data:Record<string,unknown>={}){const event={kind,at:new Date(now).toISOString(),...data};this.db.prepare('INSERT INTO funding_events(body,hash) VALUES(?,?)').run(JSON.stringify(event),fundingHash(event));}
  private clock(now:number,write=false){time.parse(now);const lease=this.lease();if(lease.stop_code)throw new Error(lease.stop_code);fundingCheck(now>=lease.last_seen,'FUNDING_CLOCK_MOVED_BACKWARDS');
    const remaining=Math.max(0,Math.min(Date.parse(this.value.authorization.expiresAt)-now,lease.remaining_ms-(now-lease.last_seen)));fundingCheck(remaining>0,'FUNDING_EXPIRED');
    if(write)this.db.prepare('UPDATE funding_lease SET last_seen=?,remaining_ms=? WHERE id=1').run(now,remaining);return remaining;}
  /** Persist actual UTC observations separately from a conservative remaining-duration ceiling.
   * A failed clock observation commits its stop evidence before throwing. */
  observeClock(nonce:string,now:number,remainingCeilingMs?:number,fault?:FundingClockStop):number {
    time.parse(now);if(remainingCeilingMs!==undefined)integer.parse(remainingCeilingMs);if(fault)clockStop.parse(fault);
    const result=this.atomic(()=>{const lease=this.own(nonce),elapsedUtc=Math.max(0,now-lease.last_seen);
      // A supplied ceiling is anchored to this process's monotonic start. Do not charge
      // the same elapsed interval a second time when a stalled UTC clock catches up.
      let remaining=Math.max(0,Math.min(Date.parse(this.value.authorization.expiresAt)-now,remainingCeilingMs===undefined?lease.remaining_ms-elapsedUtc:lease.remaining_ms,remainingCeilingMs??Number.MAX_SAFE_INTEGER));
      const stop=lease.stop_code??fault??(now<lease.last_seen?'FUNDING_CLOCK_MOVED_BACKWARDS':remaining<=0?'FUNDING_EXPIRED':null);if(stop)remaining=0;
      this.db.prepare('UPDATE funding_lease SET last_seen=?,remaining_ms=?,stop_code=? WHERE id=1').run(Math.max(now,lease.last_seen),remaining,stop);
      if(stop&&!lease.stop_code)this.append('clock-stopped',now,{code:stop,observedUtcMs:now,highestObservedUtcMs:Math.max(now,lease.last_seen),remainingCeilingMs:remaining,
        basis:fault??(now<lease.last_seen?'observed-utc-rollback':remainingCeilingMs===0&&now<Date.parse(this.value.authorization.expiresAt)?'monotonic-ceiling-exhausted':'absolute-or-persisted-ceiling')});
      return {remaining,stop};});if(result.stop)throw new Error(result.stop);return result.remaining;
  }
  private chain(){
    const rows=this.db.prepare('SELECT seq,id,body,hash,previous_hash FROM funding_authorizations ORDER BY seq').all();fundingCheck(rows.length>0,'FUNDING_AUTHORIZATION_MISSING');
    let maximum=BigInt(this.value.authorization.maximumMicroCny),head='';
    rows.forEach((row,index)=>{const raw:unknown=JSON.parse(String(row.body));fundingCheck(row.seq===index+1&&fundingHash(raw)===row.hash,'FUNDING_AUTHORIZATION_CORRUPT');
      if(index===0){const initial={kind:'initial',authorization:this.value.authorization,sourceHash:this.binding.authorization.hash};fundingCheck(row.id===this.binding.fundingId&&row.previous_hash===null&&fundingHash(raw)===fundingHash(initial),'FUNDING_AUTHORIZATION_CORRUPT');}
      else{const entry=z.strictObject({kind:z.literal('increase'),amendment:FundingAmendmentSchema,sourceHash:FundingHashSchema}).parse(raw);this.validateAmendment(entry.amendment,head);fundingCheck(row.previous_hash===head&&row.id===entry.amendment.id,'FUNDING_AUTHORIZATION_CORRUPT');maximum+=BigInt(entry.amendment.additionalMicroCny);}
      head=String(row.hash);
    });fundingCheck(maximum<=BigInt(Number.MAX_SAFE_INTEGER),'FUNDING_AMOUNT_OVERFLOW');return {maximum,head,count:rows.length};
  }
  private validateAmendment(input:FundingAmendment,head:string){
    checkFundingPurpose(input.purpose,input.approval,this.mode);fundingCheck(input.fundingId===this.binding.fundingId&&input.initialAuthorizationHash===this.binding.authorization.hash&&input.previousHash===head&&input.scopeHash===this.binding.scopeHash&&input.routeHash===fundingHash(this.binding.route)&&input.priceHash===this.binding.price.hash&&input.expiresAt===this.value.authorization.expiresAt,'FUNDING_AMENDMENT_MISMATCH');
  }
  private rows(){
    const reservations=this.db.prepare('SELECT call_id,reservation_id,body,hash FROM funding_reservations').all().map(row=>{const body=checkedBody(row,ReservationSchema),request=body.request,route=this.binding.route;
      fundingCheck(request.callId===row.call_id&&body.reservationId===row.reservation_id&&request.authorizationId===this.binding.fundingId&&(request.owner.kind!=='host'||request.owner.profileId===this.binding.profileId)&&request.provider===route.provider&&request.model===route.model&&request.reasoningEffort===route.reasoningEffort&&request.inputBound===route.contextWindow&&request.outputBound<=route.maxOutputTokens&&request.requestBytes<=route.maxRequestBytes&&BigInt(body.maximumMicroCny)===fundingBoundCost(this.value.price,request.inputBound,request.outputBound),'FUNDING_EVIDENCE_CHANGED');return body;});
    const settlements=new Map(this.db.prepare('SELECT reservation_id,body,hash FROM funding_settlements').all().map(row=>{const body=checkedBody(row,SettlementSchema);fundingCheck(body.receipt.reservationId===row.reservation_id,'FUNDING_EVIDENCE_CHANGED');return [String(row.reservation_id),body] as const;}));
    for(const [id,bill]of settlements){const call=reservations.find(call=>call.reservationId===id);fundingCheck(call,'FUNDING_EVIDENCE_CHANGED');const receipt=bill.receipt,usage=receipt.usage,actual=usage===null?null:fundingUsageCost(this.value.price,usage),exceeded=usage!==null&&(usage.inputTokens>call.request.inputBound||usage.outputTokens>call.request.outputBound||actual!>BigInt(call.maximumMicroCny));
      fundingCheck(receipt.callId===call.request.callId&&receipt.authorizationId===this.binding.fundingId&&fundingHash(receipt.owner)===fundingHash(call.request.owner)&&bill.normalizedReceiptHash===fundingHash(receipt)&&bill.actualMicroCny===(actual===null?null:String(actual))&&bill.unknown===(actual===null||exceeded)&&(!['error','aborted','interrupted'].includes(receipt.finish)||usage===null),'FUNDING_EVIDENCE_CHANGED');
      fundingCheck(bill.reason==='invalid-usage'?receipt.error==='FUNDING_USAGE_INVALID'&&usage===null:bill.reason===(exceeded?'bound-exceeded':actual===null?'missing-usage':'known'),'FUNDING_EVIDENCE_CHANGED');
    }return {reservations,settlements};
  }
  snapshot():FundingSnapshot {
    this.storageGuard();const chain=this.chain(),{reservations,settlements}=this.rows(),lease=this.lease();let spent=0n,held=0n,reserved=0,unknown=0,settled=0;
    for(const call of reservations){const bill=settlements.get(call.reservationId),maximum=BigInt(call.maximumMicroCny);if(!bill){held+=maximum;reserved++;}else if(bill.unknown){held+=bill.actualMicroCny!==null&&BigInt(bill.actualMicroCny)>maximum?BigInt(bill.actualMicroCny):maximum;unknown++;}else{fundingCheck(bill.actualMicroCny!==null,'FUNDING_EVIDENCE_CHANGED');spent+=BigInt(bill.actualMicroCny);settled++;}}
    const remaining=chain.maximum-spent-held;return fundingFreeze({fundingId:this.binding.fundingId,purpose:this.mode,bindingHash:fundingHash(this.binding),authorizationHash:chain.head,authorizationCount:chain.count,notBefore:this.value.authorization.notBefore,expiresAt:this.value.authorization.expiresAt,
      balance:{maximumMicroCny:String(chain.maximum),spentMicroCny:String(spent),heldMicroCny:String(held),remainingMicroCny:String(remaining>0n?remaining:0n),reservedCalls:reserved,unknownCalls:unknown,settledCalls:settled},
      lease:{phase:lease.phase,pid:lease.pid,lastSeen:lease.last_seen,proofHash:lease.proof===null?null:fundingHash(JSON.parse(lease.proof))},clock:{highestObservedUtcMs:lease.last_seen,remainingCeilingMs:lease.remaining_ms,stopCode:lease.stop_code}});
  }
  private admission(now:number){this.liveFiles();interval(this.value,now);this.clock(now);const snapshot=this.snapshot();fundingCheck(snapshot.balance.unknownCalls===0,'FUNDING_UNKNOWN_COST');fundingCheck(snapshot.balance.reservedCalls===0,'FUNDING_RESERVED_COST');fundingCheck(BigInt(snapshot.balance.remainingMicroCny)>0n,'FUNDING_EXHAUSTED');return snapshot;}
  claimLease(now:number,processState:(pid:number)=>FundingProcessState):string {
    return this.atomic(()=>{this.admission(now);const old=this.lease();if(old.phase!=='idle'){fundingCheck(processState(old.pid!)==='absent','FUNDING_LEASE_OWNED');this.append('lease-abandoned',now,{nonce:old.nonce,pid:old.pid});}
      const remaining=this.clock(now),nonce=randomUUID();this.db.prepare("UPDATE funding_lease SET nonce=?,pid=?,phase='starting',proof=NULL,last_seen=?,remaining_ms=? WHERE id=1").run(nonce,process.pid,now,remaining);this.append('lease-starting',now,{nonce,pid:process.pid});return nonce;});
  }
  private own(nonce:string,active=false){const lease=this.lease();fundingCheck(lease.nonce===z.uuid().parse(nonce)&&lease.pid===process.pid&&lease.phase!=='idle','FUNDING_LEASE_CHANGED');if(active)fundingCheck(lease.phase==='active','FUNDING_LEASE_NOT_ACTIVE');return lease;}
  activateLease(nonce:string,raw:WindowsHostProof,now:number):void {
    const proof=WindowsHostProofSchema.parse(raw),expected=this.binding.process;
    fundingCheck(proof.parent.pid===process.pid&&proof.parent.alive&&proof.parent.elevated&&proof.parent.administratorsEnabled&&!proof.parent.restricted&&proof.parent.ownerSid===expected.expectedOwnerSid&&proof.parent.executableHash===expected.nodeHash&&resolve(proof.parent.executablePath).toLowerCase()===resolve(expected.nodePath).toLowerCase()&&resolve(expected.nodePath).toLowerCase()===resolve(process.execPath).toLowerCase(),'FUNDING_PARENT_PROOF_MISMATCH');
    fundingCheck(Date.parse(proof.observedAt)<=now&&now-Date.parse(proof.observedAt)<=15000,'FUNDING_PARENT_PROOF_STALE');
    this.atomic(()=>{this.admission(now);const lease=this.own(nonce);fundingCheck(lease.phase==='starting','FUNDING_LEASE_ALREADY_ACTIVE');
      this.clock(now,true);this.db.prepare("UPDATE funding_lease SET phase='active',proof=? WHERE id=1 AND nonce=?").run(JSON.stringify(proof),nonce);this.append('lease-active',now,{nonce,proofHash:fundingHash(proof),proofMode:this.mode});});
  }
  guardLease(nonce:string,now:number):void {this.own(nonce);this.admission(now);}
  remainingMs(nonce:string,now:number):number {this.storageGuard();this.own(nonce);interval(this.value,now);return this.clock(now);}
  reserve(nonce:string,raw:ModelBudgetRequest,now:number):ExecutorPermit {
    const input=ModelBudgetRequestSchema.parse(raw),route=this.binding.route;
    fundingCheck(input.authorizationId===this.binding.fundingId&&(input.owner.kind!=='host'||input.owner.profileId===this.binding.profileId),'FUNDING_CALL_BINDING_MISMATCH');
    fundingCheck(input.provider===route.provider&&input.model===route.model&&input.reasoningEffort===route.reasoningEffort&&input.inputBound===route.contextWindow&&input.outputBound<=route.maxOutputTokens&&input.requestBytes<=route.maxRequestBytes,'FUNDING_ROUTE_CHANGED');
    return this.atomic(()=>{this.own(nonce,true);const snapshot=this.admission(now);fundingCheck(input.deadline>now,'FUNDING_CALL_DEADLINE');fundingCheck(!this.db.prepare('SELECT 1 FROM funding_reservations WHERE call_id=?').get(input.callId),'FUNDING_CALL_REPLAY');
      const maximum=fundingBoundCost(this.value.price,input.inputBound,input.outputBound);fundingCheck(maximum<=BigInt(Number.MAX_SAFE_INTEGER),'FUNDING_AMOUNT_OVERFLOW');fundingCheck(maximum<=BigInt(snapshot.balance.remainingMicroCny),'FUNDING_EXHAUSTED');
      const permit=ExecutorPermitSchema.parse({reservationId:randomUUID(),dispatchPermit:randomUUID()}),record:Reservation={request:input,reservationId:permit.reservationId,dispatchPermitHash:fundingHash(permit.dispatchPermit),maximumMicroCny:String(maximum),leaseNonce:nonce,at:new Date(now).toISOString()};
      this.db.prepare('INSERT INTO funding_reservations VALUES(?,?,?,?)').run(input.callId,permit.reservationId,JSON.stringify(record),fundingHash(record));this.clock(now,true);this.append('reserved',now,{callId:input.callId,reservationId:permit.reservationId,owner:input.owner});return permit;});
  }
  settle(nonce:string,raw:unknown,now:number):{unknown:boolean} {
    const envelope=settlementEnvelope.parse(raw),requestReceiptHash=fundingReceiptHash(envelope),usage=ExecutorUsageSchema.safeParse(envelope.usage),invalid=envelope.usage!==null&&!usage.success;
    const receipt=ModelBudgetSettlementSchema.parse({...envelope,usage:invalid||['error','aborted','interrupted'].includes(envelope.finish)?null:usage.success?usage.data:null,error:invalid?'FUNDING_USAGE_INVALID':envelope.error});
    return this.atomic(()=>{const row=this.db.prepare('SELECT body,hash FROM funding_reservations WHERE reservation_id=?').get(receipt.reservationId);fundingCheck(row,'FUNDING_RESERVATION_MISSING');const call=checkedBody(row,ReservationSchema);
      fundingCheck(call.leaseNonce===nonce&&call.request.callId===receipt.callId&&receipt.authorizationId===this.binding.fundingId&&fundingHash(call.request.owner)===fundingHash(receipt.owner),'FUNDING_SETTLEMENT_BINDING_MISMATCH');
      const old=this.db.prepare('SELECT body,hash FROM funding_settlements WHERE reservation_id=?').get(receipt.reservationId);if(old){const existing=checkedBody(old,SettlementSchema);fundingCheck(existing.requestReceiptHash===requestReceiptHash,'FUNDING_SETTLEMENT_CONFLICT');return {unknown:existing.unknown};}
      this.own(nonce,true);time.parse(now);const at=Math.max(now,this.lease().last_seen),actual=receipt.usage===null?null:fundingUsageCost(this.value.price,receipt.usage),exceeded=receipt.usage!==null&&(receipt.usage.inputTokens>call.request.inputBound||receipt.usage.outputTokens>call.request.outputBound||actual!>BigInt(call.maximumMicroCny));
      const unknown=actual===null||exceeded,record:Settlement={receipt,requestReceiptHash,normalizedReceiptHash:fundingHash(receipt),actualMicroCny:actual===null?null:String(actual),unknown,reason:invalid?'invalid-usage':exceeded?'bound-exceeded':actual===null?'missing-usage':'known',at:new Date(at).toISOString()};
      this.db.prepare('INSERT INTO funding_settlements VALUES(?,?,?)').run(receipt.reservationId,JSON.stringify(record),fundingHash(record));this.append('settled',at,{callId:receipt.callId,reservationId:receipt.reservationId,unknown});return {unknown};});
  }
  releaseLease(nonce:string,now:number):void {this.atomic(()=>{const lease=this.own(nonce);fundingCheck(this.snapshot().balance.reservedCalls===0,'FUNDING_ACCOUNTING_PENDING');time.parse(now);const at=Math.max(now,lease.last_seen),remaining=Math.max(0,lease.remaining_ms-(at-lease.last_seen));this.append('lease-ended',at,{nonce});this.db.prepare("UPDATE funding_lease SET nonce=NULL,pid=NULL,phase='idle',proof=NULL,last_seen=?,remaining_ms=? WHERE id=1").run(at,remaining);});}
  amend(file:{path:string;hash:string},now=Date.now()):FundingSnapshot {
    const input=readFundingJson(file.path,FundingAmendmentSchema,FundingHashSchema.parse(file.hash));
    this.atomic(()=>{this.liveFiles();interval(this.value,now);this.clock(now);fundingCheck(this.lease().phase==='idle','FUNDING_AMENDMENT_REQUIRES_IDLE');const snapshot=this.snapshot();fundingCheck(snapshot.balance.reservedCalls===0,'FUNDING_ACCOUNTING_PENDING');approvalTime(input,now);
      const chain=this.chain();this.validateAmendment(input,chain.head);fundingCheck(!this.db.prepare('SELECT 1 FROM funding_authorizations WHERE id=?').get(input.id),'FUNDING_AMENDMENT_REPLAY');fundingCheck(chain.maximum+BigInt(input.additionalMicroCny)<=BigInt(Number.MAX_SAFE_INTEGER),'FUNDING_AMOUNT_OVERFLOW');
      const body={kind:'increase',amendment:input,sourceHash:file.hash},hash=fundingHash(body);this.db.prepare('INSERT INTO funding_authorizations VALUES(?,?,?,?,?)').run(chain.count+1,input.id,JSON.stringify(body),hash,chain.head);this.clock(now,true);this.append('authorization-increased',now,{id:input.id,hash});});return this.snapshot();
  }
  close():void {if(this.closed)return;this.db.close();this.closed=true;}
}

/** Metadata-only inspection: never creates a database, lease, helper, credential service or model. */
export function inspectOperationsFunding(binding:FundingBinding,options:{mode?:FundingMode}={}):{ready:boolean;code:string|null;snapshot:FundingSnapshot|null} {
  let store:OperationsFundingStore|undefined;
  try{store=OperationsFundingStore.openExisting(binding,{...options,readOnly:true});const snapshot=store.snapshot(),now=Date.now();
    const code=snapshot.clock.stopCode??(now<Date.parse(snapshot.notBefore)?'FUNDING_NOT_STARTED':now>=Date.parse(snapshot.expiresAt)||snapshot.clock.remainingCeilingMs<=Math.max(0,now-snapshot.clock.highestObservedUtcMs)?'FUNDING_EXPIRED':now<snapshot.lease.lastSeen?'FUNDING_CLOCK_MOVED_BACKWARDS':snapshot.balance.unknownCalls?'FUNDING_UNKNOWN_COST':snapshot.balance.reservedCalls?'FUNDING_RESERVED_COST':snapshot.lease.phase!=='idle'?'FUNDING_LEASE_OWNED':BigInt(snapshot.balance.remainingMicroCny)===0n?'FUNDING_EXHAUSTED':null);
    return {ready:code===null,code,snapshot};
  }catch(error){return {ready:false,code:runtimeCode(error,'FUNDING_INSPECTION_FAILED'),snapshot:null};}finally{store?.close();}
}
