import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp,mkdir,readFile,writeFile,unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { taskScopeKey } from '@dafeiyu/contracts';
import { loadHostConfig,initializeProfile,inspectHost,inspectStorage,planMigration,applyMigration,verifyMigration } from '@dafeiyu/host';
import { bindMigratedProfile,readManifest } from '../packages/host/lib/profile.js';
import { MigrationPlanSchema } from '../packages/host/lib/migration.js';
import { executorFilesSnapshot,executorSnapshotPath } from '../packages/host/lib/executor-snapshot.js';
import { ExecutorStore } from '@dafeiyu/server-executor/store';
import { ExecutorJobSpecSchema } from '@dafeiyu/server-executor/types';
import { testTempDir } from './test-temp.js';

const identity={agentId:'fictional-fish',profileId:'executor-storage'},hash='a'.repeat(64);
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
async function fixture(enabled=false){
  const root=await mkdtemp(join(testTempDir(),'host-executor-storage-')),file=join(root,'host.json'),coordination=join(root,'coordination.sqlite');
  const executor={id:'server-executor',required:true,config:{command:{nodePath:process.execPath,nodeHash:hash,entryPath:join(root,'fixture-entry.js'),entryHash:hash,cwd:root,args:[],profilePath:join(root,'fixture-profile.json'),profileHash:hash,env:{}},
    route:{provider:'local-test',model:'scripted',reasoningEffort:null,contextWindow:32768,maxOutputTokens:2048,maxRequestBytes:100000},budgetAuthorizationId:'fictional-budget',resultOwner:{account:'12345678',ownerId:'87654321'}}};
  const config={schemaVersion:1,profileId:identity.profileId,agent:{id:identity.agentId},paths:{core:'data/core',memory:'data/memory',sessions:'data/sessions',query:'data/query.sqlite'},
    modelRoutes:{chat:{provider:'local-test',model:'scripted'}},persona:{fixedFile:'persona.md',kind:'test'},plugins:[{id:'model-scripted',required:true,config:{}},{id:'timeline',required:true,config:{execution:true}},
      {id:'memory',required:true,config:{}}] as {id:string;required:boolean;config:Record<string,unknown>}[]};
  if(enabled)config.plugins.push(executor);
  await writeFile(join(root,'persona.md'),'受管离线夹具人格，不调用模型。');await writeFile(file,JSON.stringify(config));
  const old=loadHostConfig(file);initializeProfile(old,coordination);
  return {root,file,coordination,config,old,enable:async()=>{config.plugins.push(executor);await writeFile(file,JSON.stringify(config));return loadHostConfig(file);}};
}
function bundle(f:Awaited<ReturnType<typeof fixture>>){return {coreDir:f.old.paths.core,memoryDir:f.old.paths.memory,sessionsDir:f.old.paths.sessions,backupDir:join(f.root,'backups'),identity};}
function rows(file:string){const db=new DatabaseSync(file,{readOnly:true});try{return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>{
  const name=String(row.name);assert.match(name,/^[a-z_]+$/);return {name,rows:db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()};});}finally{db.close();}}
async function seed(core:string,state:'completed'|'unknown'='completed'){
  const file=join(core,'executor.sqlite'),taskId=randomUUID(),scope={kind:'task' as const,agentId:identity.agentId,taskId,scopeKey:taskScopeKey(identity.agentId,taskId)},store=new ExecutorStore(file,identity,true);
  try{
    const spec=ExecutorJobSpecSchema.parse({schemaVersion:1,scope,intentVersion:1,requestId:'fixture-job',authorizationKey:hash,goalHash:hash,inputHash:hash,profileHash:hash,commandHash:hash,executableHash:hash,budgetAuthorizationId:'fictional-budget'});
    const job=store.prepare(spec,{runId:randomUUID(),operationId:randomUUID(),authorizationHash:hash}).job,launch=store.claimLaunch(job.id,scope,job.version,'b'.repeat(64));
    const running=store.running(job.id,scope,launch.version,{nonceHash:launch.nonceHash!,profileHash:hash,process:{pid:74123,creationId:'simulated-storage-only-process',executableHash:hash}});
    const bytes=Buffer.from(JSON.stringify({schemaVersion:1,jobId:job.id,visible:'仅虚构结果存档；没有启动任何进程。'})),relative=`results/${job.id}.json`;
    await mkdir(join(core,'results'),{recursive:true});await writeFile(join(core,relative),bytes,{flag:'wx'});
    const link={callId:randomUUID(),reservationId:randomUUID(),requestHash:hash};store.linkBudget(job.id,scope,link);store.settleBudget(job.id,scope,{callId:link.callId,reservationId:link.reservationId,state:state==='unknown'?'unknown':'settled',settlementHash:hash});
    store.seal(job.id,scope,running.version,{state,effects:state==='unknown'?'unknown':'confirmed',sessionId:'fictional-session',exit:{code:0,signal:null,verified:state!=='unknown'},output:{relative,hash:digest(bytes),bytes:bytes.length},gaps:state==='unknown'?['EXECUTOR_TREE_UNCONTAINED']:[]});
    return {file,relative,bytes,jobId:job.id};
  }finally{store.close();}
}

