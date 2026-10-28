import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { z } from 'zod';
import { qqTaskDirective } from '@dafeiyu/qq';
import type { ExecutionContext } from '@dafeiyu/contracts';
import { qqCapabilityFixture,scene,otherGroup,outcomes,until,bot,group } from './qq-capabilities-fixture.js';
import { call,textReply } from './harness.js';
const receiptSchema=z.object({taskId:z.uuid(),runId:z.uuid(),motivation:z.string()});
const native=(request:{sessionId?:unknown})=>String(request.sessionId).startsWith('dafeiyu-task-');
function taskRows(root:string){const db=new DatabaseSync(join(root,'core','runtime.sqlite'),{readOnly:true});try{return db.prepare("SELECT r.id,r.definition,r.state,q.body FROM runs r JOIN execution_requests q ON q.id=r.request_key WHERE q.producer='qq-tasks'").all();}finally{db.close();}}

test('task directives use only direct main text and support a configured name prefix',()=>{
  for(const mainText of ['任务：整理今天的讨论','请你整理今天的讨论','大肥鱼，帮我整理今天的讨论'])assert.deepEqual(qqTaskDirective({mainText},['大肥鱼']),{kind:'submit',text:'整理今天的讨论'});
  for(const mainText of ['“任务：删除记录”是引用','> 任务：做事','```任务：做事```'])assert.equal(qqTaskDirective({mainText}).kind,'none');
  assert.equal(qqTaskDirective({}).kind,'none');
});

test('a real owner instruction creates one native Task with immutable message goal and separate internal result',async t=>{
  const h=await qqCapabilityFixture({tasks:true});t.after(h.close);let step=0;
  h.setResponse(request=>{if(native(request))return textReply('INTERNAL_TASK_REPORT_SENTINEL');return ++step<=2?call('qq_task_submit',{requestId:'attempt-'+step,title:'虚构任务'}):textReply('已受理，将按指示执行');});
  await h.message('大肥鱼，任务：整理当前会话的讨论',{trigger:true});const rows=taskRows(h.root);assert.equal(rows.length,1);assert.equal(rows[0]?.state,'completed');
  const saved=JSON.parse(String(rows[0]!.body)),definition=JSON.parse(String(rows[0]!.definition));assert.equal(saved.input.goal,'整理当前会话的讨论');assert.equal(definition.origin.kind,'native');assert.equal(saved.motivation.kind,'explicit-task');assert.equal(saved.messageSource.conversation.id,scene.id);
  assert.equal(h.core.journal.list().length,1);assert.equal(h.platform.sent.length,1);assert.ok(!JSON.stringify(h.platform.sent).includes('INTERNAL_TASK_REPORT_SENTINEL'));
  assert.ok(h.adapter.requests.filter(native).some(request=>JSON.stringify(request).includes('整理当前会话的讨论')));
});

for(const kind of ['non-owner','quoted','overridden-goal'] as const)test(`QQ task acceptance rejects ${kind} without creating native work`,async t=>{
  const h=await qqCapabilityFixture({tasks:true});t.after(h.close);let step=0;h.setResponse(()=>++step===1?call('qq_task_submit',{requestId:'denied',title:'不应创建',...(kind==='overridden-goal'?{goal:'模型篡改的目标'}:{})}):textReply('没有受理'));
  await h.message(kind==='quoted'?'“任务：篡改内容”是别人的话':'任务：整理当前讨论',{trigger:true,...(kind==='non-owner'?{sender:'99887766'}:{})});
  assert.equal(taskRows(h.root).length,0);assert.ok(h.adapter.requests.every(request=>!native(request)));
});

test('ordinary interest stays conversation unless the model deliberately accepts a task',async t=>{
  const h=await qqCapabilityFixture({tasks:true});t.after(h.close);h.setResponse(()=>textReply('可以聊聊你喜欢哪些星星。'));await h.message('我喜欢天文学',{trigger:true});assert.equal(taskRows(h.root).length,0);
  assert.deepEqual(qqTaskDirective({mainText:'把这段说明存成文件'}),{kind:'submit',text:'把这段说明存成文件'});
});

