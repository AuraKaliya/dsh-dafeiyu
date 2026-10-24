import { DatabaseSync } from 'node:sqlite';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { testTempDir as tmpdir } from './test-temp.js';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { conversationKey } from '@dafeiyu/contracts';
import { legacyMemory } from './legacy-memory-fixture.js';

/** Independently encoded v0.2.0 journal: schema v1 predates analysis_grants. */
export function legacyJournal(file:string){
  const db=new DatabaseSync(file);db.exec(`
    CREATE TABLE conversations(route TEXT PRIMARY KEY,session_id TEXT NOT NULL UNIQUE);
    CREATE TABLE inbox(ordinal INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,route TEXT NOT NULL REFERENCES conversations(route),message_id TEXT NOT NULL,extension_id TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL,reply TEXT,UNIQUE(route,message_id));
    CREATE TABLE events(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,route TEXT NOT NULL,trace_id TEXT NOT NULL,operation_id TEXT NOT NULL,body TEXT NOT NULL);
    CREATE INDEX events_route ON events(route,seq);CREATE INDEX events_trace ON events(trace_id,seq);
    CREATE TABLE ownership(singleton INTEGER PRIMARY KEY CHECK(singleton=1),pid INTEGER NOT NULL,nonce TEXT NOT NULL);
    CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'Events are append-only');END;
    CREATE TRIGGER events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'Events are append-only');END;
    PRAGMA user_version=1;`);
  const conversation={channel:'simulator',account:'fixture',kind:'local' as const,id:'original'},route=conversationKey('fish',conversation),id=randomUUID(),eventId=randomUUID(),at='2026-10-24T00:00:00.000Z';
  const message={id:'legacy-message',occurredAt:at,conversation,sender:{id:'fictional',displayName:'虚构'},text:'保留原来的虚构消息'};
  db.prepare('INSERT INTO conversations VALUES(?,?)').run(route,'legacy-session');
  db.prepare("INSERT INTO inbox(id,route,message_id,extension_id,payload,state,reply) VALUES(?,?,?,?,?,'delivered',?)").run(id,route,message.id,'channel-simulator',JSON.stringify(message),JSON.stringify({id:'legacy-reply',conversation,sourceMessageId:message.id,text:'原回复'}));
  const event={schemaVersion:1,id:eventId,agentId:'fish',route,traceId:id,operationId:id,causedBy:null,type:'message.accepted',plugin:'channel-simulator',pluginVersion:'0.2.0',occurredAt:at,recordedAt:at,visibility:{kind:'conversation',route},sources:[],data:{senderId:'fictional'}};
  db.prepare('INSERT INTO events(id,route,trace_id,operation_id,body) VALUES(?,?,?,?,?)').run(eventId,route,id,id,JSON.stringify(event));
  return {db,id,eventId,route};
}
export async function migrationFixture(existingRoot?:string){
  const root=existingRoot??await mkdtemp(join(tmpdir(),'dafeiyu-migration-')),coreDir=join(root,'core'),memoryDir=join(root,'memory'),sessionsDir=join(root,'sessions'),backupDir=join(root,'backups');
  await mkdir(coreDir);await mkdir(memoryDir);await mkdir(sessionsDir);
  const journal=legacyJournal(join(coreDir,'journal.sqlite'));journal.db.close();
  const memory=legacyMemory(join(memoryDir,'memory.sqlite'));memory.db.close();
  await writeFile(join(sessionsDir,'fictional.jsonl'),JSON.stringify({fixture:'only fictional history, never loaded as new input'})+'\n');
  return {root,coreDir,memoryDir,sessionsDir,backupDir,identity:{agentId:'fish',profileId:'migration-fixture'},journal,memory};
}
