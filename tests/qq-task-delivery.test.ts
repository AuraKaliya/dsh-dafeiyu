import {fixtureAction} from './fixture-action.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { z } from 'zod';
import {setTimeout as delay} from 'node:timers/promises';
import { SessionId } from '@deepseek-ai/dsh-session';
import { RuntimeStore } from '@dafeiyu/core/runtime-store';
import { API_VERSION } from '@dafeiyu/contracts';
import type { PersonaSourceRef,PersonaEntryRef } from '@dafeiyu/contracts';
import { qqCapabilityFixture,scene,otherGroup,bot,group,until } from './qq-capabilities-fixture.js';
import { call,textReply } from './harness.js';
type Fixture=Awaited<ReturnType<typeof qqCapabilityFixture>>;
const native=(id:unknown)=>String(id).startsWith('dafeiyu-task-'),render=(id:unknown)=>String(id).startsWith('dafeiyu-delivery-v3-'),verify=(id:unknown)=>String(id).startsWith('memory-expression-verify-delivery-');
function isolatedEvidence(){let step=0;return (text:string)=>++step===1?call('qq_browse',{requestId:'public',target:scene}):step===2?call('qq_browse',{requestId:'private',target:{...scene,id:otherGroup}}):textReply(text);}
const reply='PERSONA_RESULT：海风让我想起仍有许多未知值得探索。';
function runId(h:Fixture){const db=new DatabaseSync(join(h.root,'core','runtime.sqlite'),{readOnly:true});try{return String(db.prepare("SELECT r.id FROM runs r JOIN execution_requests q ON q.id=r.request_key WHERE q.producer='qq-tasks' ORDER BY r.rowid DESC LIMIT 1").get()?.id);}finally{db.close();}}
const sentText=(sent:Record<string,unknown>)=>z.object({message:z.array(z.object({type:z.string(),data:z.object({text:z.string().optional()})}))}).parse(sent).message.filter(s=>s.type==='text').map(s=>s.data.text??'').join('');
function script(h:Fixture,{text=reply,faithful=true,mixed=false}:{text?:string;faithful?:boolean;mixed?:boolean}={}){let chat=0,work=0;h.setResponse(request=>{
  if(render(request.sessionId))return textReply(text);if(verify(request.sessionId))return textReply(JSON.stringify({faithful,issues:faithful?[]:['虚构校验失败']}));
  if(native(request.sessionId)){if(mixed&&++work===1)return call('qq_browse',{requestId:'public',target:scene});if(mixed&&work===2)return call('qq_browse',{requestId:'private',target:{...scene,id:otherGroup}});return textReply(mixed?'EXECUTOR_REPORT_SENTINEL：这是执行器的候选结果。':text);}
  return ++chat===1?call('qq_task_submit',{requestId:'task'}):textReply('已受理任务');
});}
test('ordinary task delivery uses the persisted main Agent answer exactly once',async t=>{
  const h=await qqCapabilityFixture({tasks:true,deliverResults:true});t.after(h.close);script(h);await h.message('任务：写一句关于海洋的虚构感想',{trigger:true});
  const id=runId(h),status=h.core.messageTaskDeliveryStatus(id)!;assert.equal(status.state,'sent');assert.equal(h.platform.sent.length,2);assert.equal(sentText(h.platform.sent[1]!),reply);
  assert.equal(h.adapter.requests.filter(r=>render(r.sessionId)||verify(r.sessionId)).length,0);
  const calls=h.adapter.requests.length;assert.deepEqual(await h.core.deliverMessageTaskResult(id),status);assert.equal(h.adapter.requests.length,calls);assert.equal(h.platform.sent.length,2);
  const task=h.adapter.requests.find(r=>native(r.sessionId))!;const reader=await h.ctx.sessionPersistence.open(SessionId(String(task.sessionId)),'read');try{const events=(await reader.read()).events;assert.ok(events.some(e=>e.type==='assistant/message'));assert.ok(events.some(e=>e.type==='turn/end'));}finally{await reader.close();}
});