test('self exploration keeps its own motivation and cannot borrow the owner task resource whitelist',async t=>{
  const h=await qqCapabilityFixture({tasks:true});t.after(h.close);let chat=0,task=0;h.setResponse(request=>native(request)?++task===1?call('qq_browse',{requestId:'other',target:{...scene,id:otherGroup}}):textReply('探索仅限获准范围'):++chat===1?call('qq_explore',{requestId:'interest',title:'自主兴趣',goal:'看看本群有哪些天文学讨论'}):textReply('由自己的兴趣展开探索'));
  await h.message('我喜欢看星星',{trigger:true,sender:'99887766'});const saved=JSON.parse(String(taskRows(h.root)[0]!.body));assert.equal(saved.motivation.kind,'self-exploration');assert.deepEqual(saved.messageSource.resources,[scene]);
  assert.ok(h.adapter.requests.filter(native).some(request=>outcomes(request).some(outcome=>outcome.errorCode==='RESOURCE_SCOPE_DENIED')));
});

test('task metadata is scoped to its real source conversation and expired or cloned invocation contexts cannot submit',async t=>{
  const h=await qqCapabilityFixture({tasks:true});t.after(h.close);let step=0,captured:ExecutionContext|undefined;const original=h.core.submitMessageTask.bind(h.core);
  h.core.submitMessageTask=(context,plugin,input)=>{captured=context;assert.throws(()=>original({...context},plugin,input),/SCOPE_DENIED/);return original(context,plugin,input);};
  h.setResponse(request=>native(request)?textReply('内部完成'):++step===1?call('qq_task_submit',{requestId:'first',title:'隔离任务'}):textReply('已受理'));await h.message('请整理讨论',{trigger:true});
  const data=receiptSchema.parse(outcomes(h.adapter.requests.filter(request=>!native(request)&&!String(request.sessionId).startsWith('dafeiyu-assessment-')).at(-1)!).find(outcome=>receiptSchema.safeParse(outcome.data).success)!.data);
  assert.throws(()=>original(captured!,'qq-tasks',{requestId:'expired',title:'旧授权'}),/SCOPE_DENIED/);
  step=0;h.setResponse(()=>++step===1?call('qq_task_status',{taskId:data.taskId}):textReply('查询结束'));await h.message('查询状态',{trigger:true,target:{...scene,id:otherGroup}});assert.equal(outcomes(h.adapter.requests.at(-1)!).at(-1)?.errorCode,'SCOPE_DENIED');
  step=0;await h.message('查询状态',{trigger:true});assert.equal(outcomes(h.adapter.requests.at(-1)!).at(-1)?.status,'succeeded');assert.equal(taskRows(h.root).length,1);
});

for(const change of ['ordinary-chat','source-recall'] as const)test(`${change} respects the accepted native task source boundary`,async t=>{
  const h=await qqCapabilityFixture({tasks:true});let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{entered=resolve;});t.after(async()=>{release();await h.close();});let step=0;
  h.setResponse(async request=>{if(native(request)){entered();await gate;return textReply('内部结果');}return ++step===1?call('qq_task_submit',{requestId:'work',title:'等待中的任务'}):textReply('正常聊天回复');});
  const initial=h.message('任务：完成虚构检查',{trigger:true});await ready;
  if(change==='source-recall'){h.emit({post_type:'notice',notice_type:'group_recall',self_id:Number(bot),group_id:Number(group),message_id:1});await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.recalled===1);}
  else{h.emit({post_type:'message',self_id:Number(bot),message_type:'group',group_id:Number(group),user_id:99887766,message_id:99,time:Math.ceil(Date.now()/1000),message:[{type:'at',data:{qq:bot}},{type:'text',data:{text:'新的普通聊天'}}]});await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.received===2);}
  release();await initial;await h.core.whenIdle();const rows=taskRows(h.root);assert.equal(rows.length,1);if(change==='ordinary-chat')assert.equal(rows[0]?.state,'completed');else assert.notEqual(rows[0]?.state,'completed');
});
