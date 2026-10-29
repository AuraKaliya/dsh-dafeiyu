import type {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {EpisodeStartSchema,EpisodeOperationSchema,ReflectionInputSchema,SelfUnderstandingInputSchema,ContextItemSchema,redactJson} from '@dafeiyu/contracts';
import type {ExperienceMemoryPort,ExecutionScope,PersonaAccess,PersonaSourceRef,PreparedPersona,PreparedPersonaEntry,Json,PersonaSnapshot,ContextItem,SourceDependency} from '@dafeiyu/contracts';
import {personaScope,personaDigest} from './persona-digest.js';

const reflectionSchema=ReflectionInputSchema.extend({episodeId:z.uuid(),id:z.uuid(),scope: z.string(),version:z.literal(1),at:z.iso.datetime()});
const understandingSchema=SelfUnderstandingInputSchema.extend({id:z.uuid(),scope:z.literal('self'),version:z.number().int().positive(),at:z.iso.datetime()});

/** Memory owns both the experienced facts and the Agent's explicitly retained interpretations. */
export class Autobiography implements ExperienceMemoryPort {
  constructor(private readonly db:DatabaseSync,private readonly atomic:<T>(work:()=>T)=>T,private readonly agentId:string,private readonly originCurrent:(origin:import('@dafeiyu/contracts').RunOrigin)=>boolean=()=>true){}
  managementExperience(raw:unknown){const {id}=z.strictObject({id:z.uuid()}).parse(raw),episode=this.db.prepare('SELECT body,state FROM memory_episodes WHERE id=? AND agent_id=?').get(id,this.agentId);if(!episode)return null;return {episode:EpisodeStartSchema.parse(JSON.parse(String(episode.body))),state:String(episode.state),reflections:this.db.prepare('SELECT body FROM memory_reflections WHERE episode_id=? ORDER BY rowid DESC LIMIT 50').all(id).map(row=>{const body=reflectionSchema.parse(JSON.parse(String(row.body)));return {...body,...this.reflectionState(body.id)};})};}
  management(){const seed=this.db.prepare('SELECT body FROM memory_seed WHERE agent_id=?').get(this.agentId);return {foundation:seed?z.object({text:z.string(),version:z.string()}).parse(JSON.parse(String(seed.body))):null,self:this.selected(),reflections:this.db.prepare('SELECT r.body FROM memory_reflections r JOIN memory_episodes e ON e.id=r.episode_id WHERE e.agent_id=? ORDER BY r.rowid DESC LIMIT 100').all(this.agentId).map(row=>{const body=reflectionSchema.parse(JSON.parse(String(row.body))),state=this.reflectionState(body.id);return {...body,...state};})};}
  private reflectionState(id:string){const row=this.db.prepare('SELECT version,deleted FROM memory_reflection_state WHERE id=?').get(id);return {stateVersion:row?Number(row.version):0,deleted:!!row?.deleted};}
  private basisAvailable(body:z.output<typeof understandingSchema>){return body.reflections.every(id=>!this.reflectionState(id).deleted);}
  manageReflection(raw:unknown){const input=z.strictObject({id:z.uuid(),expectedVersion:z.number().int().nonnegative(),deleted:z.boolean(),requestId:z.uuid(),reason:z.string().min(1).max(500)}).parse(raw);return this.atomic(()=>{const existing=this.db.prepare('SELECT 1 FROM memory_reflections r JOIN memory_episodes e ON r.episode_id=e.id WHERE r.id=? AND e.agent_id=?').get(input.id,this.agentId);if(!existing)throw new Error('MEMORY_NOT_FOUND');const previous=this.db.prepare('SELECT * FROM memory_reflection_state WHERE id=?').get(input.id);if(previous?.request_id===input.requestId){if(!!previous.deleted!==input.deleted||previous.reason!==input.reason)throw new Error('IDEMPOTENCY_CONFLICT');return this.reflectionState(input.id);}if(this.reflectionState(input.id).stateVersion!==input.expectedVersion)throw new Error('MANAGEMENT_REVISION_CONFLICT');this.db.prepare('INSERT INTO memory_reflection_state VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,deleted=excluded.deleted,request_id=excluded.request_id,reason=excluded.reason').run(input.id,input.expectedVersion+1,Number(input.deleted),input.requestId,input.reason);return this.reflectionState(input.id);});}
  foundation(loadSeed:()=>PersonaSnapshot&{fileIdentity:string}) {
    return this.atomic(()=>{
      const existing=this.db.prepare('SELECT body FROM memory_seed WHERE agent_id=?').get(this.agentId);
      if(existing){const saved=z.object({text:z.string(),version:z.string(),fileIdentity:z.string()}).parse(JSON.parse(String(existing.body)));if(createHash('sha256').update(saved.text).digest('hex')!==saved.version)throw new Error('MEMORY_CORRUPT');return saved;}
      const seed=loadSeed(),body={text:seed.text,version:createHash('sha256').update(seed.text).digest('hex'),fileIdentity:seed.fileIdentity};
      this.db.prepare('INSERT INTO memory_seed VALUES(?,?)').run(this.agentId,JSON.stringify(body));return body;
    });
  }
  begin(raw:Parameters<ExperienceMemoryPort['begin']>[0]) {
    const value=EpisodeStartSchema.parse(raw);if(value.scope.agentId!==this.agentId)throw new Error('SCOPE_DENIED');
    const body=redactJson(z.json().parse(value)).value,scope=personaScope(value.scope);
    this.atomic(()=>{const old=this.db.prepare('SELECT body FROM memory_episodes WHERE id=?').get(value.id);
      if(old){if(personaDigest(JSON.parse(String(old.body)))!==personaDigest(body))throw new Error('EPISODE_CONFLICT');return;}
      this.db.prepare("INSERT INTO memory_episodes VALUES(?,?,?,?,?,'running','pending')").run(value.id,this.agentId,scope,JSON.stringify(body),value.at);
    });
  }
  operation(raw:Parameters<ExperienceMemoryPort['operation']>[0]) {
    const value=EpisodeOperationSchema.parse(raw),episode=this.db.prepare('SELECT agent_id FROM memory_episodes WHERE id=?').get(value.episodeId);
    if(!episode||episode.agent_id!==this.agentId)throw new Error('EPISODE_REQUIRED');
    const body=JSON.stringify(redactJson(z.json().parse(value)).value);
    this.atomic(()=>{const prior=this.db.prepare('SELECT body FROM memory_episode_events WHERE id=?').get(value.id);
      if(prior){if(prior.body!==body)throw new Error('EPISODE_EVENT_CONFLICT');return;}
      this.db.prepare('INSERT INTO memory_episode_events VALUES(?,?,?,?)').run(value.id,value.episodeId,body,personaDigest(JSON.parse(body)));
    });
  }
  settle(id:string,state:string){z.uuid().parse(id);z.enum(['completed','waiting','failed','cancelled','interrupted']).parse(state);
    this.db.prepare('UPDATE memory_episodes SET state=? WHERE id=? AND agent_id=?').run(state,id,this.agentId);}
  private episode(scope:ExecutionScope,id:string){
    if(scope.agentId!==this.agentId)throw new Error('SCOPE_DENIED');
    const row=this.db.prepare('SELECT * FROM memory_episodes WHERE id=? AND agent_id=? AND scope_key=?').get(z.uuid().parse(id),this.agentId,personaScope(scope));
    if(!row)throw new Error('SCOPE_DENIED');if(!this.originCurrent(EpisodeStartSchema.parse(JSON.parse(String(row.body))).origin))throw new Error('SOURCE_STALE');return row;
  }
  read(scope:ExecutionScope,id:string){const row=this.episode(scope,id),episode=EpisodeStartSchema.parse(JSON.parse(String(row.body)));return {untrustedEvidence:true,episode:{...episode,goal:episode.goal.slice(0,600)},state:row.state,reflection:row.reflection,
    thoughts:this.db.prepare('SELECT body,body_hash FROM memory_reflections WHERE episode_id=? ORDER BY rowid DESC LIMIT 8').all(id).filter(item=>!this.reflectionState(reflectionSchema.parse(JSON.parse(String(item.body))).id).deleted).map(item=>{const body=reflectionSchema.parse(JSON.parse(String(item.body)));if(personaDigest(body)!==item.body_hash)throw new Error('MEMORY_CORRUPT');return {id:body.id,at:body.at,thought:body.thought.slice(0,300),coverage:'excerpt',read:{episodeId:id,reflectionId:body.id,offset:0}};}),
    events:this.db.prepare('SELECT body,body_hash FROM memory_episode_events WHERE episode_id=? ORDER BY rowid DESC LIMIT 32').all(id).map(item=>{const body=EpisodeOperationSchema.parse(JSON.parse(String(item.body)));if(personaDigest(body)!==item.body_hash)throw new Error('MEMORY_CORRUPT');return {id:body.id,action:body.action,status:body.outcome.status,effects:body.outcome.effects,completeness:body.outcome.completeness,read:{episodeId:id,eventId:body.id,offset:0}};}),
    coverage:'bounded-index',note:'索引是当时的操作报告和自己的看法；通过read按需读取原内容，不从索引补造未读内容。'};}
  readPart(scope:ExecutionScope,episodeId:string,kind:'event'|'reflection',id:string,offset=0,limit=4000){
    this.episode(scope,episodeId);z.uuid().parse(id);if(kind==='reflection'&&this.reflectionState(id).deleted)throw new Error('SOURCE_STALE');z.number().int().nonnegative().parse(offset);z.number().int().min(1).max(8000).parse(limit);
    const table=kind==='event'?'memory_episode_events':'memory_reflections',row=this.db.prepare(`SELECT body,body_hash FROM ${table} WHERE id=? AND episode_id=?`).get(id,episodeId);
    if(!row)throw new Error('SOURCE_STALE');const body=JSON.parse(String(row.body));if(personaDigest(body)!==row.body_hash)throw new Error('MEMORY_CORRUPT');
    const chars=Array.from(String(row.body));if(offset>chars.length)throw new Error('INVALID_INPUT');const end=Math.min(chars.length,offset+limit);
    return {untrustedEvidence:true,id,kind,episodeId,text:chars.slice(offset,end).join(''),offset,nextOffset:end<chars.length?end:null,total:chars.length,complete:offset===0&&end===chars.length,hash:String(row.body_hash)};
  }
  pending(scope:ExecutionScope):Json[]{if(scope.agentId!==this.agentId)throw new Error('SCOPE_DENIED');return this.db.prepare("SELECT id,body,state FROM memory_episodes WHERE agent_id=? AND scope_key=? AND reflection='pending' ORDER BY rowid DESC LIMIT 8")
    .all(this.agentId,personaScope(scope)).filter(row=>this.originCurrent(EpisodeStartSchema.parse(JSON.parse(String(row.body))).origin)).map(row=>({id:String(row.id),state:String(row.state),goal:EpisodeStartSchema.parse(JSON.parse(String(row.body))).goal.slice(0,600),note:'查询时尚未留下自己的看法；需要时回顾实际经历，不补造感受。'}));}
  recover(){this.db.prepare("UPDATE memory_episodes SET state='interrupted' WHERE agent_id=? AND state='running'").run(this.agentId);}
  context(scope:ExecutionScope,exclude:{runId?:string;inboundId?:string}={}):ContextItem[]{
    if(scope.agentId!==this.agentId)throw new Error('SCOPE_DENIED');
    const pending=this.pending(scope).filter(value=>{const row=z.object({id:z.string()}).parse(value);if(row.id===exclude.runId)return false;if(!exclude.inboundId)return true;const episode=EpisodeStartSchema.parse(JSON.parse(String(this.episode(scope,row.id).body)));return episode.origin.kind!=='message'||episode.origin.inboundId!==exclude.inboundId;});
    if(!pending.length)return [];const id=randomUUID(),text=JSON.stringify({kind:'unreflected-experience-index',observedAt:new Date().toISOString(),pending,note:'这是准备本轮时的记忆索引；不是当前进度保证，也不是必须立即执行的新任务。'});
    const item=ContextItemSchema.parse({id:'experience-index:'+id,version:'1',text,expiresAt:'9999-12-31T23:59:59.999Z',sources:[{ref:'dafeiyu:experience-index:'+id,version:'1',hash:personaDigest(text)}]});
    this.db.prepare('INSERT INTO memory_context_snapshots VALUES(?,?,?,?,?)').run(id,this.agentId,personaScope(scope),JSON.stringify(item),personaDigest(item));return [item];
  }
  contextCurrent(scope:ExecutionScope,item:ContextItem){const id=item.id.slice('experience-index:'.length);if(scope.agentId!==this.agentId||!item.id.startsWith('experience-index:'))return false;
    const row=this.db.prepare('SELECT body,body_hash FROM memory_context_snapshots WHERE id=? AND agent_id=? AND scope_key=?').get(id,this.agentId,personaScope(scope));
    if(!row||personaDigest(JSON.parse(String(row.body)))!==row.body_hash||personaDigest(item)!==row.body_hash)return false;
    try{const index=z.object({pending:z.array(z.object({id:z.uuid()}))}).parse(JSON.parse(item.text));return index.pending.every(entry=>!!this.episode(scope,entry.id));}catch{return false;}
  }
  contextHistorical(scope:ExecutionScope,dependency:Extract<SourceDependency,{kind:'context'}>){
    const id=dependency.id.slice('experience-index:'.length);if(scope.agentId!==this.agentId||!dependency.id.startsWith('experience-index:'))return false;const row=this.db.prepare('SELECT body FROM memory_context_snapshots WHERE id=? AND agent_id=? AND scope_key=?').get(id,this.agentId,personaScope(scope));if(!row)return false;
    const item=ContextItemSchema.parse(JSON.parse(String(row.body)));return this.contextCurrent(scope,item)&&item.version===dependency.version&&createHash('sha256').update(JSON.stringify([item.text,item.sources])).digest('hex')===dependency.hash;
  }
  reflect(access:PersonaAccess,raw:unknown){access.guard();const input=ReflectionInputSchema.parse(raw),episodeId=input.episodeId??access.view.runId;
    this.episode(access.view.scope,episodeId);
    return this.atomic(()=>{
      const old=this.db.prepare('SELECT id,body FROM memory_reflections WHERE episode_id=? AND request_id=?').get(episodeId,input.requestId);
      if(old){const body=reflectionSchema.parse(JSON.parse(String(old.body)));if(personaDigest({...input,episodeId})!==personaDigest({requestId:body.requestId,episodeId:body.episodeId,thought:body.thought,uncertainty:body.uncertainty,next:body.next,basis:body.basis}))throw new Error('IDEMPOTENCY_CONFLICT');return {id:String(old.id),version:1};}
      for(const event of input.basis)if(!this.db.prepare('SELECT 1 FROM memory_episode_events WHERE id=? AND episode_id=?').get(event,episodeId))throw new Error('SOURCE_NOT_EXPOSED');
      if(redactJson(z.json().parse(input)).redacted)throw new Error('PRIVATE_INPUT_REJECTED');
      const body=reflectionSchema.parse({...input,episodeId,id:randomUUID(),scope:personaScope(access.view.scope),version:1,at:new Date().toISOString()});
      this.db.prepare('INSERT INTO memory_reflections VALUES(?,?,?,?,?)').run(body.id,episodeId,input.requestId,JSON.stringify(body),personaDigest(body));
      this.db.prepare("UPDATE memory_episodes SET reflection='recorded' WHERE id=?").run(episodeId);access.guard();return {id:body.id,version:1};
    });
  }
  reflections(access:PersonaAccess,ids:readonly string[]){access.guard();return ids.map(id=>{
    const row=this.db.prepare('SELECT body,body_hash FROM memory_reflections WHERE id=?').get(z.uuid().parse(id));if(!row)throw new Error('SOURCE_STALE');
    const body=reflectionSchema.parse(JSON.parse(String(row.body)));if(this.reflectionState(body.id).deleted)throw new Error('SOURCE_STALE');if(personaDigest(body)!==row.body_hash)throw new Error('MEMORY_CORRUPT');this.episode(access.view.scope,body.episodeId);return body;
  });}
  understand(access:PersonaAccess,raw:unknown,approvedHash:string){access.guard();const input=SelfUnderstandingInputSchema.parse(raw),basis=this.reflections(access,input.reflections);
    if(approvedHash!==personaDigest({input,basis}))throw new Error('SELF_VIEW_NOT_REVIEWED');
    return this.atomic(()=>{
      const repeated=this.db.prepare('SELECT id,body FROM memory_self_revisions WHERE agent_id=? AND request_id=?').get(this.agentId,input.requestId);
      if(repeated){const body=understandingSchema.parse(JSON.parse(String(repeated.body)));if(personaDigest({...input,id:body.id})!==personaDigest({requestId:body.requestId,id:body.id,expectedVersion:body.expectedVersion,text:body.text,applicability:body.applicability,uncertainty:body.uncertainty,reflections:body.reflections}))throw new Error('IDEMPOTENCY_CONFLICT');return {id:body.id,version:body.version};}
      const id=input.id??randomUUID(),head=this.db.prepare('SELECT version FROM memory_self WHERE id=? AND agent_id=?').get(id,this.agentId);
      if((head?Number(head.version):0)!==input.expectedVersion||!head&&input.id)throw new Error('VERSION_CONFLICT');
      const body=understandingSchema.parse({...input,id,scope:'self',version:input.expectedVersion+1,at:new Date().toISOString()});
      this.db.prepare('INSERT INTO memory_self_revisions VALUES(?,?,?,?,?,?)').run(id,this.agentId,body.version,input.requestId,JSON.stringify(body),personaDigest(body));
      this.db.prepare('INSERT INTO memory_self VALUES(?,?,?,1) ON CONFLICT(id) DO UPDATE SET version=excluded.version,active=1').run(id,this.agentId,body.version);(access.commitGuard??access.guard)();return {id,version:body.version};
    });
  }
  withdraw(access:PersonaAccess,id:string,version:number){access.guard();if(this.db.prepare('UPDATE memory_self SET active=0 WHERE id=? AND agent_id=? AND version=? AND active=1').run(z.uuid().parse(id),this.agentId,version).changes!==1)throw new Error('VERSION_CONFLICT');return {id,version,active:false};}
  private selected(){return this.db.prepare('SELECT r.body,r.body_hash FROM memory_self h JOIN memory_self_revisions r ON h.id=r.id AND h.version=r.version WHERE h.agent_id=? AND h.active=1 ORDER BY h.rowid').all(this.agentId).map(row=>{
    const body=understandingSchema.parse(JSON.parse(String(row.body)));if(personaDigest(body)!==row.body_hash)throw new Error('MEMORY_CORRUPT');return body;}).filter(body=>this.basisAvailable(body));}
  status(){return this.selected().map(body=>({id:body.id,version:body.version,text:body.text,applicability:body.applicability,uncertainty:body.uncertainty}));}
  reference(body:ReturnType<Autobiography['selected']>[number]):PersonaSourceRef{return {kind:'memory',collection:'autobiography',agentId:this.agentId,scopeKey:'self:'+this.agentId,id:body.id,revision:body.version,version:body.version,contentHash:personaDigest(body)};}
  material(ref:PersonaSourceRef){const entry=this.entry(ref);return entry?{text:entry.item.text,dependencies:[] as PersonaSourceRef[],rootSources:['self-memory:'+ref.id]}:null;}
  private projected(body:z.output<typeof understandingSchema>):PreparedPersonaEntry {const contentRef=this.reference(body),text=JSON.stringify({kind:'self-understanding',text:body.text,applicability:body.applicability,uncertainty:body.uncertainty,recordedAt:body.at,note:'这是该次修订时明确保存的自我认识；更新或撤下以之后的记忆记录为准。'});
    return {memory:{id:body.id,version:body.version},contentRef,dependencies:[],item:ContextItemSchema.parse({id:'self-memory:'+body.id,version:String(body.version),text,expiresAt:'9999-12-31T23:59:59.999Z',sources:[{ref:'dafeiyu:memory:'+body.id+':'+body.version,version:String(body.version),hash:contentRef.contentHash}]})};}
  entry(ref:PersonaSourceRef):PreparedPersonaEntry|null {
    if(ref.kind!=='memory'||ref.collection!=='autobiography'||ref.agentId!==this.agentId||ref.scopeKey!=='self:'+this.agentId||ref.version!==ref.revision)return null;
    const row=this.db.prepare('SELECT body,body_hash FROM memory_self_revisions WHERE id=? AND agent_id=? AND version=?').get(ref.id,this.agentId,ref.version);if(!row||row.body_hash!==ref.contentHash)return null;
    const body=understandingSchema.parse(JSON.parse(String(row.body)));if(!this.basisAvailable(body)||!this.db.prepare('SELECT 1 FROM memory_self WHERE id=? AND agent_id=? AND active=1').get(ref.id,this.agentId)||personaDigest(body)!==row.body_hash)return null;return this.projected(body);
  }
  validEntry(entry:PreparedPersonaEntry){
    const ref=entry.contentRef;if(ref.kind!=='memory'||ref.collection!=='autobiography'||ref.agentId!==this.agentId||entry.memory.id!==ref.id||entry.memory.version!==ref.version)return false;
    const saved=this.entry(ref);return !!saved&&personaDigest(saved)===personaDigest(entry);
  }
  historical(dependency:Extract<SourceDependency,{kind:'context'}>){if(!dependency.id.startsWith('self-memory:'))return false;
    const row=this.db.prepare('SELECT body,body_hash FROM memory_self_revisions WHERE id=? AND agent_id=? AND version=?').get(dependency.id.slice('self-memory:'.length),this.agentId,Number(dependency.version));if(!row)return false;
    const body=understandingSchema.parse(JSON.parse(String(row.body)));if(!this.basisAvailable(body)||!this.db.prepare('SELECT 1 FROM memory_self WHERE id=? AND agent_id=? AND active=1').get(body.id,this.agentId)||personaDigest(body)!==row.body_hash)return false;const entry=this.projected(body);return createHash('sha256').update(JSON.stringify([entry.item.text,entry.item.sources])).digest('hex')===dependency.hash;
  }
  prepare():PreparedPersona {const rows=this.selected(),entries=rows.map(body=>this.projected(body));
    const revision=rows.reduce((sum,row)=>sum+row.version,0);return {stageRevision:revision,selectionVersion:revision,entries,omitted:0};}
}

export function createAutobiographySchema(db:DatabaseSync){db.exec(`
  CREATE TABLE memory_seed(agent_id TEXT PRIMARY KEY,body TEXT NOT NULL);
  CREATE TABLE memory_episodes(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,scope_key TEXT NOT NULL,body TEXT NOT NULL,started_at TEXT NOT NULL,state TEXT NOT NULL,reflection TEXT NOT NULL);
  CREATE INDEX memory_episodes_scope ON memory_episodes(agent_id,scope_key);
  CREATE TABLE memory_episode_events(id TEXT PRIMARY KEY,episode_id TEXT NOT NULL REFERENCES memory_episodes(id),body TEXT NOT NULL,body_hash TEXT NOT NULL);
  CREATE TABLE memory_reflections(id TEXT PRIMARY KEY,episode_id TEXT NOT NULL REFERENCES memory_episodes(id),request_id TEXT NOT NULL,body TEXT NOT NULL,body_hash TEXT NOT NULL,UNIQUE(episode_id,request_id));
  CREATE TABLE memory_reflection_state(id TEXT PRIMARY KEY REFERENCES memory_reflections(id),version INTEGER NOT NULL,deleted INTEGER NOT NULL,request_id TEXT NOT NULL,reason TEXT NOT NULL);
  CREATE TABLE memory_self(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,version INTEGER NOT NULL,active INTEGER NOT NULL);
  CREATE TABLE memory_self_revisions(id TEXT NOT NULL,agent_id TEXT NOT NULL,version INTEGER NOT NULL,request_id TEXT NOT NULL,body TEXT NOT NULL,body_hash TEXT NOT NULL,PRIMARY KEY(id,version),UNIQUE(agent_id,request_id));
  CREATE TABLE memory_context_snapshots(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,scope_key TEXT NOT NULL,body TEXT NOT NULL,body_hash TEXT NOT NULL);
  CREATE TRIGGER memory_episode_identity BEFORE UPDATE OF id,agent_id,scope_key,body,started_at ON memory_episodes BEGIN SELECT RAISE(ABORT,'Immutable episode identity');END;
`);
  for(const table of ['memory_seed','memory_episode_events','memory_reflections','memory_self_revisions','memory_context_snapshots'])db.exec(`CREATE TRIGGER ${table}_immutable BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Immutable memory fact');END;CREATE TRIGGER ${table}_retain BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Retain memory fact');END;`);
}
