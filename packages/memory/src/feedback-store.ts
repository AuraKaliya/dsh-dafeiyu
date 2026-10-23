import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { OperationScope,TimelineScope } from '@dafeiyu/contracts';
import type { NewEvent } from '@dafeiyu/journal';
import { ToolFeedbackSchema } from '@dafeiyu/contracts';
import { evidenceSchema,MemoryError,MEMORY_VERSION } from './types.js';

export const digestText=(text:string)=>createHash('sha256').update(text).digest('hex');
export const dependencySchema=z.strictObject({evidence:evidenceSchema,version:z.number().int().positive().nullable()});
export type FeedbackDependency=z.infer<typeof dependencySchema>;
export const archiveSchema=z.strictObject({id:z.uuid(),body:z.string(),hash:z.string(),report:ToolFeedbackSchema.omit({data:true}),
  preview:z.strictObject({text:z.string().max(1200),totalChars:z.number().int().nonnegative()}),
  origin:z.enum(['returned','exception','invalid-result']),redacted:z.boolean(),createdAt:z.iso.datetime(),
  pluginId:z.string(),pluginVersion:z.string(),action:z.string(),operationId:z.string(),startedEventId:z.string(),traceId:z.string(),
  dependencies:z.array(dependencySchema).max(8),rejectedSources:z.boolean()});
export type FeedbackArchive=z.infer<typeof archiveSchema>;
export interface FeedbackRecord {archive:FeedbackArchive;version:number;deleted:boolean}
export interface FeedbackHeaderRecord {archive:Omit<FeedbackArchive,'body'>;version:number;deleted:boolean}
const auditSchema=z.strictObject({agentId:z.string(),route:z.string(),traceId:z.string(),operationId:z.string(),causedBy:z.string(),
  type:z.enum(['feedback.archived','feedback.deleted','feedback.restored']),plugin:z.literal('memory'),pluginVersion:z.string(),occurredAt:z.string(),
  sources:z.array(z.strictObject({kind:z.literal('event'),id:z.string(),route:z.string()})),data:z.record(z.string(),z.json())});

