import type { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CapabilityObservationSchema,CapabilitySelectionSchema,ResourceProofSchema,ExecutionScopeSchema,RunOriginSchema,SourceDependencySchema,PersonaSourceRefSchema,redactJson,conversationKey } from '@dafeiyu/contracts';
import type { CapabilityObservationAccess,PersonaAccess,PersonaSourceRef,TimelineScope,MemoryAccessPurpose,Conversation } from '@dafeiyu/contracts';
import type { MemoryStore } from './store.js';
import { conservativeBoundary } from './boundary.js';
import { personaScope } from './persona-digest.js';
import { revisionSchema } from './types.js';

const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const textHash=(value:string)=>createHash('sha256').update(value).digest('hex');
const recordSchema=z.strictObject({schemaVersion:z.literal(1),kind:z.enum(['observed','selected']),scope:ExecutionScopeSchema,origin:RunOriginSchema,
  runId:z.uuid(),operationId:z.uuid(),producer:z.string(),proof:ResourceProofSchema,observedHash:z.string().length(64),occurredAt:z.iso.datetime(),
  counts:z.strictObject({received:z.number().int().nonnegative(),processed:z.number().int().nonnegative()}),coverage:z.array(z.string()),
  history:z.array(SourceDependencySchema).max(4096),parent:PersonaSourceRefSchema.nullable(),selection:z.strictObject({mode:z.enum(['original','fragment','summary']),outputHash:z.string().length(64)}).nullable(),
  rawRetained:z.literal(false)});
type RecordBody=z.infer<typeof recordSchema>;
type Validator=(scope:TimelineScope,body:RecordBody,access:PersonaAccess|undefined)=>boolean;
export function migrateCapabilityObservations(db:DatabaseSync):void {
  const version=Number(db.prepare('PRAGMA user_version').get()?.user_version);
  if(version===9||version===10||version===11){for(const table of ['capability_observations','capability_selections'])db.prepare(`SELECT * FROM ${table} LIMIT 0`).all();return;}
  if(version!==8)throw new Error('Unsupported capability observation database');
  db.exec(`CREATE TABLE capability_observations(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,scope_key TEXT NOT NULL,producer TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,body TEXT NOT NULL,content_hash TEXT NOT NULL,UNIQUE(agent_id,scope_key,producer,request_id));
    CREATE TABLE capability_selections(agent_id TEXT NOT NULL,scope_key TEXT NOT NULL,producer TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,receipt TEXT NOT NULL,PRIMARY KEY(agent_id,scope_key,producer,request_id));
    CREATE TRIGGER capability_observation_immutable BEFORE UPDATE ON capability_observations BEGIN SELECT RAISE(ABORT,'Immutable capability observation'); END;
    CREATE TRIGGER capability_observation_retain BEFORE DELETE ON capability_observations BEGIN SELECT RAISE(ABORT,'Retain capability provenance'); END;
    CREATE TRIGGER capability_selection_immutable BEFORE UPDATE ON capability_selections BEGIN SELECT RAISE(ABORT,'Immutable capability selection'); END;
    PRAGMA user_version=9;`);
  db.prepare('INSERT INTO memory_schema_migrations VALUES(9,?,0,?)').run(new Date().toISOString(),'add-scoped-capability-observations-without-raw-unselected-content-v1');
}

