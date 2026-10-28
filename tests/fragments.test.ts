import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { API_VERSION } from '@dafeiyu/contracts';
import { readSummaryArtifacts,activeFragments,fragmentDependencies } from '@dafeiyu/core';
import { z } from 'zod';
import { fragmentFixture,summaryInputs,fragmentSettings } from './fragment-fixture.js';
import { provenanceFixture } from './provenance-fixture.js';
import { appendPluginRecord } from '@deepseek-ai/dsh-session';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { renderFragmentView } from '../packages/core/lib/summary-fragments.js';
import { digestSource } from '../packages/core/lib/source-records.js';
import { textReply } from './harness.js';
import { readCompactionEvents } from '@dafeiyu/core';
import type {} from '@deepseek-ai/dsh-token-meter';

test('a source group may exceed its soft share while preserving later groups and the total character limit',async t=>{
  const h=await provenanceFixture(undefined,30000,{...fragmentSettings,maxSummaryChars:400,maxFragmentGroups:4,maxFragments:8});t.after(h.close);const observed:{target:number;maximum:number;length:number}[]=[];
  h.setCompactionResponse(r=>{const prompt=r.messages.filter(m=>m.role==='system').flatMap(m=>m.content).filter(b=>b.type==='text').map(b=>b.text).join(''),match=prompt.match(/控制在(\d+)字内；不可超过的硬上限为(\d+)字/);assert.ok(match);const text='鱼'.repeat(observed.length===0?150:30);observed.push({target:Number(match[1]),maximum:Number(match[2]),length:Array.from(text).length});return textReply(JSON.stringify({fragments:[{kind:'note',text}]}));});
  await h.run('稳定前缀');await h.run('旧阶段1：'+'虚构材料。'.repeat(500));await h.run('旧阶段2：'+'另一份材料。'.repeat(500));await h.run('保留近期尾部');await h.run('当前任务：'+'保留当前来源。'.repeat(2800));
  const manifests=readSummaryArtifacts(h.session()).filter(e=>e.type==='plugin:dafeiyu/summary-manifest');assert.ok(manifests.length>0);assert.ok(observed.some(v=>v.length>v.target&&v.length<=v.maximum));assert.ok(manifests.every(m=>m.data.fragments.reduce((n,f)=>n+Array.from(f.text).length,0)<=400));assert.ok(!readCompactionEvents(h.session()).some(e=>e.type==='compaction/end'&&e.data.error));
});

test('soft shares cannot consume the hard character reservation for remaining groups',async t=>{
  const h=await provenanceFixture(undefined,30000,{...fragmentSettings,maxSummaryChars:400,maxFragmentGroups:4,maxFragments:8});t.after(h.close);
  h.setCompactionResponse(r=>{const prompt=r.messages.filter(m=>m.role==='system').flatMap(m=>m.content).filter(b=>b.type==='text').map(b=>b.text).join(''),match=prompt.match(/硬上限为(\d+)字/);assert.ok(match);return textReply(JSON.stringify({fragments:[{kind:'note',text:'鱼'.repeat(Number(match[1])+1)}]}));});
  await h.run('稳定前缀');await h.run('旧阶段1：'+'虚构材料。'.repeat(500));await h.run('旧阶段2：'+'另一份材料。'.repeat(500));await h.run('保留近期尾部');await h.run('当前任务：'+'保留当前来源。'.repeat(2800));assert.equal(readSummaryArtifacts(h.session()).length,0);assert.ok(h.visible().includes('旧阶段1'));assert.ok(readCompactionEvents(h.session()).some(e=>e.type==='compaction/end'&&e.data.error));
});

test('isolated input groups produce independent fragments with private full proofs and compact references',async t=>{
  const h=await fragmentFixture();t.after(h.close);const view=h.view(),body=JSON.parse(view.text);
  assert.equal(body.schemaVersion,3);assert.ok(body.fragments.length>=4);
  assert.ok(h.modelCalls().every(r=>{const text=summaryInputs(r).map(i=>i.text).join('');return !(text.includes('A_UNIT_ONLY')&&text.includes('B_UNIT_ONLY'));}));
  for(const key of ['dependencies','hash','agentId','route','sourceVersions','versions','groups'])assert.ok(!view.text.includes(`"${key}"`));
  assert.ok(view.manifest.groups.every(g=>g.inputs.length&&g.dependencies.length));
  assert.ok(Buffer.byteLength(view.text)<Buffer.byteLength(JSON.stringify(view.manifest))/2);
  assert.match(h.visible(),/CURRENT_TASK_KEEP/);
});

