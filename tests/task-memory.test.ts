import { test } from 'node:test';
import { dropExecutionFixtureSchema } from './legacy-execution-fixture.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { z } from 'zod';
import { taskMemoryFixture,scenes,resultSchema,currentVersion } from './task-memory-fixture.js';
import { observationReport } from './observation-fixture.js';
import { textReply } from './harness.js';
import { MemoryRetrieval } from '@dafeiyu/memory/retrieval';
import { config } from './retrieval-fixture.js';

for(const strategy of ['lexical','semantic','hybrid'] as const)test(`task-internal ${strategy} recall crosses only authorized scenes and excludes internal-use denial`,async t=>{
  const h=await taskMemoryFixture();t.after(h.close);const task=h.create();h.policy();const access=h.grant(task);
  h.handles[0]!.observeMemory(observationReport({conversation:scenes[0]!,sources:[{key:'hard-denied',occurredAt:'2026-10-20T00:00:00Z',archive:{kind:'text',text:'下雨 HARD_DENIED'},policy:{internalUse:'none'}}],contributions:[]}));
  h.handles[0]!.observeMemory(observationReport({conversation:scenes[0]!,sources:[{key:'denied-memory',occurredAt:'2026-10-20T00:00:00Z',archive:{kind:'text',text:'下雨 HARD_DENIED_MEMORY'}}],contributions:[{id:'denied',form:'original',source:'denied-memory',exposure:['denied-memory'],policy:{internalUse:'none'}}]}));
  const result=resultSchema.parse(await access.recall({query:'下雨出行准备什么',strategy,limit:10}));
  const visible=JSON.stringify(result);assert.match(visible,/A_ONLY/);assert.match(visible,/B_INTERNAL_ONLY/);assert.ok(!visible.includes('C_DENIED'));assert.ok(!visible.includes('HARD_DENIED'));
  assert.ok(!h.chunksCalled.some(s=>s.includes('C_DENIED')||s.includes('HARD_DENIED')));
  assert.equal(h.store.read(h.scope(1),h.receipts[1]!.contributions[0]!.memoryId),null);
  assert.ok(!JSON.stringify(task.read()).includes('A_ONLY'));assert.equal(h.adapter.requests.length,0);
});

test('no policy means no grant; source restrictions and explicit record allowlists cannot be widened',async t=>{
  const h=await taskMemoryFixture();t.after(h.close);const task=h.create();assert.throws(()=>h.grant(task),/authorization_unavailable/);h.policy([0]);assert.throws(()=>h.grant(task,[1]),/outside_policy/);
  h.core.setTaskMemoryPolicy({requestId:randomUUID(),id:'selected',expectedVersion:0,enabled:true,sources:[{conversation:scenes[0],memoryIds:[h.receipts[0]!.contributions[0]!.memoryId]}],reason:'限定记录'});
  assert.throws(()=>h.grant(task,[0],'selected'),/outside_policy/);
  const access=task.memory.grant({requestId:randomUUID(),policyId:'selected',expectedPolicyVersion:1,sources:[{conversation:scenes[0],memoryIds:[h.receipts[0]!.contributions[0]!.memoryId]}],expiresAt:new Date(Date.now()+60000).toISOString(),reason:'虚构选择'});
  assert.equal(resultSchema.parse(await access.recall({query:'下雨'})).items.length,1);
  await assert.rejects(access.recall({query:'下雨',purpose:'expression'}));
  assert.throws(()=>task.memory.resume(randomUUID()),/authorization_unavailable/);
});

test('selected cross-scene fragments stay internal and are not automatically assembled into chat',async t=>{
  const h=await taskMemoryFixture();t.after(h.close);const task=h.create();h.policy();const access=h.grant(task),result=resultSchema.parse(await access.recall({query:'雨具',limit:10}));
  access.select({requestId:randomUUID(),expectedVersion:currentVersion(task),hitIds:result.items.map(i=>i.hitId)});
  assert.match(JSON.stringify(task.read()),/B_INTERNAL_ONLY/);
  const handle=h.handles[0]!,conversation=scenes[0]!;handle.tasks.join(task.reference,{requestId:randomUUID(),conversation});handle.tasks.activate(task.reference,{requestId:randomUUID(),conversation,expectedVersion:0});
  assert.ok(!JSON.stringify(handle.tasks.view(task.reference,conversation)).includes('A_ONLY'));
  h.setResponse(()=>textReply('虚构回复'));handle.ingest({id:randomUUID(),conversation,occurredAt:new Date().toISOString(),sender:{id:'fictional',displayName:'虚构'},text:'继续任务'});await h.core.whenIdle();
  const visible=JSON.stringify(h.adapter.requests.at(-1)!.messages);assert.ok(!visible.includes('B_INTERNAL_ONLY'));assert.ok(!visible.includes('A_ONLY'));
});

