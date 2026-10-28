import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractQualifiers,checkSemanticResult,API_VERSION } from '@dafeiyu/contracts';
import { activeFragments,fragmentDependencies,resolveFragmentView,resolveFragmentProof,readSummaryArtifacts,readCompactionEvents } from '@dafeiyu/core';
import { semanticFixture,acceptedResult,raw } from './semantic-fixture.js';
import { generateSummaryRewrite,commitSummaryRewrite,buildRewriteManifest,prepareSummaryRewrite } from '../packages/core/lib/summary-rewrite.js';
import { summaryReference } from '../packages/core/lib/summary-fragments.js';
import { compose,seedCheckpoint } from './composition-fixture.js';
import { provenanceFixture } from './provenance-fixture.js';
import { textReply,call } from './harness.js';
import { MemorySourcePolicy } from '../packages/memory/lib/source-policy.js';
import { MemoryCompaction } from '../packages/memory/lib/compaction.js';
import type { SourceDependency } from '@dafeiyu/contracts';
import { scriptedSemantic } from './semantic-fixture.js';
import { randomUUID } from 'node:crypto';
import { appendPluginRecord } from '@deepseek-ai/dsh-session';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { renderFragmentView } from '../packages/core/lib/summary-fragments.js';
import { digestSource } from '../packages/core/lib/source-records.js';