test('deleting A replaces only its fragments within the same checkpoint and preserves B ids and text',async t=>{
  const h=await fragmentFixture();t.after(h.close);const before=h.view(),kept=activeFragments(before).filter(f=>f.text.startsWith('B_'));const calls=h.modelCalls().length;
  const bVisible=JSON.parse(before.text).fragments.filter((f:{text:string})=>f.text.startsWith('B_'));
  h.mutate(h.a,'delete',1);await h.run('继续有效部分');const after=h.view();
  assert.equal(after.manifestSeq,before.manifestSeq);assert.equal(after.view.revision,2);assert.equal(after.checkpoint.data.source.kind,'dafeiyu-summary-view');
  assert.ok(!after.text.includes('A_FACT_ONLY'));assert.ok(!after.text.includes('A_PENDING_ONLY'));
  assert.deepEqual(activeFragments(after).filter(f=>f.text.startsWith('B_')),kept);
  assert.deepEqual(JSON.parse(after.text).fragments.filter((f:{text:string})=>f.text.startsWith('B_')),bVisible);
  assert.equal(h.modelCalls().length,calls);assert.ok(JSON.stringify(h.session().snapshotEvents()).includes('A_FACT_ONLY'));
  assert.ok(h.core.journal.events(h.a.scope.route).some(e=>e.type==='context.summary.updated'&&e.data.kept!==0));
});

test('restore does not reinsert retired fragments; subsequent deletion can empty the bundle without tool replay',async t=>{
  const h=await fragmentFixture();t.after(h.close);h.mutate(h.a,'delete',1);await h.run('删除A');const view=h.view();
  h.mutate(h.a,'restore',2);await h.run('恢复A');assert.equal(h.view().view.revision,view.view.revision);assert.ok(!h.view().text.includes('A_FACT_ONLY'));
  h.mutate(h.b,'delete',1);await h.run('删除B');assert.ok(!h.view().text.includes('B_FACT_KEEP'));assert.ok(h.view().view.revision>view.view.revision);
});

test('short refs expose only requested valid fragment proof and pinned pagination is stable',async t=>{
  const h=await fragmentFixture();t.after(h.close);const b=activeFragments(h.view()).find(f=>f.text.startsWith('B_FACT_KEEP'))!;
  const ref=`${h.ref}.${b.id}`;
  const first=await h.probe('a',c=>h.timeline.open(c,{ref,limit:200}));assert.equal(first.status,'ok');
  const page=z.object({status:z.literal('ok'),ref:z.string(),text:z.string(),contentHash:z.string(),nextOffset:z.number().nullable(),memoryUse:z.literal('derived-only')});
  let current=page.parse(first),text=current.text,limit=0;
  while(current.nextOffset!==null){const next=page.parse(await h.probe('a',c=>h.timeline.open(c,{ref:current.ref,offset:current.nextOffset,limit:200})));assert.equal(next.contentHash,current.contentHash);text+=next.text;current=next;if(++limit>80)throw new Error('Pagination failed');}
  const proof=z.object({fragments:z.array(z.object({text:z.string()})),groups:z.array(z.object({dependencies:z.array(z.unknown())})),sourceRefs:z.array(z.string())}).parse(JSON.parse(text));
  assert.equal(proof.fragments.length,1);assert.match(proof.fragments[0]!.text,/B_FACT_KEEP/);assert.ok(!text.includes('A_FACT_ONLY'));assert.ok(proof.groups[0]!.dependencies.length);assert.ok(proof.sourceRefs.length);
  assert.equal((await h.probe('other',c=>h.timeline.open(c,{ref}))).status,'not_found');
  h.mutate(h.a,'delete',1);await h.run('更新视图');assert.equal((await h.probe('a',c=>h.timeline.open(c,{ref:page.parse(first).ref}))).status,'stale_reference');
  assert.equal((await h.probe('a',c=>h.timeline.open(c,{ref}))).status,'ok');
});

