import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {memoryFixture} from './memory-fixture.js';
import {textReply} from './harness.js';
import {qqCapabilityFixture,scene,otherGroup} from './qq-capabilities-fixture.js';

test('first-request lexical recall is scoped, source checked and does not write selected state',async t=>{
  const h=await memoryFixture(undefined,{context:{}},undefined,{assembly:{mode:'unified'}});t.after(h.close);
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
  const h=await qqCapabilityFixture({context:{assembly:{mode:'unified'}}});t.after(h.close);h.setResponse(()=>textReply('fixture'));
  await h.message('现场海洋话题 BACKGROUND_SCOPE_A',{target:scene});const before=h.adapter.requests.length;
  await h.message('另一群的 PRIVATE_BACKGROUND',{target:{...scene,id:otherGroup}});assert.equal(h.adapter.requests.length,before);
  // The shared fixture rounds protocol timestamps upward to pass its new-group boundary.
  await new Promise(resolve=>setTimeout(resolve,1050));
  await h.message('你怎么看',{target:scene,trigger:true});
  const request=JSON.stringify(h.adapter.requests.at(-1)?.messages);assert.ok(request.includes('BACKGROUND_SCOPE_A'),'current group cached background should be admitted');assert.ok(!request.includes('PRIVATE_BACKGROUND'));assert.match(request,/recent-group-background/);
  assert.equal(h.platform.historyCalls.length,0);
});
