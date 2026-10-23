import { DatabaseSync } from 'node:sqlite';
import { createHash,randomUUID } from 'node:crypto';
import type { Json,OperationScope } from '@dafeiyu/contracts';
import type { WriteContent } from '../packages/memory/lib/types.js';

function canonical(v:Json):string{return v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?`[${v.map(canonical).join(',')}]`:
  `{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k]!)}`).join(',')}}`;}
export const legacyHash=(v:Json)=>createHash('sha256').update(canonical(v)).digest('hex');
export const legacyTables=['memory_items','memory_revisions','dependencies','scope_generations','memory_events','outbox','requests'];
export function legacySnapshot(db:DatabaseSync){return Object.fromEntries(legacyTables.map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));}
/** Frozen v1 schema and fictional records; never use the new constructor to produce an
 * allegedly old fixture. The historical bodies/fingerprints are independently encoded. */
export function legacyMemory(file:string){
  const db=new DatabaseSync(file);
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE memory_items(ordinal INTEGER PRIMARY KEY,id TEXT NOT NULL UNIQUE,agent_id TEXT NOT NULL,route TEXT NOT NULL,version INTEGER NOT NULL,head INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)),reason TEXT NOT NULL DEFAULT '');
    CREATE INDEX items_scope ON memory_items(agent_id,route,ordinal);
    CREATE TABLE memory_revisions(id TEXT NOT NULL REFERENCES memory_items(id),revision INTEGER NOT NULL,body TEXT NOT NULL,event_id TEXT NOT NULL,PRIMARY KEY(id,revision));
    CREATE TABLE dependencies(id TEXT NOT NULL,revision INTEGER NOT NULL,parent_id TEXT NOT NULL,parent_revision INTEGER NOT NULL,PRIMARY KEY(id,revision,parent_id,parent_revision),FOREIGN KEY(id,revision) REFERENCES memory_revisions(id,revision),FOREIGN KEY(parent_id,parent_revision) REFERENCES memory_revisions(id,revision));
    CREATE TABLE scope_generations(agent_id TEXT NOT NULL,route TEXT NOT NULL,generation INTEGER NOT NULL,PRIMARY KEY(agent_id,route));
    CREATE TABLE memory_events(id TEXT PRIMARY KEY,body TEXT NOT NULL,reason TEXT NOT NULL);
    CREATE TABLE outbox(event_id TEXT PRIMARY KEY REFERENCES memory_events(id),delivered INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE requests(agent_id TEXT NOT NULL,route TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,receipt TEXT NOT NULL,PRIMARY KEY(agent_id,route,request_id));
    CREATE TRIGGER items_no_delete BEFORE DELETE ON memory_items BEGIN SELECT RAISE(ABORT,'Use logical deletion'); END;
    CREATE TRIGGER revisions_immutable_update BEFORE UPDATE ON memory_revisions BEGIN SELECT RAISE(ABORT,'Immutable revision'); END;
    CREATE TRIGGER revisions_immutable_delete BEFORE DELETE ON memory_revisions BEGIN SELECT RAISE(ABORT,'Immutable revision'); END;
    CREATE TRIGGER events_immutable_update BEFORE UPDATE ON memory_events BEGIN SELECT RAISE(ABORT,'Append-only memory event'); END;
    CREATE TRIGGER events_immutable_delete BEFORE DELETE ON memory_events BEGIN SELECT RAISE(ABORT,'Append-only memory event'); END;
    CREATE TRIGGER dependencies_immutable_update BEFORE UPDATE ON dependencies BEGIN SELECT RAISE(ABORT,'Immutable source dependency'); END;
    CREATE TRIGGER dependencies_immutable_delete BEFORE DELETE ON dependencies BEGIN SELECT RAISE(ABORT,'Immutable source dependency'); END;
    PRAGMA application_id=1145457969; PRAGMA user_version=1;`);
  const scope:OperationScope={agentId:'fish',route:JSON.stringify(['fish','qq','fictional-bot','group','fictional-group']),traceId:randomUUID(),operationId:randomUUID(),startedEventId:randomUUID()};
  const value=(content:string):WriteContent=>({kind:'knowledge',claimType:'self_report',content,sources:[{kind:'timeline',ref:`fictional:source:${content}`,contentHash:'a'.repeat(64)}]});
  function add(v:WriteContent,version=1,head=1,deleted=false,route=scope.route){
    const id=randomUUID();db.prepare('INSERT INTO memory_items(id,agent_id,route,version,head,deleted,reason) VALUES(?,?,?,?,?,?,?)').run(id,scope.agentId,route,version,head,Number(deleted),deleted?'虚构删除理由':'');return {id,value:v};
  }
  function revision(item:ReturnType<typeof add>,revision:number,v=item.value){
    const eventId=randomUUID(),contentHash=legacyHash(JSON.parse(JSON.stringify(v)) as Json);
    const body={...v,id:item.id,revision,contentHash,createdAt:'2026-10-20T00:00:00.000Z',analysisStatus:'not_analyzed'};
    db.prepare('INSERT INTO memory_revisions VALUES(?,?,?,?)').run(item.id,revision,JSON.stringify(body),eventId);
    return {body,eventId};
  }
  const active=add(value('虚构的有效旧记忆')),a=revision(active,1);
  const parent=add(value('虚构旧依据'),3,2,true),p1=revision(parent,1);revision(parent,2,value('虚构更正后的依据'));
  const child=add({...value('依赖旧依据的派生记录'),sources:[{kind:'memory',id:parent.id,revision:1,contentHash:p1.body.contentHash}]});revision(child,1);
  db.prepare('INSERT INTO dependencies VALUES(?,?,?,?)').run(child.id,1,parent.id,1);
  const restored=add(value('恢复过的虚构记忆'),3);revision(restored,1);
  const opaque=add(value('不猜测场景的旧记录'),1,1,false,'legacy-opaque');revision(opaque,1);
  const command={action:'create' as const,requestId:'legacy-request',value:active.value};
  const receipt={id:active.id,version:1,revision:1,eventId:a.eventId,generation:1};
  db.prepare('INSERT INTO scope_generations VALUES(?,?,?)').run(scope.agentId,scope.route,8);
  const event={agentId:scope.agentId,route:scope.route,traceId:scope.traceId,operationId:scope.operationId,causedBy:scope.startedEventId,
    type:'memory.created',plugin:'memory',pluginVersion:'0.1.0',occurredAt:'2026-10-20T00:00:00.000Z',sources:[],data:{memoryId:active.id,revision:1,version:1,deleted:false}};
  db.prepare('INSERT INTO memory_events VALUES(?,?,?)').run(a.eventId,JSON.stringify(event),'');db.prepare('INSERT INTO outbox VALUES(?,0)').run(a.eventId);
  db.prepare('INSERT INTO requests VALUES(?,?,?,?,?)').run(scope.agentId,scope.route,command.requestId,legacyHash(JSON.parse(JSON.stringify(command)) as Json),JSON.stringify(receipt));
  return {db,scope,active,parent,child,restored,opaque,command,receipt};
}
