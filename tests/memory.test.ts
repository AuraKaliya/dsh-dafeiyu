import {z} from 'zod';
import {fixtureAction} from './fixture-action.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SessionId } from '@deepseek-ai/dsh-session';
import { API_VERSION } from '@dafeiyu/contracts';
import type { ConversationAccess, PendingMessage } from '@dafeiyu/contracts';
import { MemoryStore } from '@dafeiyu/memory/store';
import { memoryFixture } from './memory-fixture.js';
import { call, textReply } from './harness.js';

function ok<T extends { status: string }>(value: T): Extract<T, { status: 'ok' }> {
  assert.equal(value.status, 'ok'); return value as Extract<T, { status: 'ok' }>;
}
const record = (ref: string, content = '虚构记忆：当前代号青羽842', requestId = randomUUID()) => ({
  requestId, kind: 'knowledge', claimType: 'self_report', content, sourceRefs: [ref],
});
function sessionSource(h: Awaited<ReturnType<typeof memoryFixture>>, item: PendingMessage, type: 'assistant/message' | 'tool/result'): string {
  const completed = h.core.journal.events(item.route).find(e => e.traceId === item.id && e.type === 'turn.completed');
  const event = h.ctx.agents.get(SessionId(item.sessionId))?.session.snapshotEvents().findLast(e => e.type === type
    && completed?.sources.some(source => source.kind === 'session' && source.seq === e.seq));
  assert.ok(completed && event);
  const index = completed.sources.findIndex(source => source.kind === 'session' && source.seq === event.seq);
  assert.ok(index >= 0);
  return `dafeiyu:source:${completed.id}:${index}`;
}

test('memory capability registers current memory tools and runs record/search through the real DSH loop', async t => {
  const h=await memoryFixture();t.after(h.close);const source=await h.evidence();let step=0;
  h.setResponse(()=>++step===1?call('dafeiyu_memory_record',{...record(source.ref),sourceRefs:JSON.stringify([source.ref])})
    :step===2?call('dafeiyu_memory_search',{query:'青羽842'}):textReply('已经记录，并找到原始依据'));
  h.simulator.send('a','记录这项虚构约定',{id:randomUUID()});await h.core.whenIdle();
  const request=h.adapter.requests.at(-1)!;
  assert.ok(request.tools?.some(tool=>tool.name==='dafeiyu_memory_record'));
  assert.ok(request.tools?.some(tool=>tool.name==='dafeiyu_memory_reflect'));
  assert.match(JSON.stringify(request),/memory-item-and-revisions/);
  assert.match(JSON.stringify(request),/not_analyzed/);
  assert.equal(h.simulator.deliveries.at(-1)?.text,'已经记录，并找到原始依据');
  assert.equal(h.core.journal.events(source.message.route).filter(e=>e.type==='memory.created').length,1);
});

test('record, correction, deletion, explicit lookup and restoration preserve provenance and ordered audit',async t=>{
  const h=await memoryFixture();t.after(h.close);const source=await h.evidence();
  const first=ok(await h.probe('a',c=>h.memory.create(c,record(source.ref))));
  const revised=ok(await h.probe('a',c=>h.memory.revise(c,{...record(source.ref,'更正：当前代号青鱼888'),id:first.id,expectedVersion:first.version})));
  const old=ok(await h.probe('a',c=>h.memory.read(c,{id:first.id,revision:1,mode:'history'})));
  assert.equal(old.item.validity,'superseded');assert.match(old.item.content,/青羽842/);
  assert.equal(old.item.sources[0]?.kind,'timeline');assert.equal(old.item.sources[0]?.contentHash.length,64);
  const deleted=ok(await h.probe('a',c=>h.memory.delete(c,{requestId:randomUUID(),id:first.id,expectedVersion:revised.version,reason:'明确遗忘'})));
  assert.equal(deleted.sourceArchivesUnchanged,true);assert.equal(deleted.visibleNow,false);
  assert.deepEqual(await h.probe('a',c=>h.memory.read(c,{id:first.id,mode:'history',revision:1})),{status:'not_found'});
  assert.equal(ok(await h.probe('a',c=>h.memory.search(c,{}))).items.length,0);
  const found=ok(await h.probe('a',c=>h.memory.searchDeleted(c,{query:'青鱼888'})));
  assert.equal(found.items[0]?.useRestriction,'deleted_lookup_only');
  assert.equal(ok(await h.probe('a',c=>h.memory.readDeleted(c,{id:first.id,revision:1}))).item.deleted,true);
  const restored=ok(await h.probe('a',c=>h.memory.restore(c,{requestId:randomUUID(),id:first.id,expectedVersion:deleted.version,reason:'明确恢复'})));
  assert.equal(restored.revision,2);assert.equal(restored.visibleNow,true);
  assert.match(ok(await h.probe('a',c=>h.memory.read(c,{id:first.id}))).item.content,/青鱼888/);
  const events=h.core.journal.events(source.message.route).filter(e=>['memory.created','memory.revised','memory.deleted','memory.restored'].includes(e.type));
  assert.deepEqual(events.map(e=>e.type),['memory.created','memory.revised','memory.deleted','memory.restored']);
  assert.ok(events.every(e=>e.causedBy&&e.operationId&&e.sources.length===1));
  assert.ok(!JSON.stringify(events).includes('青鱼888'));
  const archive=await h.probe('a',c=>h.timeline.open(c,{ref:source.ref}));assert.equal(archive.status,'ok');
});

