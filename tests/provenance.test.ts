import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readProvenance } from '@dafeiyu/core';
import { provenanceFixture } from './provenance-fixture.js';
import { textReply } from './harness.js';
import { WorkingStore } from '../packages/memory/lib/working-store.js';
import { join } from 'node:path';
import { CompactionId,compactCheckpointSource } from '@deepseek-ai/dsh-compaction';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import type {} from '@deepseek-ai/dsh-compaction/types';
import { checkpointProof } from './summary-proof.js';
import {MemorySourcePolicy} from '../packages/memory/lib/source-policy.js';

declare module '@deepseek-ai/dsh-llm' { interface MessageSourceMap {
  'provenance-test-barrier':{kind:'provenance-test-barrier'};
} }

test('current-inbound task acceptance receipts survive unrelated child memory changes without becoming reusable evidence',async t=>{
  const h=await provenanceFixture();t.after(h.close);let epoch='before';const policy=new MemorySourcePolicy(h.ctx,h.store,null),scope={agentId:'dafeiyu',route:'fixture-route',traceId:'current-inbound'};
  const text=JSON.stringify({status:'succeeded',effects:'confirmed',completeness:'complete',data:{task:{id:randomUUID()},run:{id:randomUUID()},state:'accepted'},sources:[],receipts:[]});
  for(const name of ['qq_task_submit','qq_explore','local_owner_task_submit']){const refs=policy.tool(scope,name,text,null);assert.ok(refs.length);epoch='after-child-write';assert.ok(refs.every(ref=>policy.validate(scope,ref)));assert.ok(refs.every(ref=>!policy.validate({...scope,traceId:'later-inbound'},ref)));}
});

test('delete A retires dependent answers but preserves independent B history and later user input byte-for-byte',async t=>{
  const h=await provenanceFixture();t.after(h.close);
  const b=await h.remember('B_SOURCE_独立文件路径');await h.select([b.memory],0);await h.run('请记录B任务','B_ANSWER_KEEP');
  const before=h.session().deriveMessages().find(m=>JSON.stringify(m.content).includes('B_ANSWER_KEEP'));assert.ok(before);
  const a=await h.remember('A_SOURCE_虚构命名');await h.select([a.memory],1);await h.run('请记录A任务','A_ANSWER_REMOVE');
  await h.run('B_LATER_USER_INPUT_KEEP','MIXED_ANSWER_REMOVE');
  h.mutate(a,'delete',1);await h.run('继续有效任务');
  assert.match(h.visible(),/B_ANSWER_KEEP/);assert.match(h.visible(),/B_LATER_USER_INPUT_KEEP/);
  assert.ok(!h.visible().includes('A_ANSWER_REMOVE'));assert.ok(!h.visible().includes('MIXED_ANSWER_REMOVE'));
  assert.deepEqual(h.session().deriveMessages().find(m=>m.id===before.id),before);
  assert.ok(JSON.stringify(h.session().snapshotEvents()).includes('A_ANSWER_REMOVE'));
});

test('recorded exposure includes all admitted inputs, even when the answer claims to cite only B',async t=>{
  const h=await provenanceFixture();t.after(h.close);const a=await h.remember('A_SOURCE'),b=await h.remember('B_SOURCE');
  await h.select([a.memory,b.memory],0);await h.run('回答这个问题','我只引用B：FAKE_NARROW_CITATION');
  const records=readProvenance(h.session());const answer=h.session().snapshotEvents().find(e=>e.type==='assistant/message'&&JSON.stringify(e.data.message.content).includes('FAKE_NARROW_CITATION'));assert.ok(answer);
  const record=records.find(e=>e.type==='plugin:dafeiyu/source-record'&&e.data.targetSeq===answer.seq);assert.ok(record&&record.type==='plugin:dafeiyu/source-record');
  assert.ok(record.data.dependencies.some(d=>d.kind==='memory'&&d.id===a.memory.id));assert.ok(record.data.dependencies.some(d=>d.kind==='memory'&&d.id===b.memory.id));
  h.mutate(a,'delete',1);await h.run('继续');assert.ok(!h.visible().includes('FAKE_NARROW_CITATION'));
});