/** Observation receipts retain hashes/coverage. Only an explicit selection creates a memory item. */
export class CapabilityObservations {
  private validator:Validator|undefined;
  private access:PersonaAccess|undefined;
  private readonly checking=new Set<string>();
  constructor(private readonly db:DatabaseSync,private readonly memory:MemoryStore){}
  bind(validator:Validator):()=>void {if(this.validator)throw new Error('DUPLICATE_PROVIDER');this.validator=validator;return ()=>{if(this.validator===validator)this.validator=undefined;};}
  withAccess<T>(access:PersonaAccess,work:()=>T):T {access.guard();const old=this.access;this.access=access;try{return work();}finally{this.access=old;}}
  private scope(access:PersonaAccess){return {agentId:access.view.scope.agentId,route:personaScope(access.view.scope)};}
  private suppressed(scope:TimelineScope,proof:RecordBody['proof']):boolean {
    for(const row of this.db.prepare('SELECT r.body FROM memory_revisions r JOIN memory_items i ON i.id=r.id WHERE i.agent_id=? AND i.route=? AND i.deleted=1').iterate(scope.agentId,scope.route)){
      for(const source of revisionSchema.parse(JSON.parse(String(row.body))).sources){if(source.kind!=='capability')continue;
        const old=this.row(scope,source.ref.slice('dafeiyu:capability:'.length));
        if(old?.body.proof.provider===proof.provider&&old.body.proof.roots.some(root=>proof.roots.includes(root)))return true;
      }
    }
    return false;
  }
  private row(scope:TimelineScope,id:string){const row=this.db.prepare('SELECT body,content_hash FROM capability_observations WHERE id=? AND agent_id=? AND scope_key=?').get(id,scope.agentId,scope.route);
    if(!row)return null;const body=recordSchema.parse(JSON.parse(String(row.body)));if(digest(body)!==row.content_hash||personaScope(body.scope)!==scope.route||body.scope.agentId!==scope.agentId)return null;
    return {body,ref:PersonaSourceRefSchema.parse({kind:'execution-source',id,agentId:scope.agentId,scopeKey:scope.route,version:1,contentHash:row.content_hash})};}
  reference(scope:TimelineScope,id:string):PersonaSourceRef|null {return this.row(scope,id)?.ref??null;}
  valid(scope:TimelineScope,ref:PersonaSourceRef,exposedHash?:string):boolean {
    if(ref.kind!=='execution-source'||ref.agentId!==scope.agentId||ref.scopeKey!==scope.route||ref.version!==1||this.checking.has(ref.id)||this.checking.size>=128)return false;
    this.checking.add(ref.id);
    try {const row=this.row(scope,ref.id);return !!row&&row.ref.contentHash===ref.contentHash&&(exposedHash===undefined||row.body.observedHash===exposedHash)
      &&(!row.body.parent||this.valid(scope,row.body.parent))&&!!this.validator?.(scope,row.body,this.access);}
    catch{return false;}finally{this.checking.delete(ref.id);}
  }
  source(scope:TimelineScope,id:string,purpose:MemoryAccessPurpose) {
    const row=this.row(scope,id);if(!row||!this.valid(scope,row.ref))return null;
    const binding=row.body.scope.kind==='task'?{executionScope:row.body.scope}:{conversation:row.body.proof.scene,ingressPluginId:row.body.producer};
    if(row.body.scope.kind==='task'&&purpose!=='internal')return null;
    return {ref:row.ref,hash:row.ref.contentHash,version:1,deleted:false,boundary:conservativeBoundary(scope,'conservative-create',binding),body:row.body};
  }
  material(access:PersonaAccess,ref:PersonaSourceRef){return this.withAccess(access,()=>{const scope=this.scope(access),row=this.row(scope,ref.id);if(!row||!this.valid(scope,ref))return null;
    return {text:JSON.stringify(row.body),dependencies:row.body.parent?[row.body.parent]:[],rootSources:row.body.proof.roots};});}
  expressionView(access:PersonaAccess,ref:PersonaSourceRef,target:Conversation,view:string):{text:string;fence:string}|null{return this.withAccess(access,()=>{
    const scope=this.scope(access),row=this.row(scope,ref.id);if(!row||row.body.kind!=='observed'||conversationKey(scope.agentId,row.body.proof.scene)!==conversationKey(scope.agentId,target)
      ||!this.valid(scope,ref,textHash(view))||this.suppressed(scope,row.body.proof)||this.suppressed({agentId:scope.agentId,route:conversationKey(scope.agentId,target)},row.body.proof))return null;
    const versions=new Map<string,number>();for(const route of new Set([scope.route,conversationKey(scope.agentId,target)])){
      for(const memory of this.db.prepare('SELECT i.id,i.version,r.body FROM memory_items i JOIN memory_revisions r ON r.id=i.id WHERE i.agent_id=? AND i.route=?').iterate(scope.agentId,route)){
        for(const source of revisionSchema.parse(JSON.parse(String(memory.body))).sources){if(source.kind!=='capability')continue;const old=this.row({agentId:scope.agentId,route},source.ref.slice('dafeiyu:capability:'.length));
          if(old?.body.proof.provider===row.body.proof.provider&&old.body.proof.roots.some(root=>row.body.proof.roots.includes(root)))versions.set(String(memory.id),Number(memory.version));}
      }
    }return {text:view,fence:digest([...versions].sort(([a],[b])=>a.localeCompare(b)))};
  });}
  memoryMaterial(access:PersonaAccess,ref:PersonaSourceRef){if(ref.kind!=='memory'||ref.scopeKey!==personaScope(access.view.scope)||ref.authorization||ref.range||ref.selectionId)return null;
    return this.withAccess(access,()=>{const scope=this.scope(access),item=this.memory.read(scope,ref.id,'normal',ref.revision,access.view.scope.kind==='task'?'internal':'expression');
      if(!item||item.version!==ref.version||item.contentHash!==ref.contentHash)return null;
      const proofs=item.sources.filter(source=>source.kind==='capability').map(source=>this.reference(scope,source.ref.slice('dafeiyu:capability:'.length))).filter((value):value is PersonaSourceRef=>!!value);
      if(!proofs.length)return null;return {text:item.content,dependencies:proofs,rootSources:[...new Set(proofs.flatMap(proof=>this.row(scope,proof.id)?.body.proof.roots??[]))]};});}
  operationSources(access:PersonaAccess,operationId:string):PersonaSourceRef[]{return this.withAccess(access,()=>{
    const scope=this.scope(access);return this.db.prepare("SELECT id FROM capability_observations WHERE agent_id=? AND scope_key=? AND json_extract(body,'$.operationId')=?").all(scope.agentId,scope.route,operationId)
      .map(row=>this.reference(scope,String(row.id))).filter((ref):ref is PersonaSourceRef=>!!ref&&this.valid(scope,ref));});}
  private event(access:PersonaAccess,type:string,data:unknown){const id=randomUUID();this.db.prepare('INSERT INTO execution_memory_outbox(id,body) VALUES(?,?)').run(id,JSON.stringify({id,type,scope:access.view.scope,runId:access.view.runId,origin:access.view.origin,
    operationId:access.operationId,causedBy:access.startedEventId,producer:access.producer,at:new Date().toISOString(),data}));}
  private insert(access:PersonaAccess,requestId:string,fingerprint:string,body:RecordBody){const scope=this.scope(access),old=this.db.prepare('SELECT id,fingerprint FROM capability_observations WHERE agent_id=? AND scope_key=? AND producer=? AND request_id=?').get(scope.agentId,scope.route,access.producer,requestId);
    if(old){if(old.fingerprint!==fingerprint)throw new Error('IDEMPOTENCY_CONFLICT');return {source:this.reference(scope,String(old.id))!,duplicate:true};}
    const id=randomUUID();this.db.prepare('INSERT INTO capability_observations VALUES(?,?,?,?,?,?,?,?)').run(id,scope.agentId,scope.route,access.producer,requestId,fingerprint,JSON.stringify(body),digest(body));
    return {source:this.reference(scope,id)!,duplicate:false};}
  record(authority:CapabilityObservationAccess,input:z.output<typeof CapabilityObservationSchema>){const access=authority.execution;
    return this.withAccess(access,()=>this.memory.atomic(()=>{authority.guard();if(redactJson(input).redacted)throw new Error('PRIVATE_INPUT_REJECTED');
      const {text,...metadata}=input,body=recordSchema.parse({schemaVersion:1,kind:'observed',scope:access.view.scope,origin:access.view.origin,runId:access.view.runId,operationId:access.operationId,
        producer:access.producer,proof:input.proof,observedHash:textHash(text),occurredAt:input.occurredAt,counts:input.counts,coverage:input.coverage,history:[],parent:null,selection:null,rawRetained:false});
      const result=this.insert(access,'observe:'+input.requestId,digest({...metadata,observedHash:body.observedHash}),body);
      if(!result.duplicate)this.event(access,'capability.observation.prepared',{sourceId:result.source.id,counts:input.counts,exposure:'prepared-tool-result',rawRetained:false});
      authority.guard();return result;
    }));}
  select(authority:CapabilityObservationAccess,input:z.output<typeof CapabilitySelectionSchema>,actualView:string):Record<string,unknown> {
    const access=authority.execution,scope=this.scope(access);
    return this.withAccess(access,()=>this.memory.atomic(()=>{
      authority.guard();if(redactJson(z.json().parse(input)).redacted)throw new Error('PRIVATE_INPUT_REJECTED');
      const row=this.row(scope,input.observationId);if(!row||row.body.kind!=='observed'||row.body.producer!==access.producer||row.ref.version!==input.version||!this.valid(scope,row.ref)||row.body.observedHash!==textHash(actualView)
        ||conversationKey(scope.agentId,row.body.proof.scene)!==conversationKey(scope.agentId,authority.scene))throw new Error('SOURCE_STALE');
      const history=access.historyDependencies??[];
      if(!access.historyTracked||!history.some(dep=>(dep.kind==='capability'||dep.kind==='execution-source')&&digest(dep.ref)===digest(row.ref)))throw new Error('OBSERVATION_NOT_EXPOSED');
      if(input.mode==='summary'&&(history.some(dep=>['unavailable','legacy','ephemeral'].includes(dep.kind))||!access.validateHistory?.(history)))throw new Error('HISTORY_UNTRACKED');
      if(input.mode==='none'||input.mode==='original'){if(input.text!==undefined||input.start!==undefined||input.end!==undefined)throw new Error('INVALID_INPUT');}
      if(input.mode==='summary'&&(!input.text||input.start!==undefined||input.end!==undefined))throw new Error('INVALID_INPUT');
      const fingerprint=digest(input),prior=this.db.prepare('SELECT fingerprint,receipt FROM capability_selections WHERE agent_id=? AND scope_key=? AND producer=? AND request_id=?').get(scope.agentId,scope.route,access.producer,input.requestId);
      if(prior){if(prior.fingerprint!==fingerprint)throw new Error('IDEMPOTENCY_CONFLICT');return {...z.record(z.string(),z.json()).parse(JSON.parse(String(prior.receipt))),duplicate:true};}
      let memory:Record<string,unknown>|null=null;
      if(input.mode!=='none') {
        if(this.suppressed(scope,row.body.proof))throw new Error('SOURCE_SUPPRESSED');
        if(!row.body.counts.processed)throw new Error('EMPTY_OBSERVATION');
        let content=actualView;
        if(input.mode==='fragment'){const chars=Array.from(actualView);if(input.text!==undefined||input.start===undefined||input.end===undefined||input.start>=input.end||input.end>chars.length)throw new Error('INVALID_INPUT');content=chars.slice(input.start,input.end).join('');}
        else if(input.mode==='summary')content=input.text!;
        if(!content||content.length>8000)throw new Error('CAPACITY_EXCEEDED');
        const derived=recordSchema.parse({...row.body,kind:'selected',runId:access.view.runId,origin:access.view.origin,operationId:access.operationId,
          parent:row.ref,history:input.mode==='summary'?history:[],selection:{mode:input.mode,outputHash:textHash(content)}});
        const selected=this.insert(access,'selected:'+digest(input.requestId),fingerprint,derived).source;
        memory=this.memory.mutate({agentId:scope.agentId,route:scope.route,traceId:access.view.origin.kind==='message'?access.view.origin.inboundId:access.view.runId,operationId:access.operationId,startedEventId:access.startedEventId!},
          {action:'create',requestId:'capability:'+digest([access.producer,input.requestId]),value:{kind:'experience',claimType:input.mode==='summary'?'inference':'reported_claim',content,
            sources:[{kind:'capability',ref:`dafeiyu:capability:${selected.id}`,version:1,contentHash:selected.contentHash}]}},
          access.view.scope.kind==='task'?{executionScope:access.view.scope}:{conversation:authority.scene,ingressPluginId:access.producer});
      }
      const receipt={observationId:row.ref.id,mode:input.mode,memory,duplicate:false,exposure:'verified-current-request'};
      this.db.prepare('INSERT INTO capability_selections VALUES(?,?,?,?,?,?)').run(scope.agentId,scope.route,access.producer,input.requestId,fingerprint,JSON.stringify(receipt));
      this.event(access,'capability.observation.selected',{sourceId:row.ref.id,mode:input.mode,memoryId:memory?.id??null});authority.guard();return receipt;
    }));
  }
}