test('all model-facing read and mutation paths reject foreign conversation identifiers',async t=>{
  const h=await memoryFixture();t.after(h.close);const a=await h.evidence('a'),b=await h.evidence('b','其他会话专属');
  const created=ok(await h.probe('a',c=>h.memory.create(c,record(a.ref,'PRIVATE_MEMORY_SENTINEL'))));
  assert.deepEqual(await h.probe('b',c=>h.memory.read(c,{id:created.id})),{status:'not_found'});
  assert.deepEqual(await h.probe('b',c=>h.memory.read(c,{id:created.id,mode:'history'})),{status:'not_found'});
  for(const action of ['delete','restore'] as const)assert.deepEqual(await h.probe('b',c=>h.memory[action](c,{requestId:randomUUID(),id:created.id,expectedVersion:1,reason:'尝试跨会话'})),{status:'not_found'});
  assert.deepEqual(await h.probe('b',c=>h.memory.revise(c,{...record(b.ref),id:created.id,expectedVersion:1})),{status:'not_found'});
  assert.deepEqual(await h.probe('b',c=>h.memory.create(c,record(a.ref))),{status:'source_unavailable'});
  assert.equal(ok(await h.probe('b',c=>h.memory.search(c,{}))).items.length,0);
  await h.probe('a',c=>h.memory.delete(c,{requestId:randomUUID(),id:created.id,expectedVersion:1,reason:'忘记'}));
  assert.deepEqual(await h.probe('b',c=>h.memory.readDeleted(c,{id:created.id})),{status:'not_found'});
  assert.equal(ok(await h.probe('b',c=>h.memory.searchDeleted(c,{}))).items.length,0);
});

test('forged, cloned and expired contexts never authorize memory access',async t=>{
  const h=await memoryFixture();t.after(h.close);let saved:ConversationAccess|undefined;
  await h.probe('a',c=>{saved=c;assert.throws(()=>h.memory.search({...c},{}),/SCOPE_DENIED/);return null;});
  assert.ok(saved);assert.throws(()=>h.memory.search(saved!,{}),/SCOPE_DENIED/);
});

test('unloading during asynchronous source validation prevents a late write',async t=>{
  const h=await memoryFixture();t.after(h.close);const source=await h.evidence();
  const original=h.timeline.open.bind(h.timeline);
  h.timeline.open=async(...args)=>{const result=await original(...args);await h.memoryFiber.dispose();return result;};
  await assert.rejects(h.probe('a',c=>h.memory.create(c,record(source.ref))),/unregistered/);
  const db=new DatabaseSync(join(h.root,'memory.sqlite'));try{assert.equal(db.prepare('SELECT count(*) AS n FROM memory_items').get()?.n,0);}finally{db.close();}
});