test('selection changes do not invalidate history whose sources remain valid',async t=>{
  const h=await provenanceFixture();t.after(h.close);const b=await h.remember('B_SOURCE');await h.select([b.memory],0);await h.run('旧任务','ANSWER_AFTER_DESELECT_KEEP');
  await h.select([],1);await h.run('新任务');assert.match(h.visible(),/ANSWER_AFTER_DESELECT_KEEP/);
});

test('source restore does not resurrect old answers or old selection after a deletion between requests',async t=>{
  const h=await provenanceFixture();t.after(h.close);const a=await h.remember('A_SOURCE');await h.select([a.memory],0);await h.run('原约定','OLD_ANSWER_NO_REVIVE');
  h.mutate(a,'delete',1);h.mutate(a,'restore',2);await h.run('恢复后继续');assert.ok(!h.visible().includes('OLD_ANSWER_NO_REVIVE'));
  const surface=JSON.stringify(h.session().deriveMessages());assert.ok(!surface.includes('A_SOURCE'));
});

test('changing a sibling working item preserves the original item version and its admitted history',async t=>{
  const h=await provenanceFixture();t.after(h.close);const a=await h.remember('A_WORK_SOURCE'),b=await h.remember('B_WORK_SOURCE');
  const set=async(version:number,items:unknown[])=>h.invoke('dafeiyu_memory_working_set',{requestId:randomUUID(),expectedVersion:String(version),taskId:'task',expiresAt:new Date(Date.now()+600000).toISOString(),items:JSON.stringify(items)});
  const item={id:'b',category:'goal',text:'B_GOAL_KEEP',sourceRefs:[b.evidence.ref]};
  await set(0,[item]);await h.run('B任务','B_WORK_ANSWER_KEEP');
  await set(1,[item,{id:'a',category:'pending',text:'A_PENDING',sourceRefs:[a.evidence.ref]}]);await h.run('继续B');
  assert.match(h.visible(),/B_WORK_ANSWER_KEEP/);
  const dependencies=readProvenance(h.session()).filter(e=>e.type==='plugin:dafeiyu/source-record').flatMap(e=>e.data.dependencies).filter(d=>d.kind==='working'&&d.id==='b');
  assert.ok(dependencies.length);assert.ok(dependencies.every(d=>d.kind==='working'&&d.revision===1));
});

test('restoring an ancestor cannot reactivate an old child evidence selection',async t=>{
  const h=await provenanceFixture();t.after(h.close);const parent=await h.remember('PARENT_SOURCE'),child=await h.remember('CHILD_DERIVED','a',parent.memory);
  await h.select([child.memory],0);await h.run('子记忆','CHILD_ANSWER');h.mutate(parent,'delete',1);h.mutate(parent,'restore',2);await h.run('继续');
  assert.ok(!h.visible().includes('CHILD_ANSWER'));
  const carrier=h.session().deriveMessages().filter(m=>m.role==='user'&&m.source.kind==='runtime-context');
  assert.ok(!JSON.stringify(carrier).includes('CHILD_DERIVED'));
});

test('an unrelated source mutation during dispatch does not cancel an answer with valid inputs',async t=>{
  const h=await provenanceFixture();t.after(h.close);
  const a=await h.remember('A_UNSEEN_SOURCE','other'),b=await h.remember('B_USED_SOURCE');await h.select([b.memory],0);
  // A memory in the same scope, backed by an immutable event not visible in this request.
  const unrelated=h.rememberUnseen('UNEXPOSED',b);
  h.setResponse(()=>{h.store.mutate(b.scope,{action:'delete',requestId:randomUUID(),id:unrelated.id,expectedVersion:1,reason:'无关变更'});return textReply('VALID_AFTER_UNRELATED_CHANGE');});
  const receipt=h.simulator.send('a','继续B',{id:randomUUID()});await h.core.whenIdle();assert.equal(h.core.journal.get(receipt.id).state,'delivered');
  assert.ok(a.memory.id);
});

