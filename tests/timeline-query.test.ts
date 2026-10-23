import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Journal, eventFor } from '@dafeiyu/journal';
import { MessageSchema, redactContent } from '@dafeiyu/contracts';

async function fixture() {
  const root=await mkdtemp(join(tmpdir(),'dafeiyu-timeline-query-'));
  const journal=new Journal(join(root,'journal.sqlite'));
  const add=(room:string,id:string,actor='alice',at='2026-10-23T12:00:00+08:00')=>{
    const receipt=journal.accept('dafeiyu','simulator','0.3.0',MessageSchema.parse({id,occurredAt:at,
      conversation:{channel:'simulator',account:'local',kind:'local',id:room},sender:{id:actor,displayName:actor},text:'原始消息'}));
    return journal.get(receipt.id);
  };
  return {journal,add,close:()=>journal.close(),root};
}
test('timeline scopes before filtering, including a different agent with a forged same route',async t=>{
  const f=await fixture();t.after(f.close);const a=f.add('a','same'),b=f.add('b','same');
  f.journal.append(eventFor('other-agent',a,'other.secret','test','1'));
  const scope={agentId:'dafeiyu',route:a.route};
  const page=f.journal.searchTimeline(scope,{});
  assert.equal(page.items.length,1);assert.equal(page.items[0]?.traceId,a.id);
  assert.equal(f.journal.searchTimeline(scope,{traceId:b.id}).items.length,0);
  assert.equal(f.journal.scopedEvent(scope,f.journal.events(b.route)[0]!.id),null);
});
test('timeline filters plugin, type, actor, trace and operation by exact metadata',async t=>{
  const f=await fixture();t.after(f.close);const a=f.add('a','1'),b=f.add('a','2','bob');
  const event=f.journal.append(eventFor('dafeiyu',a,'operation.failed','echo','1','op-a',null,{action:'中文回显'}));
  f.journal.append(eventFor('dafeiyu',b,'operation.failed','echo','1','op-b'));
  const scope={agentId:'dafeiyu',route:a.route};
  assert.deepEqual(f.journal.searchTimeline(scope,{plugin:'echo',type:'operation.failed',actorId:'alice',traceId:a.id,operationId:'op-a',query:'中文'}).items.map(e=>e.id),[event.id]);
  assert.equal(f.journal.searchTimeline(scope,{plugin:'ech'}).items.length,0);
});
test('timeline time ranges understand offsets and do not confuse arrival order with event time',async t=>{
  const f=await fixture();t.after(f.close);
  const a=f.add('a','1','alice','2026-10-23T12:00:00+08:00');f.add('a','2','alice','2026-10-23T03:00:00Z');
  const scope={agentId:'dafeiyu',route:a.route};
  const page=f.journal.searchTimeline(scope,{since:'2026-10-23T04:00:00Z',until:'2026-10-23T04:00:00Z'});
  assert.equal(page.items.length,1);assert.equal(page.items[0]?.traceId,a.id);
  const all=f.journal.searchTimeline(scope,{}).items;
  assert.ok(all[0]!.seq>all[1]!.seq);assert.ok(Date.parse(all[0]!.occurredAt)<Date.parse(all[1]!.occurredAt));
  assert.throws(()=>f.journal.searchTimeline(scope,{since:'2026-10-24T00:00:00Z',until:'2026-10-23T00:00:00Z'}));
  assert.throws(()=>f.journal.searchTimeline(scope,{since:'2026-10-23 12:00'}));
});
test('pagination is stable during appends and cursor cannot be reused in another scope or query',async t=>{
  const f=await fixture();t.after(f.close);const a=f.add('a','1');f.add('a','2');f.add('a','3');const b=f.add('b','1');
  const scope={agentId:'dafeiyu',route:a.route};
  const first=f.journal.searchTimeline(scope,{limit:2});assert.ok(first.nextCursor);
  const added=f.add('a','new');
  const second=f.journal.searchTimeline(scope,{limit:2,cursor:first.nextCursor});
  assert.equal(second.items.length,1);assert.equal(second.nextCursor,null);
  assert.ok(![...first.items,...second.items].some(e=>e.traceId===added.id));
  assert.throws(()=>f.journal.searchTimeline({agentId:'dafeiyu',route:b.route},{limit:2,cursor:first.nextCursor!}),/INVALID_TIMELINE_CURSOR/);
  assert.throws(()=>f.journal.searchTimeline(scope,{limit:2,query:'changed',cursor:first.nextCursor!}),/INVALID_TIMELINE_CURSOR/);
  assert.throws(()=>f.journal.searchTimeline(scope,{cursor:'not-json'}),/INVALID_TIMELINE_CURSOR/);
});
test('literal search neither interprets SQL wildcards nor matches redacted secret values',async t=>{
  const f=await fixture();t.after(f.close);const a=f.add('a','1');const scope={agentId:'dafeiyu',route:a.route};
  f.journal.append(eventFor('dafeiyu',a,'fixture','plugin','1','op',null,{api_key:'hidden-secret-sentinel',detail:'ordinary'}));
  assert.equal(f.journal.searchTimeline(scope,{query:'hidden-secret-sentinel'}).items.length,0);
  assert.equal(f.journal.searchTimeline(scope,{query:"%' OR 1=1 --"}).items.length,0);
  assert.equal(f.journal.searchTimeline(scope,{query:'ordinary'}).items.length,1);
});
test('cursor and event identifiers survive reopening the journal',async()=>{
  const f=await fixture();const a=f.add('a','1');f.add('a','2');const scope={agentId:'dafeiyu',route:a.route};
  const first=f.journal.searchTimeline(scope,{limit:1});f.close();
  const next=new Journal(join(f.root,'journal.sqlite'));
  try{assert.equal(next.scopedEvent(scope,first.items[0]!.id)?.id,first.items[0]!.id);assert.equal(next.searchTimeline(scope,{limit:1,cursor:first.nextCursor!}).items.length,1);}finally{next.close();}
});
test('redaction covers structured credentials and full unstructured authorization lines',()=>{
  const structured=redactContent(JSON.stringify({text:'可见',apiKey:'opaque-secret',nested:{cookie:'a=secret;b=also-secret'},inputTokens:12}));
  assert.ok(structured.redacted);assert.ok(!structured.value.includes('opaque-secret'));assert.ok(!structured.value.includes('also-secret'));assert.match(structured.value,/可见/);assert.match(structured.value,/12/);
  const plain=redactContent('Authorization: Bearer abcdefghijklmnopqrstuvwxyz\n密码：super-secret\nvisible');
  assert.ok(plain.redacted);assert.ok(!plain.value.includes('abcdefghijklmnopqrstuvwxyz'));assert.ok(!plain.value.includes('super-secret'));assert.match(plain.value,/visible/);
});
