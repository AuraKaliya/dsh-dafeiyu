import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readFile } from 'node:fs/promises';
import { testTempDir as tmpdir } from './test-temp.js';
import { join,resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID,createHash } from 'node:crypto';
import { readFoundation } from '@dafeiyu/core';
import { RuntimeStore,runtimeHash } from '@dafeiyu/core/runtime-store';
import { MemoryStore } from '@dafeiyu/memory/store';
import { PersonaManifestSchema,taskScopeKey } from '@dafeiyu/contracts';
import { PERSONA_TABLES } from '../packages/memory/lib/migrate-persona.js';
import { planMigration,applyMigration,inspectStorage } from '@dafeiyu/host';
import { migrationFixture } from './runtime-migration-fixture.js';

const identity={agentId:'fish',profileId:'fixture'};
const directory=()=>mkdtemp(join(tmpdir(),'dafeiyu-persona-storage-'));
function accepted(store:RuntimeStore){const taskId=randomUUID(),request=store.prepareRequest('fixture','first',{goal:'fictional'});store.bindTask(request.id,taskId);
  const run=store.acceptRun(request.id,{taskId,scope:{kind:'task',agentId:'fish',taskId,scopeKey:taskScopeKey('fish',taskId)},origin:{kind:'native',producerId:'fixture',requestId:'first'},intentVersion:1,policyId:'fixture'});
  return store.transition(run.id,run.version,'queued');}
function snapshot(){const foundation=readFoundation(resolve('profiles/persona.foundation.md')),model={provider:'fixture',model:'scripted'};
  return {foundation,model,body:{sessionId:'fictional-session',personaVersion:foundation.version,model,registryVersion:runtimeHash([]),authorityVersion:runtimeHash({}),inputs:[]}};}
function manifest(runId:string){const {foundation,model}=snapshot();return PersonaManifestSchema.parse({schemaVersion:1,agentId:'fish',runId,foundationHash:foundation.version,foundationIdentity:foundation.fileIdentity,
  stageRevision:0,selectionVersion:0,stageStatus:'not-configured',entries:[],continuityCheckpointId:null,policyVersion:runtimeHash({}),modelRouteHash:runtimeHash(model),assemblyVersion:'1'});}
function removePersonaTables(db:DatabaseSync){for(const table of [...PERSONA_TABLES].reverse())db.exec(`DROP TABLE ${table}`);db.prepare('DELETE FROM memory_schema_migrations WHERE version=8').run();db.exec('PRAGMA user_version=7');}

test('foundation snapshots reject invalid UTF-8, empty, NUL and oversized files with no fallback',async()=>{
  const root=await directory(),file=join(root,'foundation.md');await writeFile(file,'虚构底色');const first=readFoundation(file);
  assert.equal(first.version,createHash('sha256').update('虚构底色').digest('hex'));assert.equal(Object.isFrozen(first),true);
  await writeFile(file,'新底色');const second=readFoundation(file);assert.notEqual(first.version,second.version);assert.equal(first.text,'虚构底色');assert.equal(first.fileIdentity,second.fileIdentity);
  for(const value of [Buffer.from([0xc3,0x28]),Buffer.from(' \n'),Buffer.from('含\0空字符'),Buffer.from('字'.repeat(32001))]){await writeFile(file,value);assert.throws(()=>readFoundation(file),/FOUNDATION_INVALID/);}
  assert.throws(()=>readFoundation(join(root,'missing.md')),/FOUNDATION_INVALID/);assert.throws(()=>readFoundation(root),/FOUNDATION_INVALID/);
});

test('managed runtime requires a matching immutable persona manifest in the same start transaction',async()=>{
  const file=join(await directory(),'runtime.sqlite'),store=new RuntimeStore(file,identity,{create:true,requirePersonaManifest:true});
  try{const run=accepted(store);assert.throws(()=>store.start(run.id,run.version,snapshot().body),/PERSONA_MANIFEST_REQUIRED/);assert.equal(store.get(run.id).state,'queued');
    assert.throws(()=>store.start(run.id,run.version,snapshot().body,{...manifest(run.id),runId:randomUUID()}),/PERSONA_BINDING_CONFLICT/);
    const db=new DatabaseSync(file);try{db.exec("CREATE TRIGGER fixture_manifest_failure BEFORE INSERT ON run_persona_manifests BEGIN SELECT RAISE(ABORT,'fixture');END;");
      assert.throws(()=>store.start(run.id,run.version,snapshot().body,manifest(run.id)),/fixture/);assert.equal(store.get(run.id).snapshot,null);db.exec('DROP TRIGGER fixture_manifest_failure');
      store.start(run.id,run.version,snapshot().body,manifest(run.id));assert.equal(store.personaBinding(run.id).kind,'bound');
      assert.throws(()=>db.prepare("UPDATE run_persona_manifests SET body='{}' WHERE run_id=?").run(run.id),/Immutable/);assert.throws(()=>db.prepare('DELETE FROM run_persona_manifests WHERE run_id=?').run(run.id),/Retain/);
    }finally{db.close();}
  }finally{store.close();}
});