test('removed fragment refs and old full checkpoint exports cannot disclose deleted text',async t=>{
  const h=await fragmentFixture();t.after(h.close);const old=h.view(),a=activeFragments(old).find(f=>f.text.startsWith('A_FACT_ONLY'))!;
  const anchor=h.core.journal.events(h.a.scope.route).find(e=>e.sources.some(s=>s.kind==='session'&&s.seq===old.checkpoint.seq));assert.ok(anchor);
  const index=anchor.sources.findIndex(s=>s.kind==='session'&&s.seq===old.checkpoint.seq);
  h.mutate(h.a,'delete',1);await h.run('继续');
  assert.equal((await h.probe('a',c=>h.timeline.open(c,{ref:`${h.ref}.${a.id}`}))).status,'not_found');
  assert.equal((await h.probe('a',c=>h.timeline.open(c,{ref:`dafeiyu:source:${anchor.id}:${index}`}))).status,'not_exported');
});

test('other plugin regions and native sections survive fragment retirement unchanged',async t=>{
  const h=await fragmentFixture();t.after(h.close);
  h.ctx.systemPrompt.context({name:'native-c2',order:1,required:true,text:'NATIVE_C2_KEEP'});
  const expires=new Date(Date.now()+600000).toISOString();const extension=h.core.registerExtension({id:'second-c2',version:'1',protocolVersion:4,agentId:'dafeiyu',conversationContexts:[{
    id:'status',kind:'operational-fact',prepare:async()=>[{id:'status',version:'1',text:'SECOND_C2_KEEP',expiresAt:expires,sources:[{ref:'fictional:status',version:'1',hash:'test'}]}],validate:()=>true,
  }]});t.after(()=>extension.dispose());await h.run('加入其他区域');
  h.mutate(h.a,'delete',1);await h.run('继续');assert.match(h.visible(),/NATIVE_C2_KEEP/);assert.match(h.visible(),/SECOND_C2_KEEP/);assert.match(h.view().text,/B_FACT_KEEP/);
});

test('restart reconstructs the latest partial view and never reactivates earlier fragments',async()=>{
  const h=await fragmentFixture(),root=h.root,ref=h.ref,a=h.a;h.mutate(a,'delete',1);await h.run('退休A');const ids=h.view().view.active;
  await h.close();const next=await provenanceFixture(root,1000000,fragmentSettings);
  try{await next.run('重启后继续');const inspected=await next.probe('a',c=>next.timeline.open(c,{ref,limit:2000}));assert.equal(inspected.status,'ok');assert.match(next.visible(),/B_FACT_KEEP/);assert.ok(!next.visible().includes('A_FACT_ONLY'));
    const views=readSummaryArtifacts(next.session()).filter(e=>e.type==='plugin:dafeiyu/summary-view');assert.deepEqual(views.at(-1)!.data.active,ids);
    next.mutate(a,'restore',2);await next.run('恢复后继续');assert.ok(!next.visible().includes('A_FACT_ONLY'));
  }finally{await next.close();}
});

test('answers exposed to a mixed view retain the full union even when only B is mentioned',async t=>{
  const h=await fragmentFixture();t.after(h.close);const dependencies=fragmentDependencies(h.view());assert.ok(dependencies.length>1);
  await h.run('只谈B','ANSWER_SAW_A_AND_B');h.mutate(h.a,'delete',1);await h.run('继续');assert.ok(!h.visible().includes('ANSWER_SAW_A_AND_B'));assert.match(h.view().text,/B_FACT_KEEP/);
});

test('an orphan partial-view record and prune survive restart without reviving the stale root view',async()=>{
  const h=await fragmentFixture(),before=h.view(),root=h.root,ref=h.ref,scope=h.a.scope;
  h.mutate(h.a,'delete',1);
  const active=activeFragments(before).filter(f=>f.text.startsWith('B_')).map(f=>f.id),text=renderFragmentView(before.manifestSeq,before.manifest,active);
  appendPluginRecord(h.session(),'plugin:dafeiyu/summary-view',{schemaVersion:1,manifestSeq:before.manifestSeq,revision:2,
    previousViewSeq:before.viewSeq,previousCheckpointSeq:before.checkpoint.seq,active,contentHash:digestSource(text)});
  const price=h.ctx.get('tokenMeter')!.measure(h.session()).nodes.find(n=>n.seq===before.checkpoint.seq)!.heuristicTokens;
  h.session().append('compaction/prune',{shadowedRange:{start:before.checkpoint.seq,end:before.checkpoint.seq},shadowedSeqs:[before.checkpoint.seq],shadowedTokenCount:price});
  await h.ctx.sessions.flush(h.session());await h.close();const next=await provenanceFixture(root,1000000,fragmentSettings);
  try{await next.run('中断后恢复');assert.match(next.visible(),/B_FACT_KEEP/);assert.ok(!next.visible().includes('A_FACT_ONLY'));
    const read=await next.probe('a',c=>next.timeline.open(c,{ref}));assert.equal(read.status,'ok');assert.ok(next.core.journal.events(scope.route).some(e=>e.type==='context.summary.updated'));
  }finally{await next.close();}
});

