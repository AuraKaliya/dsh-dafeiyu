import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile,writeFile,access } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Journal,inspectJournal } from '@dafeiyu/journal';
import { taskScopeKey } from '@dafeiyu/contracts';
import { planMigration,applyMigration,verifyMigration,inspectStorage } from '@dafeiyu/host';
import { MemoryStore } from '@dafeiyu/memory/store';
import { migrationFixture } from './runtime-migration-fixture.js';
import { legacySnapshot } from './legacy-memory-fixture.js';
import { Worker } from 'node:worker_threads';

test('read-only preflight recognizes early journal v1 without analysis grants and leaves files unchanged',async()=>{
  const fixture=await migrationFixture(),file=join(fixture.coreDir,'journal.sqlite'),before=await readFile(file);
  assert.equal(inspectJournal(file).version,1);assert.equal(inspectJournal(file).supported,true);assert.deepEqual(await readFile(file),before);
  const journal=new Journal(file);try{assert.equal(journal.get(fixture.journal.id).state,'delivered');assert.equal(journal.events(fixture.journal.route)[0]?.id,fixture.journal.eventId);}finally{journal.close();}
  assert.equal(inspectJournal(file).version,2);
});

test('task events never appear through the old conversation event or timeline scope',async()=>{
  const fixture=await migrationFixture(),journal=new Journal(join(fixture.coreDir,'journal.sqlite'));
  try{const taskId=randomUUID(),runId=randomUUID(),id=randomUUID(),route=taskScopeKey('fish',taskId);
    const input={agentId:'fish',taskId,runId,route,traceId:runId,operationId:runId,causedBy:null,type:'run.started',plugin:'core',pluginVersion:'fixture',occurredAt:new Date().toISOString(),sources:[],data:{fixture:'internal-only'}};
    const first=journal.appendExecutionOnce(input,id);assert.equal(journal.appendExecutionOnce(input,id).seq,first.seq);
    assert.equal(journal.events(route).length,0);assert.equal(journal.scopedEvent({agentId:'fish',route},id),null);
    assert.equal(journal.executionEvents('other',taskId).length,0);assert.equal(journal.executionEvents('fish',taskId).length,1);
    assert.throws(()=>journal.appendExecutionOnce({...input,data:{fixture:'changed'}},id),/idempotency conflict/);
  }finally{journal.close();}
});

test('multi-store migration creates verified backups and preserves legacy rows, tombstones and sessions',async()=>{
  const fixture=await migrationFixture(),memoryFile=join(fixture.memoryDir,'memory.sqlite'),db=new DatabaseSync(memoryFile),before=legacySnapshot(db);db.close();
  const originalSession=await readFile(join(fixture.sessionsDir,'fictional.jsonl'));
  const plan=await planMigration(fixture);assert.equal(inspectStorage(memoryFile,'memory').version,1);
  const result=await applyMigration(plan);assert.equal(result.complete,true);assert.equal(verifyMigration(plan).passed,true);
  const after=new DatabaseSync(memoryFile);try{assert.deepEqual(legacySnapshot(after),before);assert.equal(after.prepare('PRAGMA user_version').get()?.user_version,7);assert.equal(after.prepare('SELECT count(*) AS n FROM execution_sources').get()?.n,0);assert.equal(after.prepare('SELECT count(*) AS n FROM memory_schema_migrations WHERE version=7').get()?.n,1);}finally{after.close();}
  assert.deepEqual(await readFile(join(fixture.sessionsDir,'fictional.jsonl')),originalSession);
  await access(join(fixture.backupDir,plan.id,'0-journal.sqlite'));await access(join(fixture.backupDir,plan.id,'1-memory.sqlite'));
  const marker=JSON.parse(await readFile(join(fixture.coreDir,'migration-state.json'),'utf8'));assert.equal(marker.complete,true);
  const memory=new MemoryStore(memoryFile);try{assert.equal(memory.read(fixture.memory.scope,fixture.memory.parent.id),null);assert.equal(memory.read(fixture.memory.scope,fixture.memory.parent.id,'deleted')?.deleted,true);}finally{memory.close();}
  assert.equal((await applyMigration(plan)).complete,true);
});

test('migration interrupted between databases resumes forward without repeating earlier history or resetting data',async()=>{
  const fixture=await migrationFixture(),plan=await planMigration(fixture);
  await assert.rejects(applyMigration(plan,{afterStep:kind=>{if(kind==='journal')throw new Error('injected interruption');}}),/BACKUP_RETAINED/);
  assert.equal(JSON.parse(await readFile(join(fixture.coreDir,'migration-state.json'),'utf8')).complete,false);
  assert.equal(inspectJournal(join(fixture.coreDir,'journal.sqlite')).version,2);assert.equal(inspectStorage(join(fixture.memoryDir,'memory.sqlite'),'memory').version,1);
  await applyMigration(plan);assert.equal(verifyMigration(plan).passed,true);
  const journal=new Journal(join(fixture.coreDir,'journal.sqlite'));try{assert.equal(journal.events(fixture.journal.route).length,1);assert.equal(journal.get(fixture.journal.id).state,'delivered');}finally{journal.close();}
});

test('migration refuses live owners before changing old schema and rejects stale source plans',async()=>{
  const fixture=await migrationFixture(),file=join(fixture.coreDir,'journal.sqlite'),db=new DatabaseSync(file);
  db.prepare('INSERT INTO ownership VALUES(1,?,?)').run(process.pid,'fixture-owner');db.close();const before=await readFile(file);
  assert.throws(()=>new Journal(file),/already owned/);assert.deepEqual(await readFile(file),before);
  await assert.rejects(planMigration(fixture),/ACTIVE_OWNER/);
  const release=new DatabaseSync(file);release.exec('DELETE FROM ownership');release.close();const plan=await planMigration(fixture);
  await writeFile(join(fixture.sessionsDir,'fictional.jsonl'),'changed fictional history\n');await assert.rejects(applyMigration(plan),/SESSION_CHANGED/);
  assert.equal(inspectJournal(file).version,1);
});