test('a text task starts its write deadline after preflight while keeping authority checks and a whole receipt',async t=>{
  const h=await qqCapabilityFixture({tasks:true,deliverResults:true,deliveryTimeoutMs:500});t.after(h.close);const original=h.ctx.dafeiyuQQ.deliverTaskResult.bind(h.ctx.dafeiyuQQ);let prepared=false;
  h.ctx.dafeiyuQQ.deliverTaskResult=async(...args)=>{assert.equal(typeof args[4],'function');assert.equal(h.core.messageTaskDeliveryStatus(runId(h))?.state,'ready');await delay(800);assert.equal(args[2].aborted,false);prepared=true;return original(...args);};
  script(h);await h.message('任务：测试准备耗时与写入时限分离',{trigger:true});assert.equal(prepared,true);assert.equal(h.core.messageTaskDeliveryStatus(runId(h))?.state,'sent');assert.equal(h.platform.sent.filter(sent=>sentText(sent)===reply).length,1);
});

test('a stalled real write still times out as unknown and never replays the task result',async t=>{
  const h=await qqCapabilityFixture({tasks:true,deliverResults:true,deliveryTimeoutMs:500,oneBotTimeoutMs:2000});t.after(h.close);script(h);h.platform.afterSend=async()=>{if(h.platform.sent.some(sent=>sentText(sent)===reply))await delay(900);};
  await h.message('任务：测试真正写入之后的时限',{trigger:true});const id=runId(h);assert.equal(h.core.messageTaskDeliveryStatus(id)?.state,'uncertain');const count=h.platform.sent.filter(sent=>sentText(sent)===reply).length;assert.equal(count,1);await h.core.deliverMessageTaskResult(id);assert.equal(h.platform.sent.filter(sent=>sentText(sent)===reply).length,count);
});

test('identity preparation between text parts does not consume the cumulative network-write budget',async t=>{
  const h=await qqCapabilityFixture({tasks:true,deliverResults:true,deliveryTimeoutMs:500,oneBotTimeoutMs:2000});t.after(h.close);const first='WRITE_WINDOW_PART_ONE',second='WRITE_WINDOW_PART_TWO';let delayed=false;
  script(h,{text:JSON.stringify({qq_messages:[{type:'text',text:first},{type:'text',text:second}]})});
  h.platform.beforeVerify=async()=>{if(!delayed&&h.platform.sent.some(sent=>sentText(sent)===first)){delayed=true;await delay(800);}};
  await h.message('任务：用两条消息发送虚构内容',{trigger:true});assert.equal(delayed,true);assert.equal(h.core.messageTaskDeliveryStatus(runId(h))?.state,'sent');assert.equal(h.platform.sent.filter(sent=>sentText(sent)===first).length,1);assert.equal(h.platform.sent.filter(sent=>sentText(sent)===second).length,1);
});

test('source recall during text preflight stays definitely unsent instead of becoming an unknown write',async t=>{
  const h=await qqCapabilityFixture({tasks:true,deliverResults:true,deliveryTimeoutMs:500});t.after(h.close);script(h);const original=h.ctx.dafeiyuQQ.deliverTaskResult.bind(h.ctx.dafeiyuQQ);
  h.ctx.dafeiyuQQ.deliverTaskResult=async(...args)=>{const source=h.core.journal.list()[0]!.message.id;h.emit({post_type:'notice',notice_type:'group_recall',self_id:Number(bot),group_id:Number(group),message_id:Number(source)});await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.recalled===1);return original(...args);};
  await h.message('任务：检查发送前撤回',{trigger:true});const id=runId(h);assert.equal(h.core.messageTaskDeliveryStatus(id)?.state,'not-sent');assert.ok(!h.platform.sent.some(sent=>sentText(sent)===reply));
  const db=new DatabaseSync(join(h.root,'core/runtime.sqlite'),{readOnly:true});try{assert.equal(db.prepare("SELECT count(*) AS n FROM runtime_outbox WHERE json_extract(body,'$.runId')=? AND json_extract(body,'$.type')='native.delivery.sending'").get(id)?.n,0);}finally{db.close();}
});