/** Immutable sanitized originals; mutable logical state and transactional audit receipts. */
export class FeedbackStore {
  private readonly db:DatabaseSync;
  private readonly headers=new Map<string,FeedbackHeaderRecord['archive']>();
  constructor(file:string){
    mkdirSync(dirname(file),{recursive:true});this.db=new DatabaseSync(file);
    try{
      const app=this.db.prepare('PRAGMA application_id').get()?.application_id,version=this.db.prepare('PRAGMA user_version').get()?.user_version;
      const fresh=app===0&&version===0&&this.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get()?.n===0;
      if(!fresh&&(app!==0x44464631||version!==1))throw new Error('Unsupported feedback archive');
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
      if(fresh)this.db.exec(`
        CREATE TABLE archives(ordinal INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,agent_id TEXT NOT NULL,route TEXT NOT NULL,operation_id TEXT NOT NULL,fingerprint TEXT NOT NULL,body TEXT NOT NULL,UNIQUE(agent_id,route,operation_id));
        CREATE TABLE states(id TEXT PRIMARY KEY,version INTEGER NOT NULL,deleted INTEGER NOT NULL);
        CREATE TABLE requests(agent_id TEXT NOT NULL,route TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,receipt TEXT NOT NULL,PRIMARY KEY(agent_id,route,request_id));
        CREATE TABLE events(ordinal INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,body TEXT NOT NULL,reason TEXT NOT NULL);
        CREATE TABLE outbox(id TEXT PRIMARY KEY,delivered INTEGER NOT NULL DEFAULT 0);
        CREATE TRIGGER immutable_archive BEFORE UPDATE ON archives BEGIN SELECT RAISE(ABORT,'Immutable feedback original'); END;
        CREATE TRIGGER retain_archive BEFORE DELETE ON archives BEGIN SELECT RAISE(ABORT,'Use logical deletion'); END;
        CREATE TRIGGER immutable_event BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'Immutable feedback event'); END;
        CREATE TRIGGER retain_event BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'Retain feedback history'); END;
        PRAGMA application_id=${0x44464631}; PRAGMA user_version=1;`);
    }catch(error){this.db.close();throw error;}
  }
  private transaction<T>(work:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const result=work();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  get(scope:TimelineScope,id:string):FeedbackRecord|null{
    const row=this.db.prepare('SELECT a.body,s.version,s.deleted FROM archives a JOIN states s ON s.id=a.id WHERE a.agent_id=? AND a.route=? AND a.id=?').get(scope.agentId,scope.route,id);
    if(!row)return null;
    const archive=archiveSchema.parse(JSON.parse(z.string().parse(row.body)));
    if(digestText(archive.body)!==archive.hash)throw new Error('Feedback archive integrity mismatch');
    return {archive,version:z.number().int().positive().parse(row.version),deleted:row.deleted===1};
  }
  /** Immutable header cache is bounded; ownership and mutable logical state are always read anew. */
  header(scope:TimelineScope,id:string):FeedbackHeaderRecord|null{
    const row=this.db.prepare('SELECT s.version,s.deleted FROM archives a JOIN states s ON s.id=a.id WHERE a.agent_id=? AND a.route=? AND a.id=?').get(scope.agentId,scope.route,id);
    if(!row)return null;
    let header=this.headers.get(id);
    if(!header){
      const record=this.get(scope,id);if(!record)return null;
      const {body:_body,...value}=record.archive;header=value;
      if(this.headers.size>=128){const oldest=this.headers.keys().next().value;if(oldest)this.headers.delete(oldest);}
      this.headers.set(id,header);
    }
    return {archive:header,version:z.number().int().positive().parse(row.version),deleted:row.deleted===1};
  }
  *list(scope:TimelineScope):Generator<FeedbackHeaderRecord>{
    for(const row of this.db.prepare('SELECT id FROM archives WHERE agent_id=? AND route=? ORDER BY ordinal DESC').iterate(scope.agentId,scope.route)){
      const record=this.header(scope,z.string().parse(row.id));if(record)yield record;
    }
  }
  private event(scope:OperationScope,type:'feedback.archived'|'feedback.deleted'|'feedback.restored',id:string,version:number,reason=''):string{
    const eventId=randomUUID();const event:NewEvent={agentId:scope.agentId,route:scope.route,traceId:scope.traceId,operationId:scope.operationId,causedBy:scope.startedEventId,
      type,plugin:'memory',pluginVersion:MEMORY_VERSION,occurredAt:new Date().toISOString(),sources:[{kind:'event',id:scope.startedEventId,route:scope.route}],data:{archiveId:id,ref:`dafeiyu:feedback:${id}:1`,version}};
    this.db.prepare('INSERT INTO events(id,body,reason) VALUES(?,?,?)').run(eventId,JSON.stringify(event),reason);this.db.prepare('INSERT INTO outbox(id) VALUES(?)').run(eventId);return eventId;
  }
  put(scope:OperationScope,value:Omit<FeedbackArchive,'id'|'createdAt'>):FeedbackRecord{
    return this.transaction(()=>{
      const fingerprint=digestText(JSON.stringify(value));
      const old=this.db.prepare('SELECT id,fingerprint FROM archives WHERE agent_id=? AND route=? AND operation_id=?').get(scope.agentId,scope.route,scope.operationId);
      if(old){if(old.fingerprint!==fingerprint)throw new MemoryError('idempotency_conflict');return this.get(scope,z.string().parse(old.id))!;}
      const archive=archiveSchema.parse({...value,id:randomUUID(),createdAt:new Date().toISOString()});
      this.db.prepare('INSERT INTO archives(id,agent_id,route,operation_id,fingerprint,body) VALUES(?,?,?,?,?,?)').run(archive.id,scope.agentId,scope.route,scope.operationId,fingerprint,JSON.stringify(archive));
      this.db.prepare('INSERT INTO states VALUES(?,1,0)').run(archive.id);this.event(scope,'feedback.archived',archive.id,1);
      return {archive,version:1,deleted:false};
    });
  }
  change(scope:OperationScope,input:{id:string;expectedVersion:number;requestId:string;reason:string},deleted:boolean){
    return this.transaction(()=>{
      const fingerprint=digestText(JSON.stringify({input,deleted}));
      const old=this.db.prepare('SELECT fingerprint,receipt FROM requests WHERE agent_id=? AND route=? AND request_id=?').get(scope.agentId,scope.route,input.requestId);
      if(old){if(old.fingerprint!==fingerprint)throw new MemoryError('idempotency_conflict');return {...z.object({id:z.uuid(),version:z.number(),eventId:z.uuid()}).parse(JSON.parse(z.string().parse(old.receipt))),duplicate:true};}
      const record=this.get(scope,input.id);if(!record)throw new MemoryError('not_found');
      if(record.version!==input.expectedVersion)throw new MemoryError('version_conflict');
      if(record.deleted===deleted)throw new MemoryError(deleted?'deleted':'not_deleted');
      const version=record.version+1;this.db.prepare('UPDATE states SET version=?,deleted=? WHERE id=?').run(version,Number(deleted),input.id);
      const eventId=this.event(scope,deleted?'feedback.deleted':'feedback.restored',input.id,version,input.reason),receipt={id:input.id,version,eventId};
      this.db.prepare('INSERT INTO requests VALUES(?,?,?,?,?)').run(scope.agentId,scope.route,input.requestId,fingerprint,JSON.stringify(receipt));return {...receipt,duplicate:false};
    });
  }
  flush(publish:(event:NewEvent,id:string)=>void):number{
    for(const row of this.db.prepare('SELECT e.id,e.body FROM events e JOIN outbox o ON o.id=e.id WHERE o.delivered=0 ORDER BY e.ordinal').iterate()){
      try{publish(auditSchema.parse(JSON.parse(z.string().parse(row.body))),z.string().parse(row.id));this.db.prepare('UPDATE outbox SET delivered=1 WHERE id=?').run(row.id!);}catch{break;}
    }
    return Number(this.db.prepare('SELECT count(*) AS n FROM outbox WHERE delivered=0').get()?.n);
  }
  close():void{this.db.close();}
}