test('runtime v1 upgrade is explicit and retains old snapshots without inventing persona adoption',async()=>{
  const file=join(await directory(),'runtime.sqlite');let store=new RuntimeStore(file,identity,{create:true});const run=accepted(store);store.start(run.id,run.version,snapshot().body);store.close();
  const db=new DatabaseSync(file);db.exec('DROP TABLE run_persona_manifests;PRAGMA user_version=1');const before=db.prepare('SELECT * FROM runs').all();db.close();
  const raw=await readFile(file);assert.throws(()=>new RuntimeStore(file,identity),/MIGRATION_REQUIRED/);assert.deepEqual(await readFile(file),raw);
  store=new RuntimeStore(file,identity,{migrate:true});try{assert.equal(store.personaBinding(run.id).kind,'legacy-unbound');const check=new DatabaseSync(file,{readOnly:true});try{assert.deepEqual(check.prepare('SELECT * FROM runs').all(),before);assert.equal(check.prepare('PRAGMA user_version').get()?.user_version,2);}finally{check.close();}}finally{store.close();}
});

test('memory v7 upgrade is additive, idempotent and does not promote old growth selections',async()=>{
  const file=join(await directory(),'memory.sqlite');new MemoryStore(file).close();const db=new DatabaseSync(file);removePersonaTables(db);
  db.prepare('INSERT INTO growth_selections VALUES(?,?,?,?)').run('fish','legacy-scope',7,JSON.stringify({fixture:'must not be adopted'}));const before=db.prepare('SELECT * FROM growth_selections').all();db.close();
  assert.equal(inspectStorage(file,'memory').version,7);new MemoryStore(file).close();new MemoryStore(file).close();const after=new DatabaseSync(file);
  try{assert.deepEqual(after.prepare('SELECT * FROM growth_selections').all(),before);assert.equal(after.prepare('SELECT count(*) AS n FROM persona_profiles').get()?.n,0);assert.equal(after.prepare('SELECT count(*) AS n FROM memory_schema_migrations WHERE version=8').get()?.n,1);
    const id=randomUUID();after.prepare('INSERT INTO persona_candidates VALUES(?,?,?,?)').run(id,'fish',1,'proposed');after.prepare('INSERT INTO persona_candidate_revisions VALUES(?,?,?,?)').run(id,1,'{}','fixture');
    assert.throws(()=>after.prepare("UPDATE persona_candidate_revisions SET body='changed'").run(),/Immutable/);
  }finally{after.close();}
});

test('persona upgrade failure rolls back additions while preserving v7 and its original selection',async()=>{
  const file=join(await directory(),'memory.sqlite');new MemoryStore(file).close();const db=new DatabaseSync(file);removePersonaTables(db);
  db.exec('CREATE TABLE persona_profiles(unrelated TEXT)');db.prepare('INSERT INTO persona_profiles VALUES(?)').run('keep');db.close();
  assert.throws(()=>new MemoryStore(file),/already exists/);const check=new DatabaseSync(file);try{assert.equal(check.prepare('PRAGMA user_version').get()?.user_version,7);assert.equal(check.prepare('SELECT unrelated FROM persona_profiles').get()?.unrelated,'keep');assert.equal(check.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='persona_candidates'").get()?.n,0);}finally{check.close();}
});

test('profile migration resumes between memory v8 and runtime v2 with all old Run rows retained',async()=>{
  const fixture=await migrationFixture(),memoryFile=join(fixture.memoryDir,'memory.sqlite'),runtimeFile=join(fixture.coreDir,'runtime.sqlite');new MemoryStore(memoryFile).close();
  const memory=new DatabaseSync(memoryFile);removePersonaTables(memory);memory.close();const original=new RuntimeStore(runtimeFile,fixture.identity,{create:true});const run=accepted(original);original.close();
  const runtime=new DatabaseSync(runtimeFile);runtime.exec('DROP TABLE run_persona_manifests;PRAGMA user_version=1');runtime.close();
  const plan=await planMigration(fixture);assert.deepEqual(plan.files.filter(file=>file.kind==='memory'||file.kind==='runtime').map(file=>file.targetVersion),[8,2]);
  await assert.rejects(applyMigration(plan,{afterStep:kind=>{if(kind==='memory')throw new Error('fixture interruption');}}),/BACKUP_RETAINED/);
  assert.equal(inspectStorage(memoryFile,'memory').version,8);assert.equal(inspectStorage(runtimeFile,'runtime').version,1);
  await applyMigration(plan);assert.equal(inspectStorage(runtimeFile,'runtime').version,2);assert.equal((await applyMigration(plan)).complete,true);
  const verified=new RuntimeStore(runtimeFile,fixture.identity);try{assert.deepEqual(verified.get(run.id),run);assert.equal(verified.personaBinding(run.id).kind,'legacy-unbound');}finally{verified.close();}
});
