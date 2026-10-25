import { DatabaseSync } from 'node:sqlite';
import { existsSync,mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import { z } from 'zod';

const hash=z.string().regex(/^[a-f0-9]{64}$/),id=z.string().regex(/^[a-zA-Z0-9._:-]{1,120}$/),integer=z.number().int().nonnegative().safe();
const money=integer; // Integer micro-CNY. No binary floating-point currency arithmetic.
export const EvaluationConfigSchema=z.strictObject({schemaVersion:z.literal(1),suiteId:id,suiteHash:hash,manifestHash:hash,foundationHash:hash,codeRevision:z.string().regex(/^[a-f0-9]{40}$/),
  runtimeHash:hash.optional(),
  executionBounds:z.strictObject({authorizationId:id,authorizationHash:hash.optional(),maximumActiveMs:integer.positive(),validForMsAfterFirstCall:integer.positive(),calibrationMaximumMicroCny:money.positive(),calibrationMaximumActiveMs:integer.positive()}).optional(),
  mode:z.enum(['offline','real']),budget:z.strictObject({authorized:z.boolean(),maximumMicroCny:money,expiresAt:z.iso.datetime(),pricingHash:hash,
    inputMicroCnyPerMillion:money,outputMicroCnyPerMillion:money}),cases:z.array(z.strictObject({id,reviewId:id})).min(1).max(2000)})
  .refine(c=>new Set(c.cases.map(i=>i.id)).size===c.cases.length&&new Set(c.cases.map(i=>i.reviewId)).size===c.cases.length,'Duplicate case identity')
  .refine(c=>c.mode==='offline'?!c.budget.authorized&&c.budget.maximumMicroCny===0:c.budget.authorized&&c.budget.maximumMicroCny>0,'Real execution requires an explicit frozen budget');
export type EvaluationConfig=z.infer<typeof EvaluationConfigSchema>;
const outcome=z.strictObject({state:z.enum(['needs-human-review','failed','blocked','interrupted']),code:z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/).nullable(),
  programChecks:z.array(z.strictObject({id,passed:z.boolean(),evidenceHash:hash})).max(128),answerHash:hash.nullable(),artifacts:z.array(z.strictObject({relative:z.string().max(300).refine(p=>!p.startsWith('/')&&!p.includes('\\')&&!p.split('/').some(s=>s==='..'||!s)&&!p.includes(':')),hash})).max(128)})
  .refine(o=>o.state!=='needs-human-review'||o.programChecks.length>0&&o.programChecks.every(c=>c.passed),'Failed program checks cannot pass to human review');