test('executor init is explicit and an unchanged old profile gains no executor manifest fields or database',async()=>{
  const old=await fixture(),before=await readFile(join(old.old.paths.core,'host-profile.json'));
  assert.equal(existsSync(join(old.old.paths.core,'executor.sqlite')),false);assert.equal(readManifest(old.old)?.requiredStores.includes('executor'),false);
  assert.equal(inspectHost(old.old,old.coordination).ready,true);bindMigratedProfile(old.old);assert.deepEqual(await readFile(join(old.old.paths.core,'host-profile.json')),before);
  const fresh=await fixture(true);assert.equal(inspectStorage(join(fresh.old.paths.core,'executor.sqlite'),'executor',identity).version,1);assert.ok(readManifest(fresh.old)?.requiredStores.includes('executor'));assert.equal(inspectHost(fresh.old,fresh.coordination).ready,true);
});

test('enabling executor requires backed-up migration and interrupted initialization resumes before manifest binding',async()=>{
  const f=await fixture(),enabled=await f.enable(),file=join(enabled.paths.core,'executor.sqlite'),before=rows(join(enabled.paths.memory,'memory.sqlite'));
  assert.ok(inspectHost(enabled,f.coordination).codes.includes('HOST_MIGRATION_REQUIRED'));assert.equal(existsSync(file),false);
  assert.throws(()=>bindMigratedProfile(enabled),/HOST_MIGRATION_REQUIRED/);assert.equal(existsSync(file),false);assert.throws(()=>initializeProfile(enabled,f.coordination),/REQUIRES_EMPTY/);
  const plan=await planMigration({...bundle(f),executor:true});assert.equal(plan.files.find(value=>value.kind==='executor')?.before.exists,false);assert.deepEqual(plan.executorFiles,[]);
  await assert.rejects(applyMigration(plan,{afterStep:kind=>{if(kind==='executor')throw new Error('fixture interrupt after create');}}),/BACKUP_RETAINED/);
  assert.throws(()=>bindMigratedProfile(enabled),/MIGRATION_INCOMPLETE|MIGRATION_REQUIRED/);const executorBefore=await readFile(file);
  assert.equal((await applyMigration(plan)).complete,true);assert.deepEqual(await readFile(file),executorBefore);assert.equal(verifyMigration(plan).passed,true);
  bindMigratedProfile(enabled);assert.ok(readManifest(enabled)?.requiredStores.includes('executor'));assert.deepEqual(rows(join(enabled.paths.memory,'memory.sqlite')),before);
  assert.equal(existsSync(join(f.root,'backups',plan.id,'1-memory.sqlite')),true);
  f.config.plugins=f.config.plugins.filter(value=>value.id!=='server-executor');await writeFile(f.file,JSON.stringify(f.config));const disabled=loadHostConfig(f.file);
  assert.ok(readManifest(disabled)?.requiredStores.includes('executor'));assert.equal(inspectHost(disabled,f.coordination).ready,true);
  await unlink(file);assert.ok(inspectHost(disabled,f.coordination).codes.includes('HOST_INITIALIZATION_REQUIRED'));
});

test('an existing disabled executor preserves its closed DB bytes, unknown job, budget links and all result files',async()=>{
  const f=await fixture(),seeded=await seed(f.old.paths.core,'unknown'),orphan=`results/${randomUUID()}.json`,orphanBytes=Buffer.from('{"fixture":"unsealed-result-retained"}');
  await writeFile(join(f.old.paths.core,orphan),orphanBytes);const bytes=await readFile(seeded.file),before=rows(seeded.file),plan=await planMigration(bundle(f));
  assert.equal(plan.bundle.executor,undefined);assert.equal(plan.files.find(value=>value.kind==='executor')?.before.exists,true);assert.equal(plan.executorFiles?.length,2);
  await applyMigration(plan);assert.equal(verifyMigration(plan).passed,true);assert.deepEqual(await readFile(seeded.file),bytes);assert.deepEqual(rows(seeded.file),before);
  assert.deepEqual(await readFile(join(f.root,'backups',plan.id,'executor-files',seeded.relative)),seeded.bytes);assert.deepEqual(await readFile(join(f.root,'backups',plan.id,'executor-files',orphan)),orphanBytes);
  assert.equal((await applyMigration(plan)).complete,true);assert.deepEqual(rows(seeded.file),before);
});

