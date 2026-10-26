import { test } from 'node:test';
import { dropExecutionFixtureSchema } from './legacy-execution-fixture.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DatabaseSync } from 'node:sqlite';
import { MEMORY_SCHEMA_VERSION } from '@dafeiyu/memory/store';
import { join } from 'node:path';
import { API_VERSION,conversationKey } from '@dafeiyu/contracts';
import { taskFixture,taskVersion,sceneB } from './task-workspace-fixture.js';
import { observationConversation,observationReport,observationFixture } from './observation-fixture.js';
import { textReply,call } from './harness.js';
import type { ExtensionHandle,ActionContext,TaskWorkTicket } from '@dafeiyu/contracts';

const create=(h:Awaited<ReturnType<typeof taskFixture>>,name='task')=>h.core.createTaskWorkspace({requestId:randomUUID(),title:name,goal:`PRIVATE_GOAL_${name}`});
test('one agent task associates two scenes and plugins while each scene sees only its own allowed evidence',async t=>{
  const h=await taskFixture();t.after(h.close);const task=create(h);h.join(task,h.handle,observationConversation);h.join(task,h.second,sceneB);
  h.activate(task,h.handle,observationConversation,0);h.activate(task,h.second,sceneB,0);
  h.link(task,h.handle,observationConversation,h.a.contributions[0]!.memoryId);h.link(task,h.second,sceneB,h.b.contributions[0]!.memoryId);
  const internal=JSON.stringify(task.read());assert.match(internal,/A_ORIGINAL/);assert.match(internal,/B_PRIVATE_MEMORY/);assert.match(internal,/fictional-research/);
  const a=JSON.stringify(h.handle.tasks.view(task.reference,observationConversation)),b=JSON.stringify(h.second.tasks.view(task.reference,sceneB));
  assert.match(a,/A_ORIGINAL/);assert.ok(!a.includes('B_PRIVATE_MEMORY'));assert.match(b,/B_PRIVATE_MEMORY/);assert.ok(!b.includes('A_ORIGINAL'));assert.ok(!a.includes('PRIVATE_GOAL'));
  assert.equal(h.adapter.requests.length,0);
});
test('different tasks and independent slots complete concurrently without overwriting one another',async t=>{
  const h=await taskFixture();t.after(h.close);const a=create(h,'A'),b=create(h,'B');h.join(a,h.handle,observationConversation);h.join(b,h.second,sceneB);
  h.activate(a,h.handle,observationConversation,0);h.activate(b,h.second,sceneB,0);
  const wa=h.begin(a.reference,h.handle,observationConversation,'answer',[]),wb=h.begin(b.reference,h.second,sceneB,'answer',[]);
  assert.equal(h.handle.tasks.complete(wa,{requestId:randomUUID(),text:'RESULT_A'}).applied,true);assert.equal(h.second.tasks.complete(wb,{requestId:randomUUID(),text:'RESULT_B'}).applied,true);
  assert.match(JSON.stringify(a.read()),/RESULT_A/);assert.ok(!JSON.stringify(a.read()).includes('RESULT_B'));assert.match(JSON.stringify(b.read()),/RESULT_B/);
  const w1=h.begin(a.reference,h.handle,observationConversation,'one',[]),w2=h.begin(a.reference,h.handle,observationConversation,'two',[]);
  assert.equal(h.handle.tasks.complete(w1,{requestId:randomUUID(),text:'PARALLEL_ONE'}).applied,true);assert.equal(h.handle.tasks.complete(w2,{requestId:randomUUID(),text:'PARALLEL_TWO'}).applied,true);
});
test('a task switch fences old results, including switching back to the same task',async t=>{
  const h=await taskFixture();t.after(h.close);const a=create(h,'A'),b=create(h,'B');h.join(a,h.handle,observationConversation);h.join(b,h.handle,observationConversation);
  h.activate(a,h.handle,observationConversation,0);const work=h.begin(a.reference,h.handle,observationConversation,'answer',[]);
  h.activate(b,h.handle,observationConversation,1);h.activate(a,h.handle,observationConversation,2);
  const result=h.handle.tasks.complete(work,{requestId:randomUUID(),text:'LATE_RESULT_MUST_NOT_APPLY'});assert.equal(result.applied,false);assert.equal(result.status,'late');
  assert.ok(!JSON.stringify(a.read()).includes('LATE_RESULT_MUST_NOT_APPLY'));assert.ok(!JSON.stringify(b.read()).includes('LATE_RESULT_MUST_NOT_APPLY'));
  const db=new DatabaseSync(join(h.root,'memory.sqlite'));t.after(()=>db.close());assert.match(String(db.prepare('SELECT result FROM task_jobs WHERE id=?').get(work.id)?.result),/LATE_RESULT_MUST_NOT_APPLY/);
});
test('two jobs for the same slot cannot overwrite the first accepted result',async t=>{
  const h=await taskFixture();t.after(h.close);const task=create(h);h.join(task,h.handle,observationConversation);h.activate(task,h.handle,observationConversation,0);
  const a=h.begin(task.reference,h.handle,observationConversation,'same',[]),b=h.begin(task.reference,h.handle,observationConversation,'same',[]);
  assert.equal(h.handle.tasks.complete(a,{requestId:randomUUID(),text:'FIRST_WINS'}).applied,true);assert.equal(h.handle.tasks.complete(b,{requestId:randomUUID(),text:'SECOND_STAYS_ARCHIVED'}).applied,false);
  assert.match(JSON.stringify(task.read()),/FIRST_WINS/);assert.ok(!JSON.stringify(task.read()).includes('SECOND_STAYS_ARCHIVED'));
});
test('goal changes and pause/resume invalidate older work without erasing independent task state',async t=>{
  const h=await taskFixture();t.after(h.close);const task=create(h);h.join(task,h.handle,observationConversation);h.activate(task,h.handle,observationConversation,0);
  const work=h.begin(task.reference,h.handle,observationConversation,'goal',[]);
  task.update({requestId:randomUUID(),expectedVersion:taskVersion(task),goal:'更正后的目标'});
  assert.equal(h.handle.tasks.complete(work,{requestId:randomUUID(),text:'OLD_GOAL_RESULT'}).applied,false);
  const next=h.begin(task.reference,h.handle,observationConversation,'goal',[]);task.update({requestId:randomUUID(),expectedVersion:taskVersion(task),status:'paused'});
  task.update({requestId:randomUUID(),expectedVersion:taskVersion(task),status:'active'});assert.equal(h.handle.tasks.complete(next,{requestId:randomUUID(),text:'OLD_EPOCH_RESULT'}).applied,false);
});
test('task observations adopt valid contributions and stamp global task identity; late observations stay with the original task',async t=>{
  const h=await taskFixture();t.after(h.close);const a=create(h,'A'),b=create(h,'B');h.join(a,h.handle,observationConversation);h.join(b,h.handle,observationConversation);h.activate(a,h.handle,observationConversation,0);
  const work=h.begin(a.reference,h.handle,observationConversation,'explore',[]);
  const input=observationReport({sources:[{key:'task-observation',occurredAt:'2026-10-20T01:00:00Z',archive:{kind:'text',text:'TASK_OBSERVATION_CURRENT'}}]});input.contributions=[{id:'task',form:'original',source:'task-observation',exposure:['task-observation']}];
  const receipt=h.handle.tasks.observe(work,input),memory=h.store.read(h.scope,receipt.contributions[0]!.memoryId)!;
  assert.deepEqual(memory.boundary.task,{kind:'agent-task',id:a.reference.id});assert.match(JSON.stringify(a.read()),/TASK_OBSERVATION_CURRENT/);
  const version=taskVersion(a);assert.equal(h.handle.tasks.observe(work,input).duplicate,true);assert.equal(taskVersion(a),version);
  h.activate(b,h.handle,observationConversation,1);
  const late=observationReport({sources:[{key:'late-observation',occurredAt:'2026-10-20T02:00:00Z',archive:{kind:'text',text:'LATE_OBSERVATION_BODY'}}],contributions:[{id:'late',form:'original',source:'late-observation',exposure:['late-observation']}]});
  const lateReceipt=h.handle.tasks.observe(work,late);assert.deepEqual(h.store.read(h.scope,lateReceipt.contributions[0]!.memoryId)!.boundary.task,{kind:'agent-task',id:a.reference.id});
  assert.ok(!JSON.stringify(a.read()).includes('LATE_OBSERVATION_BODY'));assert.ok(!JSON.stringify(b.read()).includes('LATE_OBSERVATION_BODY'));
  assert.equal(h.handle.tasks.complete(work,{requestId:randomUUID(),text:'LATE_PROGRESS'}).applied,false);
});
test('source deletion and restore cannot reactivate pinned task links or dependent results',async t=>{
  const h=await taskFixture();t.after(h.close);const task=create(h);h.join(task,h.handle,observationConversation);h.join(task,h.second,sceneB);h.activate(task,h.handle,observationConversation,0);
  const a=h.link(task,h.handle,observationConversation,h.a.contributions[0]!.memoryId);h.link(task,h.second,sceneB,h.b.contributions[0]!.memoryId);
  const work=h.begin(task.reference,h.handle,observationConversation,'answer',[a]);assert.equal(h.handle.tasks.complete(work,{requestId:randomUUID(),text:'DERIVED_A_RESULT'}).applied,true);
  h.handle.changeObservationSource({conversation:observationConversation,ref:h.a.sources[0]!.ref,requestId:'delete',expectedVersion:1,action:'delete'});
  assert.ok(!JSON.stringify(task.read()).includes('A_ORIGINAL'));assert.ok(!JSON.stringify(task.read()).includes('DERIVED_A_RESULT'));assert.match(JSON.stringify(task.read()),/B_PRIVATE_MEMORY/);
  h.handle.changeObservationSource({conversation:observationConversation,ref:h.a.sources[0]!.ref,requestId:'restore',expectedVersion:2,action:'restore'});
  assert.ok(!JSON.stringify(task.read()).includes('A_ORIGINAL'));assert.ok(!JSON.stringify(task.read()).includes('DERIVED_A_RESULT'));
});
test('private internal evidence and cross-scene result dependencies never enter a scene reply view',async t=>{
  const h=await taskFixture();t.after(h.close);const task=create(h);h.join(task,h.handle,observationConversation);h.join(task,h.second,sceneB);h.activate(task,h.handle,observationConversation,0);
  const b=h.link(task,h.second,sceneB,h.b.contributions[0]!.memoryId),a=h.link(task,h.handle,observationConversation,h.a.contributions[0]!.memoryId);
  const work=h.begin(task.reference,h.handle,observationConversation,'mixed',[a,b]);h.handle.tasks.complete(work,{requestId:randomUUID(),text:'PRIVATE_CROSS_SCENE_CONCLUSION'});
  assert.match(JSON.stringify(task.read()),/PRIVATE_CROSS_SCENE_CONCLUSION/);assert.ok(!JSON.stringify(h.handle.tasks.view(task.reference,observationConversation)).includes('PRIVATE_CROSS_SCENE_CONCLUSION'));
  const privateReceipt=h.handle.observeMemory(observationReport({requestId:randomUUID(),sources:[{key:'internal-only',occurredAt:'2026-10-20T00:00:00Z',archive:{kind:'text',text:'TASK_INTERNAL_ONLY'},policy:{externalExpression:'none'}}],contributions:[{id:'private',form:'original',source:'internal-only',exposure:['internal-only']}]}));
  h.link(task,h.handle,observationConversation,privateReceipt.contributions[0]!.memoryId);assert.match(JSON.stringify(task.read()),/TASK_INTERNAL_ONLY/);assert.ok(!JSON.stringify(h.handle.tasks.view(task.reference,observationConversation)).includes('TASK_INTERNAL_ONLY'));
});
test('opaque task references, producer tickets, scene membership and CAS block forged or stale writes',async t=>{
  const h=await taskFixture();t.after(h.close);const task=create(h);
  assert.throws(()=>h.handle.tasks.join({id:task.reference.id},{requestId:randomUUID(),conversation:observationConversation}),/core-issued/);
  assert.throws(()=>h.second.tasks.join(task.reference,{requestId:randomUUID(),conversation:observationConversation}),/owned channel/);
  assert.throws(()=>h.handle.tasks.activate(task.reference,{requestId:randomUUID(),conversation:observationConversation,expectedVersion:0}),/not_joined/);
  h.join(task,h.handle,observationConversation);h.activate(task,h.handle,observationConversation,0);
  assert.throws(()=>h.activate(task,h.handle,observationConversation,0),/selection_conflict/);
  const ticket=h.begin(task.reference,h.handle,observationConversation,'slot',[]);
  assert.throws(()=>h.handle.tasks.complete({id:ticket.id},{requestId:randomUUID(),text:'forged'}),/producer work ticket/);
  assert.throws(()=>h.second.tasks.complete(ticket,{requestId:randomUUID(),text:'wrong producer'}),/producer work ticket/);
  assert.throws(()=>task.update({requestId:randomUUID(),expectedVersion:0,goal:'stale'}),/version_conflict/);
});
test('restart preserves task selection and committed state while orphaned work is interrupted without execution',async()=>{
  const h=await taskFixture(),task=create(h),id=task.reference.id,root=h.root;h.join(task,h.handle,observationConversation);h.activate(task,h.handle,observationConversation,0);
  const link=h.link(task,h.handle,observationConversation,h.a.contributions[0]!.memoryId),done=h.begin(task.reference,h.handle,observationConversation,'done',[link]);
  h.handle.tasks.complete(done,{requestId:randomUUID(),text:'PERSISTED_TASK_RESULT'});const pending=h.begin(task.reference,h.handle,observationConversation,'pending',[link]);await h.close();
  const next=await taskFixture(root);try{const resumed=next.core.resumeTaskWorkspace(id);assert.match(JSON.stringify(resumed.read()),/PERSISTED_TASK_RESULT/);
    const jobs=z.object({jobs:z.array(z.object({id:z.string(),status:z.string()}))}).parse(resumed.read()).jobs;assert.equal(jobs.find(j=>j.id===pending.id)!.status,'interrupted');
    assert.equal(z.object({selection:z.object({taskId:z.string()})}).parse(next.handle.tasks.view(resumed.reference,observationConversation)).selection.taskId,id);
    assert.equal(next.adapter.requests.length,0);assert.throws(()=>next.handle.tasks.complete(pending,{requestId:randomUUID(),text:'old ticket'}),/producer work ticket/);
  }finally{await next.close();}
});
test('DSH scene contexts stay isolated and task switching preserves unrelated plugin regions',async t=>{
  const h=await taskFixture();t.after(h.close);const task=create(h),other=create(h,'other');h.join(task,h.handle,observationConversation);h.join(task,h.second,sceneB);h.join(other,h.handle,observationConversation);
  h.activate(task,h.handle,observationConversation,0);h.activate(task,h.second,sceneB,0);h.link(task,h.handle,observationConversation,h.a.contributions[0]!.memoryId);h.link(task,h.second,sceneB,h.b.contributions[0]!.memoryId);
  h.ctx.systemPrompt.context({name:'task-native',order:1,required:true,text:'NATIVE_TASK_KEEP'});
  const extra=h.core.registerExtension({id:'task-independent-plugin',version:'1',apiVersion:API_VERSION,agentId:'dafeiyu',contexts:[{id:'status',kind:'operational-fact',prepare:async()=>[{id:'status',version:'1',text:'OTHER_PLUGIN_KEEP',expiresAt:'2099-01-01T00:00:00.000Z',sources:[{ref:'fictional:status',version:'1',hash:'fixture'}]}],validate:()=>true}]});t.after(()=>extra.dispose());
  const send=async(handle:typeof h.handle,conversation:typeof sceneB)=>{h.setResponse(()=>textReply('虚构回复'));const receipt=handle.ingest({id:randomUUID(),conversation,occurredAt:new Date().toISOString(),sender:{id:'fictional-user',displayName:'虚构用户'},text:'继续当前任务'});await h.core.whenIdle();assert.equal(h.core.journal.get(receipt.id).state,'delivered');return h.core.journal.get(receipt.id);};
  const a=await send(h.handle,observationConversation);let visible=JSON.stringify(h.adapter.requests.at(-1)!.messages);assert.match(visible,/A_ORIGINAL/);assert.ok(!visible.includes('B_PRIVATE_MEMORY'));
  const b=await send(h.second,sceneB);assert.notEqual(a.sessionId,b.sessionId);visible=JSON.stringify(h.adapter.requests.at(-1)!.messages);assert.match(visible,/B_PRIVATE_MEMORY/);assert.ok(!visible.includes('A_ORIGINAL'));
  h.activate(other,h.handle,observationConversation,1);await send(h.handle,observationConversation);visible=JSON.stringify(h.adapter.requests.at(-1)!.messages);assert.ok(!visible.includes('A_ORIGINAL'));assert.match(visible,/OTHER_PLUGIN_KEEP/);assert.match(visible,/NATIVE_TASK_KEEP/);
});