test('assistant revocation cancels a native task started by that group and prevents automatic result delivery',{timeout:15000},async t=>{
  const h=await qqCapabilityFixture({tasks:true,deliverResults:true});let entered!:()=>void,release!:()=>void,chat=0;
  const started=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  t.after(()=>{release();return h.close();});
  h.setResponse(async request=>{
    if(native(request.sessionId)){entered();await gate;return textReply('IGNORED_NATIVE_RESULT_SENTINEL');}
    if(render(request.sessionId))return textReply('不应生成的群回复');if(verify(request.sessionId))return textReply('{"faithful":true,"issues":[]}');
    return ++chat===1?call('qq_task_submit',{requestId:'assistant-native'}):textReply('已受理');
  });
  const pending=h.message('任务：完成一项虚构工作',{trigger:true});await started;await until(()=>h.core.journal.list()[0]?.state==='delivered');const before=h.platform.sent.length;
  h.platform.groups[0]!.msgMask=2;await h.ctx.dafeiyuQQ.refreshGroups();release();await pending;await h.core.whenIdle();
  const db=new DatabaseSync(join(h.root,'core','runtime.sqlite'),{readOnly:true});
  try{assert.ok(['failed','interrupted'].includes(String(db.prepare('SELECT state FROM runs WHERE id=?').get(runId(h))?.state)));}finally{db.close();}
  assert.equal(h.platform.sent.length,before);assert.equal(h.adapter.requests.filter(request=>render(request.sessionId)).length,0);
});

test('assistant revocation also cancels a task result already being formatted for that group',{timeout:15000},async t=>{
  const h=await qqCapabilityFixture({tasks:true});script(h,{mixed:true});await h.message('任务：准备一份虚构结果',{trigger:true});
  let entered!:()=>void,release!:()=>void,formattingSignal:AbortSignal|undefined;
  const started=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  t.after(()=>{release();return h.close();});const before=h.platform.sent.length;
  h.setResponse(async request=>{if(render(request.sessionId)){formattingSignal=request.signal;entered();await gate;return textReply('不应交付');}return textReply('{"faithful":true,"issues":[]}');});
  const pending=h.core.deliverMessageTaskResult(runId(h));await started;h.platform.groups[0]!.msgMask=2;await h.ctx.dafeiyuQQ.refreshGroups();
  assert.equal(formattingSignal?.aborted,true);release();const status=await pending;assert.ok(status&&status.state!=='sent');assert.equal(h.platform.sent.length,before);
});

test('mixed private evidence and inherited global prompt content never enter the target rendering request',async t=>{
  const h=await qqCapabilityFixture({tasks:true});t.after(h.close);await h.message('TARGET_PUBLIC_SENTINEL');await h.message('FOREIGN_PRIVATE_SENTINEL',{target:{...scene,id:otherGroup}});script(h,{mixed:true});await h.message('任务：整理当前可公开资料',{trigger:true});
  const context=h.ctx.systemPrompt.context({name:'foreign-global',order:50,text:'GLOBAL_PRIVATE_CONTEXT_SENTINEL'}),section=h.ctx.systemPrompt.section({name:'foreign-global-section',order:50,text:'GLOBAL_PRIVATE_SECTION_SENTINEL'});t.after(context);t.after(section);
  assert.equal((await h.core.deliverMessageTaskResult(runId(h)))?.state,'sent');const target=JSON.stringify(h.adapter.requests.find(r=>render(r.sessionId)));
  assert.match(target,/TARGET_PUBLIC_SENTINEL/);for(const forbidden of ['FOREIGN_PRIVATE_SENTINEL','EXECUTOR_REPORT_SENTINEL','GLOBAL_PRIVATE_CONTEXT_SENTINEL','GLOBAL_PRIVATE_SECTION_SENTINEL'])assert.ok(!target.includes(forbidden));
});

test('failed independent verification never creates a send credential or performs the task-result send',async t=>{
  const h=await qqCapabilityFixture({tasks:true,deliverResults:true});t.after(h.close);script(h,{faithful:false,mixed:true});await h.message('任务：生成一份虚构结果',{trigger:true});
  const id=runId(h),status=h.core.messageTaskDeliveryStatus(id)!;assert.equal(status.state,'rejected');assert.equal(status.error,'DELIVERY_UNFAITHFUL');assert.equal(h.platform.sent.length,2);assert.ok(h.platform.sent.every(sent=>!sentText(sent).includes(reply)&&!sentText(sent).includes('EXECUTOR_REPORT_SENTINEL')));
  const db=new DatabaseSync(join(h.root,'core','runtime.sqlite'),{readOnly:true});try{const row=db.prepare('SELECT body,credential FROM native_deliveries').get()!;assert.equal(row.body,null);assert.equal(row.credential,null);}finally{db.close();}
  const calls=h.adapter.requests.length;await h.core.deliverMessageTaskResult(id);assert.equal(h.adapter.requests.length,calls);
  assert.equal(h.adapter.requests.filter(request=>render(request.sessionId)).length,2);assert.equal(h.adapter.requests.filter(request=>verify(request.sessionId)).length,2);
});

