import { readCompactionEvents } from '@dafeiyu/core';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SessionId,appendPluginRecord } from '@deepseek-ai/dsh-session';
import type {} from '@deepseek-ai/dsh-compaction/types';
import type {} from '@deepseek-ai/dsh-token-meter';
import type { GenerateOptions } from '@deepseek-ai/dsh-llm';
import { API_VERSION } from '@dafeiyu/contracts';
import { z } from 'zod';
import { memoryFixture } from './memory-fixture.js';
import { textReply } from './harness.js';
import { call } from './harness.js';
import { MemoryStore } from '@dafeiyu/memory/store';
import { join } from 'node:path';
import { fixtureTool,report,invoke,archivePointer } from './feedback-fixture.js';
import { CompactionId,compactCheckpointSource } from '@deepseek-ai/dsh-compaction';
import { createUserMessage } from '@deepseek-ai/dsh-llm';

type H = Awaited<ReturnType<typeof memoryFixture>>;
const policy = { inputTokens: 5000, minGrowthTokens: 0, minSavingsTokens: 64, cooldownMs: 0, retainTurns: 1, maxSummaryChars: 400 };
const original = (i: number) => `虚构旧任务${i}：` + '观察：蓝色纸船尚未测试，不能认定成功。'.repeat(200);
const compactCalls = (h: H) => h.adapter.requests.filter(r => r.purpose === 'compaction');
const lastChat = (h: H) => h.adapter.requests.findLast(r => r.purpose !== 'compaction')!;
const visible = (r: GenerateOptions) => JSON.stringify(r.messages);
async function seed(h: H, count = 5, room = 'a') {
  let message;
  for (let i = 0; i < count; i++) { message = await h.seed(room, original(i)); assert.equal(message.state, 'delivered'); }
  return h.ctx.agents.get(SessionId(message!.sessionId))!;
}
async function next(h: H, room = 'a', text = 'CURRENT_TASK_KEEP：只继续当前任务') {
  const item = await h.seed(room, text); assert.equal(item.state, 'delivered'); return item;
}

test('threshold compacts only completed older owned spans with DSH checkpoints, preserving persona, prefix and tail', async t => {
  const h = await memoryFixture(undefined, { compaction: policy }); t.after(h.close);
  const agent = await seed(h);
  await next(h);
  assert.ok(compactCalls(h).length > 0);
  const events = readCompactionEvents(agent.session);
  const summaries = events.filter(e => e.type === 'compaction/summary'); assert.ok(summaries.length > 0);
  for (const event of summaries) {
    const checkpoint = events[event.seq + 1]; assert.equal(checkpoint?.type, 'user/message');
    assert.ok(event.data.shadowedTokenCount > 0);
    assert.ok(event.data.shadowedSeqs.every(seq => events[seq]?.type !== 'system/message'));
  }
  assert.match(visible(lastChat(h)), /CURRENT_TASK_KEEP/);
  assert.match(visible(lastChat(h)), /虚构旧任务0/);
  assert.match(visible(lastChat(h)), /虚构旧任务4/);
  assert.ok(lastChat(h).messages.some(m => m.role === 'system'));
  assert.ok(JSON.stringify(events).includes(original(1)));
  assert.ok(events.some(e => e.type === 'plugin:dafeiyu/compaction-check' && e.data.status === 'compacted' && e.data.saved > 0));
  for (const request of compactCalls(h)) {
    assert.equal(request.tools?.length ?? 0, 0); assert.match(String(request.sessionId), /^memory-compaction-/);
    assert.ok(!visible(request).includes('CURRENT_TASK_KEEP'));
  }
});

test('below-threshold sessions, disabled compaction and separate rooms do not share summaries', async t => {
  const h = await memoryFixture(undefined, { compaction: { ...policy, inputTokens: 100000 } }); t.after(h.close);
  await next(h); assert.equal(compactCalls(h).length, 0);
  const off = await memoryFixture(); t.after(off.close); await seed(off, 4); assert.equal(compactCalls(off).length, 0);
  const enabled = await memoryFixture(undefined, { compaction: policy }); t.after(enabled.close); await seed(enabled);
  await next(enabled, 'b', 'OTHER_ROOM');
  assert.ok(!visible(lastChat(enabled)).includes('dafeiyu-incremental-summary'));
  assert.ok(!visible(lastChat(enabled)).includes('虚构旧任务'));
});

