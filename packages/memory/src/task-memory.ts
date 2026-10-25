import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { conversationKey,redactContent,TaskMemoryPolicySchema,TaskMemoryGrantSchema,TaskMemoryAuthorizationSchema } from '@dafeiyu/contracts';
import type { TaskMemoryProvider,TaskMemoryAuthorization,Json } from '@dafeiyu/contracts';
import type { NewEvent } from '@dafeiyu/journal';
import { digest,canonical } from './retrieval-profile.js';
import type { MemoryRetrieval } from './retrieval.js';
import type { MemoryStore,MemoryView } from './store.js';
import { TaskWorkspace,witnessSchema } from './task-workspace.js';
import type { Witness } from './task-workspace.js';
import { MEMORY_VERSION } from './types.js';

const text=(v:unknown)=>z.string().parse(v),integer=(v:unknown)=>z.number().int().parse(v);
const hash=(v:unknown)=>digest(canonical(z.json().parse(v)));
const grantBodySchema=z.strictObject({input:TaskMemoryGrantSchema,authorization:TaskMemoryAuthorizationSchema});
const hitSchema=z.strictObject({proof:witnessSchema,start:z.number().int(),end:z.number().int(),profile:z.string()});
type Grant=ReturnType<TaskMemory['active']>;

export function migrateTaskMemory(db:DatabaseSync){
  const version=db.prepare('PRAGMA user_version').get()?.user_version;
if(version===5||version===6||version===7||version===8||version===9||version===10||version===11){for(const table of ['task_memory_policies','task_memory_policy_revisions','task_memory_grants','task_memory_requests','task_memory_hits'])db.prepare(`SELECT * FROM ${table} LIMIT 0`).all();return;}
  if(version!==4)throw new Error('Unsupported task memory schema');
  db.exec(`CREATE TABLE task_memory_policies(agent_id TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(agent_id,id));
    CREATE TABLE task_memory_policy_revisions(agent_id TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(agent_id,id,version));
    CREATE TABLE task_memory_grants(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,task_id TEXT NOT NULL REFERENCES task_workspaces(id),version INTEGER NOT NULL,revoked INTEGER NOT NULL,body TEXT NOT NULL);
    CREATE TABLE task_memory_requests(agent_id TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,receipt TEXT NOT NULL,PRIMARY KEY(agent_id,request_id));
    CREATE TABLE task_memory_hits(id TEXT PRIMARY KEY,grant_id TEXT NOT NULL REFERENCES task_memory_grants(id),expires_at TEXT NOT NULL,body TEXT NOT NULL);
    CREATE TRIGGER task_memory_policy_revision_immutable BEFORE UPDATE ON task_memory_policy_revisions BEGIN SELECT RAISE(ABORT,'Immutable policy revision'); END;
    CREATE TRIGGER task_memory_policy_revision_retain BEFORE DELETE ON task_memory_policy_revisions BEGIN SELECT RAISE(ABORT,'Retain policy revision'); END;
    CREATE TRIGGER task_memory_grant_immutable BEFORE UPDATE OF id,agent_id,task_id,body ON task_memory_grants BEGIN SELECT RAISE(ABORT,'Immutable grant binding'); END;
    CREATE TRIGGER task_memory_grant_retain BEFORE DELETE ON task_memory_grants BEGIN SELECT RAISE(ABORT,'Revoke authorization'); END;
    CREATE TRIGGER task_memory_hit_immutable BEFORE UPDATE ON task_memory_hits BEGIN SELECT RAISE(ABORT,'Immutable hit proof'); END;
    PRAGMA user_version=5;`);
}

