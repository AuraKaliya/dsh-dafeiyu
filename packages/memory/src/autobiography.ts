import type {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {EpisodeStartSchema,EpisodeOperationSchema,ReflectionInputSchema,SelfUnderstandingInputSchema,ContextItemSchema,redactJson} from '@dafeiyu/contracts';
import type {ExperienceMemoryPort,ExecutionScope,PersonaAccess,PersonaSourceRef,PreparedPersona,PreparedPersonaEntry,Json,PersonaSnapshot} from '@dafeiyu/contracts';
import {personaScope,personaDigest} from './persona-digest.js';

const reflectionSchema=ReflectionInputSchema.extend({episodeId:z.uuid(),id:z.uuid(),scope: z.string(),version:z.literal(1),at:z.iso.datetime()});
const understandingSchema=SelfUnderstandingInputSchema.extend({id:z.uuid(),scope:z.literal('self'),version:z.number().int().positive(),at:z.iso.datetime()});

/** Memory owns both the experienced facts and the Agent's explicitly retained interpretations. */
export class Autobiography implements ExperienceMemoryPort {
  constructor(private readonly db:DatabaseSync,private readonly atomic:<T>(work:()=>T)=>T,private readonly agentId:string){}
  foundation(seed:PersonaSnapshot&{fileIdentity:string}) {
    return this.atomic(()=>{
      const existing=this.db.prepare('SELECT body FROM memory_seed WHERE agent_id=?').get(this.agentId);
      if(existing)return z.object({text:z.string(),version:z.string(),fileIdentity:z.string()}).parse(JSON.parse(String(existing.body)));
      const body={text:seed.text,version:createHash('sha256').update(seed.text).digest('hex'),fileIdentity:seed.fileIdentity};
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
      this.db.prepare('INSERT INTO memory_episode_events VALUES(?,?,?)').run(value.id,value.episodeId,body);
    });
  }
  settle(id:string,state:string){z.uuid().parse(id);z.enum(['completed','waiting','failed','cancelled','interrupted']).parse(state);
    this.db.prepare('UPDATE memory_episodes SET state=? WHERE id=? AND agent_id=?').run(state,id,this.agentId);}
  private episode(scope:ExecutionScope,id:string){
    const row=this.db.prepare('SELECT * FROM memory_episodes WHERE id=? AND agent_id=? AND scope_key=?').get(z.uuid().parse(id),this.agentId,personaScope(scope));
    if(!row)throw new Error('SCOPE_DENIED');return row;
  }
  read(scope:ExecutionScope,id:string){const row=this.episode(scope,id);return {episode:JSON.parse(String(row.body)),state:row.state,reflection:row.reflection,
    thoughts:this.db.prepare('SELECT body FROM memory_reflections WHERE episode_id=? ORDER BY rowid').all(id).map(item=>reflectionSchema.parse(JSON.parse(String(item.body)))),
    events:this.db.prepare('SELECT body FROM memory_episode_events WHERE episode_id=? ORDER BY rowid').all(id).map(item=>JSON.parse(String(item.body)) as Json)};}
  pending(scope:ExecutionScope):Json[]{return this.db.prepare("SELECT id,body,state FROM memory_episodes WHERE agent_id=? AND scope_key=? AND reflection='pending' ORDER BY rowid DESC LIMIT 8")
    .all(this.agentId,personaScope(scope)).map(row=>({id:String(row.id),state:String(row.state),goal:EpisodeStartSchema.parse(JSON.parse(String(row.body))).goal,note:'尚未留下自己的看法；需要时回顾实际经历，不补造感受。'}));}
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
    const body=reflectionSchema.parse(JSON.parse(String(row.body)));if(personaDigest(body)!==row.body_hash)throw new Error('MEMORY_CORRUPT');this.episode(access.view.scope,body.episodeId);return body;
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
    const body=understandingSchema.parse(JSON.parse(String(row.body)));if(personaDigest(body)!==row.body_hash)throw new Error('MEMORY_CORRUPT');return body;});}
  status(){return this.selected().map(body=>({id:body.id,version:body.version,text:body.text,applicability:body.applicability,uncertainty:body.uncertainty}));}
  reference(body:ReturnType<Autobiography['selected']>[number]):PersonaSourceRef{return {kind:'memory',collection:'autobiography',agentId:this.agentId,scopeKey:'self:'+this.agentId,id:body.id,revision:body.version,version:body.version,contentHash:personaDigest(body)};}
  material(ref:PersonaSourceRef){if(ref.kind!=='memory'||ref.collection!=='autobiography'||ref.agentId!==this.agentId||ref.scopeKey!=='self:'+this.agentId)return null;
    const body=this.selected().find(row=>row.id===ref.id&&row.version===ref.version&&row.version===ref.revision&&personaDigest(row)===ref.contentHash);
    return body?{text:JSON.stringify({kind:'self-understanding',text:body.text,applicability:body.applicability,uncertainty:body.uncertainty}),dependencies:[] as PersonaSourceRef[],rootSources:['self-memory:'+body.id]}:null;}
  validEntry(entry:PreparedPersonaEntry){
    const ref=entry.contentRef;if(ref.kind!=='memory'||ref.collection!=='autobiography'||ref.agentId!==this.agentId||entry.memory.id!==ref.id||entry.memory.version!==ref.version)return false;
    const row=this.db.prepare('SELECT r.body,r.body_hash FROM memory_self h JOIN memory_self_revisions r ON r.id=h.id WHERE h.id=? AND h.agent_id=? AND h.active=1 AND r.version=?').get(ref.id,this.agentId,ref.version);
    if(!row||row.body_hash!==ref.contentHash)return false;
    const body=understandingSchema.parse(JSON.parse(String(row.body))),text=JSON.stringify({kind:'self-understanding',text:body.text,applicability:body.applicability,uncertainty:body.uncertainty});
    return personaDigest(body)===row.body_hash&&entry.item.text===text&&entry.dependencies.length===0;
  }
  prepare():PreparedPersona {const rows=this.selected(),entries=rows.map(body=>{const contentRef=this.reference(body),material=this.material(contentRef)!;
    return {memory:{id:body.id,version:body.version},contentRef,dependencies:[] as PersonaSourceRef[],item:ContextItemSchema.parse({id:'self-memory:'+body.id,version:String(body.version),text:material.text,expiresAt:'9999-12-31T23:59:59.999Z',sources:[{ref:'dafeiyu:memory:'+body.id+':'+body.version,version:String(body.version),hash:contentRef.contentHash}]})};});
    const revision=rows.reduce((sum,row)=>sum+row.version,0);return {stageRevision:revision,selectionVersion:revision,entries,omitted:0};}
}