test('qualifiers retain source offsets, polarity, scope, attribution, time, quantities and correction verbatim',()=>{
  const text='小周说只是猜测。仅限测试群。未验收，不能发布。若获确认再发。更正为蓝帆731。上限30元，截至2026-11-01。';
  const sources=[{seq:2,role:'user' as const,text,hash:'fixture'}],q=extractQualifiers(sources);assert.equal(q.length,6);
  assert.ok(q.every(a=>text.slice(a.start,a.end)===a.text));
  const request={mode:'rebuild' as const,sources,parents:[],maxChars:1000},good=acceptedResult(request);
  assert.doesNotThrow(()=>checkSemanticResult(request,good));
  for(const clause of q)assert.throws(()=>checkSemanticResult(request,{...good,fragment:{...good.fragment,text:good.fragment.text.replace(clause.text,'')}}));
});
test('semantic generation and independent verification use fresh tool-free DSH requests without injecting analysis',async t=>{
  const h=await semanticFixture();t.after(h.close);const plan=h.plan();assert.ok(plan);const seq=h.session().seq;
  const result=await generateSummaryRewrite(h.session(),plan,h.provider,new AbortController().signal,h.validate);
  assert.equal(h.session().seq,seq);const calls=h.adapter.requests.filter(r=>String(r.sessionId).startsWith('memory-semantic-'));
  assert.equal(calls.length,2);assert.notEqual(calls[0]!.sessionId,calls[1]!.sessionId);assert.ok(calls.every(c=>!c.tools?.length));
  assert.ok(result.qualifiers.every(q=>result.fragment.text.includes(q.text)));
  const before=activeFragments(h.a.view).filter(f=>f.group!=='G1').map(f=>[f.kind,f.text]);
  const view=commitSummaryRewrite(h.ctx,h.session(),plan,result,h.validate);
  assert.deepEqual(activeFragments(view).filter(f=>f.group!=='G1').map(f=>[f.kind,f.text]),before);
  assert.deepEqual(fragmentDependencies(view),fragmentDependencies(h.a.view));assert.equal(view.manifest.rewrite?.consecutive,1);
  await h.run('继续');assert.match(h.visible(),/青羽842/);assert.ok(!h.visible().includes('verification'));
});
test('two fusions force original-source rebuild; rebuild reads no parent prose and resets semantic depth',async t=>{
  const h=await semanticFixture();t.after(h.close);let view=h.a.view;
  for(let i=0;i<2;i++){const plan=h.plan(view);assert.ok(plan);view=commitSummaryRewrite(h.ctx,h.session(),plan,acceptedResult(plan.request),h.validate);}
  assert.equal(h.plan(view),null);const rebuild=h.plan(view,'rebuild');assert.ok(rebuild);assert.deepEqual(rebuild.request.parents,[]);
  assert.ok(rebuild.request.sources.some(s=>s.text.includes(raw)));const next=commitSummaryRewrite(h.ctx,h.session(),rebuild,acceptedResult(rebuild.request),h.validate);
  assert.equal(next.manifest.rewrite?.consecutive,0);assert.equal(next.manifest.rewrite?.generation,3);
  assert.deepEqual(fragmentDependencies(next),fragmentDependencies(h.a.view));assert.ok(resolveFragmentProof(h.session(),h.a.ref,h.scope));
  const composed=compose(h,[next]);assert.ok(resolveFragmentView(h.session(),summaryReference(composed.manifestSeq,composed.manifest),h.scope));
});
test('program-carried qualifiers preserve exact clauses while independent review rejects contradictory conclusions',async t=>{
  const h=await semanticFixture();t.after(h.close);const plan=h.plan();assert.ok(plan);
  h.setCompactionResponse(r=>textReply(JSON.stringify(String(r.sessionId).includes('-generate-')?{fragment:{kind:'fact',text:'项目已经验收，可以群发。'}}:{compatible:true,faithful:false,issues:['正文与原文限定矛盾，附带引文不能使其成立']})));
  await assert.rejects(generateSummaryRewrite(h.session(),plan,h.provider,new AbortController().signal,h.validate),/Semantic verification rejected/);
  assert.equal(h.adapter.requests.filter(r=>String(r.sessionId).includes('memory-semantic-verify')).length,1);
  h.setCompactionResponse(r=>textReply(JSON.stringify(String(r.sessionId).includes('-generate-')?{fragment:{kind:'note',text:'保留当前讨论及其限制。'}}:{compatible:true,faithful:true,issues:[]})));
  const retained=await generateSummaryRewrite(h.session(),plan,h.provider,new AbortController().signal,h.validate);assert.ok(retained.qualifiers.every(q=>retained.fragment.text.includes(q.text)));
  for(const verdict of [{compatible:false,faithful:true,issues:[]},{compatible:true,faithful:false,issues:['扩大权限']}]){
    h.setCompactionResponse(r=>textReply(JSON.stringify(String(r.sessionId).includes('-generate-')?{fragment:acceptedResult(plan.request).fragment}:verdict)));
    await assert.rejects(generateSummaryRewrite(h.session(),plan,h.provider,new AbortController().signal,h.validate));
  }
  assert.ok(resolveFragmentView(h.session(),h.a.ref,h.scope));assert.equal(readSummaryArtifacts(h.session()).filter(r=>r.type==='plugin:dafeiyu/summary-manifest').length,1);
});
test('tool calls, malformed outputs and aborted requests never commit a semantic view',async t=>{
  const h=await semanticFixture();t.after(h.close);const plan=h.plan();assert.ok(plan);
  for(const response of [()=>call('invented_tool',{}),()=>textReply('not JSON')]){
    h.setCompactionResponse(response);await assert.rejects(generateSummaryRewrite(h.session(),plan,h.provider,new AbortController().signal,h.validate));
  }
  const controller=new AbortController();controller.abort();await assert.rejects(generateSummaryRewrite(h.session(),plan,h.provider,controller.signal,h.validate));
  assert.ok(resolveFragmentView(h.session(),h.a.ref,h.scope));
});
test('source deletion during generation rejects the result and normal cleanup never restores the old view',async t=>{
  const h=await semanticFixture();t.after(h.close);const plan=h.plan();assert.ok(plan);
  h.setCompactionResponse(()=>{h.mutate(h.a.memory,'delete',1);return textReply(JSON.stringify({fragment:acceptedResult(plan.request).fragment}));});
  await assert.rejects(generateSummaryRewrite(h.session(),plan,h.provider,new AbortController().signal,h.validate),/conflict/);
  await h.run('删除后');assert.ok(!h.visible().includes('青羽842'));h.mutate(h.a.memory,'restore',2);await h.run('恢复');assert.ok(!h.visible().includes('青羽842'));
});
test('committed semantic summary survives restart; deletion and restoration cannot revive the source',async()=>{
  const h=await semanticFixture(),plan=h.plan();assert.ok(plan);const view=commitSummaryRewrite(h.ctx,h.session(),plan,acceptedResult(plan.request),h.validate);
  const root=h.root,ref=summaryReference(view.manifestSeq,view.manifest),a=h.a.memory;await h.ctx.sessions.flush(h.session());await h.close();
  const next=await provenanceFixture(root);try{await next.run('恢复运行');assert.match(next.visible(),/青羽842/);assert.ok(resolveFragmentView(next.session(),ref,a.scope));
    next.mutate(a,'delete',1);await next.run('删除');assert.ok(!next.visible().includes('青羽842'));next.mutate(a,'restore',2);await next.run('恢复来源');assert.ok(!next.visible().includes('青羽842'));
  }finally{await next.close();}
});
test('semantic plans enforce conversation, owner, current task, input budget and complete original exposure',async t=>{
  const h=await semanticFixture();t.after(h.close);const plan=h.plan();assert.ok(plan);
  for(const options of [{...plan.options,owner:'other'},{...plan.options,maxBytes:1}])assert.equal(prepareSummaryRewrite(h.session(),h.scope,h.a.ref,'G1','fusion',options,h.validate),null);
  assert.equal(prepareSummaryRewrite(h.session(),{...h.scope,route:'other'},h.a.ref,'G1','fusion',plan.options,h.validate),null);
  const task=await seedCheckpoint(h,raw,[{kind:'constraint',text:raw}],'current');
  assert.equal(prepareSummaryRewrite(h.session(),h.scope,task.ref,'G1','fusion',{...plan.options,protectedTaskId:'current'},h.validate),null);
  const bad=structuredClone(plan);bad.inputs=[];assert.throws(()=>buildRewriteManifest(h.session(),bad,acceptedResult(plan.request)));
});
test('rewriting one source group preserves unrelated history and other plugin areas',async t=>{
  const h=await semanticFixture();t.after(h.close);const b=await seedCheckpoint(h,'B_ONLY：尚未完成的独立资料。',[{kind:'pending',text:'B_ONLY：尚未完成的独立资料。'}]);
  const combined=compose(h,[h.a.view,b.view]),plan=h.plan(combined);assert.ok(plan);
  const view=commitSummaryRewrite(h.ctx,h.session(),plan,acceptedResult(plan.request),h.validate),ref=summaryReference(view.manifestSeq,view.manifest);
  h.ctx.systemPrompt.context({name:'semantic-native',order:1,required:true,text:'NATIVE_KEEP'});
  const ext=h.core.registerExtension({id:'semantic-other',version:'1',protocolVersion:4,agentId:'dafeiyu',contexts:[{id:'status',kind:'operational-fact',
    prepare:async()=>[{id:'status',version:'1',text:'OTHER_PLUGIN_KEEP',expiresAt:new Date(Date.now()+600000).toISOString(),sources:[{ref:'fictional:other',version:'1',hash:'test'}]}],validate:()=>true}]});t.after(()=>ext.dispose());
  h.mutate(h.a.memory,'delete',1);await h.run('继续');const after=resolveFragmentView(h.session(),ref,h.scope);assert.ok(after);assert.match(after.text,/B_ONLY/);assert.ok(!after.text.includes('青羽842'));
  assert.match(h.visible(),/NATIVE_KEEP/);assert.match(h.visible(),/OTHER_PLUGIN_KEEP/);
});
test('automatic semantic threshold path commits only a verified beneficial rewrite',async t=>{
  const h=await provenanceFixture(undefined,30000,{semanticEnabled:true,minGrowthTokens:0,cooldownMs:600000,maxSummaryChars:2000});t.after(h.close);await h.run('固定前缀');
  const a=await seedCheckpoint(h,raw,[{kind:'constraint',text:raw+'过程性赘述。'.repeat(150)},{kind:'pending',text:'尚未验收。'+'重复过程。'.repeat(150)}]);
  h.setCompactionResponse(r=>{
    const text=r.messages.at(-1)!.content.find(b=>b.type==='text');assert.ok(text?.type==='text');const body=JSON.parse(text.text);
    return textReply(JSON.stringify(body.stage==='generate'?{fragment:{kind:'constraint',text:body.qualifiers.map((q:{text:string})=>q.text).join('\n')}}:{compatible:true,faithful:true,issues:[]}));
  });
  await h.run('CURRENT_KEEP：'+'当前任务不能改动。'.repeat(2800));
  assert.ok(readCompactionEvents(h.session()).some(e=>e.type==='plugin:dafeiyu/compaction-check'&&e.data.status==='rewritten'),JSON.stringify(readCompactionEvents(h.session()).filter(e=>e.type==='plugin:dafeiyu/compaction-check')));
  assert.equal(resolveFragmentView(h.session(),a.ref,a.memory.scope),null);assert.match(h.visible(),/CURRENT_KEEP/);assert.match(h.visible(),/青羽842/);
});
test('rebuild of an invalid mixed group reads only independent valid originals, never the deleted mixed prose',async t=>{
  const h=await provenanceFixture();t.after(h.close);await h.run('固定前缀');
  const a=await h.remember('A_SECRET_DELETED：只属于虚构A，尚未确认。');
  const mixed=await seedCheckpoint(h,'B_SURVIVING_RAW：仅在测试环境使用，尚未验收。',[{kind:'note',text:'MIXED_PROSE_NEVER_READ：A_SECRET_DELETED 与 B_SURVIVING_RAW 的混合摘要。'}],null,1);
  h.mutate(a,'delete',1);await h.run('失效后继续');const parent=resolveFragmentView(h.session(),mixed.ref,a.scope);assert.ok(parent);assert.equal(parent.view.active.length,0);
  const policy=new MemorySourcePolicy(h.ctx,h.store,null,null,()=> 'test'),scope={...a.scope};
  const validate=(deps:readonly SourceDependency[])=>deps.every(d=>d.kind==='context'||policy.validate(scope,d));
  const plan=prepareSummaryRewrite(h.session(),scope,mixed.ref,'G1','rebuild',{owner:'memory',version:'test',protectedTaskId:null,maxChars:1000,maxBytes:65536,maxConsecutive:2},validate);assert.ok(plan);
  assert.equal(plan.request.sources.length,1);assert.deepEqual(plan.request.parents,[]);assert.ok(!JSON.stringify(plan.request).includes('A_SECRET_DELETED'));assert.ok(!JSON.stringify(plan.request).includes('MIXED_PROSE_NEVER_READ'));
  h.setCompactionResponse(scriptedSemantic);const provider=new MemoryCompaction(h.ctx,{inputTokens:1000000},()=>({epoch:'test',taskId:null,versions:{}}),policy);
  const result=await generateSummaryRewrite(h.session(),plan,provider,new AbortController().signal,validate),view=commitSummaryRewrite(h.ctx,h.session(),plan,result,validate);
  assert.match(view.text,/B_SURVIVING_RAW/);assert.ok(!view.text.includes('A_SECRET_DELETED'));
  await h.run('重建后');assert.match(h.visible(),/B_SURVIVING_RAW/);h.mutate(a,'restore',2);await h.run('恢复A后');assert.ok(!h.visible().includes('A_SECRET_DELETED'));
});
test('a fully withdrawn valid group cannot be resurrected through the rebuild entry',async t=>{
  const h=await semanticFixture();t.after(h.close);await h.memoryFiber.dispose();await h.run('插件退出');
  const view=resolveFragmentView(h.session(),h.a.ref,h.scope);assert.ok(view);assert.equal(view.view.active.length,0);
  assert.equal(h.plan(view,'rebuild'),null);
});
test('unrelated source changes during verification do not reject a valid rewrite',async t=>{
  const h=await semanticFixture();t.after(h.close);const unrelated=h.rememberUnseen('未暴露的虚构旁支',h.a.memory),plan=h.plan();assert.ok(plan);
  h.setCompactionResponse(r=>{if(String(r.sessionId).includes('-verify-'))h.store.mutate(h.scope,{action:'delete',id:unrelated.id,expectedVersion:1,requestId:randomUUID(),reason:'无关变动'});return scriptedSemantic(r);});
  const result=await generateSummaryRewrite(h.session(),plan,h.provider,new AbortController().signal,h.validate);
  const view=commitSummaryRewrite(h.ctx,h.session(),plan,result,h.validate);assert.match(view.text,/青羽842/);
});
test('semantic proof tampering is rejected after commit without restoring replaced parents',async t=>{
  const h=await semanticFixture();t.after(h.close);const plan=h.plan();assert.ok(plan);const manifest=buildRewriteManifest(h.session(),plan,acceptedResult(plan.request));
  manifest.rewrite!.inputs=[];const session=h.session(),seq=plan.parent.checkpoint.seq;
  const manifestSeq=appendPluginRecord(session,'plugin:dafeiyu/summary-manifest',manifest),active=manifest.fragments.map(f=>f.id),text=renderFragmentView(manifestSeq,manifest,active);
  const v=appendPluginRecord(session,'plugin:dafeiyu/summary-view',{schemaVersion:1,manifestSeq,revision:1,previousViewSeq:null,previousCheckpointSeq:null,active,contentHash:digestSource(text)});
  session.append('compaction/prune',{shadowedRange:{start:seq,end:seq},shadowedSeqs:[seq],shadowedTokenCount:0});
  session.append('user/message',createUserMessage({source:{kind:'dafeiyu-summary-view',compactionId:manifest.compactionId},content:[{type:'text',text}]}),{surfaceOp:{op:'replace',startSeq:seq,endSeq:seq},sourceEventSeqs:[seq,manifestSeq,v]});
  assert.equal(resolveFragmentProof(session,summaryReference(manifestSeq,manifest),h.scope),null);
});
test('rewritten proof rejects shifted anchors and a source version change before commit',async t=>{
  const h=await semanticFixture();t.after(h.close);const plan=h.plan();assert.ok(plan);const result=acceptedResult(plan.request),bad=structuredClone(result);bad.qualifiers[0]!.start++;
  assert.throws(()=>buildRewriteManifest(h.session(),plan,bad),/qualifier/);
  h.store.mutate(h.a.memory.scope,{action:'revise',id:h.a.memory.memory.id,expectedVersion:1,requestId:randomUUID(),value:{kind:'knowledge',claimType:'self_report',content:'更正后的虚构内容',sources:[...h.a.memory.memory.sources]}});
  assert.throws(()=>commitSummaryRewrite(h.ctx,h.session(),plan,result,h.validate),/conflict/);
});
test('an orphan verified rewrite manifest cannot replace a parent on restart',async()=>{
  const h=await semanticFixture(),plan=h.plan();assert.ok(plan);const root=h.root,ref=h.a.ref,scope=h.scope;
  const manifest=buildRewriteManifest(h.session(),plan,acceptedResult(plan.request)),m=appendPluginRecord(h.session(),'plugin:dafeiyu/summary-manifest',manifest);
  const active=manifest.fragments.map(f=>f.id);
  appendPluginRecord(h.session(),'plugin:dafeiyu/summary-view',{schemaVersion:1,manifestSeq:m,revision:1,previousViewSeq:null,previousCheckpointSeq:null,active,contentHash:digestSource(renderFragmentView(m,manifest,active))});
  await h.ctx.sessions.flush(h.session());await h.close();const next=await provenanceFixture(root);
  try{await next.run('重启准备阶段');assert.ok(resolveFragmentView(next.session(),ref,scope));assert.equal(resolveFragmentView(next.session(),summaryReference(m,manifest),scope),null);assert.match(next.visible(),/青羽842/);}
  finally{await next.close();}
});
test('live source change during verification blocks commit even when generation was valid',async t=>{
  const h=await semanticFixture();t.after(h.close);const plan=h.plan();assert.ok(plan);
  h.setCompactionResponse(r=>{if(String(r.sessionId).includes('-verify-'))h.mutate(h.a.memory,'delete',1);return scriptedSemantic(r);});
  await assert.rejects(generateSummaryRewrite(h.session(),plan,h.provider,new AbortController().signal,h.validate),/conflict/);
  await h.run('来源已删除');assert.ok(!h.visible().includes('青羽842'));
});
test('verified but non-beneficial rewrite leaves the original valid view selected',async t=>{
  const h=await provenanceFixture(undefined,30000,{semanticEnabled:true,minGrowthTokens:0,cooldownMs:600000,maxSummaryChars:2000});t.after(h.close);await h.run('固定前缀');
  const a=await seedCheckpoint(h,raw,[{kind:'constraint',text:raw},{kind:'pending',text:'尚未验收。'}]);
  h.setCompactionResponse(r=>{const text=r.messages.at(-1)!.content.find(b=>b.type==='text');assert.ok(text?.type==='text');const body=JSON.parse(text.text);
    return textReply(JSON.stringify(body.stage==='generate'?{fragment:{kind:'constraint',text:raw+'重复过程性说明。'.repeat(100)}}:{compatible:true,faithful:true,issues:[]}));});
  await h.run('CURRENT_KEEP：'+'当前任务不能改动。'.repeat(2800));
  assert.ok(readCompactionEvents(h.session()).some(e=>e.type==='plugin:dafeiyu/compaction-check'&&e.data.status==='rewrite-no-benefit'));
  assert.ok(resolveFragmentView(h.session(),a.ref,a.memory.scope));assert.equal(readSummaryArtifacts(h.session()).filter(e=>e.type==='plugin:dafeiyu/summary-manifest'&&e.data.rewrite).length,0);
});
test('semantic checkpoint flush failure blocks the chat model and recovers without duplicate rewrite',async t=>{
  const h=await provenanceFixture(undefined,30000,{semanticEnabled:true,minGrowthTokens:0,cooldownMs:600000,maxSummaryChars:2000});t.after(h.close);await h.run('固定前缀');
  await seedCheckpoint(h,raw,[{kind:'constraint',text:raw+'过程性赘述。'.repeat(150)},{kind:'pending',text:'尚未验收。'+'重复过程。'.repeat(150)}]);h.setCompactionResponse(scriptedSemantic);
  const persistence=h.ctx.sessions,flush=persistence.flush.bind(persistence),before=h.adapter.requests.filter(r=>r.purpose!=='compaction').length;
  persistence.flush=async()=>false;
  try{h.setResponse(()=>textReply('MUST_NOT_SEND'));const receipt=h.simulator.send('a','CURRENT_KEEP：'+'当前任务不能改动。'.repeat(2800),{id:randomUUID()});await h.core.whenIdle();
    assert.equal(h.core.journal.get(receipt.id).state,'failed');assert.equal(h.adapter.requests.filter(r=>r.purpose!=='compaction').length,before);
  }finally{persistence.flush=flush;}
  await h.run('恢复持久化');assert.match(h.visible(),/青羽842/);assert.equal(readSummaryArtifacts(h.session()).filter(e=>e.type==='plugin:dafeiyu/summary-manifest'&&e.data.rewrite).length,1);
});
test('an output-token-limited response is never accepted even when its visible JSON is complete',async t=>{
  const h=await semanticFixture();t.after(h.close);const plan=h.plan();assert.ok(plan);
  h.setCompactionResponse(()=>[...textReply(JSON.stringify({fragment:acceptedResult(plan.request).fragment})).slice(0,-1),{type:'finish',reason:{kind:'max-tokens'}}]);
  await assert.rejects(generateSummaryRewrite(h.session(),plan,h.provider,new AbortController().signal,h.validate),/incomplete \(max-tokens\)/);
  assert.ok(resolveFragmentView(h.session(),h.a.ref,h.scope));
});
test('auxiliary input budget includes qualifier copies and prompts, not only original source bytes',async t=>{
  const h=await semanticFixture();t.after(h.close);const plan=h.plan();assert.ok(plan);const before=h.adapter.requests.length;
  const provider=new MemoryCompaction(h.ctx,{inputTokens:30000,maxSourceBytes:2048},h.provider.basis,h.provider.sources);
  await assert.rejects(generateSummaryRewrite(h.session(),plan,provider,new AbortController().signal,h.validate),/input capacity/);
  assert.equal(h.adapter.requests.length,before);
});
