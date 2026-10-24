import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ActionOutcomeSchema, ExecutionScopeSchema, RunOriginSchema, conversationKey,PersonaManifestSchema } from '@dafeiyu/contracts';
import type { Json } from '@dafeiyu/contracts';
import { configureSqlite } from '@dafeiyu/journal';
import { migratePersonaRuntime } from './migrate-persona-runtime.js';
import { NativeDeliveryStore,migrateNativeDeliveries } from './native-delivery-store.js';

export const RUNTIME_APPLICATION_ID = 0x44465231;
export const RUNTIME_SCHEMA_VERSION = 3;
const key = z.string().regex(/^[a-zA-Z0-9._:-]{1,160}$/), hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const RuntimeIdentitySchema = z.strictObject({ agentId: z.string().min(1).max(100), profileId: key });
export type RuntimeIdentity = z.infer<typeof RuntimeIdentitySchema>;
export const RunStateSchema = z.enum(['accepted','queued','running','waiting','cancelling','completed','failed','cancelled','interrupted']);
export type RunState = z.infer<typeof RunStateSchema>;
export const RunDefinitionSchema = z.strictObject({ taskId: z.uuid().nullable(), origin: RunOriginSchema, scope: ExecutionScopeSchema,
  intentVersion: z.number().int().nonnegative(), policyId: key, parentRunId: z.uuid().nullable().default(null) }).superRefine((value, ctx) => {
  if(value.scope.kind==='task'&&(value.taskId!==value.scope.taskId||value.intentVersion===0))ctx.addIssue({code:'custom',message:'Task binding required'});
  if(value.scope.kind==='conversation'&&(value.origin.kind!=='message'||value.scope.route!==conversationKey(value.scope.agentId,value.origin.conversation)))ctx.addIssue({code:'custom',message:'Conversation requires real message origin'});
  if(value.origin.kind!=='message'&&value.taskId===null)ctx.addIssue({code:'custom',message:'Native run requires a task'});
});
export type RunDefinition = z.infer<typeof RunDefinitionSchema>;
export const RunSnapshotSchema = z.strictObject({ sessionId:z.string().min(1).max(300), personaVersion:hashSchema,
  model:z.strictObject({provider:z.string().min(1),model:z.string().min(1),reasoningEffort:z.string().optional()}),
  registryVersion:hashSchema,authorityVersion:hashSchema,
  inputs:z.array(z.strictObject({id:z.string().min(1).max(300),version:z.number().int().positive(),hash:hashSchema,scopeKey:z.string().max(2000)})).max(64) });
export type RunSnapshot = z.infer<typeof RunSnapshotSchema>;
export const RunResultRefSchema = z.strictObject({sessionId:z.string().min(1).max(300),messageSeq:z.number().int().positive(),turnEndSeq:z.number().int().positive(),textHash:hashSchema})
  .refine(value=>value.messageSeq<=value.turnEndSeq,'Result must precede turn end');
export type RunResultRef = z.infer<typeof RunResultRefSchema>;
const eventSchema=z.strictObject({id:z.uuid(),runId:z.uuid(),type:z.string().min(1).max(120),at:z.iso.datetime(),data:z.record(z.string(),z.json())});
const string=(value:unknown)=>z.string().parse(value);
function canonical(value:Json):string {
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key]!)}`).join(',')}}`;
}
export function runtimeHash(value:unknown):string{return createHash('sha256').update(canonical(z.json().parse(value))).digest('hex');}
export interface StoredRun {id:string;requestKey:string;definition:RunDefinition;state:RunState;version:number;snapshot:RunSnapshot|null;result:RunResultRef|null;error:string|null;createdAt:string;updatedAt:string}