/** Durable task-internal authority. The original memory boundaries are never rewritten. */
export class TaskMemory {
  constructor(private readonly db:DatabaseSync,private readonly transaction:<T>(work:()=>T)=>T,private readonly memory:MemoryStore,
    private readonly tasks:TaskWorkspace,private readonly retrieval:MemoryRetrieval|null){
    tasks.authorizeWith((agent,proof,route,id)=>{try{const grant=this.active(agent,proof.taskId,proof.grantId);return hash(grant.authorization)===hash(proof)&&this.allowed(agent,grant.input.sources,route,id);}catch{return false;}});
  }
  private audit(agentId:string,taskId:string|null,type:string,data:Record<string,Json>){
    const id=randomUUID(),event:NewEvent={agentId,route:conversationKey(agentId,{channel:'agent-task',account:agentId,kind:'local',id:taskId??'$memory-policy'}),
      traceId:taskId??id,operationId:taskId??id,causedBy:null,plugin:'memory',pluginVersion:MEMORY_VERSION,type,occurredAt:new Date().toISOString(),sources:[],data};
    this.db.prepare('INSERT INTO memory_events VALUES(?,?,?)').run(id,JSON.stringify(event),'');this.db.prepare('INSERT INTO outbox(event_id) VALUES(?)').run(id);
  }
  private request<T extends Record<string,unknown>>(agentId:string,requestId:string,input:unknown,write:()=>T):T{
    return this.transaction(()=>{const fingerprint=hash(input),old=this.db.prepare('SELECT * FROM task_memory_requests WHERE agent_id=? AND request_id=?').get(agentId,requestId);
      if(old){if(old.fingerprint!==fingerprint)throw new Error('authorization_idempotency_conflict');return z.record(z.string(),z.unknown()).parse(JSON.parse(text(old.receipt))) as T;}
      const receipt=write();this.db.prepare('INSERT INTO task_memory_requests VALUES(?,?,?,?)').run(agentId,requestId,fingerprint,JSON.stringify(receipt));return receipt;});
  }
  private uniqueSources(agent:string,sources:z.output<typeof TaskMemoryPolicySchema>['sources']){
    if(new Set(sources.map(s=>conversationKey(agent,s.conversation))).size!==sources.length||sources.some(s=>s.memoryIds&&new Set(s.memoryIds).size!==s.memoryIds.length))throw new Error('duplicate_authorization_source');
  }
  policy(agentId:string,input:Parameters<TaskMemoryProvider['policy']>[1]){
    return this.request(agentId,input.requestId,{kind:'policy',input},()=>{
      this.uniqueSources(agentId,input.sources);const row=this.db.prepare('SELECT version FROM task_memory_policies WHERE agent_id=? AND id=?').get(agentId,input.id);
      if((row?integer(row.version):0)!==input.expectedVersion)throw new Error('policy_version_conflict');
      const version=input.expectedVersion+1,body=JSON.stringify({...input,reason:redactContent(input.reason).value});
      this.db.prepare('INSERT INTO task_memory_policies VALUES(?,?,?,?) ON CONFLICT(agent_id,id) DO UPDATE SET version=excluded.version,body=excluded.body').run(agentId,input.id,version,body);
      this.db.prepare('INSERT INTO task_memory_policy_revisions VALUES(?,?,?,?)').run(agentId,input.id,version,body);
      this.audit(agentId,null,'task.memory.policy',{policyId:input.id,version,enabled:input.enabled});return {id:input.id,version};
    });
  }
  private policyState(agent:string,id:string){const row=this.db.prepare('SELECT * FROM task_memory_policies WHERE agent_id=? AND id=?').get(agent,id);if(!row)throw new Error('authorization_unavailable');
    return {version:integer(row.version),input:TaskMemoryPolicySchema.parse(JSON.parse(text(row.body)))};}
  private allowed(agent:string,sources:z.output<typeof TaskMemoryGrantSchema>['sources'],route:string,id?:string){
    const source=sources.find(s=>conversationKey(agent,s.conversation)===route);return !!source&&(!source.memoryIds||id!==undefined&&source.memoryIds.includes(id));
  }
  grant(agentId:string,taskId:string,input:Parameters<TaskMemoryProvider['grant']>[2]):string {
    return this.request(agentId,input.requestId,{kind:'grant',taskId,input},()=>{
      this.uniqueSources(agentId,input.sources);const policy=this.policyState(agentId,input.policyId),task=this.tasks.state(agentId,taskId),expiry=Date.parse(input.expiresAt);
      if(!policy.input.enabled||policy.version!==input.expectedPolicyVersion||task.status!=='active'||expiry<=Date.now()||expiry>Date.now()+86400000)throw new Error('authorization_unavailable');
      for(const source of input.sources){const route=conversationKey(agentId,source.conversation),parent=policy.input.sources.find(s=>conversationKey(agentId,s.conversation)===route);
        if(!parent||parent.memoryIds&&(!source.memoryIds||source.memoryIds.some(id=>!parent.memoryIds!.includes(id))))throw new Error('authorization_outside_policy');}
      const id=randomUUID(),authorization:TaskMemoryAuthorization={taskId,taskEpoch:task.epoch,grantId:id,grantVersion:1,policyId:input.policyId,policyVersion:policy.version};
      const body={input:{...input,reason:redactContent(input.reason).value},authorization};
      this.db.prepare('INSERT INTO task_memory_grants VALUES(?,?,?,1,0,?)').run(id,agentId,taskId,JSON.stringify(body));
      this.audit(agentId,taskId,'task.memory.granted',{grantId:id,policyId:input.policyId,policyVersion:policy.version,expiresAt:input.expiresAt,executor:'$task-coordinator',purpose:'internal'});return {id};
    }).id;
  }
  private active(agentId:string,taskId:string,id:string){
    const row=this.db.prepare('SELECT * FROM task_memory_grants WHERE id=? AND agent_id=? AND task_id=?').get(id,agentId,taskId);if(!row||row.revoked!==0)throw new Error('authorization_unavailable');
    const grant=grantBodySchema.parse(JSON.parse(text(row.body))),task=this.tasks.state(agentId,taskId),policy=this.policyState(agentId,grant.authorization.policyId);
    if(integer(row.version)!==grant.authorization.grantVersion||grant.authorization.grantId!==id||grant.authorization.taskId!==taskId||task.status!=='active'||task.epoch!==grant.authorization.taskEpoch
      ||Date.parse(grant.input.expiresAt)<=Date.now()||!policy.input.enabled||policy.version!==grant.authorization.policyVersion)throw new Error('authorization_unavailable');
    return grant;
  }
  check(agent:string,task:string,grant:string){this.active(agent,task,grant);}
  revoke(agentId:string,taskId:string,input:Parameters<TaskMemoryProvider['revoke']>[2]){
    return this.request(agentId,input.requestId,{kind:'revoke',taskId,input},()=>{
      const row=this.db.prepare('SELECT version,revoked FROM task_memory_grants WHERE id=? AND agent_id=? AND task_id=?').get(input.id,agentId,taskId);
      if(!row||row.revoked!==0||integer(row.version)!==input.expectedVersion)throw new Error('grant_version_conflict');
      this.db.prepare('UPDATE task_memory_grants SET version=version+1,revoked=1 WHERE id=?').run(input.id);
      this.audit(agentId,taskId,'task.memory.revoked',{grantId:input.id,version:input.expectedVersion+1});return {id:input.id,version:input.expectedVersion+1};
    });
  }
  private proof(agent:string,route:string,memory:MemoryView,grant:Grant):Witness|null{
    if(!this.allowed(agent,grant.input.sources,route,memory.id))return null;
    try{const base=this.tasks.memoryProof({agentId:agent,route},memory.id,memory.revision,memory.version,memory.contentHash);
      return base?.kind==='memory'?{...base,authorization:grant.authorization}:null;
    }catch{return null;}
  }
  async recall(agentId:string,taskId:string,grantId:string,input:Parameters<TaskMemoryProvider['recall']>[3],signal:AbortSignal,outerGuard:()=>void){
    const grant=this.active(agentId,taskId,grantId),retrieval=this.retrieval;if(!retrieval)throw new Error('task_retrieval_unconfigured');
    const routes=grant.input.sources.map(s=>conversationKey(agentId,s.conversation));
    const generations=routes.map(route=>this.memory.generation({agentId,route}));
    const guard=()=>{outerGuard();signal.throwIfAborted();this.active(agentId,taskId,grantId);
      if(routes.some((route,i)=>this.memory.generation({agentId,route})!==generations[i]))throw new Error('task_retrieval_stale');};
    const candidates:Array<{route:string;rank:number;item:Awaited<ReturnType<MemoryRetrieval['recall']>>['items'][number];proof:Witness}>=[];
    const stats:Array<{route:string;strategyUsed:string;degraded:boolean;cacheHits:number;vectorsComputed:number}>=[];
    for(const route of routes){guard();const scope={agentId,route};
      const result=await retrieval.recallInternal(scope,hash(grant.authorization),m=>!!this.proof(agentId,route,m,grant),input,signal,guard);guard();
      stats.push({route,strategyUsed:result.strategyUsed,degraded:result.degraded,cacheHits:result.cacheHits,vectorsComputed:result.vectorsComputed});
      result.items.forEach((item,rank)=>{const memory=this.memory.read(scope,item.id,'normal',item.revision,'internal'),proof=memory&&this.proof(agentId,route,memory,grant);
        if(proof)candidates.push({route,rank,item,proof});});
    }
    // Rank fusion avoids comparing BM25 values from different scene corpora.
    candidates.sort((a,b)=>a.rank-b.rank||routes.indexOf(a.route)-routes.indexOf(b.route));
    return this.transaction(()=>{guard();const seen=new Set<string>();const selected=candidates.filter(c=>{const key=`${c.route}:${c.item.id}`;if(seen.has(key))return false;seen.add(key);return this.tasks.validProof(agentId,c.proof);}).slice(0,input.limit);
      const expiresAt=new Date(Math.min(Date.parse(grant.input.expiresAt),Date.now()+600000)).toISOString();
      this.db.prepare('DELETE FROM task_memory_hits WHERE expires_at<=?').run(new Date().toISOString());
      const items=selected.map(c=>{const hitId=randomUUID(),body={proof:c.proof,start:c.item.chunk.start,end:c.item.chunk.previewEnd,profile:retrieval.profile.hash};
        this.db.prepare('INSERT INTO task_memory_hits VALUES(?,?,?,?)').run(hitId,grantId,expiresAt,JSON.stringify(body));
        return {...c.item,hitId,sourceRoute:c.route,authorization:grant.authorization,usage:'internal-only',expiresAt};});
      this.db.prepare('DELETE FROM task_memory_hits WHERE id IN (SELECT id FROM task_memory_hits WHERE grant_id=? ORDER BY rowid DESC LIMIT -1 OFFSET 128)').run(grantId);
      this.audit(agentId,taskId,'task.memory.recalled',{grantId,queryHash:hash(input.query),count:items.length,profile:retrieval.profile.hash});
      return {status:'ok',usage:'internal-only',taskId,grantId,profile:retrieval.profile.hash,items,scenes:stats,selectionRequired:true,rankKind:'scene-rank-interleave'};
    });
  }
  private hit(agentId:string,taskId:string,grantId:string,hitId:string){
    const grant=this.active(agentId,taskId,grantId),row=this.db.prepare('SELECT body,expires_at FROM task_memory_hits WHERE id=? AND grant_id=?').get(hitId,grantId);
    if(!row||Date.parse(text(row.expires_at))<=Date.now())throw new Error('task_hit_unavailable');
    const hit=hitSchema.parse(JSON.parse(text(row.body))),proof=hit.proof;
    if(proof.kind!=='memory'||hash(proof.authorization)!==hash(grant.authorization)||!this.tasks.validProof(agentId,proof))throw new Error('task_hit_unavailable');
    return {...hit,proof};
  }
  open(agentId:string,taskId:string,grantId:string,input:Parameters<TaskMemoryProvider['open']>[3]){
    return this.transaction(()=>{const hit=this.hit(agentId,taskId,grantId,input.hitId),memory=this.memory.read({agentId,route:hit.proof.route},hit.proof.id,'normal',hit.proof.revision,'internal');if(!memory)throw new Error('task_hit_unavailable');
      const points=Array.from(memory.content),end=Math.min(points.length,input.offset+input.limit);
      this.audit(agentId,taskId,'task.memory.opened',{grantId,hitId:input.hitId,offset:input.offset});
      return {status:'ok',usage:'internal-only',text:points.slice(input.offset,end).join(''),offset:input.offset,nextOffset:end<points.length?end:null,proof:hit.proof,sourceRoute:hit.proof.route};});
  }
  select(agentId:string,taskId:string,grantId:string,input:Parameters<TaskMemoryProvider['select']>[3]){
    return this.transaction(()=>{if(new Set(input.hitIds).size!==input.hitIds.length)throw new Error('duplicate_task_hit');
      const proofs=input.hitIds.map(id=>{const hit=this.hit(agentId,taskId,grantId,id);return {...hit.proof,range:{start:hit.start,end:hit.end}};});
      return this.tasks.selectAuthorized(agentId,taskId,input.requestId,input.expectedVersion,proofs);});
  }
}