test('task-derived observations inherit foreign input privacy and deletion even with a new source archive',async t=>{
  const h=await taskFixture();t.after(h.close);const task=create(h);h.join(task,h.handle,observationConversation);h.join(task,h.second,sceneB);h.activate(task,h.handle,observationConversation,0);
  const b=h.link(task,h.second,sceneB,h.b.contributions[0]!.memoryId),work=h.begin(task.reference,h.handle,observationConversation,'derive',[b]);
  const input=observationReport({sources:[{key:'derived-source',occurredAt:'2026-10-20T00:00:00Z',archive:{kind:'text',text:'PRIVATE_DERIVED_FROM_B'}}],contributions:[{id:'derived',form:'original',source:'derived-source',exposure:['derived-source']}]});
  const receipt=h.handle.tasks.observe(work,input),id=receipt.contributions[0]!.memoryId,ref=receipt.sources[0]!.ref;
  assert.equal(h.handle.tasks.observe(work,input).duplicate,true);
  assert.ok(h.store.read(h.scope,id,'normal',undefined,'internal'));assert.equal(h.store.read(h.scope,id),null);
  assert.equal(h.handle.openObservationSource({conversation:observationConversation,ref}).status,'not_found');
  assert.ok(!JSON.stringify(h.handle.tasks.view(task.reference,observationConversation)).includes('PRIVATE_DERIVED_FROM_B'));
  assert.match(JSON.stringify(task.read()),/PRIVATE_DERIVED_FROM_B/);
  const activity=h.handle.tasks.observe(work,observationReport({sources:[],contributions:[],selection:{policyId:'private-task-interest',policyVersion:'1',reasonCode:'private-filter'}}));
  assert.ok(h.store.observations.activity(h.scope,activity.activityId,'internal'));assert.equal(h.store.observations.activity(h.scope,activity.activityId),null);
  h.second.changeObservationSource({conversation:sceneB,ref:h.b.sources[0]!.ref,requestId:'delete-b',expectedVersion:1,action:'delete'});
  assert.equal(h.store.read(h.scope,id,'normal',undefined,'internal'),null);assert.ok(h.store.read(h.scope,id,'deleted',undefined,'internal'));
  assert.equal(h.store.observations.activity(h.scope,activity.activityId,'internal'),null);
  assert.ok(!JSON.stringify(task.read()).includes('PRIVATE_DERIVED_FROM_B'));
  assert.throws(()=>h.handle.tasks.observe(work,{...input,requestId:randomUUID()}),/source_unavailable/);
  assert.equal(h.handle.tasks.complete(work,{requestId:randomUUID(),text:'STALE_DERIVED'}).applied,false);
  h.second.changeObservationSource({conversation:sceneB,ref:h.b.sources[0]!.ref,requestId:'restore-b',expectedVersion:2,action:'restore'});
  assert.equal(h.store.read(h.scope,id,'normal',undefined,'internal'),null);
});

