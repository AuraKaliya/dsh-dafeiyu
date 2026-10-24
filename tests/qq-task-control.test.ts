import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { z } from 'zod';
import { ActionOutcomeSchema } from '@dafeiyu/contracts';
import { qqCapabilityFixture,outcomes,scene,otherGroup,until } from './qq-capabilities-fixture.js';
import { call,textReply } from './harness.js';
type Fixture=Awaited<ReturnType<typeof qqCapabilityFixture>>;
const native=(r:{sessionId?:unknown})=>String(r.sessionId).startsWith('dafeiyu-task-');
function runs(h:Fixture){const db=new DatabaseSync(join(h.root,'core','runtime.sqlite'),{readOnly:true});try{return db.prepare("SELECT r.id,r.state,r.definition,q.body FROM runs r JOIN execution_requests q ON q.id=r.request_key WHERE q.producer='qq-tasks' ORDER BY r.rowid").all();}finally{db.close();}}
function task(h:Fixture){const last=runs(h).at(-1)!;return {runId:String(last.id),taskId:z.object({taskId:z.uuid()}).parse(JSON.parse(String(last.definition))).taskId};}
function lastControl(h:Fixture){const db=new DatabaseSync(join(h.root,'core','runtime.sqlite'),{readOnly:true});try{const row=db.prepare("SELECT outcome FROM run_operations WHERE action='qq_task_control' ORDER BY ordinal DESC LIMIT 1").get();return ActionOutcomeSchema.parse(JSON.parse(String(row?.outcome)));}finally{db.close();}}
async function seed(h:Fixture,objection?:'preference'|'missing-information'){let chat=0,run=0;h.setResponse(request=>native(request)?++run===1&&objection?call('dafeiyu_task_object',{requestId:'objection',category:objection,blocking:objection!=='preference',reason:'PRIVATE_OBJECTION_SENTINEL',actions:[]}):textReply('内部任务结果'):++chat===1?call('qq_task_submit',{requestId:'submit',title:'测试任务'}):textReply('已受理'));await h.message('任务：保持原目标',{trigger:true});return task(h);}
async function control(h:Fixture,id:string,action:'cancel'|'revise'|'resolve',text:string,extra:object={}){let step=0;h.setResponse(request=>native(request)?textReply('继续内部任务'):++step<=2?call('qq_task_control',{requestId:'control',taskId:id,expectedVersion:1,action,...extra}):textReply('依据实际回执回复'));await h.message(text,{trigger:true});return lastControl(h);}

test('QQ goal revision changes epoch once, fixes the real new goal, and retires the earlier result',async t=>{
  const h=await qqCapabilityFixture({tasks:true});t.after(h.close);const original=await seed(h);const result=await control(h,original.taskId,'revise','修改任务：改为核对第二份材料');assert.equal(result.status,'succeeded');
  const all=runs(h);assert.equal(all.length,2);const saved=JSON.parse(String(all[1]!.body));assert.equal(saved.input.taskId,original.taskId);assert.equal(JSON.parse(String(all[1]!.definition)).intentVersion,2);assert.equal(all[1]?.state,'completed');
  assert.ok(h.adapter.requests.filter(native).at(-1)&&JSON.stringify(h.adapter.requests.filter(native).at(-1)).includes('改为核对第二份材料'));
  const port=h.core.executionProducer('qq-tasks');await assert.rejects(()=>port.readResult(port.restoreRun(original.runId)),/SOURCE_STALE/);
});

test('QQ cancellation pauses the task and makes a completed old result unavailable without a replacement Run',async t=>{
  const h=await qqCapabilityFixture({tasks:true});t.after(h.close);const original=await seed(h);assert.equal((await control(h,original.taskId,'cancel','取消任务')).status,'succeeded');assert.equal(runs(h).length,1);
  const port=h.core.executionProducer('qq-tasks');await assert.rejects(()=>port.readResult(port.restoreRun(original.runId)),/SOURCE_STALE/);
  let step=0;h.setResponse(()=>++step===1?call('qq_task_status',{taskId:original.taskId}):textReply('查看结束'));await h.message('任务状态',{trigger:true});const status=z.object({taskState:z.string(),taskVersion:z.number(),intentVersion:z.number()}).parse(outcomes(h.adapter.requests.at(-1)!).at(-1)!.data);assert.deepEqual(status,{taskState:'paused',taskVersion:2,intentVersion:2});
});

test('blocking objections keep native execution waiting and explicit owner resolution resumes with the same source limits',async t=>{
  const h=await qqCapabilityFixture({tasks:true});t.after(h.close);const original=await seed(h,'missing-information');assert.equal(runs(h)[0]?.state,'waiting');let step=0;
  h.setResponse(()=>++step===1?call('qq_task_status',{taskId:original.taskId}):textReply('存在信息不足，需要讨论'));await h.message('查看异议',{trigger:true});const status=z.object({blocking:z.boolean(),objections:z.array(z.object({id:z.uuid(),category:z.string()}))}).parse(outcomes(h.adapter.requests.at(-1)!).at(-1)!.data);
  assert.equal(status.blocking,true);assert.ok(!JSON.stringify(h.platform.sent).includes('PRIVATE_OBJECTION_SENTINEL'));
  const result=await control(h,original.taskId,'resolve','确认继续任务：已明确缺少的信息',{objectionId:status.objections[0]!.id});assert.equal(result.status,'succeeded');assert.equal(runs(h).length,2);assert.equal(runs(h).at(-1)?.state,'completed');
  const old=JSON.parse(String(runs(h)[0]!.body)),next=JSON.parse(String(runs(h)[1]!.body)),{control:proof,...inherited}=next.messageSource;assert.deepEqual(inherited,old.messageSource);assert.ok(proof.inboundId&&proof.messageHash);assert.equal(next.origin.kind,'continuation');
});