test('migration rejects unknown databases, omitted preservation digests and session path traversal',async()=>{
  const fixture=await migrationFixture(),plan=await planMigration(fixture);
  await assert.rejects(planMigration({...fixture,identity:{...fixture.identity,agentId:'wrong-agent'}}),/AGENT_BINDING_MISMATCH/);
  await assert.rejects(applyMigration({...plan,engineHash:'a'.repeat(64)}),/CODE_CHANGED/);
  await assert.rejects(applyMigration({...plan,files:plan.files.map(file=>file.kind==='memory'?{...file,rows:[]}:file)}),/SNAPSHOT_INCOMPLETE/);
  await assert.rejects(applyMigration({...plan,sessions:[{relative:'../escape.jsonl',hash:'a'.repeat(64)}]}),/PATH_ESCAPE/);
  const file=join(fixture.memoryDir,'memory.sqlite'),db=new DatabaseSync(file);db.exec('PRAGMA user_version=99');db.close();const before=await readFile(file);
  await assert.rejects(planMigration(fixture),/STORE_UNSUPPORTED/);assert.deepEqual(await readFile(file),before);
});

test('completed migration verification does not replace legitimate post-migration changes with the backup',async()=>{
  const fixture=await migrationFixture(),plan=await planMigration(fixture);await applyMigration(plan);
  const store=new MemoryStore(join(fixture.memoryDir,'memory.sqlite'));
  try{store.mutate(fixture.memory.scope,{action:'delete',requestId:'later-user-delete',id:fixture.memory.active.id,expectedVersion:1,reason:'本次迁移后新增的真实语义操作（虚构样本）'});}finally{store.close();}
  await applyMigration(plan);const current=new MemoryStore(join(fixture.memoryDir,'memory.sqlite'));
  try{assert.equal(current.read(fixture.memory.scope,fixture.memory.active.id),null);assert.equal(current.read(fixture.memory.scope,fixture.memory.active.id,'deleted')?.version,2);}finally{current.close();}
});

test('WAL setup waits within the existing busy budget for a real legacy reader to release',async()=>{
  const fixture=await migrationFixture(),file=join(fixture.memoryDir,'memory.sqlite'),reader=new DatabaseSync(file);
  reader.exec('BEGIN');reader.prepare('SELECT count(*) FROM memory_items').get();
  let timer:ReturnType<typeof setTimeout>|undefined,released=false;
  const worker=new Worker(`const {parentPort,workerData}=require('node:worker_threads');
    import(workerData.module).then(({MemoryStore})=>{parentPort.postMessage('opening');const store=new MemoryStore(workerData.file);store.close();parentPort.postMessage('done');}).catch(error=>{throw error;});`,
    {eval:true,workerData:{file,module:new URL('../packages/memory/lib/store.js',import.meta.url).href}});
  try{
    await new Promise<void>((resolve,reject)=>{worker.on('message',value=>{if(value==='opening')timer=setTimeout(()=>{reader.exec('ROLLBACK');released=true;},150);else if(value==='done')resolve();});worker.once('error',reject);worker.once('exit',code=>{if(code!==0)reject(new Error('Migration worker failed'));});});
    assert.equal(released,true);assert.equal(inspectStorage(file,'memory').version,7);
  }finally{if(timer)clearTimeout(timer);if(!released)reader.exec('ROLLBACK');reader.close();await worker.terminate();}
});

test('concurrent fresh journal initialization has one owner and cannot downgrade the new schema',async()=>{
  const fixture=await migrationFixture(),file=join(fixture.coreDir,'new-journal.sqlite'),barrier=new SharedArrayBuffer(4),flag=new Int32Array(barrier);
  const workers:Worker[]=[],results:string[]=[];let ready=0;
  try{
    await new Promise<void>((resolve,reject)=>{
      for(let index=0;index<2;index++){
        const worker=new Worker(`const {parentPort,workerData}=require('node:worker_threads');
          import(workerData.module).then(({Journal})=>{parentPort.postMessage('ready');Atomics.wait(new Int32Array(workerData.barrier),0,0);let store;
            try{store=new Journal(workerData.file);parentPort.postMessage('owned');parentPort.once('message',()=>{store.close();parentPort.close();});}
            catch(error){parentPort.postMessage(/already owned/.test(error.message)?'rejected':'unexpected');parentPort.close();}}).catch(error=>{throw error;});`,
          {eval:true,workerData:{file,barrier,module:new URL('../packages/journal/lib/index.js',import.meta.url).href}});
        workers.push(worker);worker.on('message',value=>{
          if(value==='ready'){ready++;if(ready===2){Atomics.store(flag,0,1);Atomics.notify(flag,0,2);}}
          else{results.push(String(value));if(results.length===2){for(const item of workers)item.postMessage('close');resolve();}}
        });worker.once('error',reject);
      }
    });
    await Promise.all(workers.map(worker=>new Promise<void>(resolve=>{if(worker.threadId===-1)resolve();else worker.once('exit',()=>resolve());})));
    assert.deepEqual(results.sort(),['owned','rejected']);assert.equal(inspectJournal(file).version,2);assert.equal(inspectJournal(file).activeOwner,false);
  }finally{await Promise.all(workers.map(worker=>worker.terminate()));}
});
