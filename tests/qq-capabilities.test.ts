import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationKey } from '@dafeiyu/contracts';
import { qqCapabilityFixture,scene,privateScene,bot,group,otherGroup,lastPage,outcomes,until } from './qq-capabilities-fixture.js';
import { call,textReply } from './harness.js';

for(const mode of ['none','original','fragment','summary'] as const)test(`QQ actual page ${mode} selection uses current exposure and retains one decision`,async t=>{
  const h=await qqCapabilityFixture();t.after(h.close);await h.message('PASSIVE_QQ_SENTINEL：观察到的虚构内容',{media:true});
  assert.equal(h.adapter.requests.length,0);assert.equal(h.rows().memories.length,0);assert.equal(h.core.journal.list().length,0);
  let step=0,pageText='';h.setResponse(request=>{switch(++step){case 1:return call('qq_browse',{requestId:'read'});
    case 2:case 3:{const page=lastPage(request);pageText=JSON.stringify(page.page);return call('qq_observe_select',{requestId:'choice',snapshotId:page.snapshotId,mode,reason:'虚构选择',...(mode==='fragment'?{start:0,end:16}:mode==='summary'?{text:'推断：虚构讨论需要进一步核实。'}:{})});}
    default:return textReply('按实际回执结束');}});
  await h.message('请查看本会话',{trigger:true});const rows=h.rows();assert.equal(rows.decisions.length,1);assert.equal(rows.memories.length,mode==='none'?0:1);
  assert.match(JSON.stringify(outcomes(h.adapter.requests.at(-1)!)),/"duplicate":true/);assert.ok(!JSON.stringify(rows.observations).includes('PASSIVE_QQ_SENTINEL'));
  const page=lastPage(h.adapter.requests.at(-1)!);assert.ok(!JSON.stringify(page).includes('UNBOUND_CACHE_SENTINEL'));
  assert.equal(page.page.messages.find(m=>m.text.includes('PASSIVE'))?.occurredAt,'2026-10-25T00:00:00.000Z');assert.deepEqual(page.page.messages.find(m=>m.text.includes('PASSIVE'))?.unsupported,['image']);
  if(mode!=='none'){const body=JSON.parse(String(rows.memories[0]!.body)),boundary=JSON.parse(String(rows.memories[0]!.boundary));
    assert.equal(body.claimType,mode==='summary'?'inference':'reported_claim');assert.equal(boundary.externalExpression.kind,'conversation');
    assert.equal(boundary.sourceScene.conversation.id,group);if(mode==='original')assert.match(body.content,/PASSIVE_QQ_SENTINEL/);if(mode==='fragment')assert.equal(body.content,Array.from(pageText).slice(0,16).join(''));}
});

test('QQ lists only current conversation or native resource whitelist, never all joined groups',async t=>{
  const h=await qqCapabilityFixture();t.after(h.close);
  for(const target of [privateScene,scene]){let step=0;h.setResponse(()=>++step===1?call('qq_groups',{}):textReply('查询完成'));await h.message('列表',{target,trigger:true});
    const result=outcomes(h.adapter.requests.at(-1)!).at(-1)!;assert.equal(result.status,'succeeded');assert.deepEqual((result.data as {resources:{scene:unknown}[]}).resources.map(r=>r.scene),[target]);}
  let step=0;h.setResponse(()=>++step===1?call('qq_groups',{}):textReply('完成'));const run=await h.native('list');assert.equal(run.status.operations[0]?.status,'succeeded');
  assert.deepEqual((outcomes(h.adapter.requests.at(-1)!).at(-1)!.data as {resources:{scene:unknown}[]}).resources.map(r=>r.scene),[scene]);
});

test('native QQ browsing makes task-only memory without fake inbound messages or QQ sends',async t=>{
  const h=await qqCapabilityFixture();t.after(h.close);await h.message('NATIVE_CACHE_SENTINEL');let step=0;
  h.setResponse(request=>++step===1?call('qq_browse',{requestId:'native-read'}):step===2?call('qq_observe_select',{requestId:'native-choice',snapshotId:lastPage(request).snapshotId,mode:'summary',text:'虚构原生任务摘要',reason:'只在任务内使用'}):textReply('完成'));
  const run=await h.native('native');assert.equal(run.status.state,'completed');assert.deepEqual(run.status.operations.map(op=>op.status),['succeeded','succeeded']);
  assert.equal(h.core.journal.list().length,0);assert.equal(h.platform.sent.length,0);const boundary=JSON.parse(String(h.rows().memories[0]!.boundary));assert.equal(boundary.task.id,run.task.id);assert.equal(boundary.externalExpression.kind,'none');
});

