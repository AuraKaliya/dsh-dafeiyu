import type { DatabaseSync } from 'node:sqlite';
import { createHash,randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ExecutionScopeSchema,PersonaSourceRefSchema,PersonaRequestIdSchema,redactJson,SourceDependencySchema,ExecutionObservationSchema,PersonaSourceNatureSchema,PersonaSourceEvidenceSchema } from '@dafeiyu/contracts';
import type { PersonaSourceNature } from '@dafeiyu/contracts';
import type { PersonaAccess,PersonaSourceRef } from '@dafeiyu/contracts';
import type { PersonaMaterial,PersonaResolver } from './persona-store.js';
import { personaDigest,personaScope,uniqueSources } from './persona-digest.js';

const bodySchema=z.strictObject({schemaVersion:z.literal(1),kind:z.literal('self-report'),text:z.string().min(1).max(8000),scope:ExecutionScopeSchema,
  runId:z.uuid(),producer:z.string(),operationId:z.string(),dependencies:z.array(PersonaSourceRefSchema).max(64),rootSources:z.array(z.string().max(2200)).max(64)});
const observedSchema=z.strictObject({schemaVersion:z.literal(2),kind:z.enum(['primary','digest','self-report']),text:z.string().min(1).max(32000),scope:ExecutionScopeSchema,
  runId:z.uuid(),producer:z.string(),operationId:z.string(),dependencies:z.array(PersonaSourceRefSchema).max(64),rootSources:z.array(z.string().max(2200)).max(64),
  history:z.array(SourceDependencySchema).max(4096),occurredAt:z.iso.datetime({offset:true}),resource:z.string(),coverage:z.array(z.string()),completeness:z.enum(['complete','partial','unknown']),nature:PersonaSourceNatureSchema.optional()});