test('summary failures keep valid source history, close the DSH bracket and respect cooldown', async t => {
  const h = await memoryFixture(undefined, { compaction: { ...policy, cooldownMs: 600000 } }); t.after(h.close);
  h.setCompactionResponse(() => textReply('{bad json'));
  const agent = await seed(h, 6); const count = compactCalls(h).length; assert.equal(count, 1);
  await next(h); assert.equal(compactCalls(h).length, count);
  assert.match(visible(lastChat(h)), /虚构旧任务1/);
  const events = readCompactionEvents(agent.session);
  assert.equal(events.filter(e => e.type === 'compaction/start').length, events.filter(e => e.type === 'compaction/end').length);
  assert.equal(events.filter(e => e.type === 'compaction/summary').length, 0);
});

test('native and second-plugin regions remain verbatim across repeated incremental replacements', async t => {
  const h = await memoryFixture(undefined, { compaction: policy, context: {} }); t.after(h.close);
  h.ctx.systemPrompt.context({ name: 'native-fixture', order: 1, required: true, text: 'NATIVE_UNCHANGED' });
  const handle = h.core.registerExtension({ id: 'other-region', version: '1', apiVersion: API_VERSION, agentId: 'dafeiyu', contexts: [{
    id: 'facts', kind: 'operational-fact', prepare: async () => [{ id: 'a', version: '1', text: 'OTHER_PLUGIN_UNCHANGED',
      sources: [{ ref: 'fictional:other', version: '1', hash: 'fictional' }], expiresAt: new Date(Date.now() + 600000).toISOString() }], validate: () => true,
  }] }); t.after(() => handle.dispose());
  await seed(h, 6); await next(h);
  assert.ok(compactCalls(h).length > 0);
  assert.match(visible(lastChat(h)), /NATIVE_UNCHANGED/); assert.match(visible(lastChat(h)), /OTHER_PLUGIN_UNCHANGED/);
  for (const request of compactCalls(h)) { assert.ok(!visible(request).includes('NATIVE_UNCHANGED')); assert.ok(!visible(request).includes('OTHER_PLUGIN_UNCHANGED')); }
});

test('deletion invalidates summaries and their raw derived turns; restoration cannot reactivate old summaries', async t => {
  const h = await memoryFixture(undefined, { compaction: policy }); t.after(h.close);
  const evidence = await h.evidence('a');
  const memory = z.object({ id: z.string() }).parse(await h.probe('a', c => h.memory.create(c, { requestId: randomUUID(), kind: 'knowledge', claimType: 'self_report', content: '虚构测试知识', sourceRefs: [evidence.ref] })));
  h.setCompactionResponse(() => textReply(JSON.stringify({ summary: 'SUMMARY_DELETE_SENTINEL：旧记录的虚构信息。' })));
  const agent = await seed(h, 6); assert.match(visible(lastChat(h)), /SUMMARY_DELETE_SENTINEL/);
  const dependent=agent.session.deriveMessages().filter(m=>m.role==='user'&&m.source.kind==='compact-checkpoint'&&m.content.some(b=>b.type==='text'&&JSON.parse(b.text).dependencies?.some((d:{kind:string})=>d.kind==='legacy'))).map(m=>m.id);
  assert.ok(dependent.length);
  await h.probe('a', c => h.memory.delete(c, { requestId: randomUUID(), id: memory.id, expectedVersion: 1, reason: '测试删除' }));
  await next(h); assert.ok(!lastChat(h).messages.some(m=>m.id!==undefined&&dependent.includes(m.id)));
  await h.probe('a', c => h.memory.restore(c, { requestId: randomUUID(), id: memory.id, expectedVersion: 2, reason: '测试恢复' }));
  await next(h); assert.ok(!lastChat(h).messages.some(m=>m.id!==undefined&&dependent.includes(m.id)));
  assert.ok(JSON.stringify(readCompactionEvents(agent.session)).includes('SUMMARY_DELETE_SENTINEL'));
});

test('current working task is protected and never sent to the auxiliary summarizer',async t=>{
  const h=await memoryFixture(undefined,{compaction:policy,context:{}});t.after(h.close);
  const e=await h.evidence('a');
  await h.probe('a',c=>h.memory.updateWorking(c,{requestId:randomUUID(),expectedVersion:0,taskId:'active-task',expiresAt:new Date(Date.now()+600000).toISOString(),
    items:[{id:'goal',category:'goal',text:'TASK_GOAL_PROTECTED',sourceRefs:[e.ref]}]}));
  await seed(h,6);await next(h);
  assert.equal(compactCalls(h).length,0);assert.match(visible(lastChat(h)),/TASK_GOAL_PROTECTED/);
});

