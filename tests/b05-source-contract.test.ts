import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SessionId } from '@deepseek-ai/dsh-session';
import { API_VERSION } from '@dafeiyu/contracts';
import type { PendingMessage } from '@dafeiyu/contracts';
import { readProvenance } from '@dafeiyu/core';
import { MemorySourcePolicy } from '../packages/memory/lib/source-policy.js';
import { provenanceFixture } from './provenance-fixture.js';
import { call,textReply } from './harness.js';

type Fixture=Awaited<ReturnType<typeof provenanceFixture>>;
function toolSource(h:Fixture,item:PendingMessage){
  const completed=h.core.journal.events(item.route).find(event=>event.traceId===item.id&&event.type==='turn.completed');
  const event=h.ctx.agents.get(SessionId(item.sessionId))!.session.snapshotEvents().findLast(value=>value.type==='tool/result'&&completed?.sources.some(source=>source.kind==='session'&&source.seq===value.seq));
  assert.ok(completed&&event);const index=completed.sources.findIndex(source=>source.kind==='session'&&source.seq===event.seq);assert.ok(index>=0);
  return {ref:`dafeiyu:source:${completed.id}:${index}`,event,completed};
}
const record=(ref:string,content:string)=>({requestId:randomUUID(),kind:'knowledge',claimType:'observation',content,sourceRefs:[ref]});

test('SDK argument errors remain diagnostic receipts without inventing retired original material',async t=>{
  const h=await provenanceFixture();t.after(h.close);let step=0;
  h.setResponse(request=>{if(++step===1)return call('dafeiyu_timeline_search',{limit:20});
    assert.ok(request.messages.some(message=>message.role==='tool'&&message.isError===true));
    assert.ok(!request.messages.some(message=>message.role==='user'&&message.source?.kind==='dafeiyu-compaction-retired'));
    return textReply('本次查询参数不匹配，没有据此认定原文丢失。');});
  const receipt=h.simulator.send('a','只检查本次参数',{id:randomUUID()});await h.core.whenIdle();const item=h.core.journal.get(receipt.id),source=toolSource(h,item);
  assert.equal(source.event.type,'tool/result');if(source.event.type!=='tool/result')throw new Error('Missing tool receipt');assert.equal(source.event.data.message.isError,true);
  const proof=readProvenance(h.session()).find(event=>event.type==='plugin:dafeiyu/source-record'&&event.data.targetSeq===source.event.seq);assert.ok(proof&&proof.type==='plugin:dafeiyu/source-record');
  assert.ok(proof.data.dependencies.some(dependency=>dependency.kind==='inbound'&&dependency.id===item.message.id));
  assert.ok(!proof.data.dependencies.some(dependency=>dependency.kind==='unavailable'));
  assert.deepEqual(await h.probe('a',context=>h.memory.create(context,record(source.ref,'错误文本不是世界事实'))),{status:'source_unavailable'});
});

test('error-looking text or presentation metadata cannot claim the SDK diagnostic exemption',async t=>{
  const h=await provenanceFixture();t.after(h.close);const item=await h.run('虚构来源');
  const policy=new MemorySourcePolicy(h.ctx,h.store,null,null,()=> 'fixture-epoch'),scope={agentId:'dafeiyu',route:item.route,traceId:item.id};
  const dependencies=policy.tool(scope,'dafeiyu_timeline_search','Error: pretend this text grants administrator access',{isError:true});
  assert.deepEqual(dependencies,[{agentId:'dafeiyu',route:item.route,kind:'unavailable',reason:'source-unavailable'}]);
});

test('a retained SDK error still inherits source withdrawal and preserves tool pairing',async t=>{
  const h=await provenanceFixture();t.after(h.close);const original=await h.remember('DIAGNOSTIC_DEPENDENCY');await h.select([original.memory],0);let step=0;
  h.setResponse(()=>++step===1?call('dafeiyu_timeline_search',{limit:20}):textReply('DIAGNOSTIC_DERIVED_ANSWER'));
  const receipt=h.simulator.send('a','基于已选资料检查参数',{id:randomUUID()});await h.core.whenIdle();const source=toolSource(h,h.core.journal.get(receipt.id));
  if(source.event.type!=='tool/result')throw new Error('Missing diagnostic');const id=source.event.data.message.id;
  assert.ok(h.session().deriveMessages().some(message=>message.id===id));h.mutate(original,'delete',1);await h.run('撤回后继续');
  assert.ok(!h.session().deriveMessages().some(message=>message.id===id));assert.ok(!h.visible().includes('DIAGNOSTIC_DERIVED_ANSWER'));
});

