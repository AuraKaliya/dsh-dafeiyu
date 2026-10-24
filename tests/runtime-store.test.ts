import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { testTempDir as tmpdir } from './test-temp.js';
import { join } from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { RuntimeStore,runtimeHash } from '@dafeiyu/core/runtime-store';
import { taskScopeKey } from '@dafeiyu/contracts';
import { inspectStorage } from '@dafeiyu/host';

const identity={agentId:'fish',profileId:'fixture'};
const path=async()=>join(await mkdtemp(join(tmpdir(),'dafeiyu-runtime-')),'runtime.sqlite');
const outcome={status:'succeeded' as const,effects:'confirmed' as const,completeness:'complete' as const,data:{value:'fictional'},sources:[],receipts:[{id:'fixture-receipt',kind:'fixture'}]};
function accepted(store:RuntimeStore){const taskId=randomUUID(),requestId=randomUUID(),request=store.prepareRequest('native-fixture',requestId,{goal:'虚构目标'});store.bindTask(request.id,taskId);
  return store.acceptRun(request.id,{taskId,origin:{kind:'native',producerId:'native-fixture',requestId},scope:{kind:'task',agentId:'fish',taskId,scopeKey:taskScopeKey('fish',taskId)},intentVersion:1,policyId:'fixture'});}
function start(store:RuntimeStore){const run=accepted(store),queued=store.transition(run.id,run.version,'queued'),sessionId=store.session('fixture:'+run.definition.taskId);
  return store.start(run.id,queued.version,{sessionId,personaVersion:'a'.repeat(64),model:{provider:'local-test',model:'scripted'},registryVersion:'b'.repeat(64),authorityVersion:'c'.repeat(64),inputs:[]});}

test('runtime requires explicit initialization and rejects a different identity or live owner',async()=>{
  const file=await path();assert.throws(()=>new RuntimeStore(file,identity),/INITIALIZATION_REQUIRED/);assert.equal(existsSync(file),false);
  const store=new RuntimeStore(file,identity,{create:true});assert.equal(inspectStorage(file,'runtime',identity).activeOwner,true);
  assert.throws(()=>new RuntimeStore(file,identity),/ALREADY_OWNED/);store.close();
  const before=createHash('sha256').update(await readFile(file)).digest('hex');
  assert.throws(()=>new RuntimeStore(file,{...identity,agentId:'other'}),/IDENTITY_MISMATCH/);
  assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'),before);
  assert.equal(inspectStorage(file,'runtime',identity).supported,true);
});

test('runtime request and run identities are durable and conflicting retries do not overwrite them',async()=>{
  const file=await path();let store=new RuntimeStore(file,identity,{create:true});
  const request=store.prepareRequest('native-fixture','request',{b:2,a:1});assert.equal(store.prepareRequest('native-fixture','request',{a:1,b:2}).id,request.id);
  assert.throws(()=>store.prepareRequest('native-fixture','request',{a:2}),/IDEMPOTENCY_CONFLICT/);
  const taskId=randomUUID();store.bindTask(request.id,taskId);assert.throws(()=>store.bindTask(request.id,randomUUID()),/TASK_BINDING_CONFLICT/);
  const definition={taskId,origin:{kind:'native',producerId:'native-fixture',requestId:'request'},scope:{kind:'task',agentId:'fish',taskId,scopeKey:taskScopeKey('fish',taskId)},intentVersion:1,policyId:'fixture'};
  const run=store.acceptRun(request.id,definition);assert.equal(store.acceptRun(request.id,definition).id,run.id);store.close();
  store=new RuntimeStore(file,identity);try{assert.equal(store.request(request.id).runId,run.id);assert.equal(store.get(run.id).state,'accepted');}finally{store.close();}
});

test('runtime snapshot and completed result are bound and cannot be bypassed by a state update',async t=>{
  const store=new RuntimeStore(await path(),identity,{create:true});t.after(()=>store.close());const run=start(store);
  assert.throws(()=>store.transition(run.id,run.version,'completed'),/DEDICATED/);
  assert.throws(()=>store.complete(run.id,run.version,{sessionId:'wrong',messageSeq:2,turnEndSeq:3,textHash:'d'.repeat(64)}),/RESULT_BINDING/);
  const operation=store.beginOperation(run.id,'call-1','fixture_write','fixture-plugin','1',{value:'not-in-audit'});
  assert.throws(()=>store.complete(run.id,run.version,{sessionId:run.snapshot?.sessionId,messageSeq:2,turnEndSeq:3,textHash:'d'.repeat(64)}),/OPERATION_PENDING/);
  store.finishOperation(operation.id,outcome);const completed=store.complete(run.id,run.version,{sessionId:run.snapshot?.sessionId,messageSeq:2,turnEndSeq:3,textHash:'d'.repeat(64)});
  assert.equal(completed.state,'completed');assert.throws(()=>store.start(run.id,completed.version,run.snapshot),/VERSION_CONFLICT/);
  assert.ok(!JSON.stringify(store.outbox()).includes('not-in-audit'));
});