test('source version changes during summarization reject the result and retire invalid input even on failure',async t=>{
  const h=await memoryFixture(undefined,{compaction:policy});t.after(h.close);
  const e=await h.evidence('a');
  const memory=z.object({id:z.string()}).parse(await h.probe('a',c=>h.memory.create(c,{requestId:randomUUID(),kind:'knowledge',claimType:'self_report',content:'虚构依赖',sourceRefs:[e.ref]})));
  let changed=false;
  h.setCompactionResponse(request=>{
    if(changed)return textReply(JSON.stringify({summary:'FRESH_VALID_SUMMARY'}));
    const input=request.messages.at(-1)?.content.find(b=>b.type==='text');
    if(!input||input.type!=='text'||!JSON.parse(input.text).sources.some((s:{role:string})=>s.role==='assistant'))return textReply(JSON.stringify({summary:'VALID_INDEPENDENT_SUMMARY'}));
    if(!changed){changed=true;const store=new MemoryStore(join(h.root,'memory.sqlite'));try{
      store.mutate({agentId:'dafeiyu',route:e.message.route,traceId:'fictional-race',operationId:'fictional-race',startedEventId:randomUUID()},
        {action:'delete',id:memory.id,expectedVersion:1,requestId:randomUUID(),reason:'虚构并发删除'});
    }finally{store.close();}}
    return textReply(JSON.stringify({summary:'REJECTED_STALE_SUMMARY'}));
  });
  await seed(h,6);await next(h);
  assert.ok(changed);assert.ok(!visible(lastChat(h)).includes('REJECTED_STALE_SUMMARY'));
  assert.ok(!h.adapter.requests.filter(r=>r.purpose!=='compaction').some(r=>visible(r).includes('REJECTED_STALE_SUMMARY')));
});

test('restart replays committed replacements once and missing provider withdraws summaries without changing native regions',async()=>{
  let h=await memoryFixture(undefined,{compaction:policy});const root=h.root;
  await seed(h);const before=compactCalls(h).length;assert.ok(before>0);await h.close();
  h=await memoryFixture(root,{compaction:{...policy,inputTokens:100000}});
  try{await next(h);assert.match(visible(lastChat(h)),/dafeiyu-incremental-summary/);assert.equal(compactCalls(h).length,0);}finally{await h.close();}
  h=await memoryFixture(root);
  try{h.ctx.systemPrompt.context({name:'surviving-native',order:1,required:true,text:'SURVIVING_NATIVE'});await next(h);
    assert.ok(!visible(lastChat(h)).includes('dafeiyu-incremental-summary'));assert.match(visible(lastChat(h)),/SURVIVING_NATIVE/);
  }finally{await h.close();}
});

test('old summary source is derived-only while valid and cannot be exported after deletion',async t=>{
  const h=await memoryFixture(undefined,{compaction:policy});t.after(h.close);
  const e=await h.evidence('a');const memory=z.object({id:z.string()}).parse(await h.probe('a',c=>h.memory.create(c,{requestId:randomUUID(),kind:'knowledge',claimType:'self_report',content:'虚构知识',sourceRefs:[e.ref]})));
  await seed(h);
  const audit=h.core.journal.events(e.message.route).findLast(e=>e.type==='context.compaction.checked'&&e.data.status==='compacted');assert.ok(audit);
  const ref=`dafeiyu:source:${audit.id}:1`;
  const valid=await h.probe('a',c=>h.timeline.open(c,{ref}));assert.equal(valid.status,'ok');if(valid.status==='ok')assert.equal(valid.memoryUse,'derived-only');
  await h.probe('a',c=>h.memory.delete(c,{requestId:randomUUID(),id:memory.id,expectedVersion:1,reason:'删除'}));
  assert.equal((await h.probe('a',c=>h.timeline.open(c,{ref}))).status,'not_exported');
  assert.equal((await h.probe('b',c=>h.timeline.open(c,{ref}))).status,'not_found');
});

