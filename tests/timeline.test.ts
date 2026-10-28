import {z} from 'zod';
import {fixtureAction} from './fixture-action.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SessionId } from '@deepseek-ai/dsh-session';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { API_VERSION } from '@dafeiyu/contracts';
import type { ConversationAccess, EventRecord } from '@dafeiyu/contracts';
import { eventFor } from '@dafeiyu/journal';
import { textReply, call } from './harness.js';
import { timelineFixture } from './timeline-fixture.js';

const ref=(event:EventRecord)=>'dafeiyu:event:'+event.id;
const source=(event:EventRecord,index:number)=>`dafeiyu:source:${event.id}:${index}`;

test('timeline plugin registers model tools and a real DSH tool call returns scoped event citations',async t=>{
  const h=await timelineFixture();t.after(h.close);const seed=await h.seed('a');await h.seed('b','别的会话原文');
  let requests=0;h.setResponse(()=>++requests===1?call('dafeiyu_timeline_search',{type:'message.accepted',traceId:seed.id}):textReply('查询完成'));
  h.simulator.send('a','检索之前的行为',{id:'search'});await h.core.whenIdle();
  assert.ok(h.adapter.requests.at(-1)?.tools?.some(tool=>tool.name==='dafeiyu_source_open'));
  const last=h.adapter.requests.at(-1);assert.match(JSON.stringify(last),/dafeiyu:event:/);assert.ok(!JSON.stringify(last).includes('别的会话原文'));
  const audit=h.core.journal.events(seed.route).find(e=>e.type==='history.search');assert.ok(audit?.sources.length);
});

test('opening a message citation returns the normalized source and journals the evidence read',async t=>{
  const h=await timelineFixture();t.after(h.close);const item=await h.seed('a','这段文字需要回查');
  const accepted=h.core.journal.events(item.route).find(e=>e.traceId===item.id&&e.type==='message.accepted')!;
  const result=await h.probe('a',context=>h.timeline.open(context,{ref:source(accepted,0)}));
  assert.equal(result.status,'ok');if(result.status!=='ok')return;
  assert.equal(result.kind,'normalized-inbound');assert.match(result.text,/这段文字需要回查/);assert.equal(result.untrustedEvidence,true);
  assert.ok(h.core.journal.events(item.route).some(e=>e.type==='history.open'&&e.sources.some(s=>s.kind==='message'&&s.id===item.message.id)));
});

test('foreign event and source references look like missing references, including guessed source indexes',async t=>{
  const h=await timelineFixture();t.after(h.close);const item=await h.seed('private','私聊专属内容');
  const accepted=h.core.journal.events(item.route).find(e=>e.type==='message.accepted')!;
  for(const target of [ref(accepted),source(accepted,0),'dafeiyu:event:'+randomUUID()]){
    const result=await h.probe('group',context=>h.timeline.open(context,{ref:target}));assert.deepEqual(result,{status:'not_found'});
  }
  const result=await h.probe('group',context=>h.timeline.search(context,{traceId:item.id}));assert.equal(result.items.length,0);
});

test('a visible event cannot launder another conversation session, message or causal reference',async t=>{
  const h=await timelineFixture();t.after(h.close);const a=await h.seed('a'),b=await h.seed('b','private-only');
  const foreign=h.core.journal.events(b.route).find(e=>e.type==='message.accepted')!;
  const forged=h.core.journal.append({...eventFor('dafeiyu',a,'fixture','test','1','fake',foreign.id),sources:[
    {kind:'session',id:b.sessionId,seq:1},{kind:'event',id:foreign.id},{kind:'message',id:b.message.id},
  ]});
  const event=await h.probe('a',context=>h.timeline.open(context,{ref:ref(forged)}));
  assert.equal(event.status,'ok');if(event.status==='ok'){assert.ok(!event.text.includes(b.sessionId));assert.ok(!event.text.includes(foreign.id));assert.match(event.text,/"causedBy": null/);}
  for(let i=0;i<3;i++)assert.deepEqual(await h.probe('a',context=>h.timeline.open(context,{ref:source(forged,i)})),{status:'not_found'});
});