for(const revoke of [false,true])test(`one unapproved wording repair ${revoke?'stops on source recall':'is independently verified and delivered once'}`,async t=>{
  const h=await qqCapabilityFixture({tasks:true,deliverResults:true});t.after(h.close);const isolated=isolatedEvidence();let chat=0,renders=0,checks=0;
  h.setResponse(async request=>{if(render(request.sessionId)){renders++;if(renders===2){assert.match(JSON.stringify(request.messages),/previousCandidateUnapproved/);assert.match(JSON.stringify(request.messages),/总数与折叠数混淆/);assert.equal(request.tools?.length??0,0);}return textReply(renders===1?'虚构数据：折叠1600条。':'虚构数据：总数1600条，其中折叠1100条。');}
    if(verify(request.sessionId)){checks++;if(checks===1){if(revoke){const source=h.core.journal.list()[0]!.message.id;h.emit({post_type:'notice',notice_type:'group_recall',self_id:Number(bot),group_id:Number(group),message_id:Number(source)});await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.recalled===1);}return textReply('{"faithful":false,"issues":["总数与折叠数混淆，应为总数1600、其中折叠1100。"]}');}assert.match(JSON.stringify(request.messages),/其中折叠1100/);return textReply('{"faithful":true,"issues":[]}');}
    if(native(request.sessionId))return isolated('虚构数据：总数1600条，其中折叠1100条。');
    return ++chat===1?call('qq_task_submit',{requestId:'wording-repair'}):textReply('已受理');});
  await h.message('任务：转述一组虚构数据',{trigger:true});const id=runId(h),status=h.core.messageTaskDeliveryStatus(id)!;
  if(revoke){assert.notEqual(status.state,'sent');assert.equal(renders,1);assert.ok(!JSON.stringify(h.platform.sent).includes('其中折叠1100'));}
  else{assert.equal(status.state,'sent');assert.equal(renders,2);assert.equal(checks,2);assert.equal(h.platform.sent.filter(sent=>sentText(sent).includes('其中折叠1100')).length,1);assert.ok(!h.platform.sent.some(sent=>sentText(sent)==='虚构数据：折叠1600条。'));
    assert.ok(h.core.journal.executionEvents('dafeiyu',status.taskId).some(event=>event.type==='native.delivery.verification-rejected'));}
});

for(const mode of ['recover-cutoff','repeated-cutoff','invalid-json'] as const)test(`delivery verifier ${mode} keeps the candidate gated and exposes the actual failure phase`,async t=>{
  const h=await qqCapabilityFixture({tasks:true,deliverResults:true});t.after(h.close);const isolated=isolatedEvidence();let chat=0,checks=0;
  h.setResponse(request=>{
    if(render(request.sessionId))return textReply(reply);
    if(verify(request.sessionId)){checks++;assert.ok((request.maxTokens??0)>=8192);
      if(mode==='invalid-json')return textReply('invalid response');
      if(mode==='repeated-cutoff'||checks===1)return [{type:'finish',reason:{kind:'max-tokens'}}];
      return textReply('{"faithful":true,"issues":[]}');}
    if(String(request.sessionId).startsWith('dafeiyu-progress-')){assert.match(JSON.stringify(request.messages),/"sendAttempted":false/);assert.match(JSON.stringify(request.messages),/verification/);return textReply('结果核验未完成，正文还未发送。');}
    if(native(request.sessionId))return isolated('完成虚构材料');
    return ++chat===1?call('qq_task_submit',{requestId:'verify-recovery'}):textReply('已受理');
  });
  await h.message('任务：写一句虚构感想',{trigger:true});const state=h.core.messageTaskDeliveryStatus(runId(h))!;
  assert.equal(checks,mode==='invalid-json'?1:2);
  if(mode==='recover-cutoff'){assert.equal(state.state,'sent');assert.equal(h.platform.sent.filter(item=>sentText(item)===reply).length,1);}
  else{assert.equal(state.state,'rejected');assert.equal(state.error,mode==='invalid-json'?'DELIVERY_VERIFICATION_INVALID_RESULT':'DELIVERY_VERIFICATION_MAX_TOKENS');assert.ok(h.platform.sent.every(item=>!sentText(item).includes(reply)));}
});