test('all captured inputs are checked: an earlier changed source cannot mask a later deletion',async t=>{
  const h=await taskFixture();t.after(h.close);const task=create(h);h.join(task,h.handle,observationConversation);h.join(task,h.second,sceneB);h.activate(task,h.handle,observationConversation,0);
  const a=h.link(task,h.handle,observationConversation,h.a.contributions[0]!.memoryId),b=h.link(task,h.second,sceneB,h.b.contributions[0]!.memoryId);
  const work=h.begin(task.reference,h.handle,observationConversation,'both',[a,b]);
  const receipt=h.handle.tasks.observe(work,observationReport({sources:[{key:'mixed-new',occurredAt:'2026-10-20T00:00:00Z',archive:{kind:'text',text:'MIXED_DEPENDENCY'}}],contributions:[{id:'mixed',form:'original',source:'mixed-new',exposure:['mixed-new']}]}));
  h.handle.changeObservationSource({conversation:observationConversation,ref:h.a.sources[0]!.ref,requestId:'del-a',expectedVersion:1,action:'delete'});
  h.handle.changeObservationSource({conversation:observationConversation,ref:h.a.sources[0]!.ref,requestId:'res-a',expectedVersion:2,action:'restore'});
  h.second.changeObservationSource({conversation:sceneB,ref:h.b.sources[0]!.ref,requestId:'del-b',expectedVersion:1,action:'delete'});
  assert.equal(h.store.taskSourceState('dafeiyu',work.id),'deleted');
  assert.equal(h.store.read(h.scope,receipt.contributions[0]!.memoryId,'history',undefined,'internal'),null);
  assert.ok(h.store.read(h.scope,receipt.contributions[0]!.memoryId,'deleted',undefined,'internal'));
});