test('QQ rejects foreign targets, forged cursors and selection tickets borrowed across tasks',async t=>{
  const h=await qqCapabilityFixture();t.after(h.close);await h.message('SCOPE_QQ_SENTINEL');
  for(const target of [{...scene,id:otherGroup},{...scene,account:'99887766'}]){let step=0;h.setResponse(()=>++step===1?call('qq_browse',{requestId:'forbidden',target}):textReply('拒绝'));await h.message('跨范围',{trigger:true});assert.equal(outcomes(h.adapter.requests.at(-1)!).at(-1)?.errorCode,'RESOURCE_SCOPE_DENIED');}
  let step=0;h.setResponse(()=>++step===1?call('qq_browse',{requestId:'forged',cursor:crypto.randomUUID()}):textReply('拒绝'));await h.message('伪造游标',{trigger:true});assert.equal(outcomes(h.adapter.requests.at(-1)!).at(-1)?.errorCode,'SNAPSHOT_UNAVAILABLE');
  step=0;h.setResponse(()=>++step===1?call('qq_browse',{requestId:'first'}):textReply('完成'));await h.native('first');const snapshotId=lastPage(h.adapter.requests.at(-1)!).snapshotId;
  step=0;h.setResponse(()=>++step===1?call('qq_observe_select',{requestId:'stolen',snapshotId,mode:'original',reason:'不能借用'}):textReply('拒绝'));const stolen=await h.native('second');assert.equal(stolen.status.operations[0]?.status,'failed');assert.equal(h.rows().memories.length,0);
});

test('recall invalidates actual views and derived memory; wrong-account notice and unrelated group changes do not',async t=>{
  const h=await qqCapabilityFixture();t.after(h.close);const passive=await h.message('RECALLED_QQ_SENTINEL');let step=0;
  h.setResponse(request=>++step===1?call('qq_browse',{requestId:'read'}):step===2?call('qq_observe_select',{requestId:'save',snapshotId:lastPage(request).snapshotId,mode:'original',reason:'来源测试'}):textReply('完成'));await h.message('观察并保存',{trigger:true});assert.equal(h.rows().memories.length,1);
  const scope={agentId:'dafeiyu',route:conversationKey('dafeiyu',scene)},epoch=h.core.capabilityResourceEpoch(scope);
  h.emit({post_type:'notice',notice_type:'group_recall',self_id:99887766,group_id:Number(group),message_id:Number(passive.id)});
  await h.message('其它群被动消息',{target:{...scene,id:otherGroup}});assert.equal(h.ctx.dafeiyuQQ.getStatus().counters.recalled,0);assert.equal(h.core.capabilityResourceEpoch(scope),epoch);
  h.emit({post_type:'notice',notice_type:'group_recall',self_id:Number(bot),group_id:Number(group),message_id:Number(passive.id)});await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.recalled===1);
  assert.notEqual(h.core.capabilityResourceEpoch(scope),epoch);const calls=h.adapter.requests.length;
  await h.message('RECALLED_QQ_SENTINEL',{id:passive.id});assert.equal(h.adapter.requests.length,calls);
  step=0;h.setResponse(()=>++step===1?call('dafeiyu_memory_search',{query:'RECALLED_QQ_SENTINEL',limit:'5'}):textReply('旧来源不可用'));await h.message('查找有效记忆',{trigger:true});
  // Query text intentionally names the sentinel; no old body should remain in any tool result.
  const latest=h.adapter.requests.at(-1)!;assert.ok(!JSON.stringify(outcomes(latest)).includes('RECALLED_QQ_SENTINEL'));assert.match(JSON.stringify(latest),/\\?"items\\?":\s*\[\]/);
});