test('revocation blocks recall, raw lookup, selection and already selected task evidence',async t=>{
  const h=await taskMemoryFixture();t.after(h.close);const task=h.create();h.policy();const access=h.grant(task),result=resultSchema.parse(await access.recall({query:'雨',limit:10}));
  access.select({requestId:randomUUID(),expectedVersion:currentVersion(task),hitIds:result.items.map(i=>i.hitId)});
  assert.match(JSON.stringify(access.open({hitId:result.items[0]!.hitId})),/ONLY/);
  task.memory.revoke({requestId:'revoke',id:access.id,expectedVersion:1});
  await assert.rejects(access.recall({query:'雨'}),/authorization_unavailable/);assert.throws(()=>access.open({hitId:result.items[0]!.hitId}),/authorization_unavailable/);
  assert.throws(()=>access.select({requestId:randomUUID(),expectedVersion:currentVersion(task),hitIds:[result.items[0]!.hitId]}),/authorization_unavailable/);
  assert.ok(!JSON.stringify(task.read()).includes('A_ONLY'));assert.ok(!JSON.stringify(task.read()).includes('B_INTERNAL_ONLY'));
});

test('revoking during embedding rejects the entire asynchronous result without durable hits',async t=>{
  const h=await taskMemoryFixture();t.after(h.close);const task=h.create();h.policy();const access=h.grant(task),embed=h.dependency.embedder.embed;
  h.dependency.embedder.embed=async(...args)=>{const result=await embed(...args);task.memory.revoke({requestId:'during-embedding',id:access.id,expectedVersion:1});return result;};
  await assert.rejects(access.recall({query:'天气',strategy:'semantic'}),/authorization_unavailable/);
  const db=new DatabaseSync(join(h.root,'memory.sqlite'));t.after(()=>db.close());assert.equal(db.prepare('SELECT count(*) AS n FROM task_memory_hits').get()?.n,0);
});

test('internal caches separate tasks, grants and ordinary scene queries; repeated authorized queries reuse vectors',async t=>{
  const h=await taskMemoryFixture();t.after(h.close);const a=h.create(),b=h.create();h.policy();const first=h.grant(a),second=h.grant(b);
  const one=resultSchema.parse(await first.recall({query:'天气',strategy:'semantic'})),repeat=resultSchema.parse(await first.recall({query:'天气',strategy:'semantic'}));
  assert.ok(one.scenes.some(s=>s.vectorsComputed>0));assert.ok(repeat.scenes.every(s=>s.vectorsComputed===0));
  const two=resultSchema.parse(await second.recall({query:'天气',strategy:'semantic'}));assert.ok(two.scenes.some(s=>s.vectorsComputed>0));
  assert.throws(()=>second.open({hitId:one.items[0]!.hitId}),/hit_unavailable/);
  const db=new DatabaseSync(join(h.root,'retrieval.sqlite'));t.after(()=>db.close());const routes=db.prepare('SELECT DISTINCT route FROM chunks').all();assert.equal(routes.length,4);assert.ok(routes.every(r=>String(r.route).startsWith('$task-internal:')));
  const ordinary=new MemoryRetrieval(h.store,h.root,config,h.dependency);try{
    const a=await ordinary.recall(h.scope(0),{query:'天气',strategy:'semantic'},AbortSignal.timeout(5000),()=>{});assert.ok(a.vectorsComputed>0);
    const b=await ordinary.recall(h.scope(1),{query:'天气',strategy:'semantic'},AbortSignal.timeout(5000),()=>{});assert.equal(b.items.length,0);
  }finally{ordinary.close();}
  assert.ok(!JSON.stringify(h.handles[0]!.tasks).includes('recall'));
});

