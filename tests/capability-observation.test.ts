import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { capabilityFixture,capabilityScene } from './capability-observation-fixture.js';
import { call,textReply } from './harness.js';

function memoryRows(root:string){const db=new DatabaseSync(join(root,'memory','memory.sqlite'),{readOnly:true});try{return {
  memories:db.prepare('SELECT i.route,r.body,b.body AS boundary FROM memory_items i JOIN memory_revisions r ON r.id=i.id JOIN memory_boundaries b ON b.id=i.id').all(),
  observations:db.prepare('SELECT body FROM capability_observations').all(),decisions:db.prepare('SELECT receipt FROM capability_selections').all(),
};}finally{db.close();}}
function script(h:Awaited<ReturnType<typeof capabilityFixture>>,mode:'none'|'original'|'fragment'|'summary',repeat=false){let step=0;h.setResponse(()=>{
  if(++step===1)return call('qq_browse',{requestId:'browse'});
  if(step===2||repeat&&step===3)return call('qq_observe_select',{requestId:'choose',observationId:h.source().id,version:1,mode,reason:'虚构选择',...(mode==='summary'?{text:'摘要：虚构资料尚未核实。'}:mode==='fragment'?{start:0,end:16}:{})});
  return textReply('只报告实际选择结果');
});}

for(const mode of ['none','original','fragment','summary'] as const)test(`scoped ${mode} selection keeps observation metadata separate from selected memory`,async t=>{
  const h=await capabilityFixture();t.after(h.close);script(h,mode,true);const outcome=await h.chat();assert.equal(outcome.state,'delivered');
  const rows=memoryRows(h.root);assert.equal(rows.decisions.length,1);assert.equal(h.receipts.length,2);assert.equal(h.receipts[1]?.duplicate,true);
  const events=h.core.journal.events(outcome.route);for(const event of events.filter(event=>event.type==='capability.observation.prepared')){
    const parent=events.find(candidate=>candidate.id===event.causedBy);assert.ok(parent&&parent.type==='operation.started'&&parent.seq<event.seq);
  }
  assert.equal(rows.memories.length,mode==='none'?0:1);assert.ok(!JSON.stringify(rows.observations).includes('QQ_RAW_VIEW_SENTINEL'));
  if(mode!=='none'){const body=JSON.parse(String(rows.memories[0]!.body)),boundary=JSON.parse(String(rows.memories[0]!.boundary));
    assert.equal(body.content,mode==='original'?h.view:mode==='fragment'?Array.from(h.view).slice(0,16).join(''):'摘要：虚构资料尚未核实。');assert.equal(body.claimType,mode==='summary'?'inference':'reported_claim');assert.equal(boundary.externalExpression.kind,'conversation');}
});

test('conversation capabilities reject foreign resources and cloned or expired invocation contexts',async t=>{
  const h=await capabilityFixture();t.after(h.close);let step=0;h.setResponse(()=>++step===1?call('qq_browse',{requestId:'foreign',scene:capabilityScene}):textReply('未获授权'));
  await h.chat('b');assert.equal(h.state.reads,0);assert.equal(memoryRows(h.root).observations.length,0);
  assert.throws(()=>h.core.authorizeCapabilityResource({...h.captured()},'fixture-observer',capabilityScene),/SCOPE_DENIED/);
  assert.throws(()=>h.core.authorizeCapabilityResource(h.captured(),'fixture-observer',capabilityScene),/SCOPE_DENIED/);
});

test('without actual source tracking a cached identifier cannot claim model exposure or create a memory',async t=>{
  const h=await capabilityFixture(false);t.after(h.close);script(h,'summary');await h.chat();assert.equal(h.receipts.length,0);assert.equal(memoryRows(h.root).memories.length,0);
  assert.match(JSON.stringify(h.adapter.requests),/OBSERVATION_NOT_EXPOSED/);
});

test('native resource use keeps its real Task origin and creates only task-internal memory',async t=>{
  const h=await capabilityFixture();t.after(h.close);script(h,'summary');const port=h.core.executionProducer('fixture-native'),run=port.submitTask({requestId:'native-one',title:'虚构观察',goal:'读取获准虚构资料并选择摘要',policyId:'native'});
  await h.core.whenIdle();assert.equal(port.status(run.run).state,'completed');assert.equal(h.core.journal.list().length,0);assert.equal(h.receipts.length,1);
  const row=memoryRows(h.root).memories[0]!;assert.ok(row);const boundary=JSON.parse(String(row.boundary));assert.equal(boundary.schemaVersion,2);assert.equal(boundary.externalExpression.kind,'none');assert.equal(boundary.task.id,run.task.id);
  assert.equal(h.captured().origin.kind,'native');assert.equal(h.captured().scope.kind,'task');
});

test('source changes retire browsed tool contents and selected memory instead of reviving old proofs',async t=>{
  const h=await capabilityFixture();t.after(h.close);script(h,'original');await h.chat();assert.equal(memoryRows(h.root).memories.length,1);
  h.state.valid=false;h.state.version++;
  let step=0;h.setResponse(()=>++step===1?call('dafeiyu_memory_search',{query:'QQ_RAW',limit:'5'}):textReply('旧来源不可用'));
  await h.chat('a','查询旧记忆是否仍可用');const latest=JSON.stringify(h.adapter.requests.at(-1));assert.ok(!latest.includes('QQ_RAW_VIEW_SENTINEL'));assert.match(latest,/\\?"items\\?":\s*\[\]/);
});