test('a committed attempt to re-add retired ids is rejected instead of falling back to an earlier view',async t=>{
  const h=await fragmentFixture();t.after(h.close);h.mutate(h.a,'delete',1);await h.run('退出A');const view=h.view();
  h.mutate(h.a,'restore',2);
  const active=view.manifest.fragments.map(f=>f.id),text=renderFragmentView(view.manifestSeq,view.manifest,active);
  const record=appendPluginRecord(h.session(),'plugin:dafeiyu/summary-view',{schemaVersion:1,manifestSeq:view.manifestSeq,revision:view.view.revision+1,
    previousViewSeq:view.viewSeq,previousCheckpointSeq:view.checkpoint.seq,active,contentHash:digestSource(text)});
  h.session().append('compaction/prune',{shadowedRange:{start:view.checkpoint.seq,end:view.checkpoint.seq},shadowedSeqs:[view.checkpoint.seq],shadowedTokenCount:0});
  h.session().append('user/message',createUserMessage({source:{kind:'dafeiyu-summary-view',compactionId:view.manifest.compactionId},content:[{type:'text',text}]}),
    {surfaceOp:{op:'replace',startSeq:view.checkpoint.seq,endSeq:view.checkpoint.seq},sourceEventSeqs:[view.manifestSeq,record,view.checkpoint.seq]});
  await h.run('不恢复旧内容');assert.ok(!h.visible().includes('A_FACT_ONLY'));assert.equal((await h.probe('a',c=>h.timeline.open(c,{ref:h.ref}))).status,'not_found');
});

test('missing view proofs fail closed while preserving unrelated native context',async t=>{
  const h=await fragmentFixture();t.after(h.close);const view=h.view();h.ctx.systemPrompt.context({name:'native-proof-test',order:1,required:true,text:'NATIVE_PROOF_KEEP'});
  const body=JSON.parse(view.text);body.ref='S000000000000-zz';
  h.session().append('user/message',createUserMessage({source:{kind:'dafeiyu-summary-view',compactionId:view.manifest.compactionId},content:[{type:'text',text:JSON.stringify(body)}]}),
    {surfaceOp:{op:'replace',startSeq:view.checkpoint.seq,endSeq:view.checkpoint.seq},sourceEventSeqs:[view.checkpoint.seq]});
  await h.run('检查损坏引用');assert.match(h.visible(),/NATIVE_PROOF_KEEP/);assert.ok(!h.visible().includes('A_FACT_ONLY'));
  assert.equal((await h.probe('a',c=>h.timeline.open(c,{ref:body.ref}))).status,'not_found');
});

test('failed persistence stops dispatch after a partial retirement and later recovery keeps the safe view',async t=>{
  const h=await fragmentFixture();t.after(h.close);h.mutate(h.a,'delete',1);
  const persistence=h.ctx.sessions,flush=persistence.flush.bind(persistence),before=h.adapter.requests.length;
  persistence.flush=async()=>false;
  try{h.setResponse(()=>textReply('MUST_NOT_DELIVER'));const receipt=h.simulator.send('a','测试持久化失败',{id:randomUUID()});await h.core.whenIdle();assert.equal(h.core.journal.get(receipt.id).state,'failed');assert.equal(h.adapter.requests.length,before);}
  finally{persistence.flush=flush;}
  await h.run('恢复后继续');assert.match(h.view().text,/B_FACT_KEEP/);assert.ok(!h.view().text.includes('A_FACT_ONLY'));
});