test('feedback deletion retires dependent assistant turns and balanced rewritten tool pairs without replay',async t=>{
  const h=await memoryFixture(undefined,{compaction:policy,feedback:{}});t.after(h.close);
  const tool=fixtureTool(h,()=>report('FEEDBACK_DELETE_SENTINEL'));t.after(()=>tool.handle.dispose());
  const pointer=archivePointer((await invoke(h,tool.name)).value);
  await seed(h,5);
  const result=await h.probe('a',c=>h.memory.feedbackDelete(c,{ref:pointer.ref,expectedVersion:1,requestId:randomUUID(),reason:'删除'}));assert.equal(z.object({status:z.string()}).parse(result).status,'ok');
  await next(h);assert.ok(!visible(lastChat(h)).includes('FEEDBACK_DELETE_SENTINEL'));assert.equal(tool.calls,1);
});

test('explicit historical lookup and its assistant paraphrase expire together before later compression',async t=>{
  const h=await memoryFixture(undefined,{compaction:policy,feedback:{}});t.after(h.close);
  const tool=fixtureTool(h,()=>report('历史虚构资料'));t.after(()=>tool.handle.dispose());const pointer=archivePointer((await invoke(h,tool.name)).value);
  let requests=0;h.setResponse(()=>++requests===1?call('dafeiyu_tool_feedback_open',{ref:pointer.ref,expectedVersion:'1'}):textReply('EPHEMERAL_PARAPHRASE'));
  h.simulator.send('a','回查归档',{id:randomUUID()});await h.core.whenIdle();assert.match(visible(lastChat(h)),/历史虚构资料/);
  await next(h);assert.ok(!visible(lastChat(h)).includes('EPHEMERAL_PARAPHRASE'));
  await seed(h,5);assert.ok(!compactCalls(h).some(r=>visible(r).includes('EPHEMERAL_PARAPHRASE')));
});

test('an open DSH compaction bracket blocks another writer but preserves normal chat',async t=>{
  const h=await memoryFixture(undefined,{compaction:policy});t.after(h.close);
  const agent=await seed(h,2);agent.session.append('compaction/start',{compactionId:CompactionId(randomUUID()),turn:null});
  await seed(h,4);assert.equal(compactCalls(h).length,0);
  assert.ok(readCompactionEvents(agent.session).some(e=>e.type==='plugin:dafeiyu/compaction-check'&&e.data.status==='busy'));
});

test('insufficient reduction does not replace sources or repeatedly retry in the cooldown window',async t=>{
  const h=await memoryFixture(undefined,{compaction:{...policy,maxSummaryChars:8000,cooldownMs:600000}});t.after(h.close);
  h.setCompactionResponse(()=>textReply(JSON.stringify({summary:'不应放大上下文。'.repeat(900)})));
  const agent=await seed(h,6);assert.equal(compactCalls(h).length,1);
  assert.ok(readCompactionEvents(agent.session).some(e=>e.type==='plugin:dafeiyu/compaction-check'&&e.data.status==='no-benefit'));
  assert.ok(!readCompactionEvents(agent.session).some(e=>e.type==='compaction/summary'));
});

test('adding unrelated memory preserves previously valid summaries and conversation history',async t=>{
  const h=await memoryFixture(undefined,{compaction:policy});t.after(h.close);const e=await h.evidence('a');await seed(h);
  const summaries=lastChat(h).messages.filter(m=>m.role==='user'&&m.source?.kind==='compact-checkpoint').map(m=>m.id);assert.ok(summaries.length);
  await h.probe('a',c=>h.memory.create(c,{requestId:randomUUID(),kind:'knowledge',claimType:'self_report',content:'另一条虚构资料',sourceRefs:[e.ref]}));
  await next(h);assert.ok(summaries.every(id=>lastChat(h).messages.some(m=>m.id===id)));
});

test('large tool feedback triggers a between-step check while keeping that tool pair and executing it once',async t=>{
  const h=await memoryFixture(undefined,{compaction:{...policy,inputTokens:50000}});t.after(h.close);await seed(h,4);assert.equal(compactCalls(h).length,0);
  let effects=0,requests=0;const extension=h.core.registerExtension({id:'big-tool',version:'1',apiVersion:API_VERSION,agentId:'dafeiyu',actions:[{
    name:'large_fictional_result',description:'虚构大结果',fields:{},execute:async()=>{effects++;return {data:'虚构材料'.repeat(30000)};},
  }]});t.after(()=>extension.dispose());
  h.setResponse(()=>++requests===1?call('large_fictional_result',{}):textReply('工具结果已检查'));
  const receipt=h.simulator.send('a','执行虚构工具',{id:randomUUID()});await h.core.whenIdle();assert.equal(h.core.journal.get(receipt.id).state,'delivered');
  assert.ok(compactCalls(h).length>0);assert.equal(effects,1);assert.equal(requests,2);
  for(const request of compactCalls(h))assert.ok(!visible(request).includes('large_fictional_result'));
});