test('QQ reload retires selection tickets and membership loss denies new access while late recalls still tombstone known sources',async t=>{
  const h=await qqCapabilityFixture();t.after(h.close);const passive=await h.message('RELOAD_QQ_SENTINEL');let step=0;
  h.setResponse(()=>++step===1?call('qq_browse',{requestId:'read'}):textReply('完成'));await h.message('读取',{trigger:true});const snapshotId=lastPage(h.adapter.requests.at(-1)!).snapshotId;
  await h.reload();step=0;h.setResponse(()=>++step===1?call('qq_observe_select',{requestId:'old',snapshotId,mode:'original',reason:'旧快照'}):textReply('拒绝'));await h.message('继续选择',{trigger:true});assert.equal(outcomes(h.adapter.requests.at(-1)!).at(-1)?.errorCode,'SNAPSHOT_UNAVAILABLE');
  h.platform.groups=[];await h.ctx.dafeiyuQQ.refreshGroups();step=0;h.setResponse(()=>++step===1?call('qq_browse',{requestId:'left',target:scene}):textReply('拒绝'));const run=await h.native('after-leave');assert.equal(run.status.operations[0]?.status,'failed');
  h.emit({post_type:'notice',notice_type:'group_recall',self_id:Number(bot),group_id:Number(group),message_id:Number(passive.id)});await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.recalled===1);assert.equal(h.rows().memories.length,0);
});

test('QQ pages are repeatable within a Run and cursor cannot be borrowed by another conversation',async t=>{
  const h=await qqCapabilityFixture();t.after(h.close);await h.message('第一页旧消息');await h.message('第二页旧消息');let step=0,first='',second='',cursor='';
  h.setResponse(request=>{switch(++step){case 1:return call('qq_browse',{requestId:'same',limit:1});case 2:first=lastPage(request).snapshotId;return call('qq_browse',{requestId:'same',limit:1});
    case 3:second=lastPage(request).snapshotId;cursor=lastPage(request).nextCursor!;return call('qq_browse',{requestId:'next',limit:1,cursor});default:return textReply('完成');}});
  await h.message('分页',{trigger:true});assert.equal(first,second);assert.ok(cursor);assert.equal(lastPage(h.adapter.requests.at(-1)!).page.messages[0]?.text,'第二页旧消息');assert.equal(h.rows().observations.length,2);
  step=0;h.setResponse(()=>++step===1?call('qq_browse',{requestId:'borrowed',limit:1,cursor}):textReply('拒绝'));await h.message('跨群游标',{target:{...scene,id:otherGroup},trigger:true});assert.equal(outcomes(h.adapter.requests.at(-1)!).at(-1)?.errorCode,'SNAPSHOT_UNAVAILABLE');
});

test('friend recall invalidates the bound private source without waking a new model turn',async t=>{
  const h=await qqCapabilityFixture();t.after(h.close);await h.message('PRIVATE_RECALL_SENTINEL',{target:privateScene,id:'700'});let step=0;
  h.setResponse(request=>++step===1?call('qq_browse',{requestId:'private'}):step===2?call('qq_observe_select',{requestId:'save',snapshotId:lastPage(request).snapshotId,mode:'original',reason:'虚构私聊'}):textReply('完成'));await h.message('阅读',{target:privateScene});assert.equal(h.rows().memories.length,1);
  const route=conversationKey('dafeiyu',privateScene),accepted=h.core.journal.events(route).find(event=>event.type==='message.accepted'&&event.sources.some(source=>source.kind==='message'&&source.id==='700'))!;
  assert.ok(accepted);const ref=`dafeiyu:source:${accepted.id}:0`;
  const before=h.adapter.requests.length,notice={post_type:'notice',notice_type:'friend_recall',self_id:Number(bot),user_id:Number(privateScene.id),message_id:700};h.emit(notice);await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.recalled===1);assert.equal(h.adapter.requests.length,before);
  h.emit(notice);step=0;h.setResponse(()=>++step===1?call('qq_browse',{requestId:'after-recall'}):step===2?call('dafeiyu_source_open',{ref}):textReply('完成'));await h.message('重新读取',{target:privateScene});assert.ok(!JSON.stringify(h.adapter.requests.at(-1)).includes('PRIVATE_RECALL_SENTINEL'));
  assert.match(JSON.stringify(h.adapter.requests.at(-1)),/not_found/);assert.equal(h.core.journal.events(route).filter(event=>event.type==='message.recalled').length,1);
  assert.equal(h.core.journal.messageFor({agentId:'dafeiyu',route},'700')?.message.text,'PRIVATE_RECALL_SENTINEL');
});