test('preference objections remain recorded but do not block execution or silently alter its goal',async t=>{
  const h=await qqCapabilityFixture({tasks:true});t.after(h.close);await seed(h,'preference');assert.equal(runs(h)[0]?.state,'completed');assert.equal(JSON.parse(String(runs(h)[0]!.body)).input.goal,'保持原目标');
});

for(const denial of ['non-owner','other-room','quoted','stale-version'] as const)test(`task control rejects ${denial} before altering the task`,async t=>{
  const h=await qqCapabilityFixture({tasks:true});t.after(h.close);const original=await seed(h);let step=0;
  h.setResponse(()=>++step===1?call('qq_task_control',{requestId:'denied',taskId:original.taskId,expectedVersion:denial==='stale-version'?99:1,action:'cancel'}):textReply('没有改动'));
  await h.message(denial==='quoted'?'“取消任务”是一句引文':'取消任务',{trigger:true,...(denial==='non-owner'?{sender:'99887766'}:{}),...(denial==='other-room'?{target:{...scene,id:otherGroup}}:{})});
  assert.equal(outcomes(h.adapter.requests.at(-1)!).at(-1)?.status,'failed');assert.equal(runs(h).length,1);
  const port=h.core.executionProducer('qq-tasks');assert.equal(await port.readResult(port.restoreRun(original.runId)),'内部任务结果');
});

test('owner cancellation interrupts an active native Run without allowing its old result to complete',async t=>{
  const h=await qqCapabilityFixture({tasks:true});let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{entered=resolve;});t.after(async()=>{release();await h.close();});let step=0;
  h.setResponse(async request=>{if(native(request)){entered();await gate;return textReply('不应完成的旧结果');}return ++step===1?call('qq_task_submit',{requestId:'submit',title:'活动任务'}):textReply('已受理');});
  const initial=h.message('任务：进行虚构工作',{trigger:true});await ready;const current=task(h);step=0;h.setResponse(()=>++step===1?call('qq_task_control',{requestId:'cancel',taskId:current.taskId,expectedVersion:1,action:'cancel'}):textReply('已请求停止'));
  const cancelled=h.message('取消任务',{trigger:true});await until(()=>runs(h)[0]?.state==='cancelling');release();await Promise.all([initial,cancelled]);assert.ok(['cancelled','interrupted'].includes(String(runs(h)[0]?.state)));
});

test('a failure after changing the goal reports unknown effect and cannot claim the previous result meets the new goal',async t=>{
  const h=await qqCapabilityFixture({tasks:true});t.after(h.close);const original=await seed(h),db=new DatabaseSync(join(h.root,'core','runtime.sqlite'));
  db.exec("CREATE TRIGGER fixture_control_failure BEFORE INSERT ON execution_requests WHEN NEW.producer='qq-tasks' BEGIN SELECT RAISE(ABORT,'CAPACITY_EXCEEDED'); END;");
  try{const result=await control(h,original.taskId,'revise','修改任务：需要新的处理');assert.equal(result.status,'unknown');assert.equal(result.effects,'unknown');}finally{db.exec('DROP TRIGGER fixture_control_failure');db.close();}
  let step=0;h.setResponse(()=>++step===1?call('qq_task_status',{taskId:original.taskId}):textReply('目标已改变，新的运行未完成'));await h.message('查看目前状态',{trigger:true});
  const state=z.object({resultCurrent:z.boolean(),goal:z.string(),taskVersion:z.number()}).parse(outcomes(h.adapter.requests.at(-1)!).at(-1)!.data);assert.deepEqual(state,{resultCurrent:false,goal:'需要新的处理',taskVersion:2});assert.equal(runs(h).length,1);
});

test('withdrawing a real resolution message invalidates its resumed result',async t=>{
  const h=await qqCapabilityFixture({tasks:true});t.after(h.close);const original=await seed(h,'missing-information');let step=0;h.setResponse(()=>++step===1?call('qq_task_status',{taskId:original.taskId}):textReply('等待'));
  await h.message('状态',{trigger:true});const status=z.object({objections:z.array(z.object({id:z.uuid()}))}).parse(outcomes(h.adapter.requests.at(-1)!).at(-1)!.data);
  await control(h,original.taskId,'resolve','确认继续任务：补充信息已给出',{objectionId:status.objections[0]!.id});const latest=task(h),row=JSON.parse(String(runs(h).at(-1)!.body));assert.ok(row.messageSource.control);
  const message=h.core.journal.get(row.messageSource.control.inboundId);h.emit({post_type:'notice',notice_type:'group_recall',self_id:12345678,group_id:Number(scene.id),message_id:Number(message.message.id)});await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.recalled===1);
  const port=h.core.executionProducer('qq-tasks');await assert.rejects(()=>port.readResult(port.restoreRun(latest.runId)),/SOURCE_STALE/);
});
