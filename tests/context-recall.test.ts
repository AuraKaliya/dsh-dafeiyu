import {fixtureAction} from './fixture-action.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {memoryFixture} from './memory-fixture.js';
import {textReply} from './harness.js';
import {qqCapabilityFixture,scene,otherGroup} from './qq-capabilities-fixture.js';
import {API_VERSION,conversationKey} from '@dafeiyu/contracts';
import {call} from './harness.js';

test('first-request lexical recall is scoped, source checked and does not write selected state',async t=>{
  const h=await memoryFixture(undefined,{context:{}},undefined,{assembly:{}});t.after(h.close);
  const evidence=await h.evidence('a','虚构海洋资料');let id='';
  await h.probe('a',async context=>{const result=await h.memory.create(context,{requestId:randomUUID(),kind:'knowledge',claimType:'reported_claim',content:'海洋计划 RECALL_SCOPE_A：不要使用旧数据。',sourceRefs:[evidence.ref]});id=z.object({id:z.string()}).parse(result).id;return result;});
  h.setResponse(()=>textReply('fixture'));
  h.simulator.send('a','海洋计划',{id:randomUUID()});await h.core.whenIdle();assert.match(JSON.stringify(h.adapter.requests.at(-1)?.messages),/recalled-memory/);assert.match(JSON.stringify(h.adapter.requests.at(-1)?.messages),/RECALL_SCOPE_A/);
  await h.probe('a',context=>{const status=z.object({areas:z.array(z.object({storedCount:z.number()}))}).parse(h.memory.contextStatus(context));assert.ok(status.areas.every(area=>area.storedCount===0));return {ok:true};});
  h.simulator.send('b','海洋计划',{id:randomUUID()});await h.core.whenIdle();assert.ok(!JSON.stringify(h.adapter.requests.at(-1)?.messages).includes('RECALL_SCOPE_A'));
  await h.probe('a',context=>h.memory.delete(context,{requestId:randomUUID(),id,expectedVersion:1,reason:'fixture撤回'}));
  h.setResponse(()=>textReply('fixture'));h.simulator.send('a','海洋计划',{id:randomUUID()});await h.core.whenIdle();assert.ok(!JSON.stringify(h.adapter.requests.at(-1)?.messages).includes('RECALL_SCOPE_A'));
});
test('cached non-trigger group background is supplied only in its current group without replay',async t=>{
  const h=await qqCapabilityFixture({context:{assembly:{}}});t.after(h.close);h.setResponse(()=>textReply('fixture'));
  await h.message('现场海洋话题 BACKGROUND_SCOPE_A',{target:scene});const before=h.adapter.requests.length;
  await h.message('另一群的 PRIVATE_BACKGROUND',{target:{...scene,id:otherGroup}});assert.equal(h.adapter.requests.length,before);
  // The shared fixture rounds protocol timestamps upward to pass its new-group boundary.
  await new Promise(resolve=>setTimeout(resolve,1050));
  await h.message('你怎么看',{target:scene,trigger:true});
  const request=JSON.stringify(h.adapter.requests.at(-1)?.messages);assert.ok(request.includes('BACKGROUND_SCOPE_A'),'current group cached background should be admitted');assert.ok(!request.includes('PRIVATE_BACKGROUND'));assert.match(request,/recent-group-background/);
  assert.equal(h.platform.historyCalls.length,0);
});

test('a task recalls expression-eligible memory only from its verified origin conversation',async t=>{
  const h=await qqCapabilityFixture({tasks:true,deliverResults:true,context:{assembly:{}}});t.after(h.close);
  const seed=h.core.registerExtension({id:'fixture-recall-seed',version:'1',protocolVersion:4,agentId:'dafeiyu',actions:[fixtureAction(h.core,'fixture-recall-seed',{id:'fixture_recall_seed',description:'fixture scoped memory',inputSchema:z.strictObject({}),work:async(_raw,context)=>{
    const scope=h.core.scopeFor(context),event=h.core.journal.events(scope.route).findLast(event=>event.type==='message.accepted');assert.ok(event);
    return z.json().parse(await h.ctx.dafeiyuMemory.create(context,{requestId:randomUUID(),kind:'knowledge',claimType:'reported_claim',content:context.conversation.id===scene.id?'海洋计划 ORIGIN_RECALL：只读分析。':'海洋计划 FOREIGN_PRIVATE_RECALL',sourceRefs:[`dafeiyu:source:${event.id}:0`]}));
  }})]});t.after(()=>seed.dispose());let step=0;
  h.setResponse(()=>++step===1?call('fixture_recall_seed',{}):textReply('fixture saved'));await h.message('海洋记录',{target:scene,trigger:true});step=0;await h.message('海洋记录',{target:{...scene,id:otherGroup},trigger:true});
  let chat=0,read=false,rendered=false;
  h.setResponse(request=>{const id=String(request.sessionId),text=JSON.stringify(request.messages);
    if(id.startsWith('dafeiyu-task-')){assert.ok(text.includes('ORIGIN_RECALL'));assert.ok(!text.includes('FOREIGN_PRIVATE_RECALL'));read=true;return textReply('遵循原来的只读限制。');}
    if(id.startsWith('dafeiyu-delivery-v3-')){assert.ok(text.includes('ORIGIN_RECALL'));assert.ok(!text.includes('FOREIGN_PRIVATE_RECALL'));rendered=true;return textReply('我会遵循只读分析。');}
    if(id.startsWith('memory-expression-verify-delivery-'))return textReply(JSON.stringify({faithful:true,issues:[]}));
    return ++chat===1?call('qq_task_submit',{requestId:'origin-recall'}):textReply('');
  });await h.message('任务：回忆海洋计划',{target:scene,trigger:true});assert.equal(read,true);assert.equal(rendered,true);
  const fake={runId:randomUUID(),taskId:randomUUID(),scope:{kind:'conversation' as const,agentId:'dafeiyu',route:conversationKey('dafeiyu',scene)},origin:{kind:'message' as const,inboundId:randomUUID(),conversation:scene},signal:new AbortController().signal};
  assert.equal(h.core.originRecallScope(fake,'memory-origin-recall'),null);
});
