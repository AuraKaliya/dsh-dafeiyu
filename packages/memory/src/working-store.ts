import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { OperationScope,TimelineScope } from '@dafeiyu/contracts';
import type { NewEvent } from '@dafeiyu/journal';
import { evidenceSchema,MemoryError,MEMORY_VERSION } from './types.js';

export const sourceVersionSchema=z.strictObject({evidence:evidenceSchema,version:z.number().int().positive().nullable()});
export const workEntrySchema=z.strictObject({id:z.string().min(1).max(80),category:z.enum(['goal','constraint','correction','pending','result','gap']),
  text:z.string().min(1).max(4000),sources:z.array(sourceVersionSchema).min(1).max(8)});
export const selectedSchema=z.strictObject({id:z.uuid(),revision:z.number().int().positive(),version:z.number().int().positive(),contentHash:z.string().regex(/^[a-f0-9]{64}$/),
  start:z.number().int().min(0),end:z.number().int().positive()});
const common={version:z.number().int().nonnegative(),taskId:z.string().min(1).max(100),expiresAt:z.iso.datetime()};
export const stateSchema=z.discriminatedUnion('kind',[
  z.strictObject({...common,kind:z.literal('working'),items:z.array(workEntrySchema).max(12)}),
  z.strictObject({...common,kind:z.literal('evidence'),workingVersion:z.number().int().nonnegative().optional(),items:z.array(selectedSchema).max(12)}),
]);
export type WorkingState=z.infer<typeof stateSchema>;
export type WorkEntry=z.infer<typeof workEntrySchema>;
export type SelectedMemory=z.infer<typeof selectedSchema>;
const auditSchema=z.object({agentId:z.string(),route:z.string(),traceId:z.string(),operationId:z.string(),causedBy:z.string(),
  type:z.literal('memory.context.updated'),plugin:z.literal('memory'),pluginVersion:z.string(),occurredAt:z.string(),sources:z.array(z.never()),
  data:z.object({kind:z.string(),version:z.number(),count:z.number()})});

/** Scope-bound working state and selected citations, separate from long-term memory revisions. */
export class WorkingStore {
  private readonly db:DatabaseSync;
  constructor(file:string){
    mkdirSync(dirname(file),{recursive:true});this.db=new DatabaseSync(file);
    try{
      const app=this.db.prepare('PRAGMA application_id').get()?.application_id,version=this.db.prepare('PRAGMA user_version').get()?.user_version;
      const fresh=app===0&&version===0&&this.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get()?.n===0;
      if(!fresh&&(app!==0x44465731||version!==1))throw new Error('Unsupported working memory database');
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
      if(fresh)this.db.exec(`
        CREATE TABLE states(agent_id TEXT NOT NULL,route TEXT NOT NULL,kind TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(agent_id,route,kind));
        CREATE TABLE revisions(agent_id TEXT NOT NULL,route TEXT NOT NULL,kind TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(agent_id,route,kind,version));
        CREATE TABLE requests(agent_id TEXT NOT NULL,route TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,receipt TEXT NOT NULL,PRIMARY KEY(agent_id,route,request_id));
        CREATE TABLE outbox(id TEXT PRIMARY KEY,body TEXT NOT NULL,delivered INTEGER NOT NULL DEFAULT 0);
        CREATE TRIGGER immutable_revision BEFORE UPDATE ON revisions BEGIN SELECT RAISE(ABORT,'Immutable working revision'); END;
        CREATE TRIGGER retain_revision BEFORE DELETE ON revisions BEGIN SELECT RAISE(ABORT,'Retain working revision'); END;
        PRAGMA application_id=${0x44465731}; PRAGMA user_version=1;`);
    }catch(error){this.db.close();throw error;}
  }
  read(scope:TimelineScope,kind:'working'|'evidence'):WorkingState|null{
    const row=this.db.prepare('SELECT body FROM states WHERE agent_id=? AND route=? AND kind=?').get(scope.agentId,scope.route,kind);
    return row?stateSchema.parse(JSON.parse(z.string().parse(row.body))):null;
  }
  version(scope:TimelineScope,kind:'working'|'evidence'):number{
    return z.number().int().nonnegative().parse(this.db.prepare('SELECT version FROM states WHERE agent_id=? AND route=? AND kind=?').get(scope.agentId,scope.route,kind)?.version??0);
  }
  write(scope:OperationScope,requestId:string,expectedVersion:number,state:WorkingState){
    const fingerprint=createHash('sha256').update(JSON.stringify({expectedVersion,state})).digest('hex');
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const old=this.db.prepare('SELECT fingerprint,receipt FROM requests WHERE agent_id=? AND route=? AND request_id=?').get(scope.agentId,scope.route,requestId);
      if(old){
        if(old.fingerprint!==fingerprint)throw new MemoryError('idempotency_conflict');
        const receipt=z.object({kind:z.enum(['working','evidence']),version:z.number().int().positive(),eventId:z.uuid()}).parse(JSON.parse(z.string().parse(old.receipt)));
        this.db.exec('COMMIT');return {...receipt,duplicate:true};
      }
      const prior=this.read(scope,state.kind);
      if((prior?.version??0)!==expectedVersion)throw new MemoryError('version_conflict');
      const next=stateSchema.parse({...state,version:expectedVersion+1}),body=JSON.stringify(next);
      this.db.prepare('INSERT INTO states VALUES(?,?,?,?,?) ON CONFLICT(agent_id,route,kind) DO UPDATE SET version=excluded.version,body=excluded.body').run(scope.agentId,scope.route,next.kind,next.version,body);
      this.db.prepare('INSERT INTO revisions VALUES(?,?,?,?,?)').run(scope.agentId,scope.route,next.kind,next.version,body);
      const eventId=randomUUID();
      const event:NewEvent={agentId:scope.agentId,route:scope.route,traceId:scope.traceId,operationId:scope.operationId,causedBy:scope.startedEventId,
        type:'memory.context.updated',plugin:'memory',pluginVersion:MEMORY_VERSION,occurredAt:new Date().toISOString(),sources:[],
        data:{kind:next.kind,version:next.version,count:next.items.length}};
      this.db.prepare('INSERT INTO outbox(id,body) VALUES(?,?)').run(eventId,JSON.stringify(event));
      const receipt={kind:next.kind,version:next.version,eventId};
      this.db.prepare('INSERT INTO requests VALUES(?,?,?,?,?)').run(scope.agentId,scope.route,requestId,fingerprint,JSON.stringify(receipt));
      this.db.exec('COMMIT');return {...receipt,duplicate:false};
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  flush(publish:(event:NewEvent,id:string)=>void):void{
    for(const row of this.db.prepare('SELECT id,body FROM outbox WHERE delivered=0 ORDER BY rowid').iterate()){
      try{publish(auditSchema.parse(JSON.parse(z.string().parse(row.body))),z.string().parse(row.id));this.db.prepare('UPDATE outbox SET delivered=1 WHERE id=?').run(row.id!);}catch{break;}
    }
  }
  close():void{this.db.close();}
}
