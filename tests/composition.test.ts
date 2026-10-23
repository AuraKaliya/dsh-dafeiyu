import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendPluginRecord } from '@deepseek-ai/dsh-session';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { API_VERSION } from '@dafeiyu/contracts';
import { activeFragments,fragmentDependencies,readSummaryArtifacts,resolveFragmentView,resolveFragmentProof,readCompactionEvents } from '@dafeiyu/core';
import { seedCheckpoint,prepare,compose } from './composition-fixture.js';
import { provenanceFixture } from './provenance-fixture.js';
import { prepareSummaryComposition,commitSummaryComposition,summaryCompositionRuns } from '../packages/core/lib/summary-composition.js';
import { summaryReference,renderFragmentView,summarySelectionState } from '../packages/core/lib/summary-fragments.js';
import { digestSource,unionDependencies } from '../packages/core/lib/source-records.js';
import { randomUUID } from 'node:crypto';
import { textReply } from './harness.js';
import type { CompositionPlan } from '../packages/core/lib/summary-composition.js';
import type { CompositionHarness } from './composition-fixture.js';

declare module '@deepseek-ai/dsh-llm' { interface MessageSourceMap {
  'fictional-other-plugin':{kind:'fictional-other-plugin'};
} }

const fact={kind:'constraint' as const,text:'仅测试群，主人确认后才能试发；尚未验收，不允许正式群发。'};
async function fixture(){
  const h=await provenanceFixture();await h.run('稳定前缀');
  const a=await seedCheckpoint(h,'虚构A独立来源',[fact,{kind:'uncertainty',text:'A_ONLY：可能失败，尚无结果。'},fact]);
  const b=await seedCheckpoint(h,'虚构B独立来源',[fact,{kind:'fact',text:'B_ONLY：保留独立资料。'}]);
  return {...h,a,b};
}
test('lossless composition strictly deduplicates same-origin fragments but preserves identical text from different origins',async t=>{
  const h=await fixture();t.after(h.close);const before=h.adapter.requests.length,view=compose(h,[h.a.view,h.b.view]);
  assert.equal(view.manifest.composition?.generation,1);
  assert.equal(activeFragments(view).filter(f=>f.text===fact.text).length,2);
  assert.equal(view.view.active.length,h.a.view.view.active.length+h.b.view.view.active.length-1);
  assert.ok(view.manifest.composition!.lineage.some(l=>l.parents.length===2));
  assert.deepEqual(fragmentDependencies(view),unionDependencies(fragmentDependencies(h.a.view),fragmentDependencies(h.b.view)));
  assert.equal(h.adapter.requests.length,before);assert.ok(!view.text.includes('lineage'));assert.ok(!view.text.includes('dependencies'));
});
test('three generations retain raw closure and immutable parent proof after parents leave the surface',async t=>{
  const h=await fixture();t.after(h.close);const first=compose(h,[h.a.view,h.b.view]),second=compose(h,[first]),third=compose(h,[second]);
  assert.equal(third.manifest.composition?.generation,3);assert.deepEqual(fragmentDependencies(third),fragmentDependencies(first));
  assert.deepEqual(activeFragments(third).map(f=>[f.kind,f.text]),activeFragments(first).map(f=>[f.kind,f.text]));
  assert.equal(resolveFragmentView(h.session(),h.a.ref,h.a.memory.scope),null);
  assert.ok(resolveFragmentProof(h.session(),h.a.ref,h.a.memory.scope));
  assert.equal(summarySelectionState(h.session(),h.a.ref,h.a.memory.scope),'superseded');
  assert.equal(summarySelectionState(h.session(),summaryReference(third.manifestSeq,third.manifest),h.a.memory.scope),'active');
  await h.run('三代后继续');assert.match(h.visible(),/B_ONLY/);assert.match(h.visible(),/尚未验收/);
  assert.equal((await h.probe('a',c=>h.timeline.open(c,{ref:h.a.ref}))).status,'not_found');
});
test('A deletion retires only dependent descendants; independent B survives and A restore never revives it',async t=>{
  const h=await fixture();t.after(h.close);const third=compose(h,[compose(h,[compose(h,[h.a.view,h.b.view])])]);
  const ref=summaryReference(third.manifestSeq,third.manifest),kept=activeFragments(third).filter(f=>f.text.includes('B_ONLY'));
  h.mutate(h.a.memory,'delete',1);await h.run('删除A后');const after=resolveFragmentView(h.session(),ref,h.a.memory.scope);assert.ok(after);
  assert.ok(!after.text.includes('A_ONLY'));assert.deepEqual(activeFragments(after).filter(f=>f.text.includes('B_ONLY')),kept);
  assert.equal(activeFragments(after).filter(f=>f.text===fact.text).length,1);
  h.mutate(h.a.memory,'restore',2);await h.run('恢复A后');assert.ok(!h.visible().includes('A_ONLY'));assert.match(h.visible(),/B_ONLY/);
  assert.ok(JSON.stringify(h.session().snapshotEvents()).includes('A_ONLY'));
});
test('restart retains a multi-generation partial view and source restoration cannot re-add retired fragments',async()=>{
  const h=await fixture(),view=compose(h,[compose(h,[compose(h,[h.a.view,h.b.view])])]);
  const root=h.root,ref=summaryReference(view.manifestSeq,view.manifest),a=h.a.memory;
  h.mutate(a,'delete',1);await h.run('持久化删除');const before=resolveFragmentView(h.session(),ref,a.scope)!;await h.close();
  const next=await provenanceFixture(root);
  try{await next.run('重启');const after=resolveFragmentView(next.session(),ref,a.scope);assert.ok(after);assert.deepEqual(after.view.active,before.view.active);
    assert.match(next.visible(),/B_ONLY/);assert.ok(!next.visible().includes('A_ONLY'));
    next.mutate(a,'restore',2);await next.run('恢复');assert.ok(!next.visible().includes('A_ONLY'));
  }finally{await next.close();}
});
test('composition rejects stale parent selection, changed source state, scope, owner, active task and capacity overflow',async t=>{
  const h=await fixture();t.after(h.close);const plan=prepare(h,[h.a.view,h.b.view]);assert.ok(plan);
  for(const options of [{...plan.options,owner:'foreign'},{...plan.options,maxGroups:1},{...plan.options,maxFragments:1},{...plan.options,maxBytes:1}]){
    assert.equal(prepareSummaryComposition(h.session(),plan.scope,[h.a.ref,h.b.ref],options,()=>true),null);
  }
  assert.equal(prepareSummaryComposition(h.session(),{...plan.scope,route:'foreign'},[h.a.ref],plan.options,()=>true),null);
  assert.equal(prepare(h,[h.a.view,h.b.view],()=>false),null);
  assert.throws(()=>commitSummaryComposition(h.ctx,h.session(),plan,()=>false),/conflict/);
  const task=await seedCheckpoint(h,'当前任务来源',[fact],'current-task');
  assert.equal(prepareSummaryComposition(h.session(),plan.scope,[task.ref],{...plan.options,protectedTaskId:'current-task'},()=>true),null);
  h.mutate(h.a.memory,'delete',1);await h.run('来源变化');assert.throws(()=>commitSummaryComposition(h.ctx,h.session(),plan,()=>true),/conflict/);
});
test('native and foreign plugin nodes are barriers and their regions remain intact after local retirement',async t=>{
  const h=await provenanceFixture();t.after(h.close);await h.run('稳定前缀');const a=await seedCheckpoint(h,'A来源',[{kind:'fact',text:'A_ONLY'}]);
  h.session().append('user/message',createUserMessage({source:{kind:'fictional-other-plugin'},content:[{type:'text',text:'FOREIGN_SURFACE_KEEP'}]}),{surfaceOp:'append'});
  const b=await seedCheckpoint(h,'B来源',[{kind:'fact',text:'B_ONLY'}]);assert.equal(prepare(h,[a.view,b.view]),null);
  assert.ok(summaryCompositionRuns(h.session(),a.memory.scope).every(r=>!(r.includes(a.ref)&&r.includes(b.ref))));
  h.ctx.systemPrompt.context({name:'native-c3',order:1,required:true,text:'NATIVE_C3_KEEP'});
  const extension=h.core.registerExtension({id:'second-c3',version:'1',apiVersion:API_VERSION,agentId:'dafeiyu',contexts:[{id:'status',kind:'operational-fact',
    prepare:async()=>[{id:'status',version:'1',text:'SECOND_C3_KEEP',expiresAt:new Date(Date.now()+600000).toISOString(),sources:[{ref:'fictional:status',version:'1',hash:'test'}]}],validate:()=>true}]});t.after(()=>extension.dispose());
  compose(h,[b.view]);h.mutate(a.memory,'delete',1);await h.run('继续');assert.match(h.visible(),/NATIVE_C3_KEEP/);assert.match(h.visible(),/SECOND_C3_KEEP/);assert.match(h.visible(),/FOREIGN_SURFACE_KEEP/);
});
test('an orphan composition manifest, view and prune restart with valid parents still selected',async()=>{
  const h=await fixture(),plan=prepare(h,[h.a.view,h.b.view]);assert.ok(plan);const root=h.root,refs=[h.a.ref,h.b.ref],scope=h.a.memory.scope;
  const manifestSeq=appendPluginRecord(h.session(),'plugin:dafeiyu/summary-manifest',plan.manifest),active=plan.manifest.fragments.map(f=>f.id);
  appendPluginRecord(h.session(),'plugin:dafeiyu/summary-view',{schemaVersion:1,manifestSeq,revision:1,previousViewSeq:null,previousCheckpointSeq:null,active,contentHash:digestSource(renderFragmentView(manifestSeq,plan.manifest,active))});
  const seqs=plan.parents.map(v=>v.checkpoint.seq);h.session().append('compaction/prune',{shadowedRange:{start:seqs[0]!,end:seqs.at(-1)!},shadowedSeqs:seqs,shadowedTokenCount:0});
  await h.ctx.sessions.flush(h.session());await h.close();const next=await provenanceFixture(root);
  try{await next.run('中断恢复');assert.ok(refs.every(ref=>resolveFragmentView(next.session(),ref,scope)));assert.match(next.visible(),/A_ONLY/);assert.match(next.visible(),/B_ONLY/);
    assert.equal(resolveFragmentProof(next.session(),summaryReference(manifestSeq,plan.manifest),scope),null);
  }finally{await next.close();}
});
test('raw closure omissions and future/cyclic parent references fail closed, never fall back to replaced parents',async t=>{
  const h=await fixture();t.after(h.close);const plan=prepare(h,[h.a.view,h.b.view]);assert.ok(plan);
  const bad=structuredClone(plan);bad.manifest.groups[0]!.dependencies=[];
  assert.throws(()=>commitSummaryComposition(h.ctx,h.session(),bad,()=>true),/proof changed/);
  bad.manifest=structuredClone(plan.manifest);bad.manifest.composition!.parents[0]!.manifestSeq=h.session().seq+100;
  assert.throws(()=>commitSummaryComposition(h.ctx,h.session(),bad,()=>true),/proof changed/);
  assert.ok(resolveFragmentView(h.session(),h.a.ref,h.a.memory.scope));
});
test('generation limit fails without truncating proof or replacing valid history',async t=>{
  const h=await fixture();t.after(h.close);let view=compose(h,[h.a.view,h.b.view]);
  for(let i=1;i<16;i++)view=compose(h,[view]);
  assert.equal(view.manifest.composition?.generation,16);assert.equal(prepare(h,[view]),null);assert.ok(resolveFragmentView(h.session(),summaryReference(view.manifestSeq,view.manifest),h.a.memory.scope));
});
test('proof lookup returns selected lineage and original sources without exposing retired siblings or crossing sessions',async t=>{
  const h=await fixture();t.after(h.close);const view=compose(h,[compose(h,[h.a.view,h.b.view])]),ref=summaryReference(view.manifestSeq,view.manifest);
  h.mutate(h.a.memory,'delete',1);await h.run('删除A');const b=activeFragments(resolveFragmentView(h.session(),ref,h.b.memory.scope)!).find(f=>f.text.includes('B_ONLY'))!;
  const proof=await h.probe('a',c=>h.core.summaryReference(c,`${ref}.${b.id}`));assert.equal(proof.status,'ok');
  if(proof.status==='ok'){assert.ok(proof.proof.composition?.parents.length);assert.equal(proof.proof.composition?.lineage.length,1);assert.ok(proof.sourceSeqs.length);assert.ok(!JSON.stringify(proof).includes('A_ONLY'));}
  assert.equal((await h.probe('other',c=>h.timeline.open(c,{ref}))).status,'not_found');
});
test('the automatic threshold path composes and deduplicates without a new model compaction call',async t=>{
  const h=await provenanceFixture(undefined,30000,{cooldownMs:0,minGrowthTokens:0,maxFragments:32,maxSummaryChars:4000});t.after(h.close);await h.run('固定前缀');
  const repeated={kind:'constraint' as const,text:'AUTO_DEDUP：仅限本地虚构测试，尚未验收。'.repeat(20)};
  await seedCheckpoint(h,'虚构重复来源',[repeated,repeated,repeated]);
  const before=h.adapter.requests.filter(r=>r.purpose==='compaction').length;
  await h.run('CURRENT_TASK_KEEP：'+'当前任务不得压缩。'.repeat(2800));
  assert.ok(readCompactionEvents(h.session()).some(e=>e.type==='plugin:dafeiyu/compaction-check'&&e.data.status==='composed'));
  assert.equal(h.adapter.requests.filter(r=>r.purpose==='compaction').length,before);assert.match(h.visible(),/CURRENT_TASK_KEEP/);
  assert.ok(readSummaryArtifacts(h.session()).some(r=>r.type==='plugin:dafeiyu/summary-manifest'&&r.data.composition));
});