test('idempotent requests keep original receipts and observation identity cannot move to another work item',async t=>{
  const h=await taskFixture();t.after(h.close);const input={requestId:randomUUID(),title:'repeat',goal:'repeat'},task=h.core.createTaskWorkspace(input);
  assert.equal(h.core.createTaskWorkspace(input).reference.id,task.reference.id);assert.throws(()=>h.core.createTaskWorkspace({...input,goal:'changed'}),/idempotency_conflict/);
  h.join(task,h.handle,observationConversation);h.activate(task,h.handle,observationConversation,0);
  const args={requestId:randomUUID(),conversation:observationConversation,slot:'same',expectedSlotVersion:0,inputs:[]};
  const first=h.handle.tasks.begin(task.reference,args),retry=h.handle.tasks.begin(task.reference,args);assert.equal(first.id,retry.id);
  const observation=observationReport({sources:[],contributions:[]});h.handle.tasks.observe(first,observation);
  const other=h.begin(task.reference,h.handle,observationConversation,'other',[]);assert.throws(()=>h.handle.tasks.observe(other,observation),/binding_conflict/);
  const result={requestId:randomUUID(),text:'ONE_RESULT'};assert.deepEqual(h.handle.tasks.complete(first,result),h.handle.tasks.complete(retry,result));
  assert.throws(()=>h.handle.tasks.complete(retry,{...result,text:'different'}),/idempotency_conflict/);
});