test('provenance survives restart and invalid derived sources cannot be opened through timeline',async()=>{
  let h=await provenanceFixture();const root=h.root;const b=await h.remember('B_SOURCE');await h.select([b.memory],0);await h.run('B任务','B_RESTART_KEEP');
  const a=await h.remember('A_SOURCE');await h.select([a.memory],1);await h.run('A任务','A_RESTART_REMOVE');
  const answer=h.session().snapshotEvents().find(e=>e.type==='assistant/message'&&JSON.stringify(e.data.message.content).includes('A_RESTART_REMOVE'));assert.ok(answer);
  const anchor=h.core.journal.events(a.scope.route).find(e=>e.sources.some(s=>s.kind==='session'&&s.seq===answer.seq));assert.ok(anchor);
  const index=anchor.sources.findIndex(s=>s.kind==='session'&&s.seq===answer.seq);h.mutate(a,'delete',1);await h.close();
  h=await provenanceFixture(root);try{await h.run('重启继续');assert.match(h.visible(),/B_RESTART_KEEP/);assert.ok(!h.visible().includes('A_RESTART_REMOVE'));
    const result=await h.probe('a',c=>h.timeline.open(c,{ref:`dafeiyu:source:${anchor.id}:${index}`}));assert.equal(result.status,'not_exported');
  }finally{await h.close();}
});

test('fine-grained summary checkpoints keep independent B while withdrawing A and all inherited A exposure',async t=>{
  const h=await provenanceFixture(undefined,5000);t.after(h.close);
  const b=await h.remember('B_SUMMARY_SOURCE');await h.select([b.memory],0);
  for(let i=0;i<5;i++)await h.run(`B阶段${i}：`+'虚构蓝色纸船尚未验证。'.repeat(200),'B阶段记录');
  const checkpoints=()=>h.session().deriveMessages().flatMap(m=>m.role==='user'&&(m.source.kind==='compact-checkpoint'||m.source.kind==='dafeiyu-summary-view')
    ?[{id:m.id,data:checkpointProof(h.session(),m)}]:[]);
  const independent=checkpoints().map(c=>c.data);assert.ok(independent.length);
  const a=await h.remember('A_SUMMARY_SOURCE');await h.select([a.memory],1);
  for(let i=0;i<5;i++)await h.run(`A阶段${i}：`+'虚构后续检查尚未确认。'.repeat(200),'A阶段记录');
  const dependent=checkpoints().filter(c=>c.data.dependencies.some((d:{kind:string;id?:string;hash?:string})=>d.kind==='memory'&&d.id===a.memory.id||d.hash===a.memory.sources[0]!.contentHash)).map(c=>c.id);
  assert.ok(dependent.length);h.mutate(a,'delete',1);await h.run('继续有效部分');
  const surviving=checkpoints();
  // C3-A may replace the container; independently grounded content and original closure survive.
  const survivingSources=new Set(surviving.flatMap(c=>c.data.sources.map(s=>JSON.stringify(s))));
  assert.ok(independent.every(proof=>proof.sources.every(s=>survivingSources.has(JSON.stringify(s)))));
  assert.ok(independent.every(proof=>proof.summary.split('\n').every(text=>surviving.some(c=>c.data.summary.includes(text)))));
  assert.ok(dependent.every(id=>!surviving.some(c=>c.id===id)));
  assert.ok(surviving.every(c=>!c.data.dependencies.some(d=>d.kind==='memory'&&d.id===a.memory.id||'hash' in d&&d.hash===a.memory.sources[0]!.contentHash)));
  h.mutate(a,'restore',2);await h.run('恢复后继续');assert.ok(dependent.every(id=>!checkpoints().some(c=>c.id===id)));
});