function appendMalformedCommit(h:CompositionHarness,plan:CompositionPlan){
  const session=h.session(),m=plan.manifest,seqs=plan.parents.map(v=>v.checkpoint.seq);
  const manifestSeq=appendPluginRecord(session,'plugin:dafeiyu/summary-manifest',m),active=m.fragments.map(f=>f.id),text=renderFragmentView(manifestSeq,m,active);
  const viewSeq=appendPluginRecord(session,'plugin:dafeiyu/summary-view',{schemaVersion:1,manifestSeq,revision:1,previousViewSeq:null,previousCheckpointSeq:null,active,contentHash:digestSource(text)});
  session.append('compaction/prune',{shadowedRange:{start:seqs[0]!,end:seqs.at(-1)!},shadowedSeqs:seqs,shadowedTokenCount:0});
  session.append('user/message',createUserMessage({source:{kind:'dafeiyu-summary-view',compactionId:m.compactionId},content:[{type:'text',text}]}),
    {surfaceOp:{op:'replace',startSeq:seqs[0]!,endSeq:seqs.at(-1)!},sourceEventSeqs:[...seqs,manifestSeq,viewSeq]});
  return summaryReference(manifestSeq,m);
}
for(const corruption of ['omitted-dependency','self-cycle','wrong-scope','changed-condition','missing-parent'] as const){
  test(`a committed ${corruption} proof is rejected without reactivating parent views`,async t=>{
    const h=await fixture();t.after(h.close);const plan=prepare(h,[h.a.view,h.b.view]);assert.ok(plan);
    if(corruption==='omitted-dependency')plan.manifest.groups[0]!.dependencies=[];
    if(corruption==='self-cycle'){
      const parent=plan.manifest.composition!.parents[0]!;parent.ref=summaryReference(h.session().seq,plan.manifest);parent.manifestSeq=h.session().seq;
    }
    if(corruption==='wrong-scope')plan.manifest.route='foreign-conversation';
    if(corruption==='changed-condition')plan.manifest.fragments[0]!.text='已验收，可以正式群发。';
    if(corruption==='missing-parent')plan.manifest.composition!.lineage[0]!.parents=['S000000000000-0.F1'];
    const ref=appendMalformedCommit(h,plan);assert.equal(resolveFragmentProof(h.session(),ref,h.a.memory.scope),null);
    await h.run('检查坏证明');assert.ok(!h.visible().includes('A_ONLY'));assert.ok(!h.visible().includes('B_ONLY'));assert.ok(!h.visible().includes('可以正式群发'));
    assert.equal(resolveFragmentView(h.session(),h.a.ref,h.a.memory.scope),null);
  });
}
test('new composition after local retirement uses only the surviving view and does not inherit removed siblings',async t=>{
  const h=await fixture();t.after(h.close);const first=compose(h,[h.a.view,h.b.view]),ref=summaryReference(first.manifestSeq,first.manifest);
  h.mutate(h.a.memory,'delete',1);await h.run('退出A');const partial=resolveFragmentView(h.session(),ref,h.a.memory.scope)!;
  const second=compose(h,[partial]);assert.ok(!second.text.includes('A_ONLY'));assert.match(second.text,/B_ONLY/);
  h.mutate(h.a.memory,'restore',2);await h.run('恢复后');assert.ok(!h.visible().includes('A_ONLY'));assert.match(h.visible(),/B_ONLY/);
});
test('a downstream answer exposed to A and B retains their union even after lossless composition',async t=>{
  const h=await fixture();t.after(h.close);compose(h,[h.a.view,h.b.view]);await h.run('只说B','MIXED_ANSWER_MUST_RETIRE');
  h.mutate(h.a.memory,'delete',1);await h.run('继续');assert.ok(!h.visible().includes('MIXED_ANSWER_MUST_RETIRE'));assert.match(h.visible(),/B_ONLY/);
});
test('failed composition persistence blocks model dispatch and a retry keeps a single committed child',async t=>{
  const h=await provenanceFixture(undefined,30000,{cooldownMs:0,minGrowthTokens:0,maxFragments:32,maxSummaryChars:4000});t.after(h.close);await h.run('固定前缀');
  const repeated={kind:'constraint' as const,text:'FLUSH_DUP：仅限虚构测试，尚未验收。'.repeat(20)};await seedCheckpoint(h,'虚构重复来源',[repeated,repeated,repeated]);
  const before=h.adapter.requests.length,persistence=h.ctx.sessions,flush=persistence.flush.bind(persistence);persistence.flush=async()=>false;
  try{h.setResponse(()=>textReply('MUST_NOT_DELIVER'));const receipt=h.simulator.send('a','当前任务：'+'不能压缩当前任务。'.repeat(2800),{id:randomUUID()});await h.core.whenIdle();
    assert.equal(h.core.journal.get(receipt.id).state,'failed');assert.equal(h.adapter.requests.length,before);
  }finally{persistence.flush=flush;}
  assert.equal(readSummaryArtifacts(h.session()).filter(e=>e.type==='plugin:dafeiyu/summary-manifest'&&e.data.composition).length,1);
  await h.run('持久化恢复');assert.match(h.visible(),/FLUSH_DUP/);
  assert.equal(readSummaryArtifacts(h.session()).filter(e=>e.type==='plugin:dafeiyu/summary-manifest'&&e.data.composition).length,1);
});
test('successful composition is idempotent under retry and a replaced parent cannot be selected again',async t=>{
  const h=await fixture();t.after(h.close);const plan=prepare(h,[h.a.view,h.b.view]);assert.ok(plan);
  commitSummaryComposition(h.ctx,h.session(),plan,()=>true);
  assert.throws(()=>commitSummaryComposition(h.ctx,h.session(),plan,()=>true),/conflict/);assert.equal(prepare(h,[h.a.view]),null);
  assert.equal(readSummaryArtifacts(h.session()).filter(e=>e.type==='plugin:dafeiyu/summary-manifest'&&e.data.composition).length,1);
});
test('source revision changes retire dependent generations while unrelated version changes preserve them',async t=>{
  const h=await fixture();t.after(h.close);const view=compose(h,[compose(h,[h.a.view,h.b.view])]),ref=summaryReference(view.manifestSeq,view.manifest);
  const unrelated=h.rememberUnseen('虚构未入上下文来源',h.a.memory);
  h.store.mutate(h.a.memory.scope,{action:'delete',id:unrelated.id,expectedVersion:1,requestId:randomUUID(),reason:'无关来源变化'});
  await h.run('无关更新');assert.equal(resolveFragmentView(h.session(),ref,h.a.memory.scope)!.view.revision,1);
  const a=h.a.memory;
  h.store.mutate(a.scope,{action:'revise',id:a.memory.id,expectedVersion:1,requestId:randomUUID(),value:{kind:'knowledge',claimType:'self_report',content:'虚构A修订后的内容',sources:[...a.memory.sources]}});
  await h.run('版本更新');assert.ok(!h.visible().includes('A_ONLY'));assert.match(h.visible(),/B_ONLY/);
});
