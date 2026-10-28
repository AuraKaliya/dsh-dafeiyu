import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { ExperienceRevisionSchema,ExperienceReviewSchema,ExperienceRelationSchema,MaintenanceRequestInputSchema,
  MaintenanceSnapshotSchema,MaintenanceStateSchema,MaintenanceSchedulingItemSchema,PersonaSourceRefSchema,redactJson } from '@dafeiyu/contracts';
import type { PersonaAccess,PersonaSourceRef,ExperienceRevision,MaintenanceSnapshot,MaintenanceState } from '@dafeiyu/contracts';
import type { PersonaResolver } from './material.js';
import { personaDigest,personaScope,uniqueSources,sourceKey } from './persona-digest.js';

export interface ExperienceDraft {
  content:ExperienceRevision['content'];contentRef:PersonaSourceRef;supports:PersonaSourceRef[];counters:PersonaSourceRef[];
  target:{id:string;version:number}|null;
}
export class ExperienceStore {
  private readonly sourceReadStatements=new Map<string,import('node:sqlite').StatementSync>();
  private sourceRead(sql:string){let statement=this.sourceReadStatements.get(sql);if(!statement){statement=this.db.prepare(sql);this.sourceReadStatements.set(sql,statement);}return statement;}
  constructor(private readonly db:DatabaseSync,private readonly transaction:<T>(fn:()=>T)=>T,private readonly resolve:PersonaResolver){}
  private task(access:PersonaAccess){
    access.guard();const scope=access.view.scope;if(scope.kind!=='task')throw new Error('TASK_REQUIRED');
    const row=this.db.prepare('SELECT epoch,status,body FROM task_workspaces WHERE id=? AND agent_id=?').get(scope.taskId,scope.agentId);
    if(!row||row.status!=='active'||row.epoch!==access.intentVersion)throw new Error('TASK_NOT_ACTIVE');
    return {scope,goal:z.object({goal:z.string()}).parse(JSON.parse(String(row.body))).goal};
  }
  validate(access:PersonaAccess,snapshot:MaintenanceSnapshot,compareTargets=true){
    const {scope}=this.task(access);
    if(snapshot.scope.agentId!==scope.agentId||personaScope(snapshot.scope)!==scope.scopeKey)throw new Error('SCOPE_DENIED');
    if(snapshot.taskEpoch!==access.intentVersion)throw new Error('TASK_NOT_ACTIVE');
    if(snapshot.history.length&&!access.validateHistory?.(snapshot.history))throw new Error('SOURCE_STALE');
    for(const ref of snapshot.sources)if(!this.resolve(access,ref))throw new Error('SOURCE_STALE');
    if(compareTargets)for(const target of snapshot.targets){const current=this.read(access,target.id);if(current.version!==target.version)throw new Error('VERSION_CONFLICT');}
  }
  private audit(access:PersonaAccess,type:string,data:unknown){const id=randomUUID();
    this.db.prepare('INSERT INTO execution_memory_outbox(id,body) VALUES(?,?)').run(id,JSON.stringify({id,type,scope:access.view.scope,runId:access.view.runId,origin:access.view.origin,
      operationId:access.operationId,causedBy:access.startedEventId,producer:access.producer,at:new Date().toISOString(),data}));
  }
  private insert(snapshot:MaintenanceSnapshot,producer:string,fingerprint:string,state:MaintenanceState){
    this.db.prepare('INSERT INTO maintenance_requests(id,agent_id,scope_key,producer,request_id,fingerprint,body,state,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(snapshot.id,snapshot.scope.agentId,personaScope(snapshot.scope),producer,snapshot.requestId,fingerprint,JSON.stringify(snapshot),state,snapshot.createdAt);
    return snapshot.id;
  }
  request(access:PersonaAccess,raw:unknown){
    const input=MaintenanceRequestInputSchema.parse(raw),{scope,goal}=this.task(access);
    const fingerprint=personaDigest({input,epoch:access.intentVersion});
    return this.transaction(()=>{
      const old=this.db.prepare('SELECT id,fingerprint FROM maintenance_requests WHERE agent_id=? AND scope_key=? AND producer=? AND request_id=?')
        .get(scope.agentId,scope.scopeKey,access.producer,input.requestId);
      if(old){if(old.fingerprint!==fingerprint)throw new Error('IDEMPOTENCY_CONFLICT');return String(old.id);}
      const exposed=uniqueSources([...access.admittedSources,...access.inputs.flatMap(i=>i.sourceRef?[i.sourceRef]:[])]);
      for(const ref of input.sources)if(!exposed.some(known=>personaDigest(known)===personaDigest(ref)))throw new Error('SOURCE_NOT_EXPOSED');
      const targetInputs=input.targets.flatMap(target=>{const value=this.read(access,target.id);if(value.version!==target.version)throw new Error('VERSION_CONFLICT');
        return value.dependencies.filter(ref=>sourceKey(ref)!==sourceKey(value.contentRef));});
      const sources=uniqueSources([...input.sources,...exposed,...targetInputs]),history=[...(access.historyDependencies??[])];
      const now=new Date().toISOString(),id=randomUUID();
      const snapshot=MaintenanceSnapshotSchema.parse({schemaVersion:1,id,scope,taskEpoch:access.intentVersion,runId:access.view.runId,requestId:input.requestId,
        goal,reason:input.reason,motivation:access.motivation,sources,history,targets:input.targets,
        watermark:personaDigest({sources,history,targets:input.targets,epoch:access.intentVersion}),createdAt:now,expiresAt:new Date(Date.now()+7*86400000).toISOString()});
      if(redactJson(z.json().parse(snapshot)).redacted)throw new Error('PRIVATE_INPUT_REJECTED');this.validate(access,snapshot);
      this.insert(snapshot,access.producer,fingerprint,'ready');this.audit(access,'memory.maintenance.requested',{id,watermark:snapshot.watermark});
      (access.commitGuard??access.guard)();return id;
    });
  }
  snapshot(access:PersonaAccess,id:string){
    this.task(access);const row=this.db.prepare('SELECT body,state,version,result,error FROM maintenance_requests WHERE id=? AND agent_id=? AND scope_key=?')
      .get(z.uuid().parse(id),access.view.scope.agentId,personaScope(access.view.scope));if(!row)throw new Error('SCOPE_DENIED');
    return {input:MaintenanceSnapshotSchema.parse(JSON.parse(String(row.body))),state:MaintenanceStateSchema.parse(row.state),version:Number(row.version),
      result:row.result===null?null:z.json().parse(JSON.parse(String(row.result))),error:row.error===null?null:String(row.error)};
  }
  status(access:PersonaAccess,id?:string){
    this.task(access);const ids=id?[z.uuid().parse(id)]:this.db.prepare('SELECT id FROM maintenance_requests WHERE agent_id=? AND scope_key=? ORDER BY rowid DESC LIMIT 32')
      .all(access.view.scope.agentId,personaScope(access.view.scope)).map(row=>String(row.id));
    return ids.map(key=>{const row=this.snapshot(access,key);let available=true;try{this.validate(access,row.input,row.state!=='completed');}catch{available=false;}
      return {id:key,state:row.state,version:row.version,reason:row.input.reason,watermark:row.input.watermark,available,error:row.error,
        processed:!!this.db.prepare('SELECT 1 FROM maintenance_watermarks WHERE request_id=?').get(key)};});
  }
  begin(access:PersonaAccess,id:string){return this.transaction(()=>{
    const row=this.snapshot(access,id);this.validate(access,row.input,row.state!=='completed');
    if(row.state==='completed')return row;
    if(!['ready','waiting-scheduler'].includes(row.state))throw new Error('MAINTENANCE_STATE_CONFLICT');
    if(Date.parse(row.input.expiresAt)<=Date.now())throw new Error('SOURCE_STALE');
    this.db.prepare("UPDATE maintenance_requests SET state='running',version=version+1,updated_at=? WHERE id=?").run(new Date().toISOString(),id);
    this.audit(access,'memory.maintenance.started',{id});return {...row,state:'running' as const,version:row.version+1};
  });}
  fail(access:PersonaAccess,id:string,code:string){return this.transaction(()=>{
    // Record the already-started failure even when its live grant has expired or been cancelled.
    const row=this.db.prepare('SELECT state FROM maintenance_requests WHERE id=? AND agent_id=? AND scope_key=?').get(id,access.view.scope.agentId,personaScope(access.view.scope));
    if(!row||row.state!=='running'&&(!['ready','waiting-scheduler'].includes(String(row.state))||!['SOURCE_STALE','TASK_NOT_ACTIVE','VERSION_CONFLICT'].includes(code)))return;
    const state=code==='CANCELLED'?'cancelled':['SOURCE_STALE','TASK_NOT_ACTIVE','VERSION_CONFLICT'].includes(code)?'stale':'failed';
    this.db.prepare('UPDATE maintenance_requests SET state=?,version=version+1,error=?,updated_at=? WHERE id=?').run(state,code,new Date().toISOString(),id);
    this.audit(access,'memory.maintenance.failed',{id,code});
  });}
  recover(){return this.db.prepare("UPDATE maintenance_requests SET state='failed',version=version+1,error='PROCESS_INTERRUPTED',updated_at=? WHERE state='running'").run(new Date().toISOString()).changes;}
  sourceCurrent(access:PersonaAccess,ref:PersonaSourceRef):boolean {
    const rows=this.sourceRead("SELECT r.body,i.version,i.state FROM experience_revisions r JOIN experience_items i ON i.id=r.id WHERE i.agent_id=? AND i.scope_key=? AND json_extract(r.body,'$.contentRef.id')=? ORDER BY r.version DESC LIMIT 1")
      .all(access.view.scope.agentId,personaScope(access.view.scope),ref.id);
    if(!rows.length)return true;const row=rows[0]!,value=ExperienceRevisionSchema.parse(JSON.parse(String(row.body)));
    // A superseded inference is still a dated input to its correction. Current adoption is
    // fenced separately by experienceBasis; withdrawal and source revocation invalidate both.
    return value.taskEpoch===access.intentVersion&&!['withdrawn','rejected'].includes(String(row.state));
  }
  read(access:PersonaAccess,id:string):ExperienceRevision {
    const {scope}=this.task(access);const row=this.db.prepare('SELECT r.body,r.body_hash FROM experience_items i JOIN experience_revisions r ON r.id=i.id AND r.version=i.version WHERE i.id=? AND i.agent_id=? AND i.scope_key=?')
      .get(z.uuid().parse(id),scope.agentId,scope.scopeKey);if(!row)throw new Error('SCOPE_DENIED');
    const value=ExperienceRevisionSchema.parse(JSON.parse(String(row.body)));if(personaDigest(value)!==row.body_hash)throw new Error('EXPERIENCE_STATE_CORRUPT');
    if(value.taskEpoch!==access.intentVersion||['withdrawn','rejected'].includes(value.state))throw new Error('SOURCE_STALE');
    for(const ref of value.dependencies)if(!this.resolve(access,ref))throw new Error('SOURCE_STALE');return value;
  }
  private write(value:ExperienceRevision){const parsed=ExperienceRevisionSchema.parse(value);
    this.db.prepare('INSERT INTO experience_items VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,state=excluded.state')
      .run(value.id,value.scope.agentId,personaScope(value.scope),value.version,value.state);
    this.db.prepare('INSERT INTO experience_revisions VALUES(?,?,?,?)').run(value.id,value.version,JSON.stringify(parsed),personaDigest(parsed));
  }
  commit(access:PersonaAccess,id:string,drafts:readonly ExperienceDraft[],relations:readonly z.infer<typeof ExperienceRelationSchema>[],extra:unknown={}){
    return this.transaction(()=>{
      const row=this.snapshot(access,id);this.validate(access,row.input,row.state!=='completed');if(row.state==='completed')return row.result;
      if(row.state!=='running')throw new Error('MAINTENANCE_STATE_CONFLICT');
      const actual=uniqueSources([...row.input.sources,...access.admittedSources,...access.inputs.flatMap(i=>i.sourceRef?[i.sourceRef]:[])]);
      const materials=actual.map(ref=>{const value=this.resolve(access,ref);if(!value)throw new Error('SOURCE_STALE');return value;});
      const dependencies=uniqueSources([...actual,...materials.flatMap(m=>m.dependencies)]),roots=[...new Set(materials.flatMap(m=>m.rootSources))];
      const ids:string[]=[],experienceBasis:{id:string;sourceId:string;taskEpoch:number}[]=[];
      for(const draft of drafts){
        for(const ref of [...draft.supports,...draft.counters])if(!actual.some(known=>personaDigest(known)===personaDigest(ref)))throw new Error('SOURCE_NOT_EXPOSED');
        if(!this.resolve(access,draft.contentRef))throw new Error('SOURCE_STALE');
        const target=draft.target?this.read(access,draft.target.id):null;
        if(target&&(!row.input.targets.some(t=>t.id===target.id&&t.version===target.version)||target.version!==draft.target?.version))throw new Error('VERSION_CONFLICT');
        const value=ExperienceRevisionSchema.parse({schemaVersion:1,id:target?.id??randomUUID(),version:(target?.version??0)+1,state:'proposed',scope:row.input.scope,taskEpoch:row.input.taskEpoch,
          runId:access.view.runId,maintenanceId:id,goal:row.input.goal,motivation:row.input.motivation,content:draft.content,contentRef:draft.contentRef,
          supports:draft.supports,counters:draft.counters,dependencies:uniqueSources([...dependencies,draft.contentRef,...(target?.dependencies.filter(ref=>sourceKey(ref)!==sourceKey(target.contentRef))??[])]),
          rootSources:[...new Set([...roots,...(target?.rootSources??[])])],reason:target?'new-evidence-comparison':'analysis-candidate',createdAt:new Date().toISOString(),policy:'experience-e-v1',evidenceStatus:'source-bound-inference'});
        if(redactJson(z.json().parse(value)).redacted)throw new Error('PRIVATE_INPUT_REJECTED');this.write(value);ids.push(value.id);
        experienceBasis.push({id:value.id,sourceId:value.contentRef.id,taskEpoch:value.taskEpoch});
        this.db.prepare('INSERT INTO experience_relations VALUES(?,?,?,?)').run(randomUUID(),id,personaScope(access.view.scope),JSON.stringify({kind:target?'revises':'belongs-to-task',
          from:{id:value.id,version:value.version},to:target?{id:target.id,version:target.version}:{taskId:access.view.taskId,runId:row.input.runId},authority:'program',state:'recorded'}));
      }
      for(const raw of relations){const relation=ExperienceRelationSchema.parse(raw);
        if(sourceKey(relation.from)===sourceKey(relation.to))throw new Error('INVALID_RELATION');
        for(const ref of [relation.from,relation.to])if(!actual.some(known=>personaDigest(known)===personaDigest(ref)))throw new Error('SOURCE_NOT_EXPOSED');
        this.db.prepare('INSERT INTO experience_relations VALUES(?,?,?,?)').run(randomUUID(),id,personaScope(access.view.scope),JSON.stringify({...relation,state:'held',authority:'model-suggestion'}));
      }
      const result=z.json().parse({...z.record(z.string(),z.json()).parse(extra),experienceIds:ids,experienceBasis});
      if(redactJson(result).redacted)throw new Error('PRIVATE_INPUT_REJECTED');
      this.db.prepare("UPDATE maintenance_requests SET state='completed',version=version+1,result=?,updated_at=? WHERE id=?").run(JSON.stringify(result),new Date().toISOString(),id);
      this.db.prepare('INSERT INTO maintenance_watermarks VALUES(?,?,?,?)').run(access.view.scope.agentId,personaScope(access.view.scope),id,row.input.watermark);
      this.audit(access,'memory.maintenance.completed',{id,experienceIds:ids});(access.commitGuard??access.guard)();return result;
    });
  }
  review(access:PersonaAccess,raw:unknown){const input=ExperienceReviewSchema.parse(raw);return this.transaction(()=>{
    const {scope}=this.task(access),fingerprint=personaDigest(input);
    const old=this.db.prepare('SELECT fingerprint,body FROM maintenance_receipts WHERE agent_id=? AND scope_key=? AND producer=? AND request_id=?').get(scope.agentId,scope.scopeKey,access.producer,input.requestId);
    if(old){if(old.fingerprint!==fingerprint)throw new Error('IDEMPOTENCY_CONFLICT');return z.json().parse(JSON.parse(String(old.body)));}
    const current=this.read(access,input.id);if(current.version!==input.expectedVersion)throw new Error('VERSION_CONFLICT');
    const value={...current,version:current.version+1,state:input.state,reason:input.reason};if(redactJson(z.json().parse(value)).redacted)throw new Error('PRIVATE_INPUT_REJECTED');this.write(value);
    const result={id:value.id,version:value.version,state:value.state};this.db.prepare('INSERT INTO maintenance_receipts VALUES(?,?,?,?,?,?)').run(scope.agentId,scope.scopeKey,access.producer,input.requestId,fingerprint,JSON.stringify(result));
    this.audit(access,'memory.experience.reviewed',result);(access.commitGuard??access.guard)();return result;
  });}
  relations(access:PersonaAccess,id:string){const row=this.snapshot(access,id);this.validate(access,row.input,row.state!=='completed');
    return this.db.prepare('SELECT body FROM experience_relations WHERE scope_key=? AND maintenance_id=? ORDER BY rowid LIMIT 32').all(personaScope(access.view.scope),id).map(r=>z.json().parse(JSON.parse(String(r.body))));}
  counts(){const rows=this.db.prepare('SELECT state,count(*) AS n FROM maintenance_requests GROUP BY state').all();return Object.fromEntries(rows.map(r=>[String(r.state),Number(r.n)]));}
  schedulingItem(id:string){const row=this.db.prepare('SELECT body,state,version FROM maintenance_requests WHERE id=?').get(z.uuid().parse(id));if(!row)return null;
    const body=MaintenanceSnapshotSchema.parse(JSON.parse(String(row.body)));return MaintenanceSchedulingItemSchema.parse({id:body.id,scope:body.scope,taskEpoch:body.taskEpoch,runId:body.runId,
      watermark:body.watermark,expiresAt:body.expiresAt,state:row.state,version:row.version,reason:'explicit-request',retainedSources:body.sources.length});}
  pendingScheduling(agentId:string,after:number,limit:number){z.number().int().nonnegative().parse(after);z.number().int().min(1).max(100).parse(limit);
    const rows=this.db.prepare("SELECT rowid,id FROM maintenance_requests WHERE agent_id=? AND rowid>? AND state IN ('ready') AND json_extract(body,'$.motivation.kind')<>'maintenance' ORDER BY rowid LIMIT ?")
      .all(agentId,after,limit);return {items:rows.flatMap(row=>{const item=this.schedulingItem(String(row.id));return item?[item]:[];}),next:rows.length===limit?Number(rows.at(-1)!.rowid):null};}
}