test('runtime interruption marks pending effects unknown once and refuses late promotion',async()=>{
  const file=await path();let store=new RuntimeStore(file,identity,{create:true}),run=start(store);
  const op=store.beginOperation(run.id,'call-1','fixture_write','fixture-plugin','1',{value:1});store.close();
  store=new RuntimeStore(file,identity);try{assert.equal(store.get(run.id).state,'running');assert.equal(store.recover(),1);assert.equal(store.operation(op.id).state,'unknown');
    assert.equal(store.get(run.id).state,'interrupted');const count=store.outbox().length;assert.equal(store.recover(),0);assert.equal(store.outbox().length,count);
    assert.throws(()=>store.finishOperation(op.id,outcome),/OPERATION_UNCERTAIN/);
  }finally{store.close();}
});

test('runtime cannot mark pending work cancelled and never overwrites a confirmed operation outcome',async t=>{
  const store=new RuntimeStore(await path(),identity,{create:true});t.after(()=>store.close());const run=start(store);
  const op=store.beginOperation(run.id,'call-1','fixture_write','fixture-plugin','1',{value:1});
  assert.equal(store.beginOperation(run.id,'call-1','fixture_write','fixture-plugin','1',{value:1}).id,op.id);
  assert.throws(()=>store.beginOperation(run.id,'call-1','fixture_write','fixture-plugin','1',{value:2}),/IDEMPOTENCY_CONFLICT/);
  const cancelling=store.transition(run.id,run.version,'cancelling');assert.throws(()=>store.transition(run.id,cancelling.version,'cancelled'),/OPERATION_PENDING/);
  store.finishOperation(op.id,outcome);assert.deepEqual(store.finishOperation(op.id,outcome).outcome,outcome);
  assert.throws(()=>store.finishOperation(op.id,{...outcome,data:{value:'changed'}}),/OUTCOME_CONFLICT/);
  assert.equal(store.transition(run.id,cancelling.version,'cancelled').state,'cancelled');
});

test('wake receipt and accepted run commit atomically and the same occurrence cannot create a second run',async t=>{
  const file=await path(),store=new RuntimeStore(file,identity,{create:true});t.after(()=>store.close());const taskId=randomUUID();
  const request=store.prepareRequest('activity-fixture','wake-request',{purpose:'fixture'});store.bindTask(request.id,taskId);
  const definition={taskId,origin:{kind:'wake',producerId:'activity-fixture',scheduleId:'fixture',scheduleVersion:1,occurrenceId:'occurrence-1',dueAt:new Date().toISOString()},scope:{kind:'task',agentId:'fish',taskId,scopeKey:taskScopeKey('fish',taskId)},intentVersion:1,policyId:'fixture'};
  const fault=new DatabaseSync(file);fault.exec("CREATE TRIGGER fixture_outbox_failure BEFORE INSERT ON runtime_outbox BEGIN SELECT RAISE(ABORT,'fixture'); END;");
  assert.throws(()=>store.acceptWake(request.id,definition));assert.equal(store.request(request.id).runId,null);assert.equal(store.list().length,0);
  assert.equal(fault.prepare('SELECT count(*) AS n FROM wake_receipts').get()?.n,0);fault.exec('DROP TRIGGER fixture_outbox_failure');fault.close();
  const run=store.acceptWake(request.id,definition);assert.equal(store.acceptWake(request.id,definition).id,run.id);assert.equal(store.list().length,1);
  assert.throws(()=>store.acceptWake(request.id,{...definition,origin:{...definition.origin,scheduleVersion:2}}),/IDEMPOTENCY_CONFLICT/);
});

test('runtime preserves unknown schema files and canonical digests ignore object member order',async()=>{
  assert.equal(runtimeHash({b:[1,2],a:true}),runtimeHash({a:true,b:[1,2]}));const file=await path();const store=new RuntimeStore(file,identity,{create:true});store.close();
  const db=new DatabaseSync(file);db.exec('PRAGMA user_version=99');db.close();const before=await readFile(file);
  assert.throws(()=>new RuntimeStore(file,identity),/SCHEMA_UNSUPPORTED/);assert.deepEqual(await readFile(file),before);
});