/** One-host execution ledger. Task definitions and complete DSH histories remain in their own stores. */
export class RuntimeStore {
  readonly nativeDeliveries:NativeDeliveryStore;
  private readonly db:DatabaseSync;
  private readonly nonce=randomUUID();
  private closed=false;
  readonly identity:Readonly<RuntimeIdentity>;
  constructor(readonly file:string,identity:RuntimeIdentity,private readonly options:{create?:boolean;migrate?:boolean;requirePersonaManifest?:boolean}={}){
    this.identity=Object.freeze(RuntimeIdentitySchema.parse(identity));
    if(!existsSync(file)&&!options.create)throw new Error('RUNTIME_INITIALIZATION_REQUIRED');
    if(options.create)mkdirSync(dirname(file),{recursive:true});
    this.db=new DatabaseSync(file);
    try{
      const version=Number(this.db.prepare('PRAGMA user_version').get()?.user_version),app=Number(this.db.prepare('PRAGMA application_id').get()?.application_id);
      const count=Number(this.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get()?.n);
      const fresh=version===0&&app===0&&count===0;
      if(fresh&&!options.create)throw new Error('RUNTIME_INITIALIZATION_REQUIRED');
      if(!fresh&&(![1,2,3].includes(version)||app!==RUNTIME_APPLICATION_ID))throw new Error('RUNTIME_SCHEMA_UNSUPPORTED');
      if(!fresh&&version<RUNTIME_SCHEMA_VERSION&&!options.migrate)throw new Error('MIGRATION_REQUIRED');
      this.db.exec('PRAGMA busy_timeout=5000;PRAGMA foreign_keys=ON;');
      if(fresh)this.initialize();
      const saved=this.db.prepare('SELECT body FROM runtime_metadata WHERE singleton=1').get();
      if(!saved||runtimeHash(JSON.parse(string(saved.body)))!==runtimeHash(this.identity))throw new Error('RUNTIME_IDENTITY_MISMATCH');
      const owner=this.db.prepare('SELECT pid FROM runtime_ownership WHERE singleton=1').get();
      if(owner){let alive=true;try{process.kill(Number(owner.pid),0);}catch(error){if(error instanceof Error&&'code'in error&&error.code==='ESRCH')alive=false;}if(alive)throw new Error('RUNTIME_ALREADY_OWNED');}
      configureSqlite(this.db);
      this.transaction(()=>{const owner=this.db.prepare('SELECT pid FROM runtime_ownership WHERE singleton=1').get();
        if(owner){let alive=true;try{process.kill(Number(owner.pid),0);}catch(error){if(error instanceof Error&&'code'in error&&error.code==='ESRCH')alive=false;}if(alive)throw new Error('RUNTIME_ALREADY_OWNED');}
        migratePersonaRuntime(this.db);
        migrateNativeDeliveries(this.db);
        this.db.prepare('INSERT OR REPLACE INTO runtime_ownership VALUES(1,?,?)').run(process.pid,this.nonce);});
      this.nativeDeliveries=new NativeDeliveryStore(this.db,work=>this.transaction(work),(runId,type,data)=>this.event(runId,type,data));
    }catch(error){this.db.close();throw error;}
  }
  private initialize():void {
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const version=Number(this.db.prepare('PRAGMA user_version').get()?.user_version);
      if(version===1||version===2||version===3){this.db.exec('COMMIT');return;}
      this.db.exec(`
        CREATE TABLE runtime_metadata(singleton INTEGER PRIMARY KEY CHECK(singleton=1),body TEXT NOT NULL);
        CREATE TABLE runtime_ownership(singleton INTEGER PRIMARY KEY CHECK(singleton=1),pid INTEGER NOT NULL,nonce TEXT NOT NULL);
        CREATE TABLE execution_requests(id TEXT PRIMARY KEY,producer TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,body TEXT NOT NULL,task_id TEXT,run_id TEXT,UNIQUE(producer,request_id));
        CREATE TABLE runs(id TEXT PRIMARY KEY,request_key TEXT NOT NULL UNIQUE REFERENCES execution_requests(id),definition TEXT NOT NULL,state TEXT NOT NULL,version INTEGER NOT NULL,snapshot TEXT,result TEXT,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
        CREATE TABLE run_inputs(run_id TEXT NOT NULL REFERENCES runs(id),input_id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(run_id,input_id));
        CREATE TABLE execution_sessions(session_key TEXT PRIMARY KEY,session_id TEXT NOT NULL UNIQUE);
        CREATE TABLE run_operations(ordinal INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,run_id TEXT NOT NULL REFERENCES runs(id),call_id TEXT NOT NULL,fingerprint TEXT NOT NULL,action TEXT NOT NULL,plugin TEXT NOT NULL,plugin_version TEXT NOT NULL,state TEXT NOT NULL,outcome TEXT,started_event TEXT NOT NULL,UNIQUE(run_id,call_id));
        CREATE TABLE run_checkpoints(id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES runs(id),body TEXT NOT NULL);
        CREATE TABLE wake_receipts(producer TEXT NOT NULL,occurrence_id TEXT NOT NULL,fingerprint TEXT NOT NULL,body TEXT NOT NULL,run_id TEXT REFERENCES runs(id),PRIMARY KEY(producer,occurrence_id));
        CREATE TABLE runtime_outbox(ordinal INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,body TEXT NOT NULL,delivered INTEGER NOT NULL DEFAULT 0);
        CREATE TRIGGER runtime_request_immutable BEFORE UPDATE OF id,producer,request_id,fingerprint,body ON execution_requests BEGIN SELECT RAISE(ABORT,'Immutable runtime request');END;
        CREATE TRIGGER runtime_run_binding_immutable BEFORE UPDATE OF id,request_key,definition,created_at ON runs BEGIN SELECT RAISE(ABORT,'Immutable run binding');END;
        CREATE TRIGGER runtime_snapshot_immutable BEFORE UPDATE OF snapshot ON runs WHEN OLD.snapshot IS NOT NULL BEGIN SELECT RAISE(ABORT,'Immutable run snapshot');END;
        CREATE TRIGGER runtime_result_immutable BEFORE UPDATE OF result ON runs WHEN OLD.result IS NOT NULL BEGIN SELECT RAISE(ABORT,'Immutable run result');END;
        CREATE TRIGGER runtime_operation_binding_immutable BEFORE UPDATE OF id,run_id,call_id,fingerprint,action,plugin,plugin_version,started_event ON run_operations BEGIN SELECT RAISE(ABORT,'Immutable operation binding');END;
        CREATE TRIGGER runtime_operation_result_immutable BEFORE UPDATE OF outcome ON run_operations WHEN OLD.outcome IS NOT NULL BEGIN SELECT RAISE(ABORT,'Immutable operation outcome');END;
        CREATE TRIGGER runtime_checkpoint_immutable BEFORE UPDATE ON run_checkpoints BEGIN SELECT RAISE(ABORT,'Immutable checkpoint');END;
        CREATE TRIGGER runtime_event_immutable BEFORE UPDATE OF id,body ON runtime_outbox BEGIN SELECT RAISE(ABORT,'Immutable execution event');END;
        CREATE TRIGGER runtime_runs_retain BEFORE DELETE ON runs BEGIN SELECT RAISE(ABORT,'Retain execution history');END;
        PRAGMA application_id=${RUNTIME_APPLICATION_ID};PRAGMA user_version=1;
      `);
      this.db.prepare('INSERT INTO runtime_metadata VALUES(1,?)').run(JSON.stringify(this.identity));this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  private open():void{if(this.closed)throw new Error('RUNTIME_CLOSED');}
  private transaction<T>(work:()=>T):T {this.open();this.db.exec('BEGIN IMMEDIATE');try{const result=work();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  private event(runId:string,type:string,data:Record<string,Json>={}):string {
    const value=eventSchema.parse({id:randomUUID(),runId,type,at:new Date().toISOString(),data});this.db.prepare('INSERT INTO runtime_outbox(id,body) VALUES(?,?)').run(value.id,JSON.stringify(value));return value.id;
  }
  prepareRequest(producer:string,requestId:string,raw:unknown){
    key.parse(producer);key.parse(requestId);const payload=z.json().parse(raw),body=canonical(payload);if(Buffer.byteLength(body)>128000)throw new Error('RUNTIME_INPUT_TOO_LARGE');
    const fingerprint=runtimeHash(payload);return this.transaction(()=>{
      const old=this.db.prepare('SELECT id,fingerprint FROM execution_requests WHERE producer=? AND request_id=?').get(producer,requestId);
      if(old){if(old.fingerprint!==fingerprint)throw new Error('IDEMPOTENCY_CONFLICT');return this.request(string(old.id));}
      const id=randomUUID();this.db.prepare('INSERT INTO execution_requests VALUES(?,?,?,?,?,NULL,NULL)').run(id,producer,requestId,fingerprint,body);return this.request(id);
    });
  }
  request(id:string){this.open();z.uuid().parse(id);const row=this.db.prepare('SELECT * FROM execution_requests WHERE id=?').get(id);if(!row)throw new Error('REQUEST_NOT_FOUND');
    return {id,producer:string(row.producer),requestId:string(row.request_id),payload:z.json().parse(JSON.parse(string(row.body))),taskId:row.task_id===null?null:z.uuid().parse(row.task_id),runId:row.run_id===null?null:z.uuid().parse(row.run_id)};}
  findRequest(producer:string,requestId:string){this.open();const row=this.db.prepare('SELECT id FROM execution_requests WHERE producer=? AND request_id=?').get(producer,requestId);return row?this.request(string(row.id)):null;}
  pendingRequests(){this.open();return this.db.prepare('SELECT id FROM execution_requests WHERE run_id IS NULL ORDER BY rowid').all().map(row=>this.request(string(row.id)));}
  bindTask(requestKey:string,taskId:string):void{z.uuid().parse(taskId);this.transaction(()=>{const request=this.request(requestKey);if(request.taskId&&request.taskId!==taskId)throw new Error('TASK_BINDING_CONFLICT');this.db.prepare('UPDATE execution_requests SET task_id=? WHERE id=? AND task_id IS NULL').run(taskId,requestKey);});}
  acceptRun(requestKey:string,raw:unknown):StoredRun {
    const definition=RunDefinitionSchema.parse(raw);if(definition.scope.agentId!==this.identity.agentId)throw new Error('RUN_AGENT_MISMATCH');
    return this.transaction(()=>this.acceptInside(requestKey,definition));
  }
  private acceptInside(requestKey:string,definition:RunDefinition):StoredRun {
    const request=this.request(requestKey);
    if(request.taskId!==definition.taskId)throw new Error('TASK_BINDING_CONFLICT');
    if(definition.origin.kind==='native'||definition.origin.kind==='maintenance')if(definition.origin.producerId!==request.producer||definition.origin.requestId!==request.requestId)throw new Error('ORIGIN_BINDING_CONFLICT');
    if(definition.origin.kind==='wake'&&definition.origin.producerId!==request.producer)throw new Error('ORIGIN_BINDING_CONFLICT');
    if(request.runId){const old=this.get(request.runId);if(runtimeHash(old.definition)!==runtimeHash(definition))throw new Error('IDEMPOTENCY_CONFLICT');return old;}
    if(definition.parentRunId){const parent=this.get(definition.parentRunId);if(parent.definition.taskId!==definition.taskId||['accepted','queued','running','cancelling'].includes(parent.state))throw new Error('PARENT_RUN_CONFLICT');}
    const id=randomUUID(),now=new Date().toISOString();this.db.prepare("INSERT INTO runs VALUES(?,?,?,'accepted',1,NULL,NULL,NULL,?,?)").run(id,requestKey,JSON.stringify(definition),now,now);
    this.db.prepare('UPDATE execution_requests SET run_id=? WHERE id=?').run(id,requestKey);this.event(id,'run.accepted');return this.get(id);
  }
  acceptWake(requestKey:string,raw:unknown):StoredRun {
    const definition=RunDefinitionSchema.parse(raw);if(definition.scope.agentId!==this.identity.agentId||definition.origin.kind!=='wake')throw new Error('INVALID_WAKE_BINDING');
    const origin=definition.origin;const fingerprint=runtimeHash({definition,requestKey});
    return this.transaction(()=>{
      const old=this.db.prepare('SELECT fingerprint,run_id FROM wake_receipts WHERE producer=? AND occurrence_id=?').get(origin.producerId,origin.occurrenceId);
      if(old){if(old.fingerprint!==fingerprint)throw new Error('IDEMPOTENCY_CONFLICT');return this.get(string(old.run_id));}
      const run=this.acceptInside(requestKey,definition);this.db.prepare('INSERT INTO wake_receipts VALUES(?,?,?,?,?)').run(origin.producerId,origin.occurrenceId,fingerprint,JSON.stringify(origin),run.id);return run;
    });
  }
  get(id:string):StoredRun {this.open();z.uuid().parse(id);const row=this.db.prepare('SELECT * FROM runs WHERE id=?').get(id);if(!row)throw new Error('RUN_NOT_FOUND');
    return {id,requestKey:string(row.request_key),definition:RunDefinitionSchema.parse(JSON.parse(string(row.definition))),state:RunStateSchema.parse(row.state),version:Number(row.version),
      snapshot:row.snapshot===null?null:RunSnapshotSchema.parse(JSON.parse(string(row.snapshot))),result:row.result===null?null:RunResultRefSchema.parse(JSON.parse(string(row.result))),error:row.error===null?null:string(row.error),createdAt:string(row.created_at),updatedAt:string(row.updated_at)};}
  list(states?:readonly RunState[]):StoredRun[]{this.open();if(states?.length===0)return [];const filter=states?.map(value=>RunStateSchema.parse(value));
    return this.db.prepare(`SELECT id FROM runs${filter?' WHERE state IN ('+filter.map(()=>'?').join(',')+')':''} ORDER BY rowid`).all(...(filter??[])).map(row=>this.get(string(row.id)));}
  session(keyValue:string):string {key.parse(keyValue);return this.transaction(()=>{const old=this.db.prepare('SELECT session_id FROM execution_sessions WHERE session_key=?').get(keyValue);if(old)return string(old.session_id);const id=`dafeiyu-task-${randomUUID()}`;this.db.prepare('INSERT INTO execution_sessions VALUES(?,?)').run(keyValue,id);return id;});}
  transition(id:string,expectedVersion:number,to:RunState,error:string|null=null):StoredRun{if(to==='running'||to==='completed')throw new Error('USE_DEDICATED_TRANSITION');return this.transaction(()=>this.transitionInside(id,expectedVersion,to,error));}
  private transitionInside(id:string,version:number,to:RunState,error:string|null=null):StoredRun {
    const current=this.get(id),allowed:Partial<Record<RunState,readonly RunState[]>>={accepted:['queued','cancelled','failed'],queued:['running','cancelled','failed'],running:['waiting','cancelling','completed','failed','interrupted'],cancelling:['waiting','cancelled','interrupted','failed'],waiting:['cancelled','interrupted']};
    if(current.version!==version)throw new Error('VERSION_CONFLICT');if(!allowed[current.state]?.includes(to))throw new Error('RUN_TRANSITION_FORBIDDEN');
    if(error!==null&&!/^[A-Z0-9_]{1,100}$/.test(error))throw new Error('INVALID_ERROR_CODE');
    const pending=this.operations(id).filter(operation=>operation.state==='started');
    if((to==='waiting'||to==='cancelled')&&pending.length)throw new Error('OPERATION_PENDING');
    if(to==='failed'||to==='interrupted')for(const operation of pending){this.db.prepare("UPDATE run_operations SET state='unknown' WHERE id=?").run(operation.id);this.event(id,'operation.unknown',{operationId:operation.id});}
    this.db.prepare('UPDATE runs SET state=?,version=version+1,error=?,updated_at=? WHERE id=? AND version=?').run(to,error,new Date().toISOString(),id,version);this.event(id,`run.${to}`,error?{code:error}:{});return this.get(id);
  }
  start(id:string,version:number,raw:unknown,persona?:unknown):StoredRun {
    const snapshot=RunSnapshotSchema.parse(raw);return this.transaction(()=>{const run=this.get(id);if(run.state!=='queued'||run.version!==version)throw new Error('VERSION_CONFLICT');
      if(persona===undefined&&this.options.requirePersonaManifest)throw new Error('PERSONA_MANIFEST_REQUIRED');
      if(persona!==undefined){const manifest=PersonaManifestSchema.parse(persona);
        if(manifest.runId!==id||manifest.agentId!==run.definition.scope.agentId||manifest.foundationHash!==snapshot.personaVersion||manifest.modelRouteHash!==runtimeHash(snapshot.model))throw new Error('PERSONA_BINDING_CONFLICT');
        this.db.prepare('INSERT INTO run_persona_manifests VALUES(?,?,?)').run(id,JSON.stringify(manifest),runtimeHash(manifest));}
      this.db.prepare('UPDATE runs SET snapshot=? WHERE id=?').run(JSON.stringify(snapshot),id);
      for(const input of snapshot.inputs)this.db.prepare('INSERT INTO run_inputs VALUES(?,?,?)').run(id,input.id,JSON.stringify(input));
      return this.transitionInside(id,version,'running');});
  }
  personaBinding(id:string){this.get(id);const row=this.db.prepare('SELECT body,body_hash FROM run_persona_manifests WHERE run_id=?').get(id);
    if(!row)return {kind:'legacy-unbound' as const};const manifest=PersonaManifestSchema.parse(JSON.parse(string(row.body)));if(runtimeHash(manifest)!==row.body_hash)throw new Error('PERSONA_MANIFEST_CORRUPT');return {kind:'bound' as const,manifest};}
  complete(id:string,version:number,raw:unknown):StoredRun {
    const result=RunResultRefSchema.parse(raw);return this.transaction(()=>{const run=this.get(id);if(run.state!=='running'||run.version!==version||run.snapshot?.sessionId!==result.sessionId)throw new Error('RESULT_BINDING_CONFLICT');
      if(this.operations(id).some(operation=>operation.state==='started'))throw new Error('OPERATION_PENDING');
      this.db.prepare('UPDATE runs SET result=? WHERE id=?').run(JSON.stringify(result),id);return this.transitionInside(id,version,'completed');});
  }
  beginOperation(runId:string,callId:string,action:string,plugin:string,pluginVersion:string,input:unknown,actionVersion=pluginVersion){
    key.parse(callId);key.parse(action);key.parse(plugin);key.parse(pluginVersion);key.parse(actionVersion);const fingerprint=runtimeHash({action,plugin,pluginVersion,actionVersion,input});
    return this.transaction(()=>{const run=this.get(runId);if(run.state!=='running')throw new Error('RUN_NOT_RUNNING');const old=this.db.prepare('SELECT id,fingerprint FROM run_operations WHERE run_id=? AND call_id=?').get(runId,callId);
      if(old){if(old.fingerprint!==fingerprint)throw new Error('IDEMPOTENCY_CONFLICT');return {...this.operation(string(old.id)),reused:true};}
      const id=randomUUID(),eventId=this.event(runId,'operation.started',{operationId:id,action,plugin});
      this.db.prepare("INSERT INTO run_operations(id,run_id,call_id,fingerprint,action,plugin,plugin_version,state,outcome,started_event) VALUES(?,?,?,?,?,?,?,'started',NULL,?)").run(id,runId,callId,fingerprint,action,plugin,pluginVersion,eventId);
      this.db.prepare('INSERT INTO run_inputs VALUES(?,?,?)').run(runId,`operation-version:${id}`,JSON.stringify({schemaVersion:1,pluginVersion,actionVersion}));return {...this.operation(id),reused:false};});
  }
  operation(id:string){this.open();const row=this.db.prepare('SELECT * FROM run_operations WHERE id=?').get(id);if(!row)throw new Error('OPERATION_NOT_FOUND');
    const versionRow=this.db.prepare('SELECT body FROM run_inputs WHERE run_id=? AND input_id=?').get(row.run_id!,`operation-version:${id}`);
    const versions=versionRow?z.strictObject({schemaVersion:z.literal(1),pluginVersion:z.string(),actionVersion:z.string()}).parse(JSON.parse(string(versionRow.body))):null;
    return {id,runId:string(row.run_id),callId:string(row.call_id),fingerprint:string(row.fingerprint),action:string(row.action),plugin:string(row.plugin),pluginVersion:string(row.plugin_version),actionVersion:versions?.actionVersion??null,versionsBound:versions!==null,state:z.enum(['started','finished','unknown']).parse(row.state),startedEventId:string(row.started_event),outcome:row.outcome===null?null:ActionOutcomeSchema.parse(JSON.parse(string(row.outcome)))};}
  bindInput(runId:string,id:string,body:unknown):void{const value=z.json().parse(body);this.transaction(()=>{const run=this.get(runId);if(!['accepted','queued','running','cancelling'].includes(run.state))throw new Error('RUN_NOT_RUNNING');
    const old=this.db.prepare('SELECT body FROM run_inputs WHERE run_id=? AND input_id=?').get(runId,id);if(old){if(runtimeHash(JSON.parse(string(old.body)))!==runtimeHash(value))throw new Error('INPUT_BINDING_CONFLICT');return;}this.db.prepare('INSERT INTO run_inputs VALUES(?,?,?)').run(runId,id,JSON.stringify(value));});}
  readInput(runId:string,id:string):Json|null{this.get(runId);const row=this.db.prepare('SELECT body FROM run_inputs WHERE run_id=? AND input_id=?').get(runId,id);return row?z.json().parse(JSON.parse(string(row.body))):null;}
  findContext(id:string):Json|null{this.open();const row=this.db.prepare('SELECT body FROM run_inputs WHERE input_id=? ORDER BY rowid DESC LIMIT 1').get(id);return row?z.json().parse(JSON.parse(string(row.body))):null;}
  appendExecutionEvent(runId:string,type:string,data:Record<string,Json>):string{return this.transaction(()=>{this.get(runId);return this.event(runId,type,data);});}
  operations(runId:string){this.open();return this.db.prepare('SELECT id FROM run_operations WHERE run_id=? ORDER BY ordinal').all(runId).map(row=>this.operation(string(row.id)));}
  finishOperation(id:string,raw:unknown){const outcome=ActionOutcomeSchema.parse(raw);return this.transaction(()=>{const operation=this.operation(id);if(operation.outcome){if(runtimeHash(operation.outcome)!==runtimeHash(outcome))throw new Error('OPERATION_OUTCOME_CONFLICT');return operation;}
    if(operation.state!=='started')throw new Error('OPERATION_UNCERTAIN');this.db.prepare("UPDATE run_operations SET state='finished',outcome=? WHERE id=?").run(JSON.stringify(outcome),id);this.event(operation.runId,`operation.${outcome.status}`,{operationId:id,effects:outcome.effects});return this.operation(id);});}
  checkpoint(runId:string,body:unknown):string {const value=z.json().parse(body);return this.transaction(()=>{const run=this.get(runId);if(!['running','waiting','cancelling'].includes(run.state))throw new Error('RUN_NOT_RUNNING');const id=randomUUID();this.db.prepare('INSERT INTO run_checkpoints VALUES(?,?,?)').run(id,runId,JSON.stringify(value));return id;});}
  readCheckpoint(runId:string,id:string):Json {this.open();const row=this.db.prepare('SELECT body FROM run_checkpoints WHERE id=? AND run_id=?').get(id,runId);if(!row)throw new Error('CHECKPOINT_NOT_FOUND');return z.json().parse(JSON.parse(string(row.body)));}
  checkpoints(runId:string){this.open();return this.db.prepare('SELECT id FROM run_checkpoints WHERE run_id=? ORDER BY rowid').all(runId).map(row=>string(row.id));}
  control(runId:string,requestKey:string,version:number,to:RunState):StoredRun{return this.transaction(()=>{
    const request=this.request(requestKey);if(request.runId){if(request.runId!==runId)throw new Error('IDEMPOTENCY_CONFLICT');return this.get(runId);}
    const run=this.transitionInside(runId,version,to);this.db.prepare('UPDATE execution_requests SET run_id=?,task_id=? WHERE id=?').run(runId,run.definition.taskId,requestKey);return run;
  });}
  /** A durable chat projection belongs to the same transaction as the completed Run. */
  completeWithProjection(id:string,version:number,result:unknown,projection:Record<string,Json>):StoredRun {
    const ref=RunResultRefSchema.parse(result);return this.transaction(()=>{const run=this.get(id);
      if(run.definition.origin.kind!=='message'||run.state!=='running'||run.version!==version||run.snapshot?.sessionId!==ref.sessionId)throw new Error('RESULT_BINDING_CONFLICT');
      if(this.operations(id).some(operation=>operation.state==='started'))throw new Error('OPERATION_PENDING');
      this.db.prepare('UPDATE runs SET result=? WHERE id=?').run(JSON.stringify(ref),id);
      const completed=this.transitionInside(id,version,'completed');this.event(id,'conversation.result-ready',projection);return completed;
    });
  }
  recover():number{return this.transaction(()=>{let count=0;for(const run of this.list(['running','cancelling'])){
    for(const operation of this.operations(run.id))if(operation.state==='started'){this.db.prepare("UPDATE run_operations SET state='unknown' WHERE id=?").run(operation.id);this.event(run.id,'operation.unknown',{operationId:operation.id});}
    this.transitionInside(run.id,run.version,'interrupted','PROCESS_INTERRUPTED');count++;}return count;});}
  outbox(){this.open();return this.db.prepare('SELECT body FROM runtime_outbox WHERE delivered=0 ORDER BY ordinal').all().map(row=>eventSchema.parse(JSON.parse(string(row.body))));}
  acknowledgeEvent(id:string):void{this.open();z.uuid().parse(id);this.db.prepare('UPDATE runtime_outbox SET delivered=1 WHERE id=?').run(id);}
  close():void {if(this.closed)return;this.db.prepare('DELETE FROM runtime_ownership WHERE singleton=1 AND nonce=?').run(this.nonce);this.db.close();this.closed=true;}
}