test('model tool requests during auxiliary compaction are rejected without executing any action',async t=>{
  const h=await memoryFixture(undefined,{compaction:{...policy,cooldownMs:600000}});t.after(h.close);
  h.setCompactionResponse(()=>call('dafeiyu_memory_delete',{id:randomUUID(),expectedVersion:'1'}));
  const agent=await seed(h);assert.equal(compactCalls(h).length,1);assert.ok(!agent.session.snapshotEvents().some(e=>e.type==='tool/call'));
  assert.ok(!agent.session.snapshotEvents().some(e=>e.type==='compaction/summary'));
});

test('unfinished checkpoint after crash is withdrawn on resume rather than guessed committed',async()=>{
  let h=await memoryFixture(undefined,{compaction:policy});const root=h.root;const agent=await seed(h);
  const summary=agent.session.snapshotEvents().find(e=>e.type==='compaction/summary');assert.ok(summary);
  const seq=agent.session.surface.nodes.at(-1)!;
  const id=CompactionId(randomUUID());agent.session.append('compaction/start',{compactionId:id,turn:null});
  agent.session.append('compaction/summary',{...summary.data,compactionId:id,shadowedRange:{start:seq,end:seq},shadowedSeqs:[seq],
    shadowedTokenCount:h.ctx.get('tokenMeter')!.measure(agent.session).nodes.find(n=>n.seq===seq)!.heuristicTokens});
  agent.session.append('user/message',createUserMessage({source:compactCheckpointSource(id),content:summary.data.summary}),{surfaceOp:{op:'replace',startSeq:seq,endSeq:seq},sourceEventSeqs:[seq]});
  await h.ctx.sessions.flush(agent.session);await h.close();h=await memoryFixture(root,{compaction:policy});
  try{await next(h);assert.ok(!lastChat(h).messages.some(m=>m.role==='user'&&m.source?.kind==='compact-checkpoint'&&m.source.compactionId===id));}
  finally{await h.close();}
});

test('unsealed owned turn is quarantined without replaying any operation',async t=>{
  const h=await memoryFixture(undefined,{compaction:policy});t.after(h.close);const agent=await seed(h,2);
  const item=h.core.journal.list(['delivered'])[0]!;
  appendPluginRecord(agent.session,'plugin:dafeiyu/turn-open',{traceId:'interrupted-fictional-turn',route:item.route});
  agent.session.append('user/message',createUserMessage({source:{kind:'user'},content:[{type:'text',text:'UNSEALED_INTERRUPTED_DATA'}]}),{surfaceOp:'append'});
  await next(h);assert.ok(!visible(lastChat(h)).includes('UNSEALED_INTERRUPTED_DATA'));
  assert.ok(JSON.stringify(agent.session.snapshotEvents()).includes('UNSEALED_INTERRUPTED_DATA'));
});

test('a source mutation after provider dispatch prevents delivery of an obsolete answer',async t=>{
  const h=await memoryFixture(undefined,{compaction:policy});t.after(h.close);const e=await h.evidence('a');
  const memory=z.object({id:z.string()}).parse(await h.probe('a',c=>h.memory.create(c,{requestId:randomUUID(),kind:'knowledge',claimType:'self_report',content:'虚构依据',sourceRefs:[e.ref]})));
  await seed(h);h.setResponse(()=>{const store=new MemoryStore(join(h.root,'memory.sqlite'));try{
    store.mutate({agentId:'dafeiyu',route:e.message.route,traceId:'late-delete',operationId:'late-delete',startedEventId:randomUUID()},
      {action:'delete',id:memory.id,expectedVersion:1,requestId:randomUUID(),reason:'虚构输出竞态'});
  }finally{store.close();}return textReply('STALE_ANSWER_MUST_NOT_DELIVER');});
  const receipt=h.simulator.send('a','继续当前任务',{id:randomUUID()});await h.core.whenIdle();assert.equal(h.core.journal.get(receipt.id).state,'failed');
  await next(h);assert.ok(!visible(lastChat(h)).includes('STALE_ANSWER_MUST_NOT_DELIVER'));
});