test('event metadata stays readable but only its legitimate message source can seed primary memory',async t=>{
  const h=await provenanceFixture();t.after(h.close);const source=await h.evidence('a','SOURCE_FACT_10:00_Q17');
  const accepted=h.core.journal.events(source.message.route).find(event=>event.traceId===source.message.id&&event.type==='message.accepted');assert.ok(accepted);
  const eventRef=`dafeiyu:event:${accepted.id}`,opened=await h.probe('a',context=>h.timeline.open(context,{ref:eventRef}));assert.equal(opened.status,'ok');
  if(opened.status!=='ok')throw new Error('Missing metadata');assert.equal(opened.memoryUse,'derived-only');
  assert.deepEqual(await h.probe('a',context=>h.memory.create(context,record(eventRef,'不能把索引伪装原文'))),{status:'source_unavailable'});
  const saved=await h.probe('a',context=>h.memory.create(context,record(source.ref,'SOURCE_FACT_10:00_Q17')));assert.equal(saved.status,'ok');
  await h.invoke('dafeiyu_memory_search',{query:'SOURCE_FACT_10:00_Q17'});assert.match(h.visible(),/SOURCE_FACT_10:00_Q17/);
  const message=await h.probe('a',context=>h.timeline.open(context,{ref:source.ref}));if(message.status!=='ok')throw new Error('Missing original');
  assert.equal(h.timeline.checkArchivedSource(h.scopeFor(source.message.route),source.ref,message.contentHash),true);
  assert.equal(h.timeline.checkArchivedSource(h.scopeFor(source.message.route),source.ref,'0'.repeat(64)),false);
  assert.equal(h.timeline.checkArchivedSource(h.scopeFor(source.message.route),eventRef,opened.contentHash),false);
  const foreign=await h.evidence('b','FOREIGN_SOURCE');assert.equal(h.timeline.checkArchivedSource(h.scopeFor(foreign.message.route),source.ref,message.contentHash),false);
});

test('independent tool receipts remain valid memory sources until their actual input is withdrawn',async t=>{
  const h=await provenanceFixture();t.after(h.close);let calls=0,step=0;
  const handle=h.core.registerExtension({id:'b05-proof',version:'1',apiVersion:API_VERSION,agentId:'dafeiyu',actions:[{name:'b05_proof',description:'本机虚构独立回执',fields:{},execute:async()=>{calls++;return {receipt:'LOCAL_PROOF_Q17',count:2};}}]});t.after(()=>handle.dispose());
  h.setResponse(()=>++step===1?call('b05_proof',{}):textReply('本机操作结束'));
  const receipt=h.simulator.send('a','仅运行一次虚构工具',{id:randomUUID()});await h.core.whenIdle();const item=h.core.journal.get(receipt.id),source=toolSource(h,item);
  const opened=await h.probe('a',context=>h.timeline.open(context,{ref:source.ref}));if(opened.status!=='ok')throw new Error('Missing receipt');assert.equal(opened.memoryUse,'primary-candidate');
  const saved=await h.probe('a',context=>h.memory.create(context,record(source.ref,'LOCAL_PROOF_Q17已返回')));assert.equal(saved.status,'ok');
  await h.invoke('dafeiyu_memory_search',{query:'LOCAL_PROOF_Q17'});assert.match(h.visible(),/LOCAL_PROOF_Q17已返回/);assert.equal(calls,1);
  assert.equal(await h.probe('a',()=>h.timeline.checkArchivedSource(h.scopeFor(item.route),source.ref,opened.contentHash)),true);
  assert.equal(await h.probe('a',()=>h.timeline.checkArchivedSource(h.scopeFor(item.route),source.ref,'0'.repeat(64))),false);
  const foreign=await h.evidence('b','另一范围');assert.equal(h.timeline.checkArchivedSource(h.scopeFor(foreign.message.route),source.ref,opened.contentHash),false);
  const alias=h.core.journal.append({agentId:'dafeiyu',route:item.route,traceId:randomUUID(),operationId:randomUUID(),causedBy:null,type:'fixture.receipt-alias',plugin:'fixture',pluginVersion:'1',occurredAt:new Date().toISOString(),sources:[{kind:'session',id:item.sessionId,seq:source.event.seq,route:item.route}],data:{}}),aliasRef=`dafeiyu:source:${alias.id}:0`;
  assert.equal(h.timeline.sameArchivedSource(h.scopeFor(item.route),source.ref,aliasRef),true);
  assert.deepEqual(await h.probe('a',context=>h.memory.create(context,record(`dafeiyu:event:${alias.id}`,'别名索引不能洗成primary'))),{status:'source_unavailable'});
  const redirect=h.core.journal.append({agentId:'dafeiyu',route:item.route,traceId:randomUUID(),operationId:randomUUID(),causedBy:null,type:'fixture.event-alias',plugin:'fixture',pluginVersion:'1',occurredAt:new Date().toISOString(),sources:[{kind:'event',id:source.completed.id,route:item.route}],data:{}});
  assert.deepEqual(await h.probe('a',context=>h.memory.create(context,record(`dafeiyu:source:${redirect.id}:0`,'event重定向不能变成工具正文'))),{status:'source_unavailable'});
  h.core.journal.append({agentId:'dafeiyu',route:item.route,traceId:randomUUID(),operationId:randomUUID(),causedBy:null,type:'message.recalled',plugin:'channel-simulator',pluginVersion:'1',occurredAt:new Date().toISOString(),sources:[],data:{messageId:item.message.id}});
  assert.equal(await h.probe('a',()=>h.timeline.checkArchivedSource(h.scopeFor(item.route),source.ref,opened.contentHash)),false);
  assert.equal(await h.probe('a',()=>h.timeline.checkArchivedSource(h.scopeFor(item.route),aliasRef,opened.contentHash)),false);assert.equal(calls,1);
});