test('deleted lookup does not restore or let its memory reference seed another record',async t=>{
  const h=await memoryFixture();t.after(h.close);const source=await h.evidence();
  const created=ok(await h.probe('a',c=>h.memory.create(c,record(source.ref))));
  await h.probe('a',c=>h.memory.delete(c,{requestId:randomUUID(),id:created.id,expectedVersion:1,reason:'删除'}));
  const read=ok(await h.probe('a',c=>h.memory.readDeleted(c,{id:created.id})));
  assert.deepEqual(await h.probe('a',c=>h.memory.create(c,record(read.item.ref,'不应该重新记入'))),{status:'source_unavailable'});
  assert.equal(ok(await h.probe('a',c=>h.memory.search(c,{}))).items.length,0);
});

test('deleted tool result and assistant restatement cannot masquerade as new primary evidence',async t=>{
  const h=await memoryFixture();t.after(h.close);const source=await h.evidence();
  const created=ok(await h.probe('a',c=>h.memory.create(c,record(source.ref))));
  await h.probe('a',c=>h.memory.delete(c,{requestId:randomUUID(),id:created.id,expectedVersion:1,reason:'删除'}));
  await h.probe('a',c=>h.memory.readDeleted(c,{id:created.id}));
  const item=h.core.journal.list().at(-1)!;
  for(const kind of ['tool/result','assistant/message'] as const){
    const ref=sessionSource(h,item,kind);
    const opened=await h.probe('a',c=>h.timeline.open(c,{ref}));assert.ok(['ok','not_exported'].includes(opened.status));
    if(opened.status==='ok')assert.equal(opened.memoryUse,'derived-only');
    assert.deepEqual(await h.probe('a',c=>h.memory.create(c,record(ref))),{status:'source_unavailable'});
  }
});

test('independent actual tool evidence remains usable without re-executing the tool',async t=>{
  const h=await memoryFixture();t.after(h.close);let count=0,step=0;
  const extension=h.core.registerExtension({id:'proof-tool',version:'1',protocolVersion:4,agentId:'dafeiyu',actions:[fixtureAction(h.core,'proof-tool',{id:'proof_tool',description:'虚构工具验证',inputSchema:z.strictObject({}),work:async()=>{count++;return {receipt:'FAKE-RECEIPT-731',success:true};}})]});t.after(()=>extension.dispose());
  h.setResponse(()=>++step===1?call('proof_tool',{}):textReply('操作已结束'));
  const receipt=h.simulator.send('a','运行虚构操作',{id:randomUUID()});await h.core.whenIdle();
  const item=h.core.journal.get(receipt.id),ref=sessionSource(h,item,'tool/result');
  const saved=await h.probe('a',c=>h.memory.create(c,{...record(ref,'虚构工具返回成功回执'),claimType:'observation'}));
  assert.equal(saved.status,'ok');assert.equal(count,1);
});

test('invalid model fields and JSON cannot select routes or deleted mode through normal tools',async t=>{
  const h=await memoryFixture();t.after(h.close);const source=await h.evidence();
  assert.deepEqual(await h.probe('a',c=>h.memory.create(c,{...record(source.ref),route:'other'})),{status:'invalid_input'});
  assert.deepEqual(await h.probe('a',c=>h.memory.search(c,{mode:'deleted'})),{status:'invalid_input'});
  let step=0;h.setResponse(()=>++step===1?call('dafeiyu_memory_record',{...record(source.ref),sourceRefs:'NOT_JSON_SECRET'}):textReply('参数错误已处理'));
  h.simulator.send('a','测试非法参数',{id:randomUUID()});await h.core.whenIdle();
  const output=JSON.stringify(h.adapter.requests.at(-1)?.messages);
  assert.match(output,/invalid_input/);
  assert.equal(ok(await h.probe('a',c=>h.memory.search(c,{}))).items.length,0);
});

test('known credentials are redacted before persistence and audit never copies memory text',async t=>{
  const h=await memoryFixture();t.after(h.close);const source=await h.evidence();
  const created=ok(await h.probe('a',c=>h.memory.create(c,record(source.ref,'保留普通文本 PRIVATE_TEXT\npassword=MEMORY_PASSWORD_SENTINEL'))));
  const read=ok(await h.probe('a',c=>h.memory.read(c,{id:created.id})));
  assert.ok(!read.item.content.includes('MEMORY_PASSWORD_SENTINEL'));assert.match(read.item.content,/PRIVATE_TEXT/);
  const db=new DatabaseSync(join(h.root,'memory.sqlite'));try{assert.ok(!JSON.stringify(db.prepare('SELECT body FROM memory_revisions').all()).includes('MEMORY_PASSWORD_SENTINEL'));}finally{db.close();}
  assert.ok(!JSON.stringify(h.core.journal.events(source.message.route).filter(e=>e.plugin==='memory')).includes('PRIVATE_TEXT'));
});