test('policy replacement and task epoch changes invalidate existing grants without widening legacy records',async t=>{
  const h=await taskMemoryFixture();t.after(h.close);const task=h.create(),before=h.store.read(h.scope(0),h.receipts[0]!.contributions[0]!.memoryId);h.policy();const old=h.grant(task);
  h.policy([0,1],'fixture-policy',1);await assert.rejects(old.recall({query:'雨'}),/authorization_unavailable/);
  const fresh=h.grant(task,[0,1],'fixture-policy',2);assert.deepEqual(h.store.read(h.scope(0),h.receipts[0]!.contributions[0]!.memoryId),before);
  task.update({requestId:randomUUID(),expectedVersion:currentVersion(task),goal:'新的任务目的'});await assert.rejects(fresh.recall({query:'雨'}),/authorization_unavailable/);
});

test('source deletion retires only dependent selections and restoration never revives old hits',async t=>{
  const h=await taskMemoryFixture();t.after(h.close);const task=h.create();h.policy();const access=h.grant(task),result=resultSchema.parse(await access.recall({query:'雨',limit:10}));
  access.select({requestId:randomUUID(),expectedVersion:currentVersion(task),hitIds:result.items.map(i=>i.hitId)});
  h.handles[0]!.changeObservationSource({conversation:scenes[0]!,ref:h.receipts[0]!.sources[0]!.ref,requestId:'delete',expectedVersion:1,action:'delete'});
  assert.ok(!JSON.stringify(task.read()).includes('A_ONLY'));assert.match(JSON.stringify(task.read()),/B_INTERNAL_ONLY/);
  const hit=result.items.find(i=>i.id===h.receipts[0]!.contributions[0]!.memoryId)!;assert.throws(()=>access.open({hitId:hit.hitId}),/hit_unavailable/);
  h.handles[0]!.changeObservationSource({conversation:scenes[0]!,ref:h.receipts[0]!.sources[0]!.ref,requestId:'restore',expectedVersion:2,action:'restore'});
  assert.throws(()=>access.open({hitId:hit.hitId}),/hit_unavailable/);assert.ok(!JSON.stringify(task.read()).includes('A_ONLY'));
  assert.ok(!JSON.stringify(await access.recall({query:'雨'})).includes('A_ONLY'));
});

test('restart restores authorization without replay and revoked grants remain revoked',async()=>{
  const h=await taskMemoryFixture(),task=h.create(),root=h.root;h.policy();const access=h.grant(task),revoked=h.grant(task);const result=resultSchema.parse(await access.recall({query:'雨'}));
  access.select({requestId:randomUUID(),expectedVersion:currentVersion(task),hitIds:[result.items[0]!.hitId]});task.memory.revoke({requestId:randomUUID(),id:revoked.id,expectedVersion:1});await h.close();
  const next=await taskMemoryFixture(root);try{const restored=next.core.resumeTaskWorkspace(task.reference.id);assert.match(JSON.stringify(restored.read()),/ONLY/);
    assert.equal(restored.memory.resume(access.id).open({hitId:result.items[0]!.hitId}).status,'ok');assert.throws(()=>restored.memory.resume(revoked.id),/authorization_unavailable/);assert.equal(next.adapter.requests.length,0);
    await assert.rejects(access.recall({query:'雨'}));
  }finally{await next.close();}
});

test('authorization audit failure rolls back rule, grant and hit writes with durable requests',async t=>{
  const h=await taskMemoryFixture();t.after(h.close);const task=h.create(),db=new DatabaseSync(join(h.root,'memory.sqlite'));t.after(()=>db.close());
  db.exec("CREATE TRIGGER fail_auth_audit BEFORE INSERT ON memory_events WHEN json_extract(NEW.body,'$.type') LIKE 'task.memory.%' BEGIN SELECT RAISE(ABORT,'fixture authorization failure'); END;");
  assert.throws(()=>h.policy(),/fixture authorization failure/);assert.equal(db.prepare('SELECT count(*) AS n FROM task_memory_policies').get()?.n,0);
  db.exec('DROP TRIGGER fail_auth_audit');h.policy();const access=h.grant(task);
  db.exec("CREATE TRIGGER fail_auth_audit BEFORE INSERT ON memory_events WHEN json_extract(NEW.body,'$.type')='task.memory.recalled' BEGIN SELECT RAISE(ABORT,'fixture authorization failure'); END;");
  await assert.rejects(access.recall({query:'雨'}),/fixture authorization failure/);assert.equal(db.prepare('SELECT count(*) AS n FROM task_memory_hits').get()?.n,0);
});

