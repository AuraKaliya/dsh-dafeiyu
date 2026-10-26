import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync,lstatSync } from 'node:fs';
import { mkdtemp,mkdir,readFile,readdir,symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { inspectExistingArchive,openExistingArchive,HostArchiveRecordSchema } from '../packages/server-compat/lib/index.js';
import type { ExistingArchive,HostArchiveRecord } from '../packages/server-compat/lib/index.js';
import { existingArchiveUri } from '../packages/server-compat/lib/safety.js';
import { existingArchiveFixture,archiveRows,fixtureTime } from './server-existing-archive-fixture.js';
import { testTempDir } from './test-temp.js';

const options={profileId:'fixture-host',clock:()=>Date.parse(fixtureTime)},hash='a'.repeat(64);
const record:HostArchiveRecord={id:'event:1',kind:'event',route:'group:11111',actor:'22222',occurredAt:fixtureTime,audience:'conversation',source:{id:'session:event:1',hash},payload:{type:'assistant/message',data:{text:'visible fictional reply'}}};
function toWritingNotes(archive:ExistingArchive){let cycle=archive.createCycle({id:'daily-2026-10-26',day:'2026-10-26',kind:'daily'});
  cycle=archive.transitionCycle({id:cycle.id,expectedToken:cycle.token,state:'memory',patch:{attempts:1}});
  cycle=archive.transitionCycle({id:cycle.id,expectedToken:cycle.token,state:'archiving',patch:{memoryDone:true,maintenance:{complete:true,remainingUsers:0,remainingPersona:0},memory_finished_at:fixtureTime}});
  return archive.transitionCycle({id:cycle.id,expectedToken:cycle.token,state:'writing_notes'});}
const plan={index:'fictional-private-index',recordHighWatermark:41,evidenceRefs:['maintenance:daily-2026-10-26','archive:41-41'],unknownPlan:{retain:['source identity',7]}};
const notes=(id:string,expectedToken:string)=>({id,expectedToken,title:'虚构日志夹具',notes:'这是持久层虚构文本，不是一次真实模型日志或 Git 保存。',evidenceRefs:plan.evidenceRefs,run:{runId:randomUUID(),closedEventId:randomUUID(),resultHash:hash}});

test('actual Node SQLite mode=rw refuses missing files and adapter never creates a database, marker or Git directory',async()=>{
  const root=await mkdtemp(join(testTempDir(),'archive-missing-')),directory=join(root,'历史记录');await mkdir(directory);const database=join(directory,'history.sqlite'),location={root,database};
  assert.throws(()=>new DatabaseSync(existingArchiveUri(database,true)));assert.equal(existsSync(database),false);
  assert.equal(inspectExistingArchive(location).ready,false);assert.throws(()=>openExistingArchive(location,options),/ARCHIVE_MISSING/);
  assert.deepEqual(await readdir(directory),[]);assert.equal(existsSync(join(root,'.git')),false);
});

test('read-only preflight and explicit existing open preserve all legacy rows, marker, unrelated data and main bytes',async()=>{
  const f=await existingArchiveFixture(),rows=archiveRows(f.database),bytes=await readFile(f.database),marker=await readFile(join(f.directory,'.initialized')),inspection=inspectExistingArchive(f.location);
  assert.equal(inspection.ready,true);assert.equal(inspection.searchImplementation,'columns-validated-not-assumed');assert.equal(inspection.identity?.database.ino,lstatSync(f.database,{bigint:true}).ino.toString());
  const archive=openExistingArchive(f.location,options);try{assert.equal(archive.range().through,'41');assert.equal(archive.getCycle('daily-2026-10-22')?.state,'complete');}finally{archive.close();}
  assert.deepEqual(archiveRows(f.database),rows);assert.deepEqual(await readFile(f.database),bytes);assert.deepEqual(await readFile(join(f.directory,'.initialized')),marker);
  assert.equal(await readFile(join(f.root,'unrelated-dirty.txt'),'utf8'),'unchanged fixture worktree');assert.equal(existsSync(join(f.root,'.git')),false);
});

test('wrong physical location, unknown schema and absent immutability trigger fail without repairing the legacy database',async()=>{
  const f=await existingArchiveFixture();assert.equal(inspectExistingArchive({...f.location,database:join(f.root,'history.sqlite')}).ready,false);
  let db=new DatabaseSync(f.database);db.exec('PRAGMA user_version=99');db.close();let before=await readFile(f.database);
  assert.equal(inspectExistingArchive(f.location).code,'ARCHIVE_SCHEMA_UNSUPPORTED');assert.throws(()=>openExistingArchive(f.location,options),/SCHEMA_UNSUPPORTED/);assert.deepEqual(await readFile(f.database),before);
  db=new DatabaseSync(f.database);db.exec("PRAGMA user_version=1; DROP TRIGGER records_immutable_update; CREATE TRIGGER records_immutable_update BEFORE UPDATE ON records BEGIN SELECT 1; END;");db.close();before=await readFile(f.database);
  assert.equal(inspectExistingArchive(f.location).code,'ARCHIVE_IMMUTABILITY_UNSUPPORTED');assert.deepEqual(await readFile(f.database),before);
});

test('unique partial constraints and usable search columns are checked without assuming a specific FTS declaration',async()=>{
  const f=await existingArchiveFixture();let db=new DatabaseSync(f.database);db.exec("DROP INDEX one_daily_cycle; CREATE UNIQUE INDEX one_daily_cycle ON cycles(day) WHERE kind='DAILY'");db.close();
  assert.equal(inspectExistingArchive(f.location).code,'ARCHIVE_UNIQUENESS_UNSUPPORTED');
  db=new DatabaseSync(f.database);db.exec("DROP INDEX one_daily_cycle; CREATE UNIQUE INDEX one_daily_cycle ON cycles(day) WHERE kind='daily'; DROP TRIGGER records_index; CREATE TRIGGER records_index AFTER INSERT ON records BEGIN INSERT INTO records_search(rowid,body) VALUES(new.id,new.source); END;");db.close();
  assert.equal(inspectExistingArchive(f.location).code,'ARCHIVE_SEARCH_TRIGGER_UNSUPPORTED');
  db=new DatabaseSync(f.database);db.exec('DROP TABLE records_search');db.close();
  assert.equal(inspectExistingArchive(f.location).code,'ARCHIVE_SCHEMA_UNSUPPORTED');
});

test('a junction to another existing history directory is rejected before any mutable open',async()=>{
  const f=await existingArchiveFixture(),aliasRoot=await mkdtemp(join(testTempDir(),'archive-alias-')),aliasDirectory=join(aliasRoot,'历史记录'),before=archiveRows(f.database);
  await symlink(f.directory,aliasDirectory,process.platform==='win32'?'junction':'dir');const location={root:aliasRoot,database:join(aliasDirectory,'history.sqlite')};
  assert.equal(inspectExistingArchive(location).code,'ARCHIVE_PATH_INVALID');assert.throws(()=>openExistingArchive(location,options),/PATH_INVALID/);assert.deepEqual(archiveRows(f.database),before);
});

test('host records discard private blocks, redact known secrets and enforce full source identity on replay',async()=>{
  const f=await existingArchiveFixture(),secret='SYNTHETIC_CREDENTIAL_abcdefghijkl',archive=openExistingArchive(f.location,{...options,knownSecrets:[secret]});
  const input:HostArchiveRecord={...record,payload:{type:'assistant/message',data:{visible:secret,reasoning:'INTERNAL_ONLY_SENTINEL',replayState:{raw:'REPLAY_SENTINEL'},credentials:{token:secret},blocks:[{type:'text',text:'visible fixture'},{type:'thinking',text:'HIDDEN_BLOCK_SENTINEL'}]}},text:'password='+secret};
  try{const first=archive.appendHostRecord(input),again=archive.appendHostRecord(input);assert.equal(first.key,'host:fixture-host:event:1');assert.equal(first.created,true);assert.equal(again.created,false);assert.equal(first.id,again.id);
    assert.throws(()=>HostArchiveRecordSchema.parse({...record,payload:{type:'thinking',data:'HIDDEN_TOP_LEVEL'}}));assert.throws(()=>HostArchiveRecordSchema.parse({...record,rawLogs:'UNCLASSIFIED'}));
    assert.throws(()=>archive.appendHostRecord({...input,payload:{type:'assistant/message',data:{visible:'different'}}}),/SOURCE_CONFLICT/);assert.throws(()=>archive.appendHostRecord({...input,route:'group:33333'}),/SOURCE_CONFLICT/);
    assert.throws(()=>archive.appendHostRecord({...record,source:{id:'Bearer '+secret,hash}}),/PRIVATE_METADATA/);
  }finally{archive.close();}
  const rows=archiveRows(f.database),body=JSON.stringify(rows.records);for(const value of [secret,'INTERNAL_ONLY_SENTINEL','REPLAY_SENTINEL','HIDDEN_BLOCK_SENTINEL'])assert.equal(body.includes(value),false);
  assert.equal(rows.records?.length,2);assert.equal(rows.imports?.[0]?.fingerprint,'frames-v2:42:123');
});

test('two writers use row CAS while preserving unknown cycle fields and extra columns',async()=>{
  const f=await existingArchiveFixture(),first=openExistingArchive(f.location,options),second=openExistingArchive(f.location,options);
  try{const cycle=first.createCycle({id:'manual-fixture',day:'2026-10-26',kind:'manual'});const raw=new DatabaseSync(f.database);
    try{const payload=JSON.parse(String(raw.prepare('SELECT payload FROM cycles WHERE id=?').get(cycle.id)?.payload)) as Record<string,unknown>;payload.futureLegacy={opaque:['keep',42]};raw.prepare('UPDATE cycles SET payload=? WHERE id=?').run(JSON.stringify(payload),cycle.id);}finally{raw.close();}
    const a=first.getCycle(cycle.id)!,b=second.getCycle(cycle.id)!;assert.equal(a.token,b.token);
    const changed=first.transitionCycle({id:a.id,expectedToken:a.token,state:'memory',patch:{attempts:1}});assert.deepEqual(changed.payload.futureLegacy,{opaque:['keep',42]});
    assert.throws(()=>second.transitionCycle({id:b.id,expectedToken:b.token,state:'memory',patch:{attempts:1}}),/CAS_CONFLICT/);
    const db=new DatabaseSync(f.database);try{assert.equal(db.prepare('SELECT legacy_extra FROM cycles WHERE id=?').get(a.id)?.legacy_extra,'retain-cycle-column');assert.throws(()=>db.exec("UPDATE records SET body='illegal'"),/append-only/);assert.throws(()=>db.exec('DELETE FROM records'),/append-only/);}finally{db.close();}
  }finally{second.close();first.close();}
});

test('version preparation, visible notes and commit facts progress in order and terminal records are never rewritten',async()=>{
  const f=await existingArchiveFixture(),before=archiveRows(f.database),archive=openExistingArchive(f.location,options);
  try{let cycle=toWritingNotes(archive);assert.throws(()=>archive.prepareVersion({id:cycle.id,cycleId:cycle.id,expectedCycleToken:cycle.token,baseCommit:'c'.repeat(40),treeId:'d'.repeat(40),plan:{...plan,recordHighWatermark:0}}),/WATERMARK_REGRESSION/);
    let version=archive.prepareVersion({id:cycle.id,cycleId:cycle.id,expectedCycleToken:cycle.token,baseCommit:'c'.repeat(40),treeId:'d'.repeat(40),plan});
    assert.equal(archive.prepareVersion({id:cycle.id,cycleId:cycle.id,expectedCycleToken:cycle.token,baseCommit:'c'.repeat(40),treeId:'d'.repeat(40),plan}).token,version.token);
    assert.throws(()=>archive.markCommitted({id:version.id,expectedToken:version.token,commitHash:'f'.repeat(40)}),/VERSION_TRANSITION/);
    const stale=version;version=archive.saveVersionNotes(notes(version.id,version.token));assert.throws(()=>archive.saveVersionNotes(notes(stale.id,stale.token)),/CAS_CONFLICT/);
    assert.throws(()=>archive.markCommitPrepared({id:version.id,expectedToken:version.token,treeId:'e'.repeat(40),commitHash:'f'.repeat(40)}),/COMMIT_ORDER/);
    cycle=archive.transitionCycle({id:cycle.id,expectedToken:cycle.token,state:'committing'});
    version=archive.markCommitPrepared({id:version.id,expectedToken:version.token,treeId:'e'.repeat(40),commitHash:'f'.repeat(40)});
    assert.throws(()=>archive.transitionCycle({id:cycle.id,expectedToken:cycle.token,state:'complete',patch:{version:version.id,commit:'f'.repeat(40),finished_at:fixtureTime}}),/COMMIT_INCOMPLETE/);
    version=archive.markCommitted({id:version.id,expectedToken:version.token,commitHash:'f'.repeat(40)});assert.deepEqual(version.plan.unknownPlan,plan.unknownPlan);
    cycle=archive.transitionCycle({id:cycle.id,expectedToken:cycle.token,state:'complete',patch:{version:version.id,commit:'f'.repeat(40),finished_at:fixtureTime}});
    assert.throws(()=>archive.transitionCycle({id:cycle.id,expectedToken:cycle.token,state:'memory'}),/CYCLE_COMPLETE/);assert.throws(()=>archive.markCommitted({id:version.id,expectedToken:version.token,commitHash:'f'.repeat(40)}),/VERSION_COMMITTED/);
    assert.equal(archive.range('41').through,'42');
  }finally{archive.close();}
  const after=archiveRows(f.database);for(const table of ['imports','blobs','snapshots','unrelated'])assert.deepEqual(after[table],before[table]);
  assert.deepEqual(after.records?.[0],before.records?.[0]);assert.deepEqual(after.cycles?.[0],before.cycles?.[0]);assert.deepEqual(after.versions?.[0],before.versions?.[0]);
  assert.equal(after.versions?.[1]?.legacy_extra,'retain-version-column');
});

test('failed and pending maintenance cannot skip to completion or rewind an already completed legacy cycle',async()=>{
  const f=await existingArchiveFixture(),archive=openExistingArchive(f.location,options);
  try{const old=archive.getCycle('daily-2026-10-22')!;assert.equal(archive.createCycle({id:old.id,day:old.day,kind:'daily'}).token,old.token);assert.throws(()=>archive.transitionCycle({id:old.id,expectedToken:old.token,state:'memory'}),/CYCLE_COMPLETE/);
    let cycle=archive.createCycle({id:'manual-pending',day:'2026-10-26',kind:'manual'});assert.throws(()=>archive.transitionCycle({id:cycle.id,expectedToken:cycle.token,state:'complete'}),/CYCLE_TRANSITION/);
    cycle=archive.transitionCycle({id:cycle.id,expectedToken:cycle.token,state:'memory'});
    assert.throws(()=>archive.transitionCycle({id:cycle.id,expectedToken:cycle.token,state:'archiving',patch:{memoryDone:true,maintenance:{complete:false}}}),/MAINTENANCE_INCOMPLETE/);
    cycle=archive.transitionCycle({id:cycle.id,expectedToken:cycle.token,state:'failed',patch:{error:'FIXTURE_MAINTENANCE_FAILED',retryAt:Date.parse(fixtureTime)+600000}});
    assert.throws(()=>archive.transitionCycle({id:cycle.id,expectedToken:cycle.token,state:'archiving'}),/CYCLE_TRANSITION/);
    assert.equal(archive.transitionCycle({id:cycle.id,expectedToken:cycle.token,state:'memory'}).state,'memory');
  }finally{archive.close();}
});

test('changing schema after open prevents further writes instead of repairing dropped protections',async()=>{
  const f=await existingArchiveFixture(),archive=openExistingArchive(f.location,options),db=new DatabaseSync(f.database);
  try{db.exec('DROP TRIGGER records_immutable_delete');assert.throws(()=>archive.appendHostRecord(record),/SCHEMA_CHANGED/);assert.equal(db.prepare('SELECT count(*) AS n FROM records').get()?.n,1);}finally{db.close();archive.close();}
});