test('source results omit model reasoning, tool-private data and system prompts',async t=>{
  const h=await timelineFixture();t.after(h.close);
  h.setResponse(()=>[
    {type:'block-start',index:0,blockType:'reasoning'},
    {type:'reasoning-delta',index:0,text:'INTERNAL_REASONING_SENTINEL'},
    {type:'block-end',index:0,block:{type:'reasoning',text:'INTERNAL_REASONING_SENTINEL'}},
    {type:'block-start',index:1,blockType:'text'},
    {type:'text-delta',index:1,text:'可见的最终回复'},
    {type:'block-end',index:1,block:{type:'text',text:'可见的最终回复'}},
    {type:'finish',reason:{kind:'stop'}},
  ]);
  const receipt=h.simulator.send('a','请回答',{id:'reasoning'});await h.core.whenIdle();const item=h.core.journal.get(receipt.id);
  const completed=h.core.journal.events(item.route).find(e=>e.traceId===item.id&&e.type==='turn.completed')!;
  const session=h.ctx.agents.get(SessionId(item.sessionId))!.session;
  const assistant=session.snapshotEvents().find(e=>e.type==='assistant/message')!;
  assert.match(JSON.stringify(assistant),/INTERNAL_REASONING_SENTINEL/);
  const index=completed.sources.findIndex(s=>s.seq===assistant.seq);
  const opened=await h.probe('a',context=>h.timeline.open(context,{ref:source(completed,index)}));
  assert.equal(opened.status,'ok');if(opened.status==='ok'){assert.match(opened.text,/可见的最终回复/);assert.ok(!opened.text.includes('INTERNAL_REASONING_SENTINEL'));assert.equal(opened.omittedBlocks,1);}
  const system=session.snapshotEvents().find(e=>e.type==='system/message')!;
  const record=h.core.journal.append({...eventFor('dafeiyu',item,'fixture','test','1'),sources:[{kind:'session',id:item.sessionId,seq:system.seq}]});
  assert.deepEqual(await h.probe('a',context=>h.timeline.open(context,{ref:source(record,0)})),{status:'not_exported'});
});

test('opening tool evidence never reruns the tool and masks credential-shaped output',async t=>{
  const h=await timelineFixture();t.after(h.close);let executions=0,requests=0;
  h.core.registerExtension({id:'fixture-action',version:'1',protocolVersion:4,agentId:'dafeiyu',actions:[fixtureAction(h.core,'fixture-action',{id:'fixture_action',description:'一次测试操作',inputSchema:z.strictObject({}),work:async()=>{executions++;return {value:'测试结果',api_key:'MOCK_SECRET_SENTINEL'};}})]});
  h.setResponse(()=>++requests===1?call('fixture_action',{}):textReply('操作完成'));
  const receipt=h.simulator.send('a','执行测试操作',{id:'operation'});await h.core.whenIdle();const item=h.core.journal.get(receipt.id);
  const completed=h.core.journal.events(item.route).find(e=>e.traceId===item.id&&e.type==='turn.completed')!;
  const target=h.ctx.agents.get(SessionId(item.sessionId))!.session.snapshotEvents().find(e=>e.type==='tool/result')!;
  const index=completed.sources.findIndex(s=>s.seq===target.seq);
  const opened=await h.probe('a',context=>h.timeline.open(context,{ref:source(completed,index)}));
  assert.equal(opened.status,'ok');if(opened.status==='ok'){assert.match(opened.text,/测试结果/);assert.ok(!opened.text.includes('MOCK_SECRET_SENTINEL'));assert.equal(opened.redacted,true);}
  assert.equal(executions,1);
});

test('text pagination preserves Unicode and redacts a secret before splitting pages',async t=>{
  const h=await timelineFixture();t.after(h.close);const item=await h.seed('a','🐟'.repeat(120)+'\npassword=UNIQUE_SECRET_VALUE\n结束');
  const accepted=h.core.journal.events(item.route).find(e=>e.traceId===item.id&&e.type==='message.accepted')!;
  const chunks=await h.probe('a',async context=>{
    let offset=0;const pieces:string[]=[];const hashes=new Set<string>();
    for(let i=0;i<100;i++){const result=await h.timeline.open(context,{ref:source(accepted,0),offset,limit:13});assert.equal(result.status,'ok');if(result.status!=='ok')throw new Error('missing evidence');pieces.push(result.text);hashes.add(result.contentHash);if(!result.hasMore)break;offset=result.nextOffset!;}
    return {text:pieces.join(''),hashCount:hashes.size};
  });
  assert.ok(!chunks.text.includes('UNIQUE_SECRET_VALUE'));assert.equal(chunks.hashCount,1);
  assert.equal(Array.from(chunks.text).filter(c=>c==='🐟').length,120);assert.ok(!chunks.text.includes('\uFFFD'));
});