test('revocation propagates into running jobs, derived observations and their new archives',async t=>{
  const h=await taskMemoryFixture();t.after(h.close);const task=h.create();h.policy();const access=h.grant(task),result=resultSchema.parse(await access.recall({query:'雨',limit:10}));
  const selection=z.object({links:z.array(z.string())}).parse(access.select({requestId:randomUUID(),expectedVersion:currentVersion(task),hitIds:result.items.map(i=>i.hitId)}));
  const handle=h.handles[0]!,conversation=scenes[0]!;handle.tasks.join(task.reference,{requestId:randomUUID(),conversation});handle.tasks.activate(task.reference,{requestId:randomUUID(),conversation,expectedVersion:0});
  const work=handle.tasks.begin(task.reference,{requestId:randomUUID(),conversation,slot:'internal-analysis',expectedSlotVersion:0,inputs:selection.links});
  const observed=handle.tasks.observe(work,observationReport({conversation,sources:[{key:'derived-d1',occurredAt:'2026-10-20T00:00:00Z',archive:{kind:'text',text:'DERIVED_PRIVATE_D1'}}],contributions:[{id:'fact',form:'original',source:'derived-d1',exposure:['derived-d1']}]}));
  const id=observed.contributions[0]!.memoryId;assert.ok(h.store.read(h.scope(0),id,'normal',undefined,'internal'));assert.equal(h.store.read(h.scope(0),id),null);
  task.memory.revoke({requestId:randomUUID(),id:access.id,expectedVersion:1});assert.equal(h.store.read(h.scope(0),id,'normal',undefined,'internal'),null);
  assert.equal(h.store.observations.source(h.scope(0),observed.sources[0]!.ref,'internal'),null);
  assert.equal(handle.tasks.complete(work,{requestId:randomUUID(),text:'LATE_PRIVATE_D1'}).applied,false);
  assert.ok(!JSON.stringify(task.read()).includes('DERIVED_PRIVATE_D1'));assert.ok(!JSON.stringify(task.read()).includes('LATE_PRIVATE_D1'));
});

test('new grants cannot reactivate links from revoked grants, even for the same task and sources',async t=>{
  const h=await taskMemoryFixture();t.after(h.close);const task=h.create();h.policy();const old=h.grant(task),result=resultSchema.parse(await old.recall({query:'雨'}));
  old.select({requestId:randomUUID(),expectedVersion:currentVersion(task),hitIds:[result.items[0]!.hitId]});task.memory.revoke({requestId:randomUUID(),id:old.id,expectedVersion:1});
  const next=h.grant(task);assert.ok(!JSON.stringify(task.read()).includes('A_ONLY'));assert.throws(()=>next.open({hitId:result.items[0]!.hitId}),/hit_unavailable/);
  const fresh=resultSchema.parse(await next.recall({query:'雨'}));assert.ok(fresh.scenes.some(s=>s.vectorsComputed>0));
  next.select({requestId:randomUUID(),expectedVersion:currentVersion(task),hitIds:[fresh.items[0]!.hitId]});assert.match(JSON.stringify(task.read()),/A_ONLY/);
});

test('expiry, cancellation, provider unload and wrong-task restoration revoke native access',async t=>{
  const h=await taskMemoryFixture();t.after(h.close);const task=h.create();h.policy();const access=h.grant(task);assert.throws(()=>h.create().memory.resume(access.id),/authorization_unavailable/);
  await assert.rejects(access.recall({query:'雨'},AbortSignal.abort()));
  const realNow=Date.now;try{Date.now=()=>realNow()+7200000;await assert.rejects(access.recall({query:'雨'}),/authorization_unavailable/);}finally{Date.now=realNow;}
  await h.memoryFiber.dispose();await assert.rejects(access.recall({query:'雨'}),/provider unavailable/);
});

test('original permission narrowing invalidates a cached internal hit even with unchanged text',async t=>{
  const h=await taskMemoryFixture();t.after(h.close);const task=h.create();h.policy();const access=h.grant(task),result=resultSchema.parse(await access.recall({query:'雨',limit:10}));
  const hit=result.items.find(i=>i.id===h.receipts[0]!.contributions[0]!.memoryId)!,memory=h.store.read(h.scope(0),hit.id)!;
  const scope={...h.scope(0),traceId:randomUUID(),operationId:randomUUID(),startedEventId:randomUUID()};
  h.store.mutate(scope,{action:'revise',requestId:randomUUID(),id:memory.id,expectedVersion:memory.version,value:{kind:memory.kind,claimType:memory.claimType,content:memory.content,sources:memory.sources},boundaryPolicy:{internalUse:'none'}});
  assert.throws(()=>access.open({hitId:hit.hitId}),/hit_unavailable/);assert.ok(!JSON.stringify(await access.recall({query:'雨',limit:10})).includes('A_ONLY'));
});