test('new links and unrelated scene changes do not silently alter a running job or local context item',async t=>{
  const h=await taskFixture();t.after(h.close);const task=create(h);h.join(task,h.handle,observationConversation);h.join(task,h.second,sceneB);h.activate(task,h.handle,observationConversation,0);
  const a=h.link(task,h.handle,observationConversation,h.a.contributions[0]!.memoryId),work=h.begin(task.reference,h.handle,observationConversation,'local',[a]);
  const before=h.handle.tasks.view(task.reference,observationConversation);
  h.link(task,h.second,sceneB,h.b.contributions[0]!.memoryId);h.activate(task,h.second,sceneB,0);
  assert.deepEqual(h.handle.tasks.view(task.reference,observationConversation),before);
  h.second.changeObservationSource({conversation:sceneB,ref:h.b.sources[0]!.ref,requestId:'delete-unrelated',expectedVersion:1,action:'delete'});
  assert.equal(h.handle.tasks.complete(work,{requestId:randomUUID(),text:'LOCAL_RESULT_SURVIVES'}).applied,true);
  assert.match(JSON.stringify(h.handle.tasks.view(task.reference,observationConversation)),/LOCAL_RESULT_SURVIVES/);
});

test('task adoption and completion failures roll back sources, versions, slots and audit together',async t=>{
  const h=await taskFixture();t.after(h.close);const task=create(h);h.join(task,h.handle,observationConversation);h.activate(task,h.handle,observationConversation,0);
  const work=h.begin(task.reference,h.handle,observationConversation,'atomic',[]),db=new DatabaseSync(join(h.root,'memory.sqlite'));t.after(()=>db.close());
  const tables=['observation_sources','observation_activities','observation_contributions','memory_items','task_links','task_revisions','task_observations','task_slots','memory_events','outbox'];
  const counts=()=>tables.map(table=>db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n),before=counts();
  db.exec("CREATE TRIGGER fail_task_audit BEFORE INSERT ON memory_events WHEN json_extract(NEW.body,'$.type') LIKE 'task.%' BEGIN SELECT RAISE(ABORT,'task fixture failure'); END;");
  const report=observationReport({sources:[{key:'atomic-source',occurredAt:'2026-10-20T00:00:00Z',archive:{kind:'text',text:'ATOMIC_RESULT'}}],contributions:[{id:'atomic',form:'original',source:'atomic-source',exposure:['atomic-source']}]});
  assert.throws(()=>h.handle.tasks.observe(work,report),/fixture failure/);assert.deepEqual(counts(),before);
  assert.throws(()=>h.handle.tasks.complete(work,{requestId:'atomic-done',text:'ATOMIC_RESULT'}),/fixture failure/);assert.deepEqual(counts(),before);
  assert.equal(db.prepare('SELECT status FROM task_jobs WHERE id=?').get(work.id)?.status,'running');
  db.exec('DROP TRIGGER fail_task_audit');h.handle.tasks.observe(work,report);assert.equal(h.handle.tasks.complete(work,{requestId:'atomic-done',text:'ATOMIC_RESULT'}).applied,true);
});