test('new group chat and cache eviction do not replace the fixed task-result anchor',async t=>{
  const h=await qqCapabilityFixture({tasks:true});t.after(h.close);script(h);await h.message('任务：保留结果锚点',{trigger:true});const id=runId(h);
  for(let i=0;i<205;i++)await h.message('无关群消息'+i);
  const result=await h.core.deliverMessageTaskResult(id);assert.equal(result?.state,'sent');assert.equal(sentText(h.platform.sent.at(-1)!),reply);
  const quote=z.object({message:z.array(z.object({type:z.string(),data:z.record(z.string(),z.unknown())}))}).parse(h.platform.sent.at(-1)).message.find(segment=>segment.type==='reply');assert.equal(quote?.data.id,'1');
});

test('task-result segment uncertainty is terminal and never rerenders or retransmits on a duplicate request',async t=>{
  const h=await qqCapabilityFixture({tasks:true,deliverResults:true});t.after(h.close);const long='人格长回复：'+'鱼'.repeat(9000);script(h,{text:long});h.platform.loseAt=3;await h.message('任务：生成长篇虚构结果',{trigger:true});
  const id=runId(h),status=h.core.messageTaskDeliveryStatus(id)!;assert.equal(status.state,'uncertain');assert.equal(h.platform.sent.length,3);
  const parts=h.ctx.dafeiyuQQ.deliveryStatus(`native-delivery:${status.deliveryId}`)!;assert.equal(parts.confirmed,1);assert.equal(parts.unknown,1);assert.ok(parts.pending>0);
  const count=h.adapter.requests.length;await h.reload();await h.core.deliverMessageTaskResult(id);assert.equal(h.adapter.requests.length,count);assert.equal(h.platform.sent.length,3);
});

test('a source revoked during target persona generation prevents the result transport',async t=>{
  const h=await qqCapabilityFixture({tasks:true});t.after(h.close);script(h,{mixed:true});await h.message('任务：核对来源',{trigger:true});const id=runId(h),before=h.platform.sent.length;
  h.setResponse(async request=>{if(render(request.sessionId)){h.emit({post_type:'notice',notice_type:'group_recall',self_id:Number(bot),group_id:Number(group),message_id:1});await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.recalled===1);return textReply('失效结果');}return textReply('{"faithful":true,"issues":[]}');});
  assert.equal((await h.core.deliverMessageTaskResult(id))?.state,'interrupted');assert.equal(h.platform.sent.length,before);
});

test('tool calls in the target renderer are rejected without invoking a capability',async t=>{
  const h=await qqCapabilityFixture({tasks:true});t.after(h.close);script(h,{mixed:true});await h.message('任务：不要执行额外操作',{trigger:true});const id=runId(h),before=h.platform.sent.length;
  h.setResponse(request=>render(request.sessionId)?call('qq_browse',{requestId:'forbidden'}):textReply('{"faithful":true,"issues":[]}'));
  assert.equal((await h.core.deliverMessageTaskResult(id))?.state,'rejected');assert.equal(h.platform.sent.length,before);
});