test('corrupt result backups fail verification and cannot authorize an existing profile activation',async()=>{
  const f=await fixture(),seeded=await seed(f.old.paths.core),enabled=await f.enable(),plan=await planMigration({...bundle(f),executor:true});await applyMigration(plan);
  assert.equal(verifyMigration(plan).passed,true);await writeFile(join(f.root,'backups',plan.id,'executor-files',seeded.relative),'corrupt fixture bytes');
  assert.equal(verifyMigration(plan).passed,false);assert.ok(inspectHost(enabled,f.coordination).codes.includes('HOST_MIGRATION_REQUIRED'));assert.throws(()=>bindMigratedProfile(enabled),/MIGRATION_REQUIRED/);
  await assert.rejects(applyMigration(plan),/COMPLETION_MISMATCH/);assert.deepEqual(await readFile(join(f.old.paths.core,seeded.relative)),seeded.bytes);
});

test('SQLite backup captures committed WAL rows while executor source pages are not rewritten',async()=>{
  const f=await fixture(),seeded=await seed(f.old.paths.core),writer=new DatabaseSync(seeded.file);
  try{
    writer.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; UPDATE executor_clock SET last_seen=last_seen+1 WHERE id=1');
    const mainPages=await readFile(seeded.file),lastSeen=writer.prepare('SELECT last_seen FROM executor_clock WHERE id=1').get()?.last_seen,plan=await planMigration(bundle(f));
    await applyMigration(plan);assert.equal(verifyMigration(plan).passed,true);assert.deepEqual(await readFile(seeded.file),mainPages);
    const index=plan.files.findIndex(value=>value.kind==='executor'),copy=new DatabaseSync(join(f.root,'backups',plan.id,`${index}-executor.sqlite`),{readOnly:true});
    try{assert.equal(copy.prepare('SELECT last_seen FROM executor_clock WHERE id=1').get()?.last_seen,lastSeen);}finally{copy.close();}
    // The SQLite backup represents committed rows; its database pages need not equal the pre-checkpoint main file.
  }finally{writer.close();}
});

test('missing receipt archives and changed source snapshots stop before migration applies',async()=>{
  const f=await fixture(),seeded=await seed(f.old.paths.core),plan=await planMigration(bundle(f));await writeFile(join(f.old.paths.core,seeded.relative),'changed fixture archive');
  assert.ok(inspectHost(f.old,f.coordination).codes.includes('HOST_EXECUTOR_ARCHIVE_INVALID'));await assert.rejects(applyMigration(plan),/RESULT_MISSING_OR_CHANGED/);
  assert.equal(existsSync(join(f.root,'backups',plan.id)),false);await unlink(join(f.old.paths.core,seeded.relative));await assert.rejects(planMigration(bundle(f)),/RESULT_MISSING_OR_CHANGED/);
});

test('read-only executor inspection rejects wrong identity, missing immutability triggers and unknown schema without recovery',async()=>{
  const f=await fixture(),seeded=await seed(f.old.paths.core,'unknown'),before=await readFile(seeded.file),snapshot=rows(seeded.file);
  assert.equal(inspectStorage(seeded.file,'executor',{...identity,agentId:'wrong'}).identityMatches,false);assert.deepEqual(await readFile(seeded.file),before);assert.deepEqual(rows(seeded.file),snapshot);
  const db=new DatabaseSync(seeded.file);try{db.exec('DROP TRIGGER executor_receipts_immutable');}finally{db.close();}
  assert.equal(inspectStorage(seeded.file,'executor',identity).supported,false);await assert.rejects(planMigration(bundle(f)),/STORE_UNSUPPORTED/);
  const changed=new DatabaseSync(seeded.file);try{changed.exec('PRAGMA user_version=999');}finally{changed.close();}
  const unknown=await readFile(seeded.file);assert.equal(inspectStorage(seeded.file,'executor',identity).supported,false);assert.deepEqual(await readFile(seeded.file),unknown);
});

test('old plans retain absent optional fields and executor archives accept only their exact owned directory',async()=>{
  const f=await fixture(),old=await planMigration(bundle(f));assert.equal(Object.hasOwn(old.bundle,'executor'),false);assert.equal(Object.hasOwn(old,'executorFiles'),false);assert.deepEqual(MigrationPlanSchema.parse(old),old);
  await applyMigration(old);assert.equal(verifyMigration(old).passed,true);assert.equal(existsSync(join(f.old.paths.core,'executor.sqlite')),false);
  const seeded=await seed(f.old.paths.core);for(const part of ['../private.json',seeded.relative.replace('results/','Temp/'),seeded.relative.replace('.json','.txt'),'results/nested/'+randomUUID()+'.json'])assert.throws(()=>executorSnapshotPath(f.old.paths.core,part));
  await assert.rejects(planMigration({...bundle(f),backupDir:join(f.old.paths.core,'results','backups')}),/BACKUP_INSIDE_EXECUTOR_SOURCE/);
  await mkdir(join(f.old.paths.core,'results','unowned'));assert.throws(()=>executorFilesSnapshot(f.old.paths.core),/FILE_UNSUPPORTED/);
});