test('an action plugin can finish its captured job after the action ends, but cannot create new authority',async t=>{
  const h=await taskFixture();t.after(h.close);const task=create(h);let handle:ExtensionHandle,saved:ActionContext|undefined,ticket:TaskWorkTicket|undefined;
  handle=h.core.registerExtension({id:'task-explorer',version:'1',apiVersion:API_VERSION,agentId:'dafeiyu',actions:[{name:'fictional_task_begin',description:'虚构任务探索',fields:{},execute:async(_args,context)=>{
    saved=context;handle.tasks.join(task.reference,{requestId:randomUUID(),conversation:context.conversation},context);
    handle.tasks.activate(task.reference,{requestId:randomUUID(),conversation:context.conversation,expectedVersion:0},context);
    ticket=handle.tasks.begin(task.reference,{requestId:randomUUID(),conversation:context.conversation,slot:'async',expectedSlotVersion:0,inputs:[]},context);return {started:true};
  }}]});t.after(()=>handle.dispose());
  let calls=0;h.setResponse(()=>++calls===1?call('fictional_task_begin',{}):textReply('后台任务已开始'));h.simulator.send('a','开始虚构探索',{id:randomUUID()});await h.core.whenIdle();assert.ok(ticket);assert.ok(saved);
  assert.throws(()=>handle.tasks.join(task.reference,{requestId:randomUUID(),conversation:saved!.conversation},saved),/active core-issued/);
  const receipt=handle.tasks.observe(ticket,observationReport({conversation:saved.conversation}));assert.equal(receipt.contributions.length,1);
  assert.equal(handle.tasks.complete(ticket,{requestId:randomUUID(),text:'ASYNC_FINISHED'}).applied,true);
  handle.dispose();assert.throws(()=>handle.tasks.complete(ticket!,{requestId:randomUUID(),text:'after unload'}),/unregistered/);
  await h.memoryFiber.dispose();assert.throws(()=>task.read(),/provider unavailable/);
});