export function createAutobiographySchema(db:DatabaseSync){db.exec(`
  CREATE TABLE memory_seed(agent_id TEXT PRIMARY KEY,body TEXT NOT NULL);
  CREATE TABLE memory_episodes(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,scope_key TEXT NOT NULL,body TEXT NOT NULL,started_at TEXT NOT NULL,state TEXT NOT NULL,reflection TEXT NOT NULL);
  CREATE INDEX memory_episodes_scope ON memory_episodes(agent_id,scope_key);
  CREATE TABLE memory_episode_events(id TEXT PRIMARY KEY,episode_id TEXT NOT NULL REFERENCES memory_episodes(id),body TEXT NOT NULL);
  CREATE TABLE memory_reflections(id TEXT PRIMARY KEY,episode_id TEXT NOT NULL REFERENCES memory_episodes(id),request_id TEXT NOT NULL,body TEXT NOT NULL,body_hash TEXT NOT NULL,UNIQUE(episode_id,request_id));
  CREATE TABLE memory_self(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,version INTEGER NOT NULL,active INTEGER NOT NULL);
  CREATE TABLE memory_self_revisions(id TEXT NOT NULL,agent_id TEXT NOT NULL,version INTEGER NOT NULL,request_id TEXT NOT NULL,body TEXT NOT NULL,body_hash TEXT NOT NULL,PRIMARY KEY(id,version),UNIQUE(agent_id,request_id));
`);}