test('live invocation grants reject cloned contexts and borrowing another plugin identity',async t=>{
  const h=await capabilityFixture();t.after(h.close);let checked=false;
  h.setReadHook(context=>{assert.throws(()=>h.core.authorizeCapabilityResource({...context},'fixture-observer',capabilityScene),/SCOPE_DENIED/);
    assert.throws(()=>h.core.authorizeCapabilityResource(context,'other-plugin',capabilityScene),/SCOPE_DENIED/);
    assert.deepEqual(h.core.authorizeCapabilityResource(context,'fixture-observer',capabilityScene),capabilityScene);checked=true;});
  script(h,'none');await h.chat();assert.equal(checked,true);assert.equal(h.receipts.length,1);
});

test('native tasks cannot fetch outside their resource policy or select another task observation',async t=>{
  const h=await capabilityFixture();t.after(h.close);const port=h.core.executionProducer('fixture-native');let step=0;
  h.setResponse(()=>++step===1?call('qq_browse',{requestId:'denied',scene:{...capabilityScene,id:'b'}}):textReply('无权限'));
  const denied=port.submitTask({requestId:'denied',title:'无权限',goal:'虚构范围测试',policyId:'native'});await h.core.whenIdle();assert.equal(h.state.reads,0);assert.equal(port.status(denied.run).operations[0]?.status,'failed');
  script(h,'none');port.submitTask({requestId:'first',title:'任务A',goal:'读取但不记忆',policyId:'native'});await h.core.whenIdle();const foreign=h.source();
  step=0;h.setResponse(()=>++step===1?call('qq_observe_select',{requestId:'stolen',observationId:foreign.id,version:1,mode:'original',reason:'跨任务猜测'}):textReply('失败'));
  const stolen=port.submitTask({requestId:'second',title:'任务B',goal:'不能借用其它任务来源',policyId:'native'});await h.core.whenIdle();assert.equal(port.status(stolen.run).operations[0]?.status,'failed');assert.equal(memoryRows(h.root).memories.length,0);
});

test('unloading a source provider makes its stored observations and memories unavailable',async t=>{
  const h=await capabilityFixture();t.after(h.close);script(h,'original');await h.chat();h.unload();
  let step=0;h.setResponse(()=>++step===1?call('dafeiyu_memory_search',{query:'QQ_RAW',limit:'5'}):textReply('来源服务已卸载'));
  await h.chat();const latest=JSON.stringify(h.adapter.requests.at(-1));assert.ok(!latest.includes('QQ_RAW_VIEW_SENTINEL'));assert.match(latest,/\\?"items\\?":\s*\[\]/);
});

test('summaries retain actually read memory dependencies; deletion blocks reimport and restore does not revive the old summary',async t=>{
  const h=await capabilityFixture();t.after(h.close);script(h,'original');await h.chat();const original=h.receipts[0]?.memory as {id:string};let step=0;
  h.setResponse(()=>{switch(++step){case 1:return call('dafeiyu_memory_open',{id:original.id});case 2:return call('qq_browse',{requestId:'for-summary'});
    case 3:return call('qq_observe_select',{requestId:'summary-with-history',observationId:h.source().id,version:1,mode:'summary',text:'历史依赖摘要',reason:'检查实际输入'});default:return textReply('已保存');}});
  await h.chat();assert.equal(memoryRows(h.root).memories.length,2);assert.ok(memoryRows(h.root).observations.some(row=>{const body=JSON.parse(String(row.body));return body.kind==='selected'&&body.selection.mode==='summary'&&body.history.some((dep:{kind:string;id?:string})=>dep.kind==='memory'&&dep.id===original.id);}));
  step=0;h.setResponse(()=>++step===1?call('dafeiyu_memory_delete',{requestId:'delete',id:original.id,expectedVersion:'1',reason:'虚构遗忘'}):textReply('删除完成'));await h.chat();
  step=0;h.setResponse(()=>++step===1?call('qq_browse',{requestId:'reread'}):step===2?call('qq_observe_select',{requestId:'reimport',observationId:h.source().id,version:1,mode:'original',reason:'不得自动复活'}):textReply('未重建'));
  await h.chat();assert.equal(memoryRows(h.root).memories.length,2);assert.match(JSON.stringify(h.adapter.requests.at(-1)),/SOURCE_SUPPRESSED/);
  step=0;h.setResponse(()=>++step===1?call('dafeiyu_memory_restore',{requestId:'restore',id:original.id,expectedVersion:'2',reason:'明确恢复原记忆'}):step===2?call('dafeiyu_memory_search',{query:'历史依赖摘要',limit:'5'}):textReply('旧摘要仍需重新形成'));
  await h.chat();assert.match(JSON.stringify(h.adapter.requests.at(-1)),/\\?"items\\?":\s*\[\]/);
});

test('an uncertain local write in one conversation does not freeze unrelated conversation writes',async t=>{
  const h=await capabilityFixture();t.after(h.close);h.state.throwSelect=true;script(h,'none');await h.chat('a');h.state.throwSelect=false;
  script(h,'none');await h.chat('b');assert.equal(h.receipts.length,1);assert.equal(h.receipts[0]?.mode,'none');
});