test('proof tool responses are one-turn evidence and never automatically accumulate in chat',async t=>{
  const h=await fragmentFixture();t.after(h.close);const b=activeFragments(h.view()).find(f=>f.text.startsWith('B_FACT_KEEP'))!;
  await h.invoke('dafeiyu_source_open',{ref:`${h.ref}.${b.id}`,limit:2000});
  assert.ok(h.visible().includes('summary-fragments'));
  await h.run('继续正文');assert.ok(!h.visible().includes('summary-fragments'));assert.match(h.view().text,/B_FACT_KEEP/);
});

test('removing the required memory provider blocks dispatch and preserves immutable archives',async t=>{
  const h=await fragmentFixture();t.after(h.close);const calls=h.adapter.requests.length;await h.memoryFiber.dispose();await assert.rejects(h.run('插件退出'),/DEPENDENCY_UNAVAILABLE/);assert.equal(h.adapter.requests.length,calls);
  assert.ok(JSON.stringify(h.session().snapshotEvents()).includes('A_FACT_ONLY'));
});

test('forged action contexts cannot resolve short references',async t=>{
  const h=await fragmentFixture();t.after(h.close);
  await h.probe('a',context=>{assert.throws(()=>h.core.summaryReference({...context},h.ref),/SCOPE_DENIED/);return {verified:true};});
});

test('model-supplied dependency fields cannot manufacture a proof',async t=>{
  const h=await provenanceFixture(undefined,5000,{...fragmentSettings,maxFragmentGroups:1});t.after(h.close);
  h.setCompactionResponse(()=>textReply(JSON.stringify({fragments:[{kind:'fact',text:'INVALID_PROOF_OUTPUT',dependencies:[]}]})));
  for(let i=0;i<5;i++)await h.run('虚构待压缩：'+'尚未验证的资料。'.repeat(300));
  assert.equal(readSummaryArtifacts(h.session()).length,0);assert.ok(!h.visible().includes('INVALID_PROOF_OUTPUT'));
  assert.ok(readCompactionEvents(h.session()).some(e=>e.type==='plugin:dafeiyu/compaction-check'&&e.data.status==='summary-failed'));
});

test('empty model fragment arrays never commit an empty successful summary',async t=>{
  const h=await provenanceFixture(undefined,5000,{...fragmentSettings,maxFragmentGroups:1});t.after(h.close);
  h.setCompactionResponse(()=>textReply(JSON.stringify({fragments:[]})));
  for(let i=0;i<5;i++)await h.run('虚构待压缩：'+'尚未验证的资料。'.repeat(300));
  assert.equal(readSummaryArtifacts(h.session()).length,0);assert.ok(h.visible().includes('尚未验证的资料'));
});

test('a fragment count overflow aborts the whole initial commit and leaves valid raw history intact',async t=>{
  const h=await provenanceFixture(undefined,30000,{...fragmentSettings,maxFragments:2,maxFragmentGroups:2});t.after(h.close);
  h.setCompactionResponse(()=>textReply(JSON.stringify({fragments:[{kind:'fact',text:'不得提交片段一'},{kind:'constraint',text:'不得提交片段二'}]})));
  await h.run('稳定前缀');await h.run('旧阶段1：'+'虚构资料。'.repeat(500));await h.run('旧阶段2：'+'另一份资料。'.repeat(500));await h.run('近期尾部');
  await h.run('当前任务：'+'继续受保护任务。'.repeat(2800));assert.equal(readSummaryArtifacts(h.session()).length,0);
  assert.ok(h.visible().includes('旧阶段1'));assert.ok(!h.visible().includes('不得提交片段一'));
});

test('pending current input contributes to pressure without becoming a compression source',async t=>{
  const h=await provenanceFixture(undefined,30000,fragmentSettings);t.after(h.close);
  await h.run('稳定前缀');await h.run('旧阶段1：'+'虚构资料。'.repeat(500));await h.run('旧阶段2：'+'另一份资料。'.repeat(500));await h.run('保留近期尾部');
  assert.equal(h.adapter.requests.filter(r=>r.purpose==='compaction').length,0);
  await h.run('CURRENT_UNSHADOWED：'+'当前任务继续进行。'.repeat(2800));
  const calls=h.adapter.requests.filter(r=>r.purpose==='compaction');assert.ok(calls.length>0);assert.ok(calls.every(r=>!JSON.stringify(summaryInputs(r)).includes('CURRENT_UNSHADOWED')));
  assert.match(h.visible(),/CURRENT_UNSHADOWED/);
});
