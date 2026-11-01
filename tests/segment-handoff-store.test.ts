import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { taskScopeKey } from '@dafeiyu/contracts';
import { RuntimeStore,RUNTIME_SCHEMA_VERSION } from '../packages/core/lib/runtime-store.js';
import { foundationManifest } from '../packages/core/lib/persona-manifest.js';
import { migrateRuntimeStorage,inspectRuntimeMigration } from '../packages/core/lib/runtime-migration.js';
import { testTempDir } from './test-temp.js';

const identity={agentId:'fish',profileId:'handoff'};
async function fixture(){
  const root=await mkdtemp(join(testTempDir(),'segment-handoff-')),file=join(root,'runtime.sqlite'),store=new RuntimeStore(file,identity,{create:true});
  const taskId=randomUUID(),requestId=randomUUID(),request=store.prepareRequest('fixture',requestId,{messageSource:{schemaVersion:1,tag:'original-target'}});
  store.bindTask(request.id,taskId);
  let run=store.acceptRun(request.id,{taskId,origin:{kind:'native',producerId:'fixture',requestId},scope:{kind:'task',agentId:'fish',taskId,scopeKey:taskScopeKey('fish',taskId)},intentVersion:1,policyId:'fixture'});
  run=store.transition(run.id,run.version,'queued');
  const model={provider:'fixture',model:'fixture'},hash='a'.repeat(64);
  run=store.start(run.id,run.version,{sessionId:'parent-session',personaVersion:hash,model,registryVersion:hash,authorityVersion:hash,inputs:[]},
    foundationManifest(run,{text:'fixture',version:hash,fileIdentity:hash},model));
  const checkpointId=randomUUID(),origin={kind:'continuation' as const,parentRunId:run.id,checkpointId},lineage={rootRunId:run.id,index:1,deadlineAt:Date.now()+60000,toolStage:'bili-reading'};
  const input={checkpointId,checkpoint:{kind:'segment'},producer:'fixture',requestId:'child-request',
    payload:{kind:'execution',origin,messageSource:{schemaVersion:1,tag:'original-target'}},definition:{...run.definition,origin,parentRunId:run.id},lineage};
  return {root,file,store,run,input};
}

test('handoff rolls back parent, checkpoint and child together when the child cannot be persisted',async()=>{
  const f=await fixture();const db=new DatabaseSync(f.file);
  try{
    db.exec("CREATE TRIGGER reject_segment BEFORE INSERT ON runs WHEN json_extract(NEW.definition,'$.parentRunId') IS NOT NULL BEGIN SELECT RAISE(ABORT,'injected child failure');END;");
    assert.throws(()=>f.store.handoffSegment(f.run.id,f.run.version,f.input),/injected child failure/);
    assert.equal(f.store.get(f.run.id).state,'running');assert.equal(f.store.checkpoints(f.run.id).length,0);
    assert.equal(f.store.findRequest('fixture','child-request'),null);
    db.exec('DROP TRIGGER reject_segment');
    const child=f.store.handoffSegment(f.run.id,f.run.version,f.input);
    assert.equal(f.store.get(f.run.id).state,'continued');assert.equal(child.state,'accepted');
    assert.equal(f.store.nativeDeliveryCandidates().includes(f.run.id),false);
  }finally{db.close();f.store.close();}
});

test('a crash after commit leaves one accepted child and replay preserves source and deadline',async()=>{
  const f=await fixture();let store=f.store;
  const child=store.handoffSegment(f.run.id,f.run.version,f.input);store.close();store=new RuntimeStore(f.file,identity);
  try{
    store.recover();assert.equal(store.get(child.id).state,'accepted');
    const replay=store.handoffSegment(f.run.id,f.run.version,f.input);assert.equal(replay.id,child.id);assert.equal(store.list().length,2);
    assert.deepEqual(store.readInput(child.id,'segment-lineage'),f.input.lineage);
    assert.deepEqual(store.request(child.requestKey).payload,f.input.payload);
  }finally{store.close();}
});

test('runtime v1 migrates explicitly with an intact snapshot and identity mismatches never write',async()=>{
  const f=await fixture();f.store.close();const db=new DatabaseSync(f.file);db.exec('DROP TABLE message_intents; PRAGMA user_version=1');db.close();
  const before=await readFile(f.file),backup=join(f.root,'runtime-v1.sqlite');
  assert.equal(inspectRuntimeMigration(f.file,identity).state,'upgradable');
  assert.throws(()=>migrateRuntimeStorage(f.file,{...identity,agentId:'other'},backup),/IDENTITY_MISMATCH/);
  assert.deepEqual(await readFile(f.file),before);
  assert.equal(migrateRuntimeStorage(f.file,identity,backup).version,RUNTIME_SCHEMA_VERSION);
  const copy=new DatabaseSync(backup,{readOnly:true});try{assert.equal(copy.prepare('PRAGMA user_version').get()!.user_version,1);assert.equal(copy.prepare('SELECT count(*) n FROM runs').get()!.n,1);}finally{copy.close();}
  assert.equal(migrateRuntimeStorage(f.file,identity,backup).migrated,false);
});

test('recovery before handoff retains settled work and can hand off an interrupted parent once',async()=>{
  const f=await fixture();let store=f.store;store.bindInput(f.run.id,'reading-progress',{completed:['video-1']});
  store.close();store=new RuntimeStore(f.file,identity);
  try{assert.equal(store.recover(),1);const interrupted=store.get(f.run.id);assert.equal(interrupted.state,'interrupted');
    const child=store.handoffSegment(interrupted.id,interrupted.version,f.input);
    assert.deepEqual(store.readInput(interrupted.id,'reading-progress'),{completed:['video-1']});
    assert.equal(store.handoffSegment(interrupted.id,interrupted.version,f.input).id,child.id);
  }finally{store.close();}
});