export type EvaluationOutcome=z.infer<typeof outcome>;
export const EvaluationCallSchema=z.strictObject({id:z.uuid(),attemptId:z.uuid(),phase:z.enum(['started','finished']),provider:z.string().min(1).max(100),model:z.string().min(1).max(160),purpose:z.string().max(100),requestHash:hash,sessionHash:hash,at:z.iso.datetime(),durationMs:integer.nullable(),reservationId:z.uuid().nullable(),inputTokens:integer.nullable(),outputTokens:integer.nullable(),finish:z.string().max(100).nullable(),error:z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/).nullable(),reasoningEffort:z.string().max(100).nullable().optional(),outputBound:integer.optional(),usageBreakdown:z.strictObject({uncachedInputTokens:integer,cacheReadTokens:integer,cacheWriteTokens:integer,outputTokens:integer,reasoningTokens:integer.nullable()}).nullable().optional()});
export type EvaluationCall=z.infer<typeof EvaluationCallSchema>;
const batchArtifact=z.strictObject({batchId:z.uuid(),relative:z.string().regex(/^batches\/[a-f0-9-]{36}\.json$/),hash});
const encoded=(value:unknown)=>JSON.stringify(value),digest=(value:unknown)=>createHash('sha256').update(encoded(value)).digest('hex');
function freeze(value:unknown){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}}
function fee(tokens:number,rate:number){integer.parse(tokens);money.parse(rate);const value=(BigInt(tokens)*BigInt(rate)+999999n)/1000000n;if(value>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('EVALUATION_COST_OVERFLOW');return Number(value);}
/** Evaluation evidence only. This class never sends model/platform requests or edits the frozen source suite. */
export class EvaluationLedger {
  private readonly db:DatabaseSync;readonly config:EvaluationConfig;
  private executionNonce:string|undefined;
  constructor(file:string,raw:EvaluationConfig,create=false){this.config=EvaluationConfigSchema.parse(raw);freeze(this.config);if(!existsSync(file)&&!create)throw new Error('EVALUATION_LEDGER_MISSING');if(create)mkdirSync(dirname(file),{recursive:true});this.db=new DatabaseSync(file);
    try{this.db.exec('PRAGMA busy_timeout=5000;PRAGMA foreign_keys=ON;');const version=this.db.prepare('PRAGMA user_version').get()?.user_version;
      if(version===0&&create&&!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table'").get())this.atomic(()=>{this.db.exec(`CREATE TABLE metadata(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL,hash TEXT NOT NULL);
        CREATE TABLE attempts(id TEXT PRIMARY KEY,case_id TEXT NOT NULL,ordinal INTEGER NOT NULL,started_at TEXT NOT NULL,state TEXT NOT NULL,UNIQUE(case_id,ordinal));
        CREATE TABLE outcomes(attempt_id TEXT PRIMARY KEY REFERENCES attempts(id),body TEXT NOT NULL,hash TEXT NOT NULL,finished_at TEXT NOT NULL);
        CREATE TABLE reservations(id TEXT PRIMARY KEY,attempt_id TEXT NOT NULL REFERENCES attempts(id),request_key TEXT NOT NULL UNIQUE,input_bound INTEGER NOT NULL,output_bound INTEGER NOT NULL,reserved INTEGER NOT NULL,state TEXT NOT NULL,actual INTEGER,usage TEXT,created_at TEXT NOT NULL);
        CREATE TABLE audit(seq INTEGER PRIMARY KEY AUTOINCREMENT,body TEXT NOT NULL,hash TEXT NOT NULL);
        CREATE TABLE execution_clock(id INTEGER PRIMARY KEY CHECK(id=1),first_call_at INTEGER,active_ms INTEGER NOT NULL,calibration_ms INTEGER NOT NULL,active_since INTEGER,pid INTEGER,nonce TEXT,phase TEXT);
        INSERT INTO execution_clock VALUES(1,NULL,0,0,NULL,NULL,NULL,NULL);
        PRAGMA application_id=1145455927;PRAGMA user_version=1;`);this.db.prepare('INSERT INTO metadata VALUES(1,?,?)').run(encoded(this.config),digest(this.config));
        for(const table of ['metadata','outcomes','audit'])this.db.exec(`CREATE TRIGGER ${table}_immutable BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Immutable evaluation evidence');END;CREATE TRIGGER ${table}_retain BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Retain evaluation evidence');END;`);});
      else if(version!==1||this.db.prepare('PRAGMA application_id').get()?.application_id!==1145455927)throw new Error('EVALUATION_SCHEMA_UNSUPPORTED');
      const saved=this.db.prepare('SELECT body,hash FROM metadata WHERE id=1').get();if(!saved||saved.hash!==digest(this.config)||saved.body!==encoded(this.config))throw new Error('EVALUATION_CONFIG_CHANGED');
      if(this.config.executionBounds&&!this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='execution_clock' AND type='table'").get())throw new Error('EVALUATION_CLOCK_MISSING');
    }catch(e){this.db.close();throw e;}}
  private atomic<T>(work:()=>T){this.db.exec('BEGIN IMMEDIATE');try{const value=work();this.db.exec('COMMIT');return value;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  private event(type:string,data:Record<string,unknown>){const body={type,at:new Date().toISOString(),data};this.db.prepare('INSERT INTO audit(body,hash) VALUES(?,?)').run(encoded(body),digest(body));}
  private attempt(key:string){const row=this.db.prepare('SELECT * FROM attempts WHERE id=?').get(z.uuid().parse(key));if(!row)throw new Error('EVALUATION_ATTEMPT_MISSING');return row;}
  executionStatus(now=Date.now()){
    const bounds=this.config.executionBounds;if(!bounds)return null;
    const row=this.db.prepare('SELECT * FROM execution_clock WHERE id=1').get();if(!row)throw new Error('EVALUATION_CLOCK_MISSING');
    const since=row.active_since===null?null:Number(row.active_since);if(since!==null&&now<since)throw new Error('EVALUATION_CLOCK_MOVED_BACKWARDS');
    const elapsed=since===null?0:now-since,activeMs=Number(row.active_ms)+elapsed,calibrationMs=Number(row.calibration_ms)+(row.phase==='calibration'?elapsed:0),firstCallAt=row.first_call_at===null?null:Number(row.first_call_at);
    return {firstCallAt,expiresAt:firstCallAt===null?null:firstCallAt+bounds.validForMsAfterFirstCall,activeMs,calibrationMs,remainingActiveMs:Math.max(0,bounds.maximumActiveMs-activeMs),phase:row.phase===null?null:String(row.phase),ownerPid:row.pid===null?null:Number(row.pid),running:since!==null};
  }
  startExecution(phase:'calibration'|'formal'|'retest',now=Date.now()){
    if(!this.config.executionBounds||this.config.mode!=='real')throw new Error('EVALUATION_CLOCK_NOT_CONFIGURED');
    this.atomic(()=>{const row=this.db.prepare('SELECT * FROM execution_clock WHERE id=1').get()!;
      if(row.active_since!==null){let live=true;try{process.kill(Number(row.pid),0);}catch(error){if(error&&typeof error==='object'&&'code'in error&&error.code==='ESRCH')live=false;}if(live)throw new Error('EVALUATION_EXECUTOR_ACTIVE');
        const elapsed=now-Number(row.active_since);if(elapsed<0)throw new Error('EVALUATION_CLOCK_MOVED_BACKWARDS');
        // An unobserved crash interval is charged conservatively instead of granting time again.
        this.db.prepare('UPDATE execution_clock SET active_ms=active_ms+?,calibration_ms=calibration_ms+?,active_since=NULL,pid=NULL,nonce=NULL,phase=NULL WHERE id=1').run(elapsed,row.phase==='calibration'?elapsed:0);
      }
      const current=this.executionStatus(now)!;if(current.remainingActiveMs<=0)throw new Error('EVALUATION_TIME_EXHAUSTED');if(current.expiresAt!==null&&now>=current.expiresAt)throw new Error('EVALUATION_AUTHORIZATION_EXPIRED');
      if(phase==='calibration'&&current.calibrationMs>=this.config.executionBounds!.calibrationMaximumActiveMs)throw new Error('EVALUATION_CALIBRATION_TIME_EXHAUSTED');
      const nonce=randomUUID();this.db.prepare('UPDATE execution_clock SET active_since=?,pid=?,nonce=?,phase=? WHERE id=1').run(now,process.pid,nonce,phase);this.executionNonce=nonce;this.event('execution.started',{phase});
    });
  }
  stopExecution(now=Date.now()){
    if(!this.executionNonce)return;
    this.atomic(()=>{const row=this.db.prepare('SELECT * FROM execution_clock WHERE id=1').get()!;if(row.nonce!==this.executionNonce||row.pid!==process.pid)throw new Error('EVALUATION_EXECUTION_OWNER_CHANGED');const elapsed=now-Number(row.active_since);if(elapsed<0)throw new Error('EVALUATION_CLOCK_MOVED_BACKWARDS');this.db.prepare('UPDATE execution_clock SET active_ms=active_ms+?,calibration_ms=calibration_ms+?,active_since=NULL,pid=NULL,nonce=NULL,phase=NULL WHERE id=1').run(elapsed,row.phase==='calibration'?elapsed:0);this.event('execution.stopped',{elapsedMs:elapsed});});this.executionNonce=undefined;
  }
  remainingExecutionMs(now=Date.now()){
    const bounds=this.config.executionBounds;if(!bounds)return Number.POSITIVE_INFINITY;const row=this.db.prepare('SELECT nonce,pid FROM execution_clock WHERE id=1').get()!;
    if(!this.executionNonce||row.nonce!==this.executionNonce||row.pid!==process.pid)throw new Error('EVALUATION_EXECUTION_NOT_STARTED');
    const state=this.executionStatus(now)!,remaining=Math.min(state.remainingActiveMs,state.expiresAt===null?Number.POSITIVE_INFINITY:state.expiresAt-now,state.phase==='calibration'?bounds.calibrationMaximumActiveMs-state.calibrationMs:Number.POSITIVE_INFINITY);
    if(remaining<=0)throw new Error(state.expiresAt!==null&&now>=state.expiresAt?'EVALUATION_AUTHORIZATION_EXPIRED':'EVALUATION_TIME_EXHAUSTED');return remaining;
  }
  begin(caseId:string,{retry=false}: {retry?:boolean}={}){if(!this.config.cases.some(c=>c.id===caseId))throw new Error('EVALUATION_CASE_UNKNOWN');return this.atomic(()=>{const last=this.db.prepare('SELECT * FROM attempts WHERE case_id=? ORDER BY ordinal DESC LIMIT 1').get(caseId);
    if(last&&!retry)throw new Error(last.state==='running'?'EVALUATION_ATTEMPT_RUNNING':'EVALUATION_RETRY_MUST_BE_EXPLICIT');if(last?.state==='running')throw new Error('EVALUATION_ATTEMPT_RUNNING');const key=randomUUID(),ordinal=last?Number(last.ordinal)+1:1;this.db.prepare("INSERT INTO attempts VALUES(?,?,?,?,'running')").run(key,caseId,ordinal,new Date().toISOString());this.event('attempt.started',{attemptId:key,caseId,ordinal});return key;});}
  reserve(attemptId:string,requestKey:string,inputBound:number,outputBound:number,now=Date.now()){id.parse(requestKey);integer.parse(inputBound);integer.parse(outputBound);return this.atomic(()=>{if(this.config.mode!=='real'||!this.config.budget.authorized)throw new Error('EVALUATION_REAL_NOT_AUTHORIZED');if(Date.parse(this.config.budget.expiresAt)<=now)throw new Error('EVALUATION_BUDGET_EXPIRED');if(this.attempt(attemptId).state!=='running')throw new Error('EVALUATION_ATTEMPT_FINISHED');
    this.remainingExecutionMs(now);
    if(this.db.prepare("SELECT 1 FROM reservations WHERE state='unknown'").get())throw new Error('EVALUATION_UNKNOWN_COST');if(this.db.prepare('SELECT 1 FROM reservations WHERE request_key=?').get(requestKey))throw new Error('EVALUATION_REQUEST_ALREADY_RESERVED');
    if(this.config.executionBounds&&this.db.prepare("SELECT 1 FROM reservations WHERE state='reserved'").get())throw new Error('EVALUATION_REQUEST_INFLIGHT');
    const reserved=fee(inputBound,this.config.budget.inputMicroCnyPerMillion)+fee(outputBound,this.config.budget.outputMicroCnyPerMillion);if(!Number.isSafeInteger(reserved))throw new Error('EVALUATION_COST_OVERFLOW');if(reserved>this.budget.remaining)throw new Error('EVALUATION_BUDGET_EXHAUSTED');
    if(this.config.executionBounds){const calibration=String(this.attempt(attemptId).case_id).startsWith('CAL-'),state=this.executionStatus(now)!;if(calibration!==(state.phase==='calibration'))throw new Error('EVALUATION_EXECUTION_PHASE_MISMATCH');
      if(calibration){const used=this.db.prepare("SELECT sum(CASE WHEN r.state='settled' THEN r.actual ELSE max(r.reserved,coalesce(r.actual,0)) END) AS n FROM reservations r JOIN attempts a ON a.id=r.attempt_id WHERE a.case_id LIKE 'CAL-%'").get();if(Number(used?.n??0)+reserved>this.config.executionBounds.calibrationMaximumMicroCny)throw new Error('EVALUATION_CALIBRATION_BUDGET_EXHAUSTED');}
      this.db.prepare('UPDATE execution_clock SET first_call_at=coalesce(first_call_at,?) WHERE id=1').run(now);
    }
    const key=randomUUID();this.db.prepare("INSERT INTO reservations VALUES(?,?,?,?,?,?,'reserved',NULL,NULL,?)").run(key,attemptId,requestKey,inputBound,outputBound,reserved,new Date(now).toISOString());this.event('cost.reserved',{reservationId:key,attemptId,reserved});return key;});}
  settle(reservationId:string,usage:{inputTokens:number;outputTokens:number}|null){return this.atomic(()=>{const row=this.db.prepare('SELECT * FROM reservations WHERE id=?').get(z.uuid().parse(reservationId));if(!row)throw new Error('EVALUATION_RESERVATION_MISSING');
    if(row.state!=='reserved'){if(row.usage===encoded(usage))return;throw new Error('EVALUATION_COST_CONFLICT');}
    const parsed=usage===null?null:z.strictObject({inputTokens:integer,outputTokens:integer}).parse(usage),actual=parsed?fee(parsed.inputTokens,this.config.budget.inputMicroCnyPerMillion)+fee(parsed.outputTokens,this.config.budget.outputMicroCnyPerMillion):null;
    const exceeded=parsed!==null&&(parsed.inputTokens>Number(row.input_bound)||parsed.outputTokens>Number(row.output_bound)||actual!>Number(row.reserved));
    this.db.prepare('UPDATE reservations SET state=?,actual=?,usage=? WHERE id=?').run(parsed&&!exceeded?'settled':'unknown',actual,encoded(parsed),reservationId);this.event('cost.settled',{reservationId,actual,unknown:!parsed||exceeded});
    return {actual,unknown:!parsed||exceeded};});}
  finish(attemptId:string,raw:EvaluationOutcome){const body=outcome.parse(raw);return this.atomic(()=>{const prior=this.db.prepare('SELECT hash FROM outcomes WHERE attempt_id=?').get(attemptId);if(prior){if(prior.hash!==digest(body))throw new Error('EVALUATION_RESULT_CONFLICT');return;}
    if(this.attempt(attemptId).state!=='running')throw new Error('EVALUATION_ATTEMPT_FINISHED');if(this.db.prepare("SELECT 1 FROM reservations WHERE attempt_id=? AND state='reserved'").get(attemptId))throw new Error('EVALUATION_COST_PENDING');
    this.db.prepare('INSERT INTO outcomes VALUES(?,?,?,?)').run(attemptId,encoded(body),digest(body),new Date().toISOString());this.db.prepare('UPDATE attempts SET state=? WHERE id=?').run(body.state,attemptId);this.event('attempt.finished',{attemptId,state:body.state});});}
  recordCall(raw:EvaluationCall){const call=EvaluationCallSchema.parse(raw);this.atomic(()=>{const attempt=this.attempt(call.attemptId);if(call.phase==='started'&&attempt.state!=='running')throw new Error('EVALUATION_ATTEMPT_FINISHED');
    const old=this.db.prepare("SELECT body FROM audit WHERE json_extract(body,'$.type')=? AND json_extract(body,'$.data.id')=?").get('model.call.'+call.phase,call.id);if(old)throw new Error('EVALUATION_CALL_DUPLICATE');
    if(call.phase==='finished'){const prior=this.db.prepare("SELECT body FROM audit WHERE json_extract(body,'$.type')='model.call.started' AND json_extract(body,'$.data.id')=?").get(call.id);if(!prior)throw new Error('EVALUATION_CALL_NOT_STARTED');const start=EvaluationCallSchema.parse(JSON.parse(String(prior.body)).data);if(start.attemptId!==call.attemptId||start.requestHash!==call.requestHash||start.reservationId!==call.reservationId)throw new Error('EVALUATION_CALL_CONFLICT');}
    this.event('model.call.'+call.phase,{...call});});}
  recordBatch(raw:z.infer<typeof batchArtifact>){const batch=batchArtifact.parse(raw);if(batch.relative!==`batches/${batch.batchId}.json`)throw new Error('EVALUATION_BATCH_INVALID');this.atomic(()=>{if(this.db.prepare("SELECT 1 FROM audit WHERE json_extract(body,'$.type')='batch.recorded' AND json_extract(body,'$.data.batchId')=?").get(batch.batchId))throw new Error('EVALUATION_BATCH_DUPLICATE');this.event('batch.recorded',batch);});}
  recover(){return this.atomic(()=>{if(this.config.executionBounds){const clock=this.db.prepare('SELECT * FROM execution_clock WHERE id=1').get()!;if(clock.active_since!==null){let live=true;try{process.kill(Number(clock.pid),0);}catch(error){if(error&&typeof error==='object'&&'code'in error&&error.code==='ESRCH')live=false;}if(live)throw new Error('EVALUATION_EXECUTOR_ACTIVE');const elapsed=Date.now()-Number(clock.active_since);if(elapsed<0)throw new Error('EVALUATION_CLOCK_MOVED_BACKWARDS');this.db.prepare('UPDATE execution_clock SET active_ms=active_ms+?,calibration_ms=calibration_ms+?,active_since=NULL,pid=NULL,nonce=NULL,phase=NULL WHERE id=1').run(elapsed,clock.phase==='calibration'?elapsed:0);this.event('execution.interrupted',{elapsedMs:elapsed});}}const active=this.db.prepare("SELECT id FROM attempts WHERE state='running'").all();this.db.prepare("UPDATE reservations SET state='unknown',usage='null' WHERE state='reserved'").run();for(const row of active){const body:EvaluationOutcome={state:'interrupted',code:'EVALUATION_PROCESS_INTERRUPTED',programChecks:[],answerHash:null,artifacts:[]};this.db.prepare('INSERT INTO outcomes VALUES(?,?,?,?)').run(String(row.id),encoded(body),digest(body),new Date().toISOString());this.db.prepare("UPDATE attempts SET state='interrupted' WHERE id=?").run(row.id!);this.event('attempt.interrupted',{attemptId:String(row.id)});}return active.length;});}
  get budget(){let held=0,spent=0,unknown=0;for(const row of this.db.prepare('SELECT state,reserved,actual FROM reservations').all()){if(row.state==='settled')spent+=Number(row.actual);else{held+=Math.max(Number(row.reserved),row.actual===null?0:Number(row.actual));if(row.state==='unknown')unknown++;}}return {maximum:this.config.budget.maximumMicroCny,spent,held,unknown,remaining:Math.max(0,this.config.budget.maximumMicroCny-spent-held)};}
  report(){const attempts=this.db.prepare('SELECT a.*,o.body,o.hash,o.finished_at FROM attempts a LEFT JOIN outcomes o ON o.attempt_id=a.id ORDER BY a.rowid').all().map(row=>{const result=row.body===null?null:outcome.parse(JSON.parse(String(row.body)));if(result&&digest(result)!==row.hash)throw new Error('EVALUATION_EVIDENCE_CORRUPT');return {attemptId:String(row.id),caseId:String(row.case_id),ordinal:Number(row.ordinal),state:String(row.state),startedAt:String(row.started_at),finishedAt:row.finished_at===null?null:String(row.finished_at),result};});
    const calls=this.db.prepare("SELECT body,hash FROM audit WHERE json_extract(body,'$.type') IN ('model.call.started','model.call.finished') ORDER BY seq").all().map(row=>{const body:unknown=JSON.parse(String(row.body));if(digest(body)!==row.hash)throw new Error('EVALUATION_EVIDENCE_CORRUPT');return EvaluationCallSchema.parse(z.object({data:z.unknown()}).parse(body).data);});
    const batches=this.db.prepare("SELECT body,hash FROM audit WHERE json_extract(body,'$.type')='batch.recorded' ORDER BY seq").all().map(row=>{const body:unknown=JSON.parse(String(row.body));if(digest(body)!==row.hash)throw new Error('EVALUATION_EVIDENCE_CORRUPT');return batchArtifact.parse(z.object({data:z.unknown()}).parse(body).data);});
    return {schemaVersion:1,suiteId:this.config.suiteId,mode:this.config.mode,budget:this.budget,execution:this.executionStatus(),cases:this.config.cases.map(c=>({...c,state:attempts.findLast(a=>a.caseId===c.id)?.state??'not-run'})),attempts,calls,batches,realExecutionAuthorized:this.config.mode==='real'&&this.config.budget.authorized,humanAccepted:false};}
  close(){this.db.close();}
}