test('published results remain available only in their target context and the QQ cache cannot create a new copy of the result body',async t=>{
  const h=await qqCapabilityFixture({tasks:true,deliverResults:true});t.after(h.close);script(h);await h.message('任务：给出一段虚构结果',{trigger:true});
  const db=new DatabaseSync(join(h.root,'qq','qq.sqlite'),{readOnly:true});try{assert.match(String(db.prepare("SELECT text FROM messages WHERE id='-2'").get()?.text),/任务交付占位/);assert.ok(!JSON.stringify(db.prepare('SELECT text FROM messages').all()).includes(reply));}finally{db.close();}
  h.setResponse(()=>textReply('接续当前会话'));await h.message('解释一下刚才的结果',{trigger:true});assert.ok(JSON.stringify(h.adapter.requests.at(-1)?.messages).includes('PERSONA_RESULT'),'published context missing');assert.ok(JSON.stringify(h.adapter.requests.at(-1)?.messages).includes('delivered-task-result'));
  await h.message('其它群聊天',{trigger:true,target:{...scene,id:otherGroup}});assert.ok(!JSON.stringify(h.adapter.requests.at(-1)).includes('PERSONA_RESULT'));
});

test('publication reading survives the send deadline, but task cancellation withdraws its old context',async t=>{
  const h=await qqCapabilityFixture({tasks:true,deliverResults:true});t.after(h.close);script(h);await h.message('任务：产生一份结果',{trigger:true});const status=h.core.messageTaskDeliveryStatus(runId(h))!;
  const clock=Date.now;try{Date.now=()=>clock()+16*60*1000;h.setResponse(()=>textReply('仍可核验的已发结果'));await h.message('回顾已发内容',{trigger:true});assert.ok(JSON.stringify(h.adapter.requests.at(-1)?.messages).includes('PERSONA_RESULT'),'expired send grant must not erase valid publication context');}finally{Date.now=clock;}
  let step=0;h.setResponse(()=>++step===1?call('qq_task_control',{requestId:'cancel',taskId:status.taskId,expectedVersion:1,action:'cancel'}):textReply('按实际回执停止'));
  const cancelled=await h.message('取消任务',{trigger:true});assert.equal(h.core.journal.list().find(item=>item.message.id===cancelled.id)?.state,'delivered');assert.ok(JSON.stringify(h.adapter.requests.at(-1)?.messages).includes('paused'),'control acknowledgement must remain available after withdrawing old result context');
  h.setResponse(()=>textReply('旧目标已失效'));await h.message('再检查状态',{trigger:true});assert.ok(!JSON.stringify(h.adapter.requests.at(-1)).includes('PERSONA_RESULT'));
});

test('a blocking objection gets a scoped persona discussion message while its native Run stays waiting',async t=>{
  const h=await qqCapabilityFixture({tasks:true,deliverResults:true});t.after(h.close);let chat=0,work=0;
  h.setResponse(request=>render(request.sessionId)?textReply('我还需要你补充链接，任务目前没有完成。'):verify(request.sessionId)?textReply('{"faithful":true,"issues":[]}'):native(request.sessionId)?++work===1?call('dafeiyu_task_object',{requestId:'need-link',category:'missing-information',blocking:true,actions:[],reason:'缺少要查看的链接'}):textReply('我还需要你补充链接，任务目前没有完成。'):++chat===1?call('qq_task_submit',{requestId:'work'}):textReply('已受理'));
  await h.message('任务：检查那份材料',{trigger:true});const id=runId(h);assert.equal(h.core.messageTaskDeliveryStatus(id)?.state,'sent');assert.match(sentText(h.platform.sent.at(-1)!),/没有完成/);
  const db=new DatabaseSync(join(h.root,'core','runtime.sqlite'),{readOnly:true});try{assert.equal(db.prepare('SELECT state FROM runs WHERE id=?').get(id)?.state,'waiting');const row=db.prepare('SELECT anchor FROM native_deliveries').get();assert.equal(JSON.parse(String(row?.anchor)).outcome,'waiting');}finally{db.close();}
});

test('native execution excludes unregistered global context and section data',async t=>{
  const h=await qqCapabilityFixture({tasks:true});t.after(h.close);const a=h.ctx.systemPrompt.context({name:'unregistered-data',order:50,text:'NATIVE_UNREGISTERED_PRIVATE_SENTINEL'}),b=h.ctx.systemPrompt.section({name:'unregistered-section',order:50,text:'NATIVE_UNREGISTERED_SECTION_SENTINEL'});t.after(a);t.after(b);
  script(h);await h.message('任务：写一段虚构文字',{trigger:true});const request=JSON.stringify(h.adapter.requests.find(r=>native(r.sessionId)));assert.ok(!request.includes('NATIVE_UNREGISTERED_'));
});