const storedSchema=z.union([bodySchema,observedSchema]);
export class ExecutionSources {
  constructor(private readonly db:DatabaseSync,private readonly transaction:<T>(work:()=>T)=>T,private readonly resolve:PersonaResolver){}
  private ensureTask(access:PersonaAccess){access.guard();const scope=access.view.scope;if(scope.kind!=='task'||!access.view.taskId)throw new Error('TASK_REQUIRED');
    const task=this.db.prepare('SELECT epoch,status FROM task_workspaces WHERE id=? AND agent_id=?').get(scope.taskId,scope.agentId);
    if(!task||task.status!=='active'||task.epoch!==access.intentVersion)throw new Error('TASK_NOT_ACTIVE');return scope;}
  private event(access:PersonaAccess,type:string,data:unknown){const id=randomUUID();this.db.prepare('INSERT INTO execution_memory_outbox(id,body) VALUES(?,?)').run(id,JSON.stringify({id,type,scope:access.view.scope,runId:access.view.runId,origin:access.view.origin,
    operationId:access.operationId,causedBy:access.startedEventId,producer:access.producer,at:new Date().toISOString(),data}));}
  selfReport(access:PersonaAccess,requestId:string,text:string,refs:readonly PersonaSourceRef[]):PersonaSourceRef{
    return this.record(access,requestId,text,refs,{kind:'self-report',occurredAt:new Date().toISOString(),resource:'self:reflection',coverage:['current-statement'],completeness:'unknown'});
  }
  observe(access:PersonaAccess,raw:unknown):PersonaSourceRef{const input=ExecutionObservationSchema.parse(raw),{kind,occurredAt,resource,coverage,completeness,nature}=input;return this.record(access,input.requestId,input.text,input.dependencies,{kind,occurredAt,resource,coverage,completeness,...(nature===undefined?{}:{nature})});}
  private record(access:PersonaAccess,requestId:string,text:string,refs:readonly PersonaSourceRef[],details:Pick<z.infer<typeof observedSchema>,'kind'|'occurredAt'|'resource'|'coverage'|'completeness'|'nature'>):PersonaSourceRef{
    const scope=this.ensureTask(access);PersonaRequestIdSchema.parse(requestId);z.string().trim().min(1).max(details.kind==='self-report'?8000:32000).parse(text);
    if(redactJson(z.json().parse({text,...details})).redacted)throw new Error('PRIVATE_INPUT_REJECTED');
    const dependencies=uniqueSources([...refs,...access.admittedSources,...access.inputs.flatMap(input=>input.sourceRef?[input.sourceRef]:[])]);
    const materials=dependencies.map(ref=>{const material=this.resolve(access,ref);if(!material)throw new Error('SOURCE_STALE');return material;});
    const history=access.historyDependencies??[];
    if(history.length&&!access.validateHistory?.(history))throw new Error('SOURCE_STALE');
    const expanded=uniqueSources([...dependencies,...materials.flatMap(material=>material.dependencies)]),fingerprint=personaDigest({text,dependencies:expanded,kind:details.kind,resource:details.resource,coverage:details.coverage,completeness:details.completeness,...(details.nature===undefined?{}:{nature:details.nature})});
    return this.transaction(()=>{access.guard();const old=this.db.prepare('SELECT fingerprint,receipt FROM execution_memory_requests WHERE scope_key=? AND producer=? AND request_id=?').get(scope.scopeKey,access.producer,requestId);
      if(old){if(old.fingerprint!==fingerprint)throw new Error('IDEMPOTENCY_CONFLICT');return PersonaSourceRefSchema.parse(JSON.parse(String(old.receipt)));}
      const id=randomUUID(),rootSources=[...new Set(materials.flatMap(material=>material.rootSources))];if(details.kind==='primary'||!rootSources.length)rootSources.push(JSON.stringify([details.kind,scope.agentId,scope.scopeKey,id]));
      const body=observedSchema.parse({schemaVersion:2,...details,text,scope,runId:access.view.runId,producer:access.producer,operationId:access.operationId,dependencies:expanded,rootSources,history});
      const scopeRow=this.db.prepare('SELECT fingerprint FROM execution_scopes WHERE scope_key=?').get(scope.scopeKey),scopeHash=personaDigest(scope);
      if(scopeRow&&scopeRow.fingerprint!==scopeHash)throw new Error('SCOPE_DENIED');if(!scopeRow)this.db.prepare('INSERT INTO execution_scopes VALUES(?,?,?,?,?)').run(scope.scopeKey,scope.agentId,scope.taskId,JSON.stringify(scope),scopeHash);
      const contentHash=createHash('sha256').update(text).digest('hex');this.db.prepare('INSERT INTO execution_sources(id,scope_key,run_id,producer,body,content_hash) VALUES(?,?,?,?,?,?)').run(id,scope.scopeKey,access.view.runId,access.producer,JSON.stringify(body),contentHash);
      const ref=PersonaSourceRefSchema.parse({kind:'execution-source',id,agentId:scope.agentId,scopeKey:scope.scopeKey,version:1,contentHash});
      this.db.prepare('INSERT INTO execution_memory_requests VALUES(?,?,?,?,?)').run(scope.scopeKey,access.producer,requestId,fingerprint,JSON.stringify(ref));
      this.db.prepare('INSERT INTO execution_observations VALUES(?,?,?,?,?,?,?,?)').run(id,scope.scopeKey,access.view.runId,access.producer,requestId,fingerprint,JSON.stringify(body),JSON.stringify(ref));
      this.bump(scope.agentId,scope.scopeKey);this.event(access,details.kind==='self-report'?'execution.self-report.recorded':'execution.observation.recorded',{sourceId:id,version:1,kind:details.kind});return ref;
    });
  }
  reference(access:PersonaAccess,id:string):PersonaSourceRef|null{access.guard();const row=this.db.prepare('SELECT s.scope_key,s.state_version,s.content_hash FROM execution_sources s JOIN execution_scopes c ON c.scope_key=s.scope_key WHERE s.id=? AND c.agent_id=? AND s.scope_key=? AND s.deleted=0').get(id,access.view.scope.agentId,personaScope(access.view.scope));
    return row?PersonaSourceRefSchema.parse({kind:'execution-source',id,agentId:access.view.scope.agentId,scopeKey:row.scope_key,version:row.state_version,contentHash:row.content_hash}):null;}
  open(access:PersonaAccess,ref:PersonaSourceRef):PersonaMaterial|null{
    access.guard();if(ref.kind!=='execution-source'||ref.agentId!==access.view.scope.agentId||ref.scopeKey!==personaScope(access.view.scope))return null;
    const row=this.db.prepare('SELECT * FROM execution_sources WHERE id=? AND scope_key=? AND deleted=0').get(ref.id,ref.scopeKey);
    if(!row||row.state_version!==ref.version||row.content_hash!==ref.contentHash)return null;const body=storedSchema.parse(JSON.parse(String(row.body)));
    if(personaScope(body.scope)!==ref.scopeKey||body.scope.agentId!==ref.agentId||createHash('sha256').update(body.text).digest('hex')!==ref.contentHash)return null;
    if(body.schemaVersion===2){if(body.history.length&&!access.validateHistory?.(body.history))return null;
      if(body.operationId!==access.operationId&&access.operationFinished&&!access.operationFinished(body.operationId))return null;}
    const inherited=new Map<string,PersonaSourceNature>();
    for(const dependency of body.dependencies){const material=this.resolve(access,dependency);if(!material)return null;
      for(const root of material.evidence?.roots??material.rootSources.map(key=>({key,nature:'unknown' as const}))){const previous=inherited.get(root.key);inherited.set(root.key,previous&&previous!==root.nature?'unknown':root.nature);}}
    const nature:PersonaSourceNature=body.kind==='self-report'?'self-report':body.kind==='digest'?'derived':body.schemaVersion===2?body.nature??'unknown':'unknown';
    const evidence=PersonaSourceEvidenceSchema.parse({source:ref,nature,coverage:body.schemaVersion===2?body.coverage:[],completeness:body.schemaVersion===2?body.completeness:'unknown',
      roots:[...new Set(body.rootSources)].map(key=>({key,nature:inherited.get(key)??nature}))});
    return {text:body.text,dependencies:body.dependencies,rootSources:body.rootSources,evidence};
  }
  metadata(access:PersonaAccess,ref:PersonaSourceRef){if(!this.open(access,ref))throw new Error('SOURCE_STALE');return storedSchema.parse(JSON.parse(String(this.db.prepare('SELECT body FROM execution_sources WHERE id=?').get(ref.id)?.body)));}
  operationSources(access:PersonaAccess,operationId:string):PersonaSourceRef[]{return this.db.prepare("SELECT id FROM execution_sources WHERE scope_key=? AND json_extract(body,'$.operationId')=? AND deleted=0").all(personaScope(access.view.scope),operationId).flatMap(row=>{const ref=this.reference(access,String(row.id));return ref&&this.open(access,ref)?[ref]:[];});}
  private bump(agent:string,route:string){this.db.prepare('INSERT INTO scope_generations VALUES(?,?,1) ON CONFLICT(agent_id,route) DO UPDATE SET generation=generation+1').run(agent,route);}
  change(access:PersonaAccess,raw:unknown){const input=z.strictObject({requestId:PersonaRequestIdSchema,id:z.uuid(),expectedVersion:z.number().int().positive(),deleted:z.boolean()}).parse(raw),scope=this.ensureTask(access);
    return this.transaction(()=>{access.guard();const fingerprint=personaDigest({kind:'state',input}),old=this.db.prepare('SELECT fingerprint,receipt FROM execution_memory_requests WHERE scope_key=? AND producer=? AND request_id=?').get(scope.scopeKey,access.producer,input.requestId);
      if(old){if(old.fingerprint!==fingerprint)throw new Error('IDEMPOTENCY_CONFLICT');return z.object({id:z.uuid(),version:z.number()}).parse(JSON.parse(String(old.receipt)));}
      const row=this.db.prepare('SELECT state_version,deleted FROM execution_sources WHERE id=? AND scope_key=?').get(input.id,scope.scopeKey);if(!row)throw new Error('SCOPE_DENIED');if(row.state_version!==input.expectedVersion)throw new Error('VERSION_CONFLICT');
      if(row.deleted===Number(input.deleted))throw new Error('SOURCE_STATE_CONFLICT');const version=input.expectedVersion+1;this.db.prepare('UPDATE execution_sources SET state_version=?,deleted=? WHERE id=?').run(version,Number(input.deleted),input.id);
      const receipt={id:input.id,version};this.db.prepare('INSERT INTO execution_memory_requests VALUES(?,?,?,?,?)').run(scope.scopeKey,access.producer,input.requestId,fingerprint,JSON.stringify(receipt));this.bump(scope.agentId,scope.scopeKey);this.event(access,input.deleted?'execution.source.deleted':'execution.source.restored',receipt);return receipt;
    });
  }
  drainOutbox(append:(body:unknown,id:string)=>void){let pending=0;for(const row of this.db.prepare('SELECT id,body FROM execution_memory_outbox WHERE delivered=0 ORDER BY rowid').all()){
    try{append(JSON.parse(String(row.body)),String(row.id));this.db.prepare('UPDATE execution_memory_outbox SET delivered=1 WHERE id=?').run(row.id!);}catch{pending++;break;}}return pending;}
}
