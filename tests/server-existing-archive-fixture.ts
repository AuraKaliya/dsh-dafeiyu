import { mkdtemp,mkdir,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { testTempDir } from './test-temp.js';

export const fixtureTime='2026-10-26T12:00:00.000Z';
export const fixtureHash=(text:string)=>createHash('sha256').update(text).digest('hex');
/** Visible legacy v1 DDL, with an ordinary search-table stand-in; this does not claim the live FTS declaration. */
export async function existingArchiveFixture(){
  const root=await mkdtemp(join(testTempDir(),'server-existing-archive-')),directory=join(root,'历史记录'),database=join(directory,'history.sqlite');await mkdir(directory);
  const db=new DatabaseSync(database);
  try{db.exec(`
    CREATE TABLE records(id INTEGER PRIMARY KEY,source_key TEXT NOT NULL UNIQUE,kind TEXT NOT NULL,route TEXT,actor TEXT,occurred_at TEXT,captured_at TEXT NOT NULL,source TEXT NOT NULL,audience TEXT NOT NULL,body TEXT NOT NULL,payload TEXT NOT NULL,hash TEXT NOT NULL);
    CREATE INDEX records_scope_time ON records(route,occurred_at,id);
    CREATE INDEX records_kind ON records(kind,id);
    CREATE TABLE records_search(body TEXT);
    CREATE TRIGGER records_index AFTER INSERT ON records BEGIN INSERT INTO records_search(rowid,body) VALUES(new.id,new.body); END;
    CREATE TRIGGER records_immutable_update BEFORE UPDATE ON records BEGIN SELECT RAISE(ABORT,'history records are append-only'); END;
    CREATE TRIGGER records_immutable_delete BEFORE DELETE ON records BEGIN SELECT RAISE(ABORT,'history records are append-only'); END;
    CREATE TABLE imports(source TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,completed_at TEXT NOT NULL);
    CREATE TABLE cycles(id TEXT PRIMARY KEY,day TEXT NOT NULL,kind TEXT NOT NULL,state TEXT NOT NULL,updated_at TEXT NOT NULL,payload TEXT NOT NULL,legacy_extra TEXT DEFAULT 'retain-cycle-column');
    CREATE UNIQUE INDEX one_daily_cycle ON cycles(day) WHERE kind='daily';
    CREATE TABLE versions(id TEXT PRIMARY KEY,cycle_id TEXT NOT NULL,base_commit TEXT NOT NULL,tree_id TEXT NOT NULL,commit_hash TEXT,state TEXT NOT NULL,title TEXT,notes TEXT,plan TEXT NOT NULL,created_at TEXT NOT NULL,legacy_extra TEXT DEFAULT 'retain-version-column');
    CREATE UNIQUE INDEX one_commit_per_cycle ON versions(cycle_id) WHERE state='committed';
    CREATE TABLE blobs(hash TEXT PRIMARY KEY,bytes INTEGER NOT NULL,encoding TEXT NOT NULL,content BLOB NOT NULL);
    CREATE TABLE snapshots(version_id TEXT NOT NULL,path TEXT NOT NULL,hash TEXT NOT NULL REFERENCES blobs(hash),kind TEXT NOT NULL,PRIMARY KEY(version_id,path));
    CREATE TABLE unrelated(id INTEGER PRIMARY KEY,body TEXT NOT NULL);
    INSERT INTO unrelated VALUES(1,'dirty unrelated fixture');
    PRAGMA user_version=1;
  `);
    const payload=JSON.stringify({visible:'legacy retained fixture'});db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(41,'legacy:source:41','qq_in','group:11111','22222',fixtureTime,fixtureTime,'old/source#event=41','conversation','legacy retained fixture',payload,fixtureHash(payload));
    db.prepare('INSERT INTO imports VALUES(?,?,?)').run('old/session.jsonl.zstd','frames-v2:42:123',fixtureTime);
    const cycle={id:'daily-2026-10-22',day:'2026-10-22',kind:'daily',state:'complete',memoryDone:true,unknownLegacy:{keep:['original',42]}};
    db.prepare('INSERT INTO cycles(id,day,kind,state,updated_at,payload) VALUES(?,?,?,?,?,?)').run(cycle.id,cycle.day,cycle.kind,cycle.state,fixtureTime,JSON.stringify(cycle));
    db.prepare('INSERT INTO versions(id,cycle_id,base_commit,tree_id,commit_hash,state,title,notes,plan,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(cycle.id,cycle.id,'a'.repeat(40),'b'.repeat(40),'c'.repeat(40),'committed','legacy fixture','existing notes',JSON.stringify({recordHighWatermark:41,unknownLegacy:{keep:true}}),fixtureTime);
    const content='fictional private snapshot retained',contentHash=fixtureHash(content);db.prepare('INSERT INTO blobs VALUES(?,?,?,?)').run(contentHash,Buffer.byteLength(content),'deflate',deflateSync(content));
    db.prepare('INSERT INTO snapshots VALUES(?,?,?,?)').run(cycle.id,'共享记忆库/fixture.md',contentHash,'memory');
  }finally{db.close();}
  await writeFile(join(directory,'.initialized'),'schema=1\n');await writeFile(join(root,'unrelated-dirty.txt'),'unchanged fixture worktree');
  return {root,directory,database,location:{root,database}};
}
export function archiveRows(file:string){const db=new DatabaseSync(file,{readOnly:true});try{return Object.fromEntries(['records','imports','cycles','versions','blobs','snapshots','unrelated','records_search'].map(table=>[table,db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]));}finally{db.close();}}