test('scope-bound pagination becomes stale after a deletion but not after audit-only reads',async t=>{
  const h=await memoryFixture();t.after(h.close);const source=await h.evidence();
  for(let i=0;i<3;i++)ok(await h.probe('a',c=>h.memory.create(c,record(source.ref,`测试条目${i}`))));
  const page=ok(await h.probe('a',c=>h.memory.search(c,{limit:1})));assert.ok(page.nextCursor);
  assert.equal(ok(await h.probe('a',c=>h.memory.search(c,{limit:1,cursor:page.nextCursor}))).items.length,1);
  assert.deepEqual(await h.probe('b',c=>h.memory.search(c,{limit:1,cursor:page.nextCursor})),{status:'invalid_cursor'});
  const item=page.items[0]!;await h.probe('a',c=>h.memory.delete(c,{requestId:randomUUID(),id:item.id,expectedVersion:item.version,reason:'删除'}));
  assert.deepEqual(await h.probe('a',c=>h.memory.search(c,{limit:1,cursor:page.nextCursor})),{status:'stale_cursor'});
});

test('restart restores memory state without invoking a model or replaying external actions',async()=>{
  let h=await memoryFixture();const source=await h.evidence();
  const created=ok(await h.probe('a',c=>h.memory.create(c,record(source.ref))));
  await h.probe('a',c=>h.memory.delete(c,{requestId:randomUUID(),id:created.id,expectedVersion:1,reason:'删除'}));
  const root=h.root;await h.close();h=await memoryFixture(root);
  try{
    assert.equal(h.adapter.requests.length,0);assert.equal(h.simulator.deliveries.length,0);
    assert.equal(ok(await h.probe('a',c=>h.memory.search(c,{}))).items.length,0);
    assert.equal(ok(await h.probe('a',c=>h.memory.readDeleted(c,{id:created.id}))).item.content,'虚构记忆：当前代号青羽842');
  }finally{await h.close();}
});

test('journal delivery failure is reported as pending and never rolls back a committed memory',async t=>{
  const h=await memoryFixture();t.after(h.close);const source=await h.evidence();const original=h.core.journal.appendOnce.bind(h.core.journal);
  h.core.journal.appendOnce=(event,id)=>{if(event.type==='memory.created')throw new Error('temporary journal failure');return original(event,id);};
  const saved=ok(await h.probe('a',c=>h.memory.create(c,record(source.ref))));assert.equal(saved.auditPending,true);
  h.core.journal.appendOnce=original;
  assert.equal(ok(await h.probe('a',c=>h.memory.read(c,{id:saved.id}))).item.content,'虚构记忆：当前代号青羽842');
  assert.equal(h.core.journal.events(source.message.route).filter(e=>e.id===saved.eventId).length,1);
});

test('a dependency changed during asynchronous evidence reads is rejected at transaction commit',async t=>{
  const h=await memoryFixture();t.after(h.close);const source=await h.evidence();
  const parent=ok(await h.probe('a',c=>h.memory.create(c,record(source.ref))));
  const read=ok(await h.probe('a',c=>h.memory.read(c,{id:parent.id}))).item;
  const original=h.timeline.open.bind(h.timeline);let changed=false;
  h.timeline.open=async(...args)=>{
    const result=await original(...args);
    if(!changed){changed=true;const store=new MemoryStore(join(h.root,'memory.sqlite'));
      try{store.mutate(h.core.scopeFor(args[0]),{action:'revise',requestId:'concurrent-revision',id:parent.id,expectedVersion:1,value:{kind:read.kind,claimType:read.claimType,content:'更新后的依据',sources:read.sources}});}finally{store.close();}}
    return result;
  };
  const derived=await h.probe('a',c=>h.memory.create(c,{...record(source.ref,'不应提交的旧分析'),sourceRefs:[read.ref,source.ref]}));
  assert.deepEqual(derived,{status:'source_unavailable'});
  const all=ok(await h.probe('a',c=>h.memory.search(c,{})));assert.equal(all.items.length,1);assert.equal(all.items[0]?.content,'更新后的依据');
});