test('task outbox replays once after publish-before-ack without reexecuting completed work',async()=>{
  const h=await taskFixture(),root=h.root,task=create(h);h.join(task,h.handle,observationConversation);h.activate(task,h.handle,observationConversation,0);
  const work=h.begin(task.reference,h.handle,observationConversation,'durable',[]),publish=h.core.journal.appendOnce.bind(h.core.journal);let interrupted=false;
  h.core.journal.appendOnce=(event,id)=>{const result=publish(event,id);if(event.type==='task.work.completed'&&!interrupted){interrupted=true;throw new Error('fixture interruption');}return result;};
  assert.equal(h.handle.tasks.complete(work,{requestId:'durable',text:'COMMITTED_ONCE'}).applied,true);assert.equal(interrupted,true);
  h.core.journal.appendOnce=publish;await h.close();const next=await taskFixture(root);
  try{assert.equal(next.core.journal.events(next.scope.route).filter(e=>e.type==='task.work.completed'&&e.data.jobId===work.id).length,1);
    assert.match(JSON.stringify(next.core.resumeTaskWorkspace(task.reference.id).read()),/COMMITTED_ONCE/);assert.equal(next.adapter.requests.length,0);
  }finally{await next.close();}
});

test('schema v3 upgrade preserves old memory boundaries, observation sources and tombstones without assigning a task',async()=>{
  const h=await taskFixture(),root=h.root,id=h.a.contributions[0]!.memoryId,ref=h.a.sources[0]!.ref;
  h.handle.changeObservationSource({conversation:observationConversation,ref,requestId:'legacy-delete',expectedVersion:1,action:'delete'});
  const before=h.store.read(h.scope,id,'deleted');assert.ok(before);await h.close();
  const db=new DatabaseSync(join(root,'memory.sqlite'));try{
    dropExecutionFixtureSchema(db);
    for(const table of ['expression_jobs','expression_packets','expression_requests','expression_policies','expression_policy_revisions','task_memory_hits','task_memory_grants','task_memory_policies','task_memory_policy_revisions','task_memory_requests','task_observations','task_requests','task_slots','task_jobs','task_links','task_selections','task_members','task_revisions','task_workspaces'])db.exec(`DROP TABLE ${table}`);
    db.exec('PRAGMA user_version=3');
  }finally{db.close();}
  const next=await observationFixture(root);try{assert.deepEqual(next.store.read(next.scope,id,'deleted'),before);assert.equal(next.store.read(next.scope,id),null);
assert.equal(before.boundary.task.kind,'unassigned');const verify=new DatabaseSync(join(root,'memory.sqlite'));try{assert.equal(verify.prepare('PRAGMA user_version').get()?.user_version,MEMORY_SCHEMA_VERSION);assert.equal(verify.prepare('SELECT count(*) AS n FROM task_workspaces').get()?.n,0);}finally{verify.close();}
  }finally{await next.close();}
});

