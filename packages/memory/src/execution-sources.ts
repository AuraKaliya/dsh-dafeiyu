import type { DatabaseSync } from 'node:sqlite';
import { createHash,randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ExecutionScopeSchema,PersonaSourceRefSchema,PersonaRequestIdSchema,redactJson } from '@dafeiyu/contracts';
import type { PersonaAccess,PersonaSourceRef } from '@dafeiyu/contracts';
import type { PersonaMaterial,PersonaResolver } from './persona-store.js';
import { personaDigest,personaScope,uniqueSources } from './persona-digest.js';

const bodySchema=z.strictObject({schemaVersion:z.literal(1),kind:z.literal('self-report'),text:z.string().min(1).max(8000),scope:ExecutionScopeSchema,
  runId:z.uuid(),producer:z.string(),operationId:z.string(),dependencies:z.array(PersonaSourceRefSchema).max(64),rootSources:z.array(z.string().max(2200)).max(64)});
export class ExecutionSources {
  constructor(private readonly db:DatabaseSync,private readonly transaction:<T>(work:()=>T)=>T,private readonly resolve:PersonaResolver){}
  private ensureTask(access:PersonaAccess){access.guard();const scope=access.view.scope;if(scope.kind!=='task'||!access.view.taskId)throw new Error('TASK_REQUIRED');
    const task=this.db.prepare('SELECT epoch,status FROM task_workspaces WHERE id=? AND agent_id=?').get(scope.taskId,scope.agentId);
    if(!task||task.status!=='active'||task.epoch!==access.intentVersion)throw new Error('TASK_NOT_ACTIVE');return scope;}
  private event(access:PersonaAccess,type:string,data:unknown){const id=randomUUID();this.db.prepare('INSERT INTO execution_memory_outbox(id,body) VALUES(?,?)').run(id,JSON.stringify({id,type,scope:access.view.scope,runId:access.view.runId,origin:access.view.origin,
    operationId:access.operationId,causedBy:access.startedEventId,producer:access.producer,at:new Date().toISOString(),data}));}
  selfReport(access:PersonaAccess,requestId:string,text:string,refs:readonly PersonaSourceRef[]):PersonaSourceRef{
    const scope=this.ensureTask(access);PersonaRequestIdSchema.parse(requestId);z.string().trim().min(1).max(8000).parse(text);
    if(redactJson({text}).redacted)throw new Error('PRIVATE_INPUT_REJECTED');
    const dependencies=uniqueSources([...refs,...access.admittedSources,...access.inputs.flatMap(input=>input.sourceRef?[input.sourceRef]:[])]);
    const materials=dependencies.map(ref=>{const material=this.resolve(access,ref);if(!material)throw new Error('SOURCE_STALE');return material;});
    const expanded=uniqueSources([...dependencies,...materials.flatMap(material=>material.dependencies)]),fingerprint=personaDigest({text,dependencies:expanded});
    return this.transaction(()=>{access.guard();const old=this.db.prepare('SELECT fingerprint,receipt FROM execution_memory_requests WHERE scope_key=? AND producer=? AND request_id=?').get(scope.scopeKey,access.producer,requestId);
      if(old){if(old.fingerprint!==fingerprint)throw new Error('IDEMPOTENCY_CONFLICT');return PersonaSourceRefSchema.parse(JSON.parse(String(old.receipt)));}
      const id=randomUUID(),rootSources=[...new Set(materials.flatMap(material=>material.rootSources))];if(!rootSources.length)rootSources.push(JSON.stringify(['self-report',scope.agentId,scope.scopeKey,id]));
      const body=bodySchema.parse({schemaVersion:1,kind:'self-report',text,scope,runId:access.view.runId,producer:access.producer,operationId:access.operationId,dependencies:expanded,rootSources});
      const scopeRow=this.db.prepare('SELECT fingerprint FROM execution_scopes WHERE scope_key=?').get(scope.scopeKey),scopeHash=personaDigest(scope);
      if(scopeRow&&scopeRow.fingerprint!==scopeHash)throw new Error('SCOPE_DENIED');if(!scopeRow)this.db.prepare('INSERT INTO execution_scopes VALUES(?,?,?,?,?)').run(scope.scopeKey,scope.agentId,scope.taskId,JSON.stringify(scope),scopeHash);
      const contentHash=createHash('sha256').update(text).digest('hex');this.db.prepare('INSERT INTO execution_sources(id,scope_key,run_id,producer,body,content_hash) VALUES(?,?,?,?,?,?)').run(id,scope.scopeKey,access.view.runId,access.producer,JSON.stringify(body),contentHash);
      const ref=PersonaSourceRefSchema.parse({kind:'execution-source',id,agentId:scope.agentId,scopeKey:scope.scopeKey,version:1,contentHash});
      this.db.prepare('INSERT INTO execution_memory_requests VALUES(?,?,?,?,?)').run(scope.scopeKey,access.producer,requestId,fingerprint,JSON.stringify(ref));this.event(access,'execution.self-report.recorded',{sourceId:id,version:1});return ref;
    });
  }
  reference(access:PersonaAccess,id:string):PersonaSourceRef|null{access.guard();const row=this.db.prepare('SELECT s.scope_key,s.state_version,s.content_hash FROM execution_sources s JOIN execution_scopes c ON c.scope_key=s.scope_key WHERE s.id=? AND c.agent_id=? AND s.scope_key=? AND s.deleted=0').get(id,access.view.scope.agentId,personaScope(access.view.scope));
    return row?PersonaSourceRefSchema.parse({kind:'execution-source',id,agentId:access.view.scope.agentId,scopeKey:row.scope_key,version:row.state_version,contentHash:row.content_hash}):null;}
  open(access:PersonaAccess,ref:PersonaSourceRef):PersonaMaterial|null{
    access.guard();if(ref.kind!=='execution-source'||ref.agentId!==access.view.scope.agentId||ref.scopeKey!==personaScope(access.view.scope))return null;
    const row=this.db.prepare('SELECT * FROM execution_sources WHERE id=? AND scope_key=? AND deleted=0').get(ref.id,ref.scopeKey);
    if(!row||row.state_version!==ref.version||row.content_hash!==ref.contentHash)return null;const body=bodySchema.parse(JSON.parse(String(row.body)));
    if(personaScope(body.scope)!==ref.scopeKey||body.scope.agentId!==ref.agentId||createHash('sha256').update(body.text).digest('hex')!==ref.contentHash)return null;
    for(const dependency of body.dependencies)if(!this.resolve(access,dependency))return null;return {text:body.text,dependencies:body.dependencies,rootSources:body.rootSources};
  }
  change(access:PersonaAccess,raw:unknown){const input=z.strictObject({requestId:PersonaRequestIdSchema,id:z.uuid(),expectedVersion:z.number().int().positive(),deleted:z.boolean()}).parse(raw),scope=this.ensureTask(access);
    return this.transaction(()=>{access.guard();const fingerprint=personaDigest({kind:'state',input}),old=this.db.prepare('SELECT fingerprint,receipt FROM execution_memory_requests WHERE scope_key=? AND producer=? AND request_id=?').get(scope.scopeKey,access.producer,input.requestId);
      if(old){if(old.fingerprint!==fingerprint)throw new Error('IDEMPOTENCY_CONFLICT');return z.object({id:z.uuid(),version:z.number()}).parse(JSON.parse(String(old.receipt)));}
      const row=this.db.prepare('SELECT state_version,deleted FROM execution_sources WHERE id=? AND scope_key=?').get(input.id,scope.scopeKey);if(!row)throw new Error('SCOPE_DENIED');if(row.state_version!==input.expectedVersion)throw new Error('VERSION_CONFLICT');
      if(row.deleted===Number(input.deleted))throw new Error('SOURCE_STATE_CONFLICT');const version=input.expectedVersion+1;this.db.prepare('UPDATE execution_sources SET state_version=?,deleted=? WHERE id=?').run(version,Number(input.deleted),input.id);
      const receipt={id:input.id,version};this.db.prepare('INSERT INTO execution_memory_requests VALUES(?,?,?,?,?)').run(scope.scopeKey,access.producer,input.requestId,fingerprint,JSON.stringify(receipt));this.event(access,input.deleted?'execution.source.deleted':'execution.source.restored',receipt);return receipt;
    });
  }
  drainOutbox(append:(body:unknown,id:string)=>void){let pending=0;for(const row of this.db.prepare('SELECT id,body FROM execution_memory_outbox WHERE delivered=0 ORDER BY rowid').all()){
    try{append(JSON.parse(String(row.body)),String(row.id));this.db.prepare('UPDATE execution_memory_outbox SET delivered=1 WHERE id=?').run(row.id!);}catch{pending++;break;}}return pending;}
}
