import { DatabaseSync } from 'node:sqlite';
import { existsSync,mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import { z } from 'zod';
import { configureSqlite } from '@dafeiyu/journal';
import { ActivityScheduleBodySchema,ActivityConfigSchema,ActivityDomainEventSchema,WakeOccurrenceBodySchema,ActivityOccurrenceStateSchema,PersonaRequestIdSchema,redactJson } from '@dafeiyu/contracts';
import type { ActivityScheduleBody,ActivityDomainEvent,WakeOccurrenceBody,ActivityOccurrenceState,ExecutionScope } from '@dafeiyu/contracts';
import { initialDue,elapsedDue,nextAllowed,validateQuiet,localTime,daySlices } from './time.js';

export const ACTIVITY_APPLICATION_ID=0x44464134;
export const ACTIVITY_SCHEMA_VERSION=1;
const identitySchema=z.strictObject({agentId:z.string().min(1).max(100),profileId:z.string().min(1).max(100)});
const createSchema=ActivityScheduleBodySchema.omit({id:true,version:true,createdAt:true,updatedAt:true,taskGeneration:true}).extend({requestId:PersonaRequestIdSchema});
const updateSchema=z.strictObject({requestId:PersonaRequestIdSchema,expectedVersion:z.number().int().positive(),state:ActivityScheduleBodySchema.shape.state.optional(),
  trigger:ActivityScheduleBodySchema.shape.trigger.optional(),missed:ActivityScheduleBodySchema.shape.missed.optional(),quiet:ActivityScheduleBodySchema.shape.quiet.optional(),
  timeZone:ActivityScheduleBodySchema.shape.timeZone.optional(),goal:ActivityScheduleBodySchema.shape.goal.optional(),anchor:ActivityScheduleBodySchema.shape.anchor.optional(),
  basis:ActivityScheduleBodySchema.shape.basis.optional(),configHash:ActivityScheduleBodySchema.shape.configHash.optional()})
  .refine(v=>[v.state,v.trigger,v.missed,v.quiet,v.timeZone,v.goal,v.anchor].some(value=>value!==undefined),'Empty activity update');
const runEventSchema=z.strictObject({id:z.uuid(),occurrenceId:PersonaRequestIdSchema,runId:z.uuid(),state:z.enum(['running','completed','waiting','failed','cancelled','interrupted']),
  at:z.iso.datetime({offset:true}),unknownEffects:z.boolean()});
function canonical(value:unknown):string {
  const parsed=z.json().parse(value);if(parsed===null||typeof parsed!=='object')return JSON.stringify(parsed);
  if(Array.isArray(parsed))return '['+parsed.map(canonical).join(',')+']';return '{'+Object.keys(parsed).sort().map(key=>JSON.stringify(key)+':'+canonical(parsed[key])).join(',')+'}';
}
export const activityHash=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
export const activityScope=(scope:ExecutionScope)=>scope.kind==='task'?scope.scopeKey:JSON.stringify(['conversation',scope.agentId,scope.route]);
export interface StoredSchedule {body:ActivityScheduleBody;status:'active'|'paused'|'cancelled'|'exhausted'|'blocked';nextDue:number|null;notBefore:number;failures:number;error:string|null}
export interface StoredOccurrence {body:WakeOccurrenceBody;state:ActivityOccurrenceState;runId:string|null;startedAt:number|null;error:string|null}

/** Trusted program persistence. No method accepts model authority directly. */
export class ActivityStore {
  private readonly db:DatabaseSync;
  readonly config:z.output<typeof ActivityConfigSchema>;
  readonly identity:z.infer<typeof identitySchema>;
  private closed=false;
  constructor(file:string,identity:z.infer<typeof identitySchema>,config:z.input<typeof ActivityConfigSchema>={},create=false){
    this.identity=identitySchema.parse(identity);this.config=ActivityConfigSchema.parse(config);validateQuiet(this.config.quiet);
    if(!existsSync(file)&&!create)throw new Error('ACTIVITY_MIGRATION_REQUIRED');if(create)mkdirSync(dirname(file),{recursive:true});
    this.db=new DatabaseSync(file);try{
      this.db.exec('PRAGMA busy_timeout=5000;');const version=Number(this.db.prepare('PRAGMA user_version').get()?.user_version),app=Number(this.db.prepare('PRAGMA application_id').get()?.application_id);
      const empty=Number(this.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get()?.n)===0;
      if(version===0&&app===0&&empty&&create){configureSqlite(this.db);this.transaction(()=>this.initialize());}
      else if(version!==ACTIVITY_SCHEMA_VERSION||app!==ACTIVITY_APPLICATION_ID)throw new Error('ACTIVITY_SCHEMA_UNSUPPORTED');
      const stored=this.db.prepare('SELECT body FROM activity_metadata WHERE id=1').get();if(!stored||canonical(JSON.parse(String(stored.body)))!==canonical(this.identity))throw new Error('ACTIVITY_IDENTITY_MISMATCH');
      configureSqlite(this.db);
    }catch(error){this.db.close();throw error;}
  }
  private initialize(){this.db.exec(`
    CREATE TABLE activity_metadata(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL);
    CREATE TABLE activity_schedules(id TEXT PRIMARY KEY,owner_key TEXT NOT NULL,version INTEGER NOT NULL,task_generation INTEGER NOT NULL,status TEXT NOT NULL,next_due INTEGER,not_before INTEGER NOT NULL DEFAULT 0,event_cursor INTEGER NOT NULL DEFAULT 0,failures INTEGER NOT NULL DEFAULT 0,error TEXT);
    CREATE INDEX activity_due ON activity_schedules(status,next_due,not_before);
    CREATE TABLE activity_schedule_revisions(id TEXT NOT NULL REFERENCES activity_schedules(id),version INTEGER NOT NULL,body TEXT NOT NULL,body_hash TEXT NOT NULL,PRIMARY KEY(id,version));
    CREATE TABLE activity_tasks(schedule_id TEXT NOT NULL REFERENCES activity_schedules(id),generation INTEGER NOT NULL,task_id TEXT NOT NULL,epoch INTEGER NOT NULL,PRIMARY KEY(schedule_id,generation));
    CREATE TABLE activity_occurrences(id TEXT PRIMARY KEY,schedule_id TEXT NOT NULL REFERENCES activity_schedules(id),schedule_version INTEGER NOT NULL,body TEXT NOT NULL,body_hash TEXT NOT NULL,state TEXT NOT NULL,run_id TEXT UNIQUE,started_at INTEGER,error TEXT,updated_at INTEGER NOT NULL);
    CREATE INDEX activity_occurrence_plan ON activity_occurrences(schedule_id,state);
    CREATE TABLE activity_outbox(id TEXT PRIMARY KEY REFERENCES activity_occurrences(id),acknowledged INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE activity_requests(scope_key TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,receipt TEXT NOT NULL,PRIMARY KEY(scope_key,request_id));
    CREATE TABLE activity_domain_events(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,body TEXT NOT NULL,body_hash TEXT NOT NULL);
    CREATE TABLE activity_condition_watermarks(schedule_id TEXT NOT NULL,event_type TEXT NOT NULL,event_key TEXT NOT NULL,watermark TEXT NOT NULL,PRIMARY KEY(schedule_id,event_type,event_key,watermark));
    CREATE TABLE activity_run_events(id TEXT PRIMARY KEY,occurrence_id TEXT NOT NULL REFERENCES activity_occurrences(id),body TEXT NOT NULL,body_hash TEXT NOT NULL);
    CREATE TABLE activity_usage(run_id TEXT NOT NULL,day TEXT NOT NULL,milliseconds INTEGER NOT NULL,PRIMARY KEY(run_id,day));
    CREATE TABLE activity_clock(id INTEGER PRIMARY KEY CHECK(id=1),last_seen INTEGER NOT NULL);
    INSERT INTO activity_clock VALUES(1,0);
    PRAGMA application_id=${ACTIVITY_APPLICATION_ID};PRAGMA user_version=1;
  `);
    for(const table of ['activity_metadata','activity_schedule_revisions','activity_tasks','activity_requests','activity_domain_events','activity_condition_watermarks','activity_run_events','activity_usage']){
      this.db.exec(`CREATE TRIGGER ${table}_immutable BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Immutable activity history');END;
        CREATE TRIGGER ${table}_retain BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Retain activity history');END;`);
    }
    this.db.exec("CREATE TRIGGER activity_occurrence_immutable BEFORE UPDATE OF id,schedule_id,schedule_version,body,body_hash ON activity_occurrences BEGIN SELECT RAISE(ABORT,'Immutable wake occurrence');END;");
    this.db.prepare('INSERT INTO activity_metadata VALUES(1,?)').run(JSON.stringify(this.identity));
  }
  private transaction<T>(work:()=>T):T {this.db.exec('BEGIN IMMEDIATE');try{const value=work();this.db.exec('COMMIT');return value;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  private clock(now:number){z.number().int().nonnegative().safe().parse(now);const prior=Number(this.db.prepare('SELECT last_seen FROM activity_clock WHERE id=1').get()?.last_seen),value=Math.max(prior,now);
    this.db.prepare('UPDATE activity_clock SET last_seen=? WHERE id=1').run(value);return value;}
  private authorize(body:ActivityScheduleBody,scope?:ExecutionScope){if(!scope)return;
    if(scope.agentId!==this.identity.agentId)throw new Error('SCOPE_DENIED');if(activityScope(body.owner)===activityScope(scope))return;
    if(scope.kind==='task'&&this.task(body.id)?.taskId===scope.taskId)return;throw new Error('SCOPE_DENIED');}
  get(id:string,scope?:ExecutionScope):StoredSchedule {
    const row=this.db.prepare('SELECT s.*,r.body,r.body_hash FROM activity_schedules s JOIN activity_schedule_revisions r ON r.id=s.id AND r.version=s.version WHERE s.id=?').get(z.uuid().parse(id));
    if(!row)throw new Error('SCOPE_DENIED');const body=ActivityScheduleBodySchema.parse(JSON.parse(String(row.body)));if(activityHash(body)!==row.body_hash||body.agentId!==this.identity.agentId)throw new Error('ACTIVITY_STATE_CORRUPT');
    this.authorize(body,scope);return {body,status:z.enum(['active','paused','cancelled','exhausted','blocked']).parse(row.status),nextDue:row.next_due===null?null:Number(row.next_due),notBefore:Number(row.not_before),failures:Number(row.failures),error:row.error===null?null:String(row.error)};
  }
  list(scope:ExecutionScope,limit=32){z.number().int().min(1).max(100).parse(limit);if(scope.agentId!==this.identity.agentId)throw new Error('SCOPE_DENIED');
    const ids=this.db.prepare('SELECT s.id FROM activity_schedules s WHERE s.owner_key=? OR EXISTS(SELECT 1 FROM activity_tasks t WHERE t.schedule_id=s.id AND t.generation=s.task_generation AND t.task_id=?) ORDER BY s.rowid DESC LIMIT ?')
      .all(activityScope(scope),scope.kind==='task'?scope.taskId:'',limit);return ids.map(row=>this.get(String(row.id),scope));}
  private validate(body:ActivityScheduleBody){
    if(body.agentId!==this.identity.agentId||body.owner.agentId!==this.identity.agentId)throw new Error('SCOPE_DENIED');
    if(body.anchor&&(activityScope(body.anchor.scope)!==activityScope(body.owner)&&body.purpose!=='exploration'))throw new Error('SCOPE_DENIED');
    if(body.trigger.kind==='interval'&&body.trigger.intervalMs<this.config.minIntervalMs)throw new Error('ACTIVITY_INTERVAL_TOO_SHORT');
    if(body.purpose==='maintenance'&&!body.maintenanceId||body.purpose==='exploration'&&!body.anchor)throw new Error('ACTIVITY_SOURCE_REQUIRED');
    validateQuiet(body.quiet);if(redactJson(z.json().parse(body)).redacted)throw new Error('PRIVATE_INPUT_REJECTED');
  }
  private request<T>(scope:string,id:string,fingerprint:string,parse:(raw:unknown)=>T,write:()=>T):T {
    const old=this.db.prepare('SELECT fingerprint,receipt FROM activity_requests WHERE scope_key=? AND request_id=?').get(scope,id);
    if(old){if(old.fingerprint!==fingerprint)throw new Error('IDEMPOTENCY_CONFLICT');return parse(JSON.parse(String(old.receipt)));}
    const value=write();this.db.prepare('INSERT INTO activity_requests VALUES(?,?,?,?)').run(scope,id,fingerprint,JSON.stringify(value));return value;
  }
  create(raw:unknown,now:number){const input=createSchema.parse(raw),{requestId,...spec}=input;
    return this.transaction(()=>{const time=this.clock(now),fingerprint=activityHash({kind:'create',...spec,anchor:spec.anchor?{scope:spec.anchor.scope}:null});
      return this.request(activityScope(spec.owner),requestId,fingerprint,v=>z.object({id:z.uuid(),version:z.number()}).parse(v),()=>{
        if(Number(this.db.prepare("SELECT count(*) AS n FROM activity_schedules WHERE status NOT IN ('cancelled','exhausted')").get()?.n)>=this.config.maxPlans)throw new Error('ACTIVITY_CAPACITY');
        const body=ActivityScheduleBodySchema.parse({...spec,schemaVersion:1,id:randomUUID(),version:1,taskGeneration:1,createdAt:new Date(time).toISOString(),updatedAt:new Date(time).toISOString()});this.validate(body);
        this.db.prepare('INSERT INTO activity_schedules(id,owner_key,version,task_generation,status,next_due) VALUES(?,?,1,1,?,?)').run(body.id,activityScope(body.owner),body.state,initialDue(body.trigger));
        this.revision(body);return {id:body.id,version:body.version};});});
  }
  private revision(body:ActivityScheduleBody){this.db.prepare('INSERT INTO activity_schedule_revisions VALUES(?,?,?,?)').run(body.id,body.version,JSON.stringify(body),activityHash(body));}
  update(id:string,scope:ExecutionScope,raw:unknown,now:number){const input=updateSchema.parse(raw);return this.transaction(()=>{
    const current=this.get(id,scope),time=this.clock(now);return this.request(activityScope(scope),input.requestId,activityHash({kind:'update',id,input}),v=>z.object({id:z.uuid(),version:z.number()}).parse(v),()=>{
      if(current.body.version!==input.expectedVersion)throw new Error('VERSION_CONFLICT');if(current.body.state==='cancelled')throw new Error('ACTIVITY_CANCELLED');
      const {requestId:_request,expectedVersion:_expected,...patch}=input;const changedGoal=input.goal!==undefined&&input.goal!==current.body.goal;
      if(changedGoal&&(input.anchor===undefined||input.anchor===null))throw new Error('ACTIVITY_SOURCE_REQUIRED');
      const body=ActivityScheduleBodySchema.parse({...current.body,...patch,version:current.body.version+1,taskGeneration:current.body.taskGeneration+(changedGoal?1:0),updatedAt:new Date(time).toISOString()});this.validate(body);
      this.revision(body);this.db.prepare('UPDATE activity_schedules SET version=?,task_generation=?,status=?,next_due=?,not_before=?,failures=0,error=NULL WHERE id=?')
        .run(body.version,body.taskGeneration,body.state,input.trigger?initialDue(body.trigger):current.nextDue,time,id);
      // Already-running work is settled by the service; queued intents cannot survive a changed plan.
      this.db.prepare("UPDATE activity_occurrences SET state='cancelled',error='SCHEDULE_CHANGED',updated_at=? WHERE schedule_id=? AND state IN ('pending','accepted') AND started_at IS NULL").run(time,id);
      this.db.prepare("UPDATE activity_outbox SET acknowledged=1 WHERE id IN(SELECT id FROM activity_occurrences WHERE schedule_id=? AND state='cancelled' AND run_id IS NULL)").run(id);
      return {id,version:body.version};});});}
  bindTask(id:string,generation:number,taskId:string,epoch:number){z.uuid().parse(taskId);z.number().int().positive().parse(epoch);
    return this.transaction(()=>{const plan=this.get(id);if(plan.body.taskGeneration!==generation)throw new Error('VERSION_CONFLICT');
      const old=this.db.prepare('SELECT task_id,epoch FROM activity_tasks WHERE schedule_id=? AND generation=?').get(id,generation);
      if(old){if(old.task_id!==taskId||old.epoch!==epoch)throw new Error('ACTIVITY_TASK_CONFLICT');return;}
      this.db.prepare('INSERT INTO activity_tasks VALUES(?,?,?,?)').run(id,generation,taskId,epoch);});}
  task(id:string){const row=this.db.prepare('SELECT t.task_id,t.epoch FROM activity_tasks t JOIN activity_schedules s ON s.id=t.schedule_id AND s.task_generation=t.generation WHERE s.id=?').get(id);
    return row?{taskId:String(row.task_id),epoch:Number(row.epoch)}:null;}
  event(raw:ActivityDomainEvent){const event=ActivityDomainEventSchema.parse(raw),hash=activityHash(event);return this.transaction(()=>{
    const old=this.db.prepare('SELECT seq,body_hash FROM activity_domain_events WHERE id=?').get(event.id);if(old){if(old.body_hash!==hash)throw new Error('IDEMPOTENCY_CONFLICT');return Number(old.seq);}
    return Number(this.db.prepare('INSERT INTO activity_domain_events(id,body,body_hash) VALUES(?,?,?)').run(event.id,JSON.stringify(event),hash).lastInsertRowid);});}
  due(now:number){return this.transaction(()=>{const time=this.clock(now);return this.db.prepare("SELECT id FROM activity_schedules WHERE status='active' AND not_before<=? AND (next_due<=? OR next_due IS NULL) ORDER BY coalesce(next_due,0),rowid LIMIT ?")
    .all(time,time,this.config.maxPlans).map(r=>String(r.id));});}
  private condition(plan:StoredSchedule){if(plan.body.trigger.kind!=='condition')return null;
    const cursor=Number(this.db.prepare('SELECT event_cursor FROM activity_schedules WHERE id=?').get(plan.body.id)?.event_cursor);
    return this.db.prepare("SELECT seq,id,json_extract(body,'$.watermark') AS watermark FROM activity_domain_events WHERE seq>? AND json_extract(body,'$.type')=? AND json_extract(body,'$.key')=? AND json_extract(body,'$.origin')='primary' AND NOT EXISTS(SELECT 1 FROM activity_condition_watermarks w WHERE w.schedule_id=? AND w.event_type=json_extract(body,'$.type') AND w.event_key=json_extract(body,'$.key') AND w.watermark=json_extract(body,'$.watermark')) ORDER BY seq DESC LIMIT 1")
      .get(cursor,plan.body.trigger.event,plan.body.trigger.key,plan.body.id)??null;}
  issue(id:string,now:number):WakeOccurrenceBody|null {return this.transaction(()=>{
    const time=this.clock(now),plan=this.get(id);if(plan.status!=='active'||plan.body.state!=='active'||time<plan.notBefore)return null;
    if(this.db.prepare("SELECT 1 FROM activity_occurrences WHERE schedule_id=? AND state IN ('pending','accepted','running') LIMIT 1").get(id))return null;
    if(Number(this.db.prepare("SELECT count(*) AS n FROM activity_occurrences WHERE state IN ('pending','accepted','running')").get()?.n)>=this.config.maxConcurrent)return null;
    if(this.used(time)>=this.config.dailyActiveMs)return null;
    const last=this.db.prepare("SELECT json_extract(body,'$.createdAt') AS at FROM activity_occurrences ORDER BY rowid DESC LIMIT 1").get();
    if(last&&time<Date.parse(String(last.at))+this.config.minIntervalMs)return null;
    const allowed=nextAllowed(time,plan.body.timeZone,plan.body.quiet);if(allowed>time){this.db.prepare('UPDATE activity_schedules SET not_before=? WHERE id=?').run(allowed,id);return null;}
    const conditional=this.condition(plan);let due:number|null,next:number|null;
    if(plan.body.trigger.kind==='condition'){if(!conditional)return null;due=time;next=null;}
    else{if(plan.nextDue===null)return null;({due,next}=elapsedDue(plan.body,plan.nextDue,time,Math.max(this.config.minIntervalMs,this.config.tickMs*2)));}
    if(due===null){this.db.prepare('UPDATE activity_schedules SET next_due=?,status=? WHERE id=?').run(next,next===null?'exhausted':'active',id);return null;}
    const task=this.task(id);if(!task)throw new Error('ACTIVITY_TASK_REQUIRED');
    const body=WakeOccurrenceBodySchema.parse({schemaVersion:1,id:activityHash([id,plan.body.version,due,conditional?.id??null]),scheduleId:id,scheduleVersion:plan.body.version,
      taskId:task.taskId,taskEpoch:task.epoch,taskGeneration:plan.body.taskGeneration,dueAt:new Date(due).toISOString(),createdAt:new Date(time).toISOString(),
      reason:plan.body.purpose==='maintenance'?'maintenance':conditional?'condition':'time',eventId:conditional?.id??null,configHash:plan.body.configHash});
    this.db.prepare("INSERT INTO activity_occurrences(id,schedule_id,schedule_version,body,body_hash,state,updated_at) VALUES(?,?,?,?,?,'pending',?)").run(body.id,id,plan.body.version,JSON.stringify(body),activityHash(body),time);
    this.db.prepare('INSERT INTO activity_outbox(id) VALUES(?)').run(body.id);
    if(conditional&&plan.body.trigger.kind==='condition')this.db.prepare('INSERT INTO activity_condition_watermarks VALUES(?,?,?,?)').run(id,plan.body.trigger.event,plan.body.trigger.key,conditional.watermark!);
    this.db.prepare('UPDATE activity_schedules SET next_due=?,not_before=?,event_cursor=coalesce(?,event_cursor),status=? WHERE id=?')
      .run(next,time+this.config.minIntervalMs,conditional?.seq??null,next===null&&plan.body.trigger.kind!=='condition'?'exhausted':'active',id);return body;
  });}
  occurrence(id:string):StoredOccurrence {const row=this.db.prepare('SELECT * FROM activity_occurrences WHERE id=?').get(PersonaRequestIdSchema.parse(id));if(!row)throw new Error('ACTIVITY_OCCURRENCE_UNKNOWN');
    const body=WakeOccurrenceBodySchema.parse(JSON.parse(String(row.body)));if(activityHash(body)!==row.body_hash)throw new Error('ACTIVITY_STATE_CORRUPT');return {body,state:ActivityOccurrenceStateSchema.parse(row.state),runId:row.run_id===null?null:String(row.run_id),startedAt:row.started_at===null?null:Number(row.started_at),error:row.error===null?null:String(row.error)};}
  outbox(){return this.db.prepare("SELECT o.id FROM activity_outbox o JOIN activity_occurrences r ON r.id=o.id WHERE o.acknowledged=0 AND r.state='pending' ORDER BY o.rowid LIMIT 32").all().map(row=>this.occurrence(String(row.id)));}
  acknowledge(id:string,runId:string,now:number){z.uuid().parse(runId);this.transaction(()=>{const occurrence=this.occurrence(id);if(occurrence.runId&&occurrence.runId!==runId)throw new Error('ACTIVITY_RECEIPT_CONFLICT');
    this.db.prepare('UPDATE activity_occurrences SET run_id=?,state=?,updated_at=? WHERE id=?').run(runId,occurrence.state==='pending'?'accepted':occurrence.state,this.clock(now),id);
    this.db.prepare('UPDATE activity_outbox SET acknowledged=1 WHERE id=?').run(id);});}
  reject(id:string,code:string,now:number){if(!/^[A-Z0-9_]{1,100}$/.test(code))throw new Error('INVALID_INPUT');this.transaction(()=>{const occurrence=this.occurrence(id);
    if(['completed','blocked','failed','cancelled'].includes(occurrence.state))return;
    this.db.prepare("UPDATE activity_occurrences SET state='cancelled',error=?,updated_at=? WHERE id=?").run(code,this.clock(now),id);this.db.prepare('UPDATE activity_outbox SET acknowledged=1 WHERE id=?').run(id);});}
  block(id:string,code:string,now:number){if(!/^[A-Z0-9_]{1,100}$/.test(code))throw new Error('INVALID_INPUT');this.transaction(()=>{this.get(id);this.clock(now);this.db.prepare("UPDATE activity_schedules SET status='blocked',error=? WHERE id=?").run(code,id);});}
  runEvent(raw:unknown){const event=runEventSchema.parse(raw),fingerprint=activityHash(event);return this.transaction(()=>{
    const old=this.db.prepare('SELECT body_hash FROM activity_run_events WHERE id=?').get(event.id);if(old){if(old.body_hash!==fingerprint)throw new Error('IDEMPOTENCY_CONFLICT');return;}
    const occurrence=this.occurrence(event.occurrenceId);if(occurrence.runId&&occurrence.runId!==event.runId)throw new Error('ACTIVITY_RECEIPT_CONFLICT');
    const at=Date.parse(event.at),plan=this.get(occurrence.body.scheduleId);
    this.db.prepare('INSERT INTO activity_run_events VALUES(?,?,?,?)').run(event.id,event.occurrenceId,JSON.stringify(event),fingerprint);
    this.db.prepare('UPDATE activity_occurrences SET run_id=? WHERE id=?').run(event.runId,event.occurrenceId);
    this.db.prepare('UPDATE activity_outbox SET acknowledged=1 WHERE id=?').run(event.occurrenceId);
    if(event.state==='running'){if(occurrence.state==='cancelled')return;this.db.prepare("UPDATE activity_occurrences SET state='running',started_at=coalesce(started_at,?),updated_at=? WHERE id=?").run(at,at,event.occurrenceId);return;}
    if(['completed','waiting','failed','blocked'].includes(occurrence.state))return;
    let state:ActivityOccurrenceState=event.unknownEffects||event.state==='interrupted'?'blocked':event.state;
    let code:string|null=event.unknownEffects?'OPERATION_UNCERTAIN':event.state==='interrupted'?'PROCESS_INTERRUPTED':null;
    if(occurrence.startedAt!==null){try{for(const slice of daySlices(occurrence.startedAt,at,this.config.timeZone))this.db.prepare('INSERT INTO activity_usage VALUES(?,?,?)').run(event.runId,slice.day,slice.milliseconds);}
      catch{state='blocked';code='ACTIVITY_DURATION_UNCERTAIN';}}
    this.db.prepare('UPDATE activity_occurrences SET state=?,error=?,updated_at=? WHERE id=?').run(state,code,at,event.occurrenceId);
    if(state==='blocked')this.db.prepare("UPDATE activity_schedules SET status='blocked',error=? WHERE id=?").run(code,plan.body.id);
    else if(state==='failed'){const failures=plan.failures+1,backoff=Math.min(this.config.maxBackoffMs,this.config.backoffBaseMs*2**Math.min(20,failures-1));
      this.db.prepare('UPDATE activity_schedules SET failures=?,not_before=max(not_before,?),error=? WHERE id=?').run(failures,at+backoff,'RUN_FAILED',plan.body.id);}
    else if(state==='completed')this.db.prepare('UPDATE activity_schedules SET failures=0,error=NULL WHERE id=?').run(plan.body.id);
  });}
  used(now:number){return Number(this.db.prepare('SELECT coalesce(sum(milliseconds),0) AS n FROM activity_usage WHERE day=?').get(localTime(now,this.config.timeZone).day)?.n);}
  active(){return this.db.prepare("SELECT id FROM activity_occurrences WHERE state IN ('accepted','running','waiting') ORDER BY rowid LIMIT ?").all(this.config.maxPlans).map(row=>this.occurrence(String(row.id)));}
  counts(){return {plans:Number(this.db.prepare('SELECT count(*) AS n FROM activity_schedules').get()?.n),
    states:Object.fromEntries(this.db.prepare('SELECT status,count(*) AS n FROM activity_schedules GROUP BY status').all().map(row=>[String(row.status),Number(row.n)])),
    occurrences:Object.fromEntries(this.db.prepare('SELECT state,count(*) AS n FROM activity_occurrences GROUP BY state').all().map(row=>[String(row.state),Number(row.n)]))};}
  close(){if(this.closed)return;this.closed=true;this.db.close();}
}