test('deleting a task source during model generation blocks stale delivery and later context reuse',async t=>{
  const h=await taskFixture();t.after(h.close);const task=create(h);h.join(task,h.handle,observationConversation);h.activate(task,h.handle,observationConversation,0);
  h.link(task,h.handle,observationConversation,h.a.contributions[0]!.memoryId);let deleted=false;
  h.setResponse(()=>{if(!deleted){deleted=true;h.handle.changeObservationSource({conversation:observationConversation,ref:h.a.sources[0]!.ref,requestId:'during-model',expectedVersion:1,action:'delete'});}return textReply('STALE_TASK_ANSWER');});
  const send=()=>h.handle.ingest({id:randomUUID(),conversation:observationConversation,occurredAt:new Date().toISOString(),sender:{id:'fictional',displayName:'虚构'},text:'继续'});
  const first=send();await h.core.whenIdle();assert.notEqual(h.core.journal.get(first.id).state,'delivered');
  h.setResponse(()=>textReply('有效回答'));const second=send();await h.core.whenIdle();assert.equal(h.core.journal.get(second.id).state,'delivered');
  const visible=JSON.stringify(h.adapter.requests.at(-1)!.messages);assert.ok(!visible.includes('A_ORIGINAL'));assert.ok(!visible.includes('STALE_TASK_ANSWER'));
});