test('original DSH source remains readable after surface replacement without replaying history',async t=>{
  const h=await timelineFixture();t.after(h.close);const item=await h.seed('a','压缩前原文_SENTINEL');
  const completed=h.core.journal.events(item.route).find(e=>e.traceId===item.id&&e.type==='turn.completed')!;
  const session=h.ctx.agents.get(SessionId(item.sessionId))!.session;
  const original=session.snapshotEvents().find(e=>e.type==='user/message')!;
  session.append('user/message',createUserMessage({source:{kind:'user'},content:[{type:'text',text:'用于测试的压缩替代摘要'}]}),{surfaceOp:{op:'replace',startSeq:original.seq,endSeq:original.seq},sourceEventSeqs:[original.seq]});
  await h.ctx.sessions.flush(session);
  const surface=await h.ctx.sessionQuery.readSurface(session.id);
  assert.ok(!JSON.stringify(surface.events).includes('压缩前原文_SENTINEL'));
  const index=completed.sources.findIndex(s=>s.seq===original.seq);
  const opened=await h.probe('a',context=>h.timeline.open(context,{ref:source(completed,index)}));
  assert.equal(opened.status,'ok');if(opened.status==='ok')assert.match(opened.text,/压缩前原文_SENTINEL/);
});

test('forged and expired action contexts cannot obtain a history scope',async t=>{
  const h=await timelineFixture();t.after(h.close);let captured:ConversationAccess|undefined;
  await h.probe('a',context=>{captured=context;return h.timeline.search(context,{limit:1});});
  assert.ok(captured);assert.throws(()=>h.timeline.search(captured!,{}),/No active/);
  const fake:ConversationAccess={operationId:'fake',conversation:{channel:'simulator',account:'local',kind:'local',id:'a'},sourceMessageId:'x',signal:new AbortController().signal};
  assert.throws(()=>h.timeline.search(fake,{}),/No active/);
});

test('failed turns retain source references and their failure outcome is queryable',async t=>{
  const h=await timelineFixture();t.after(h.close);h.setResponse(()=>{throw new Error('mock provider failure');});
  const receipt=h.simulator.send('a','触发失败',{id:'failed'});await h.core.whenIdle();const item=h.core.journal.get(receipt.id);
  const failure=h.core.journal.events(item.route).find(e=>e.type==='turn.failed')!;assert.ok(failure.sources.length);
  const page=await h.probe('a',context=>h.timeline.search(context,{type:'turn.failed'}));assert.equal(page.items.length,1);
  const session=h.ctx.agents.get(SessionId(item.sessionId))!.session;
  const end=session.snapshotEvents().find(e=>e.type==='turn/end')!;
  const index=failure.sources.findIndex(s=>s.seq===end.seq);
  const opened=await h.probe('a',context=>h.timeline.open(context,{ref:source(failure,index)}));
  assert.equal(opened.status,'ok');if(opened.status==='ok'){assert.equal(opened.kind,'turn-outcome');assert.ok(!opened.text.includes('mock provider failure'));}
});

test('event citations survive restart and reading sources does not create an additional agent',async()=>{
  const first=await timelineFixture();const item=await first.seed('a','重启前原文');
  const event=first.core.journal.events(item.route).find(e=>e.type==='turn.completed')!;
  const user=first.ctx.agents.get(SessionId(item.sessionId))!.session.snapshotEvents().find(e=>e.type==='user/message')!;
  const index=event.sources.findIndex(s=>s.seq===user.seq);await first.close();
  const second=await timelineFixture(first.root);
  try{const result=await second.probe('a',async context=>{const before=second.ctx.agents.list().length;const opened=await second.timeline.open(context,{ref:source(event,index)});assert.equal(second.ctx.agents.list().length,before);return opened;});assert.equal(result.status,'ok');if(result.status==='ok')assert.match(result.text,/重启前原文/);}
  finally{await second.close();}
});

