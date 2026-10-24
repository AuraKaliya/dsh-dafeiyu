import { createHash,randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { MemoryBoundarySchema,boundaryAllows,redactContent,redactJson,ObservationStoredReceiptSchema } from '@dafeiyu/contracts';
import type { ObservationAuthority,MemoryObservation,ObservationReceipt,MemoryAccessPurpose,TimelineScope,OperationScope } from '@dafeiyu/contracts';
import type { NewEvent } from '@dafeiyu/journal';
import type { MemoryStore } from './store.js';
import { conservativeBoundary,restrictBoundary,boundaryDigest } from './boundary.js';
import { MemoryError } from './types.js';

const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
const text=(v:unknown)=>z.string().parse(v),number=(v:unknown)=>z.number().int().safe().parse(v);
const sourceSchema=z.strictObject({key:z.string(),producerVersion:z.string(),occurredAt:z.string(),retention:z.enum(['text','digest']),text:z.string().nullable(),hash:z.string().regex(/^[a-f0-9]{64}$/),boundary:MemoryBoundarySchema,taskWorkId:z.uuid().optional()})
  .refine(v=>v.retention==='text'?v.text!==null&&digest(v.text)===v.hash:v.text===null,'Invalid retained source body');
export const observationSourceRef=(id:string)=>`dafeiyu:observation-source:${id}`;
const sourceId=(ref:string)=>z.uuid().parse(/^dafeiyu:observation-source:(.+)$/.exec(ref)?.[1]);
export function migrateObservations(db:DatabaseSync):void {
  const version=db.prepare('PRAGMA user_version').get()?.user_version;
  if(version===3||version===4||version===5||version===6||version===7||version===8){for(const table of ['observation_sources','observation_activities','observation_contributions','observation_source_requests'])db.prepare(`SELECT * FROM ${table} LIMIT 0`).all();return;}
  if(version!==2)throw new Error('Unsupported observation database');
  db.exec(`CREATE TABLE observation_sources(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,route TEXT NOT NULL,plugin TEXT NOT NULL,source_key TEXT NOT NULL,version INTEGER NOT NULL,deleted INTEGER NOT NULL,body TEXT NOT NULL,body_hash TEXT NOT NULL,UNIQUE(agent_id,route,source_key));
    CREATE TABLE observation_activities(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,agent_id TEXT NOT NULL,route TEXT NOT NULL,plugin TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,body TEXT NOT NULL,receipt TEXT NOT NULL,UNIQUE(agent_id,route,plugin,request_id));
    CREATE TABLE observation_contributions(memory_id TEXT PRIMARY KEY REFERENCES memory_items(id),activity_id TEXT NOT NULL REFERENCES observation_activities(id),contribution_id TEXT NOT NULL,body TEXT NOT NULL);
    CREATE TABLE observation_source_requests(agent_id TEXT NOT NULL,route TEXT NOT NULL,plugin TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,receipt TEXT NOT NULL,PRIMARY KEY(agent_id,route,plugin,request_id));
    CREATE TRIGGER observation_source_body_immutable BEFORE UPDATE OF id,agent_id,route,plugin,source_key,body,body_hash ON observation_sources BEGIN SELECT RAISE(ABORT,'Immutable observation source'); END;
    CREATE TRIGGER observation_source_no_delete BEFORE DELETE ON observation_sources BEGIN SELECT RAISE(ABORT,'Use logical deletion'); END;
    CREATE TRIGGER observation_activity_immutable BEFORE UPDATE OF id,agent_id,route,plugin,request_id,fingerprint,body ON observation_activities BEGIN SELECT RAISE(ABORT,'Immutable observation activity'); END;
    CREATE TRIGGER observation_activity_no_delete BEFORE DELETE ON observation_activities BEGIN SELECT RAISE(ABORT,'Retain observation activity'); END;
    CREATE TRIGGER observation_receipt_once BEFORE UPDATE OF receipt ON observation_activities WHEN OLD.receipt<>'{}' OR NEW.receipt='{}' BEGIN SELECT RAISE(ABORT,'Immutable observation receipt'); END;
    CREATE TRIGGER observation_contribution_immutable BEFORE UPDATE ON observation_contributions BEGIN SELECT RAISE(ABORT,'Immutable contribution'); END;
    CREATE TRIGGER observation_contribution_no_delete BEFORE DELETE ON observation_contributions BEGIN SELECT RAISE(ABORT,'Retain contribution'); END;
    PRAGMA user_version=3;`);
}

/** Shares the memory transaction and outbox: an activity and its selected contributions
 * either all commit or none do. Counts/interest decisions remain producer-reported facts. */
export class ObservationStore {
  constructor(private readonly db:DatabaseSync,private readonly transaction:<T>(work:()=>T)=>T,private readonly memory:Pick<MemoryStore,'mutate'|'suppressedEvidence'|'read'|'taskSourceState'>){}
  private publish(authority:ObservationAuthority,id:string,activityId:string,type:string,occurredAt:string,data:NewEvent['data']){
    const event:NewEvent={agentId:authority.agentId,route:authority.route,traceId:authority.parent?.traceId??activityId,operationId:activityId,causedBy:authority.parent?.eventId??null,type,plugin:authority.pluginId,
      pluginVersion:authority.pluginVersion,occurredAt,sources:[],data:redactJson(data).value as NewEvent['data']};
    this.db.prepare('INSERT INTO memory_events(id,body,reason) VALUES(?,?,?)').run(id,JSON.stringify(event),'');this.db.prepare('INSERT INTO outbox(event_id) VALUES(?)').run(id);
  }
  private record(scope:TimelineScope,ref:string){
    try{
      const id=sourceId(ref),row=this.db.prepare('SELECT * FROM observation_sources WHERE id=? AND agent_id=? AND route=?').get(id,scope.agentId,scope.route);if(!row)return null;
      const body=sourceSchema.parse(JSON.parse(text(row.body)));
      if(digest(JSON.stringify(body))!==row.body_hash||body.boundary.owner.agentId!==scope.agentId||body.boundary.sourceScene.route!==scope.route)return null;
      if(row.deleted!==0&&row.deleted!==1)return null;
      return {...body,id,ref,version:z.number().int().positive().parse(row.version),deleted:row.deleted===1,plugin:text(row.plugin)};
    }catch{return null;}
  }
  source(scope:TimelineScope,ref:string,purpose:MemoryAccessPurpose='expression'){
    const record=this.record(scope,ref);if(!record||!boundaryAllows(record.boundary,scope,purpose))return null;
    const status=record.taskWorkId?this.memory.taskSourceState(scope.agentId,record.taskWorkId):'valid';
    return status==='unavailable'||status==='changed'?null:{...record,deleted:record.deleted||status==='deleted'};
  }
  private register(authority:ObservationAuthority,input:MemoryObservation['sources'][number]){
    const sanitized=input.archive.kind==='text'?redactContent(input.archive.text).value:null;
    const body=sourceSchema.parse({key:input.key,producerVersion:authority.pluginVersion,occurredAt:input.occurredAt,retention:input.archive.kind,text:sanitized,
      ...(authority.taskWorkId?{taskWorkId:authority.taskWorkId}:{}),
      hash:input.archive.kind==='text'?digest(sanitized!):input.archive.hash,
      boundary:restrictBoundary(conservativeBoundary(authority,'conservative-create',{conversation:authority.conversation,ingressPluginId:authority.ingressPluginId,taskId:authority.taskId,...(authority.agentTaskId?{agentTaskId:authority.agentTaskId}:{})}),[],input.policy)});
    const old=this.db.prepare('SELECT id,plugin,body FROM observation_sources WHERE agent_id=? AND route=? AND source_key=?').get(authority.agentId,authority.route,input.key);
    if(old){
      const previous=sourceSchema.parse(JSON.parse(text(old.body)));
      // A source retains its original task binding across later observations.
      if(old.plugin!==authority.pluginId||previous.hash!==body.hash||previous.retention!==body.retention||previous.text!==body.text||previous.occurredAt!==body.occurredAt
        ||JSON.stringify(previous.boundary.internalUse)!==JSON.stringify(body.boundary.internalUse)||JSON.stringify(previous.boundary.externalExpression)!==JSON.stringify(body.boundary.externalExpression))throw new Error('Observation source identity conflict');
      const state=this.record(authority,observationSourceRef(text(old.id)));if(!state)throw new MemoryError('source_unavailable');
      if(state.version!==(input.expectedVersion??1))throw new MemoryError('version_conflict');
      return {key:input.key,ref:state.ref,version:state.version};
    }
    if((input.expectedVersion??1)!==1)throw new MemoryError('source_unavailable');
    const id=randomUUID();this.db.prepare('INSERT INTO observation_sources VALUES(?,?,?,?,?,1,0,?,?)').run(id,authority.agentId,authority.route,authority.pluginId,input.key,JSON.stringify(body),digest(JSON.stringify(body)));
    return {key:input.key,ref:observationSourceRef(id),version:1};
  }
  submit(authority:ObservationAuthority,input:MemoryObservation):Omit<ObservationReceipt,'auditPending'> {
    return this.transaction(()=>{
      const fingerprint=digest(JSON.stringify(input)),old=this.db.prepare('SELECT fingerprint,receipt FROM observation_activities WHERE agent_id=? AND route=? AND plugin=? AND request_id=?').get(authority.agentId,authority.route,authority.pluginId,input.requestId);
      if(old){if(old.fingerprint!==fingerprint)throw new MemoryError('idempotency_conflict');return {...ObservationStoredReceiptSchema.parse(JSON.parse(text(old.receipt))),duplicate:true};}
      const activityId=randomUUID(),eventId=randomUUID(),sources=input.sources.map(s=>this.register(authority,s));
      const body={startedAt:input.startedAt,observedAt:input.observedAt,finishedAt:input.finishedAt,recordedAt:new Date().toISOString(),outcome:input.outcome,
        selection:input.selection,counts:input.counts,producerReported:true,sources:sources.map(s=>s.ref),exposedSources:input.exposedSources.map(key=>sources.find(s=>s.key===key)!.ref),taskId:authority.taskId,
        ...(authority.agentTaskId?{agentTaskId:authority.agentTaskId,taskWorkId:authority.taskWorkId??null}:{}),
        ...(authority.parent?{parent:authority.parent}:{})};
      const inserted=this.db.prepare('INSERT INTO observation_activities(id,agent_id,route,plugin,request_id,fingerprint,body,receipt) VALUES(?,?,?,?,?,?,?,?)')
        .run(activityId,authority.agentId,authority.route,authority.pluginId,input.requestId,fingerprint,JSON.stringify(body),'{}');
      this.publish(authority,eventId,activityId,'observation.recorded',input.startedAt,{activityId,sequence:Number(inserted.lastInsertRowid),outcome:input.outcome,
        contributionCount:input.contributions.length,sourceCount:sources.length,startedAt:input.startedAt,observedAt:input.observedAt,finishedAt:input.finishedAt,
        selection:input.selection,counts:input.counts,activityRecordedAt:body.recordedAt,producerReported:true});
      const contributions:ObservationReceipt['contributions']=[];
      for(const contribution of input.contributions){
        const exposure=contribution.exposure.map(key=>{
          const registeredSource=sources.find(s=>s.key===key);if(!registeredSource)throw new MemoryError('source_unavailable');
          const state=this.source(authority,registeredSource.ref,'internal');if(!state||state.deleted||this.memory.suppressedEvidence(authority,state.hash,ref=>ref===state.ref))throw new MemoryError('source_unavailable');return state;
        });
        let content:string;
        if(contribution.form==='summary')content=redactContent(contribution.text).value;
        else{
          const selected=exposure.find(s=>s.key===contribution.source);if(!selected||selected.retention!=='text'||selected.text===null)throw new Error('Original text was not retained');
          const points=Array.from(selected.text);
          if(contribution.form==='original')content=selected.text;
          else{if(contribution.start>=contribution.end||contribution.end>points.length)throw new Error('Fragment range invalid');
            content=points.slice(contribution.start,contribution.end).join('');if(content!==redactContent(contribution.text).value)throw new Error('Fragment quote mismatch');}
        }
        const scope:OperationScope={agentId:authority.agentId,route:authority.route,traceId:authority.parent?.traceId??activityId,operationId:activityId,startedEventId:eventId};
        const receipt=this.memory.mutate(scope,{action:'create',requestId:`obs-${activityId}-${contributions.length}`,value:{kind:'experience',claimType:contribution.form==='summary'?'inference':'reported_claim',content,
          sources:exposure.map(s=>({kind:'observation',ref:s.ref,version:s.version,contentHash:s.hash}))},...(contribution.policy?{boundaryPolicy:contribution.policy}:{})},
          {conversation:authority.conversation,ingressPluginId:authority.ingressPluginId,taskId:authority.taskId,...(authority.agentTaskId?{agentTaskId:authority.agentTaskId}:{})});
        const details={activityId,producer:{id:authority.pluginId,version:authority.pluginVersion},contributionId:contribution.id,form:contribution.form,exposure:exposure.map(s=>({ref:s.ref,version:s.version,hash:s.hash,retention:s.retention})),
          ...(contribution.form==='fragment'?{range:{start:contribution.start,end:contribution.end,unit:'unicode-codepoint'}}:{})};
        this.db.prepare('INSERT INTO observation_contributions VALUES(?,?,?,?)').run(receipt.id,activityId,contribution.id,JSON.stringify(details));
        contributions.push({id:contribution.id,form:contribution.form,memoryId:receipt.id,revision:receipt.revision,version:receipt.version});
      }
      const receipt:Omit<ObservationReceipt,'auditPending'>={activityId,eventId,sequence:Number(inserted.lastInsertRowid),duplicate:false,sources,contributions};
      this.db.prepare('UPDATE observation_activities SET receipt=? WHERE id=?').run(JSON.stringify(receipt),activityId);return receipt;
    });
  }
  open(authority:ObservationAuthority,input:{ref:string;mode:'normal'|'deleted';offset:number;limit:number}):Record<string,unknown>{
    const source=this.source(authority,input.ref);if(!source||source.plugin!==authority.pluginId||(input.mode==='deleted')!==source.deleted)return {status:'not_found'};
    if(input.mode==='normal'&&this.memory.suppressedEvidence(authority,source.hash,ref=>ref===source.ref))return {status:'source_unavailable'};
    if(source.text===null)return {status:'digest_only',ref:source.ref,version:source.version,hash:source.hash,rawAvailable:false,untrustedEvidence:true,
      memoryUse:input.mode==='deleted'?'deleted_lookup_only':'observation-evidence'};
    const points=Array.from(source.text),end=Math.min(points.length,input.offset+input.limit);
    return {status:'ok',ref:source.ref,version:source.version,hash:source.hash,text:points.slice(input.offset,end).join(''),offset:input.offset,nextOffset:end<points.length?end:null,
      rawAvailable:true,untrustedEvidence:true,memoryUse:input.mode==='deleted'?'deleted_lookup_only':'observation-evidence'};
  }
  change(authority:ObservationAuthority,input:{ref:string;requestId:string;expectedVersion:number;action:'delete'|'restore'}):Record<string,unknown>{
    return this.transaction(()=>{
      const fingerprint=digest(JSON.stringify(input)),old=this.db.prepare('SELECT fingerprint,receipt FROM observation_source_requests WHERE agent_id=? AND route=? AND plugin=? AND request_id=?').get(authority.agentId,authority.route,authority.pluginId,input.requestId);
      if(old){if(old.fingerprint!==fingerprint)throw new MemoryError('idempotency_conflict');return {...JSON.parse(text(old.receipt)),duplicate:true};}
      const source=this.record(authority,input.ref);if(!source||source.plugin!==authority.pluginId)throw new MemoryError('not_found');
      if(source.version!==input.expectedVersion)throw new MemoryError('version_conflict');
      if((input.action==='restore')!==source.deleted)throw new MemoryError(source.deleted?'deleted':'not_deleted');
      const version=source.version+1,eventId=randomUUID();this.db.prepare('UPDATE observation_sources SET version=?,deleted=? WHERE id=?').run(version,Number(input.action==='delete'),source.id);
      this.db.prepare('INSERT INTO scope_generations VALUES(?,?,1) ON CONFLICT(agent_id,route) DO UPDATE SET generation=generation+1').run(authority.agentId,authority.route);
      this.publish(authority,eventId,eventId,`observation.source.${input.action==='delete'?'deleted':'restored'}`,new Date().toISOString(),{ref:input.ref,version});
      const receipt={status:'ok',ref:input.ref,version,eventId,duplicate:false};this.db.prepare('INSERT INTO observation_source_requests VALUES(?,?,?,?,?,?)').run(authority.agentId,authority.route,authority.pluginId,input.requestId,fingerprint,JSON.stringify(receipt));return receipt;
    });
  }
  epoch(scope:TimelineScope):number{return number(this.db.prepare('SELECT coalesce(sum(version-1),0) AS n FROM observation_sources WHERE agent_id=? AND route=?').get(scope.agentId,scope.route)?.n);}
  taskWorkForMemory(id:string):string|null {
    const row=this.db.prepare("SELECT json_extract(a.body,'$.taskWorkId') AS job FROM observation_contributions c JOIN observation_activities a ON a.id=c.activity_id WHERE c.memory_id=?").get(id);
    return row?.job?z.uuid().parse(row.job):null;
  }
  activity(scope:TimelineScope,id:string,purpose:MemoryAccessPurpose='expression'){
    const row=this.db.prepare('SELECT body,receipt,sequence FROM observation_activities WHERE id=? AND agent_id=? AND route=?').get(id,scope.agentId,scope.route);if(!row)return null;
    const taskWorkId=z.object({taskWorkId:z.uuid().nullable().optional()}).parse(JSON.parse(text(row.body))).taskWorkId;
    if(taskWorkId&&this.memory.taskSourceState(scope.agentId,taskWorkId,purpose)!=='valid')return null;
    const receipt=ObservationStoredReceiptSchema.parse(JSON.parse(text(row.receipt))),body=z.object({startedAt:z.string(),observedAt:z.string(),finishedAt:z.string(),outcome:z.string(),
      counts:z.object({received:z.number(),processed:z.number(),modelExposed:z.number()}),selection:z.object({policyId:z.string(),policyVersion:z.string(),reasonCode:z.string()})}).parse(JSON.parse(text(row.body)));
    if(receipt.activityId!==id||receipt.sequence!==row.sequence||receipt.sources.some(s=>{const source=this.source(scope,s.ref,purpose);return !source||source.deleted||source.version!==s.version||this.memory.suppressedEvidence(scope,source.hash,r=>r===source.ref);}))return null;
    if(receipt.contributions.some(c=>{const memory=this.memory.read(scope,c.memoryId,'normal',c.revision,purpose);return !memory||memory.version!==c.version;}))return null;
    return {hash:digest(JSON.stringify([JSON.parse(text(row.body)),receipt])),receipt,summary:{activityId:id,...body,producerReported:true}};
  }
  contribution(id:string,revision:number):unknown {
    if(revision!==1)return undefined;const row=this.db.prepare('SELECT body FROM observation_contributions WHERE memory_id=?').get(id);return row?JSON.parse(text(row.body)):undefined;
  }
}