test('schema v4 migration leaves existing boundaries and selections unchanged and creates no grants',async()=>{
  const h=await taskMemoryFixture(),root=h.root,task=h.create(),before=h.store.read(h.scope(0),h.receipts[0]!.contributions[0]!.memoryId),id=before!.id;await h.close();
  const db=new DatabaseSync(join(root,'memory.sqlite'));try{dropExecutionFixtureSchema(db);for(const table of ['expression_jobs','expression_packets','expression_requests','expression_policies','expression_policy_revisions','task_memory_hits','task_memory_grants','task_memory_policies','task_memory_policy_revisions','task_memory_requests'])db.exec(`DROP TABLE ${table}`);db.exec('PRAGMA user_version=4');}finally{db.close();}
  const next=await taskMemoryFixture(root);try{assert.deepEqual(next.store.read(next.scope(0),id),before);assert.throws(()=>next.grant(next.core.resumeTaskWorkspace(task.reference.id)),/authorization_unavailable/);
const db=new DatabaseSync(join(root,'memory.sqlite'));try{assert.equal(db.prepare('PRAGMA user_version').get()?.user_version,9);assert.equal(db.prepare('SELECT count(*) AS n FROM task_memory_grants').get()?.n,0);}finally{db.close();}
  }finally{await next.close();}
});

test('policy, grant and revoke requests are idempotent but changed request reuse conflicts',async t=>{
  const h=await taskMemoryFixture();t.after(h.close);const task=h.create(),policy={requestId:'policy-once',id:'once',expectedVersion:0,enabled:true,sources:[{conversation:scenes[0]}],reason:'验收'};
  assert.deepEqual(h.core.setTaskMemoryPolicy(policy),h.core.setTaskMemoryPolicy(policy));assert.throws(()=>h.core.setTaskMemoryPolicy({...policy,enabled:false}),/idempotency_conflict/);
  const input={requestId:'grant-once',policyId:'once',expectedPolicyVersion:1,sources:[{conversation:scenes[0]}],expiresAt:new Date(Date.now()+60000).toISOString(),reason:'验收'};
  const a=task.memory.grant(input),b=task.memory.grant(input);assert.equal(a.id,b.id);assert.throws(()=>task.memory.grant({...input,reason:'changed'}),/idempotency_conflict/);
  const revoke={requestId:'revoke-once',id:a.id,expectedVersion:1};assert.deepEqual(task.memory.revoke(revoke),task.memory.revoke(revoke));assert.throws(()=>task.memory.grant(input),/authorization_unavailable/);
});

test('revoking one parallel task does not cancel another task or its selected evidence',async t=>{
  const h=await taskMemoryFixture();t.after(h.close);const a=h.create(),b=h.create();h.policy();const first=h.grant(a),second=h.grant(b);
  const results=await Promise.all([first.recall({query:'雨',limit:10}),second.recall({query:'雨',limit:10})]);
  for(const [task,reader,result] of [[a,first,results[0]],[b,second,results[1]]] as const)reader.select({requestId:randomUUID(),expectedVersion:currentVersion(task),hitIds:resultSchema.parse(result).items.map(i=>i.hitId)});
  a.memory.revoke({requestId:randomUUID(),id:first.id,expectedVersion:1});assert.ok(!JSON.stringify(a.read()).includes('B_INTERNAL_ONLY'));assert.match(JSON.stringify(b.read()),/B_INTERNAL_ONLY/);
  assert.ok(resultSchema.parse(await second.recall({query:'雨'})).items.length>0);
});

test('changing an earlier scene while a later scene is embedding rejects the combined snapshot',async t=>{
  const h=await taskMemoryFixture();t.after(h.close);const task=h.create();h.policy();const access=h.grant(task),embed=h.dependency.embedder.embed;let calls=0;
  h.dependency.embedder.embed=async(...args)=>{const result=await embed(...args);if(++calls===3)h.handles[0]!.changeObservationSource({conversation:scenes[0]!,ref:h.receipts[0]!.sources[0]!.ref,requestId:'during-scene-b',expectedVersion:1,action:'delete'});return result;};
  await assert.rejects(access.recall({query:'雨',strategy:'semantic'}),/stale/);
});