test('explicit origin prevents cross-conversation message-ID collisions from becoming false evidence',async t=>{
  const h=await timelineFixture();t.after(h.close);
  const a=h.simulator.send('a','A的原文',{id:'same'}),b=h.simulator.send('b','B的原文',{id:'same'});await h.core.whenIdle();
  const first=h.core.journal.get(a.id),second=h.core.journal.get(b.id);
  const anchor=h.core.journal.append({...eventFor('dafeiyu',first,'fixture','test','1'),sources:[{kind:'message',id:'same',route:second.route}]});
  assert.deepEqual(await h.probe('a',context=>h.timeline.open(context,{ref:source(anchor,0)})),{status:'not_found'});
});

test('model arguments cannot override the conversation scope',async t=>{
  const h=await timelineFixture();t.after(h.close);await h.seed('a');const b=await h.seed('b','PRIVATE_SCOPE_SENTINEL');
  let calls=0;h.setResponse(()=>++calls===1?call('dafeiyu_timeline_search',{route:b.route}):textReply('done'));
  h.simulator.send('a','尝试指定另一个会话',{id:'bad-query'});await h.core.whenIdle();
  const item=h.core.journal.list().at(-1)!;
  assert.ok(!h.core.journal.events(item.route).some(event=>event.traceId===item.id&&event.type==='history.search'));
  assert.ok(!JSON.stringify(h.adapter.requests.at(-1)).includes('PRIVATE_SCOPE_SENTINEL'));
});

test('native source-open tool handles string pagination arguments and returns evidence content',async t=>{
  const h=await timelineFixture();t.after(h.close);const item=await h.seed('a','来源原文_NATIVE_OPEN');
  const accepted=h.core.journal.events(item.route).find(e=>e.type==='message.accepted')!;
  let calls=0;h.setResponse(()=>++calls===1?call('dafeiyu_source_open',{ref:source(accepted,0),offset:'0',limit:'1000'}):textReply('已回查'));
  h.simulator.send('a','打开来源',{id:'native-open'});await h.core.whenIdle();
  const result=h.ctx.agents.get(SessionId(item.sessionId))!.session.snapshotEvents().findLast(e=>e.type==='tool/result');
  assert.ok(result&&result.type==='tool/result');
  const text=result.data.message.content.filter(block=>block.type==='text').map(block=>block.text).join('');
  const body=JSON.parse(text);assert.equal(body.status,'ok');assert.equal(body.kind,'normalized-inbound');assert.match(body.text,/来源原文_NATIVE_OPEN/);
});

test('missing source events and file-like references never fall back to filesystem reads',async t=>{
  const h=await timelineFixture();t.after(h.close);const item=await h.seed('a');
  const anchor=h.core.journal.append({...eventFor('dafeiyu',item,'fixture','test','1'),sources:[{kind:'session',id:item.sessionId,seq:999999,route:item.route}]});
  assert.deepEqual(await h.probe('a',context=>h.timeline.open(context,{ref:source(anchor,0)})),{status:'not_found'});
  assert.deepEqual(await h.probe('a',context=>h.timeline.open(context,{ref:'../../.credentials.yaml'})),{status:'invalid_reference'});
});

test('unloading timeline revokes direct calls even from another currently active action',async t=>{
  const h=await timelineFixture();t.after(h.close);const instance=h.timeline;
  await h.timelineFiber.dispose();
  await assert.rejects(h.probe('a',context=>instance.search(context,{})),/unregistered/);
});

test('pagination continues across separate core-issued action contexts',async t=>{
  const h=await timelineFixture();t.after(h.close);await h.seed('a');await h.seed('a');
  const first=await h.probe('a',context=>h.timeline.search(context,{type:'message.accepted',limit:1}));assert.ok(first.nextCursor);
  const second=await h.probe('a',context=>h.timeline.search(context,{type:'message.accepted',limit:1,cursor:first.nextCursor!}));
  assert.equal(first.snapshot,second.snapshot);assert.ok(second.items[0]!.seq<first.items[0]!.seq);
});