test('unrelated mutation during auxiliary summary generation does not reject a valid selected span',async t=>{
  const h=await provenanceFixture(undefined,5000);t.after(h.close);const b=await h.remember('B_SOURCE');const unrelated=h.rememberUnseen('UNSEEN_A',b);let changed=false;
  h.setCompactionResponse(()=>{if(!changed){changed=true;h.store.mutate(b.scope,{action:'delete',id:unrelated.id,expectedVersion:1,requestId:randomUUID(),reason:'无关来源变更'});}return textReply(JSON.stringify({fragments:[{kind:'note',text:'SUMMARY_SURVIVES_UNRELATED_MUTATION'}]}));});
  for(let i=0;i<5;i++)await h.run(`阶段${i}：`+'虚构纸船待检验。'.repeat(250));
  assert.ok(changed);assert.match(h.visible(),/SUMMARY_SURVIVES_UNRELATED_MUTATION/);
});

test('revision changes invalidate related branches without withdrawing independent history',async t=>{
  const h=await provenanceFixture();t.after(h.close);const b=await h.remember('B_SOURCE');await h.select([b.memory],0);await h.run('B任务','B_AFTER_REVISION_KEEP');
  const a=await h.remember('A_OLD_SOURCE');await h.select([a.memory],1);await h.run('A任务','A_BEFORE_REVISION_REMOVE');
  h.store.mutate(a.scope,{action:'revise',requestId:randomUUID(),id:a.memory.id,expectedVersion:1,value:{kind:'knowledge',claimType:'self_report',content:'A_NEW_VALUE',sources:[...a.memory.sources]}});
  await h.run('修订后继续');assert.match(h.visible(),/B_AFTER_REVISION_KEEP/);assert.ok(!h.visible().includes('A_BEFORE_REVISION_REMOVE'));
});

test('working item removal and re-addition cannot reactivate old dependent answers',async t=>{
  const h=await provenanceFixture();t.after(h.close);const b=await h.remember('B_SOURCE');
  const item={id:'goal',category:'goal',text:'OLD_WORK_ITEM',sourceRefs:[b.evidence.ref]};
  const set=(version:number,items:unknown[])=>h.invoke('dafeiyu_memory_working_set',{requestId:randomUUID(),expectedVersion:String(version),taskId:'task',expiresAt:new Date(Date.now()+600000).toISOString(),items:JSON.stringify(items)});
  await set(0,[item]);await h.run('旧任务','OLD_WORK_ANSWER');await set(1,[]);await set(2,[item]);await h.run('新任务');assert.ok(!h.visible().includes('OLD_WORK_ANSWER'));
});

test('same message identifiers in different conversations cannot cross source or summary visibility',async t=>{
  const h=await provenanceFixture();t.after(h.close);
  h.setResponse(()=>textReply('A_REPLY'));const a=h.simulator.send('a','A_PRIVATE_SOURCE',{id:'same-platform-id'});await h.core.whenIdle();
  h.setResponse(()=>textReply('B_REPLY'));const b=h.simulator.send('b','B_PRIVATE_SOURCE',{id:'same-platform-id'});await h.core.whenIdle();
  assert.equal(h.core.journal.get(a.id).state,'delivered');assert.equal(h.core.journal.get(b.id).state,'delivered');assert.ok(!h.visible().includes('A_PRIVATE_SOURCE'));
  const memory=await h.remember('ONLY_A_MEMORY');await h.invoke('dafeiyu_memory_open',{id:memory.memory.id},'b');assert.ok(!h.visible().includes('ONLY_A_MEMORY'));
});

test('identical content hashes from distinct source messages do not couple independent memory branches',async t=>{
  const h=await provenanceFixture();t.after(h.close);const b=await h.remember('IDENTICAL_FICTIONAL_SOURCE');await h.select([b.memory],0);await h.run('B任务','B_IDENTICAL_KEEP');
  const a=await h.remember('IDENTICAL_FICTIONAL_SOURCE');assert.equal(a.memory.sources[0]!.contentHash,b.memory.sources[0]!.contentHash);
  assert.notEqual(a.evidence.message.message.id,b.evidence.message.message.id);await h.select([a.memory],1);await h.run('A任务','A_IDENTICAL_REMOVE');
  h.mutate(a,'delete',1);await h.run('继续');assert.match(h.visible(),/B_IDENTICAL_KEEP/);assert.ok(!h.visible().includes('A_IDENTICAL_REMOVE'));
  await h.select([b.memory],2);assert.ok(h.visible().includes('IDENTICAL_FICTIONAL_SOURCE'));
});

test('legacy working entries without captured source proofs stay archived until explicit refresh',async t=>{
  const h=await provenanceFixture();t.after(h.close);const a=await h.remember('LEGACY_SOURCE');const work=new WorkingStore(join(h.root,'working.sqlite'));
  try{work.write(a.scope,randomUUID(),0,{kind:'working',version:0,taskId:'legacy',expiresAt:new Date(Date.now()+600000).toISOString(),items:[{
    id:'legacy',category:'goal',text:'UNPROVEN_LEGACY_WORK',sources:[{evidence:{kind:'memory',id:a.memory.id,revision:1,contentHash:a.memory.contentHash},version:1}],
  }]});}finally{work.close();}
  await h.run('新任务');assert.ok(!h.visible().includes('UNPROVEN_LEGACY_WORK'));
  await h.invoke('dafeiyu_memory_working_set',{requestId:randomUUID(),expectedVersion:'1',taskId:'legacy',expiresAt:new Date(Date.now()+600000).toISOString(),
    items:JSON.stringify([{id:'legacy',category:'goal',text:'FRESH_VALID_WORK',sourceRefs:[a.memory.ref]}])});assert.match(h.visible(),/FRESH_VALID_WORK/);
});

test('normal memory tools cannot launder a suppressed original source through another memory record',async t=>{
  const h=await provenanceFixture();t.after(h.close);const a=await h.remember('SHARED_ORIGINAL');
  const sibling=h.store.mutate(a.scope,{action:'create',requestId:randomUUID(),value:{kind:'knowledge',claimType:'self_report',content:'SIBLING_BODY_MUST_NOT_REENTER',sources:[...a.memory.sources]}});
  h.mutate(a,'delete',1);await h.run('删除后继续');
  await h.invoke('dafeiyu_memory_open',{id:sibling.id});assert.ok(!h.visible().includes('SIBLING_BODY_MUST_NOT_REENTER'));
  assert.ok(JSON.stringify(h.session().snapshotEvents()).includes('SIBLING_BODY_MUST_NOT_REENTER'));
});

test('invalidity of a mixed descendant never flows backwards into its independent sibling source',async t=>{
  const h=await provenanceFixture();t.after(h.close);const b=await h.remember('INDEPENDENT_B_ROOT');await h.select([b.memory],0);await h.run('B任务','B_ROOT_NO_BACKFLOW');
  const a=await h.remember('A_ROOT');const child=h.store.mutate(a.scope,{action:'create',requestId:randomUUID(),value:{kind:'knowledge',claimType:'inference',content:'MIXED_CHILD',
    sources:[{kind:'memory',id:a.memory.id,revision:1,contentHash:a.memory.contentHash},...b.memory.sources]}});
  await h.select([h.store.read(a.scope,child.id)!],1);await h.run('混合任务','MIXED_CHILD_ANSWER');
  h.mutate(a,'delete',1);await h.run('继续有效历史');assert.match(h.visible(),/B_ROOT_NO_BACKFLOW/);assert.ok(!h.visible().includes('MIXED_CHILD_ANSWER'));
  await h.select([b.memory],2);assert.ok(h.visible().includes('INDEPENDENT_B_ROOT'));
});
