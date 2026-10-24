import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { testTempDir as tmpdir } from './test-temp.js';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { MemoryStore } from '@dafeiyu/memory/store';
import { Journal } from '@dafeiyu/journal';
import type { OperationScope } from '@dafeiyu/contracts';

const scope = (route = 'a', agentId = 'fish'): OperationScope => ({ agentId, route, traceId: randomUUID(), operationId: randomUUID(), startedEventId: randomUUID() });
const value = (content = '虚构项目代号青羽842') => ({ kind: 'knowledge' as const, claimType: 'self_report' as const, content,
  sources: [{ kind: 'timeline' as const, ref: `dafeiyu:event:${randomUUID()}`, contentHash: 'a'.repeat(64) }] });
async function fixture() { const root = await mkdtemp(join(tmpdir(), 'dafeiyu-memory-store-')); return { root, file: join(root, 'memory.sqlite') }; }

test('memory versions are immutable and state CAS prevents stale corrections', async t => {
  const { file } = await fixture(); const store = new MemoryStore(file); t.after(() => store.close()); const s = scope();
  const one = store.mutate(s, { action: 'create', requestId: 'one', value: value() });
  const two = store.mutate(s, { action: 'revise', id: one.id, expectedVersion: 1, requestId: 'two', value: value('更正为青鱼888') });
  assert.equal(two.revision, 2); assert.equal(two.version, 2);
  assert.equal(store.read(s, one.id, 'normal', 1), null);
  assert.equal(store.read(s, one.id, 'history', 1)?.content, '虚构项目代号青羽842');
  assert.equal(store.read(s, one.id)?.content, '更正为青鱼888');
  assert.throws(() => store.mutate(s, { action: 'revise', id: one.id, expectedVersion: 1, requestId: 'stale', value: value('旧请求覆盖') }), /version_conflict/);
  const db = new DatabaseSync(file); t.after(() => db.close());
  assert.throws(() => db.exec('UPDATE memory_revisions SET body=body'), /Immutable/);
  assert.throws(() => db.exec('DELETE FROM memory_revisions'), /Immutable/);
  assert.throws(() => db.exec('DELETE FROM memory_items'), /logical deletion/);
});

test('logical deletion hides all versions and survives reopen; explicit restore never rewinds content', async () => {
  const { file } = await fixture(); let store = new MemoryStore(file); const s = scope();
  const one = store.mutate(s, { action: 'create', requestId: 'a', value: value() });
  store.mutate(s, { action: 'revise', requestId: 'b', id: one.id, expectedVersion: 1, value: value('最终版本') });
  store.mutate(s, { action: 'delete', requestId: 'd', id: one.id, expectedVersion: 2, reason: '明确遗忘' });
  store.close(); store = new MemoryStore(file);
  try {
    assert.equal(store.search(s, 'normal', { query: '', limit: 20 }).items.length, 0);
    assert.equal(store.read(s, one.id, 'history', 1), null);
    assert.equal(store.read(s, one.id, 'deleted', 1)?.content, '虚构项目代号青羽842');
    assert.equal(store.read(s, one.id, 'deleted', 2)?.useRestriction, 'deleted_lookup_only');
    assert.throws(() => store.mutate(s, { action: 'revise', requestId: 'x', id: one.id, expectedVersion: 3, value: value() }), /deleted/);
    const restored = store.mutate(s, { action: 'restore', requestId: 'r', id: one.id, expectedVersion: 3, reason: '明确恢复' });
    assert.equal(restored.revision, 2); assert.equal(restored.version, 4);
    assert.equal(store.read(s, one.id)?.content, '最终版本');
    assert.equal(store.read(s, one.id, 'deleted'), null);
    assert.throws(() => store.mutate(s, { action: 'restore', requestId: 'stale', id: one.id, expectedVersion: 3, reason: '旧恢复请求' }), /version_conflict/);
  } finally { store.close(); }
});

test('idempotent receipts cannot disclose deleted text or repeat mutations', async t => {
  const { file } = await fixture(); const store = new MemoryStore(file); t.after(() => store.close()); const s = scope();
  const command = { action: 'create' as const, requestId: 'same', value: value('隐私记忆_SENTINEL') };
  const one = store.mutate(s, command);
  assert.equal(store.mutate(scope(), command).id, one.id);
  assert.equal(store.mutate(s, command).duplicate, true);
  store.mutate(s, { action: 'delete', requestId: 'd', id: one.id, expectedVersion: 1, reason: '忘记' });
  const repeated = store.mutate(s, command);
  assert.ok(!JSON.stringify(repeated).includes('SENTINEL'));
  assert.equal(store.read(s, one.id), null);
  assert.throws(() => store.mutate(s, { ...command, value: value('另一内容') }), /idempotency_conflict/);
});

test('scope and agent isolation apply to normal, historical, deleted and mutation paths', async t => {
  const { file } = await fixture(); const store = new MemoryStore(file); t.after(() => store.close()); const s = scope();
  const one = store.mutate(s, { action: 'create', requestId: 'one', value: value() });
  for (const other of [scope('b'), scope('a', 'another-fish')]) {
    for (const mode of ['normal','history','deleted'] as const) assert.equal(store.read(other, one.id, mode), null);
    assert.equal(store.search(other, 'normal', { query: '', limit: 10 }).items.length, 0);
    assert.throws(() => store.mutate(other, { action: 'delete', requestId: 'delete', id: one.id, expectedVersion: 1, reason: '无权限' }), /not_found/);
  }
});

test('source dependency deletion and corrections propagate transitively without rewriting evidence', async t => {
  const { file } = await fixture(); const store = new MemoryStore(file); t.after(() => store.close()); const s = scope();
  const a = store.mutate(s, { action: 'create', requestId: 'a', value: value('原始约定') });
  const parent = store.read(s, a.id)!;
  const b = store.mutate(s, { action: 'create', requestId: 'b', value: { ...value('派生结论'), sources: [{ kind: 'memory', id: a.id, revision: 1, contentHash: parent.contentHash }] } });
  const child = store.read(s, b.id)!;
  const c = store.mutate(s, { action: 'create', requestId: 'c', value: { ...value('再次整理'), sources: [{ kind: 'memory', id: b.id, revision: 1, contentHash: child.contentHash }] } });
  store.mutate(s, { action: 'delete', requestId: 'd', id: a.id, expectedVersion: 1, reason: '忘记依据' });
  assert.equal(store.read(s, c.id), null); assert.equal(store.read(s, c.id, 'history'), null);
  assert.equal(store.read(s, c.id, 'deleted')?.effectivelyDeleted, true);
  assert.equal(store.read(s, c.id, 'deleted')?.deleted, false);
  store.mutate(s, { action: 'restore', requestId: 'r', id: a.id, expectedVersion: 2, reason: '恢复未改变的依据' });
  assert.equal(store.read(s, c.id)?.content, '再次整理');
  store.mutate(s, { action: 'revise', requestId: 'v', id: a.id, expectedVersion: 3, value: value('新的依据') });
  assert.equal(store.read(s, c.id), null); assert.equal(store.read(s, c.id, 'deleted'), null);
  assert.equal(store.read(s, c.id, 'history')?.content, '再次整理');
  assert.equal(store.read(s, c.id, 'history')?.basisStatus, 'changed');
  assert.equal(store.read(s, c.id, 'history')?.useRestriction, 'historical_evidence_only');
});

test('memory dependencies reject cross-scope, changed, missing and self references', async t => {
  const { file } = await fixture(); const store = new MemoryStore(file); t.after(() => store.close()); const s = scope();
  const parent = store.mutate(scope('other'), { action: 'create', requestId: 'p', value: value() });
  assert.throws(() => store.mutate(s, { action: 'create', requestId: 'x', value: { ...value(), sources: [{ kind: 'memory', id: parent.id, revision: 1, contentHash: 'a'.repeat(64) }] } }), /source_unavailable/);
  const own = store.mutate(s, { action: 'create', requestId: 'o', value: value() });
  const read = store.read(s, own.id)!;
  assert.throws(() => store.mutate(s, { action: 'revise', id: own.id, expectedVersion: 1, requestId: 'self', value: { ...value(), sources: [{kind:'memory',id:own.id,revision:1,contentHash:read.contentHash}] } }), /source_unavailable/);
});

test('cursor binds scope, filters and state generation; deletion invalidates an older page', async t => {
  const { file } = await fixture(); const store = new MemoryStore(file); t.after(() => store.close()); const s = scope();
  for (let i=0;i<3;i++) store.mutate(s,{action:'create',requestId:`r${i}`,value:value(`记录${i}`)});
  const first = store.search(s,'normal',{query:'记录',limit:1}); assert.ok(first.nextCursor);
  const input = {query:'记录',limit:1,cursor:first.nextCursor};
  assert.throws(()=>store.search(scope('b'),'normal',input),/invalid_cursor/);
  assert.throws(()=>store.search(s,'deleted',input),/invalid_cursor/);
  assert.throws(()=>store.search(s,'normal',{...input,query:'其他'}),/invalid_cursor/);
  store.mutate(scope('other'),{action:'create',requestId:'other',value:value()});
  assert.equal(store.search(s,'normal',input).items.length,1);
  store.mutate(s,{action:'delete',requestId:'d',id:first.items[0]!.id,expectedVersion:1,reason:'删除'});
  assert.throws(()=>store.search(s,'normal',input),/stale_cursor/);
});

test('mutation and outbox roll back together if durable event insertion fails', async t => {
  const {file}=await fixture(); const store=new MemoryStore(file);t.after(()=>store.close());
  const db=new DatabaseSync(file);t.after(()=>db.close());
  db.exec("CREATE TRIGGER fail_event BEFORE INSERT ON memory_events BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
  assert.throws(()=>store.mutate(scope(),{action:'create',requestId:'fail',value:value()}),/fixture failure/);
  for(const table of ['memory_items','memory_revisions','requests','outbox'])assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n,0);
});

test('outbox replays a publish-before-ack interruption without duplicating journal events', async () => {
  const {file,root}=await fixture();let store=new MemoryStore(file);const journal=new Journal(join(root,'journal.sqlite')); const s=scope();
  try {
    const receipt=store.mutate(s,{action:'create',requestId:'one',value:value()});
    assert.equal(store.drainOutbox((event,id)=>{journal.appendOnce(event,id);throw new Error('interrupted before ack');}),1);
    store.close();store=new MemoryStore(file);
    assert.equal(store.drainOutbox((event,id)=>{journal.appendOnce(event,id);}),0);
    const events=journal.events(s.route);assert.equal(events.length,1);assert.equal(events[0]?.id,receipt.eventId);
    assert.ok(!JSON.stringify(events).includes('青羽842'));
    assert.equal(store.drainOutbox(()=>{throw new Error('should not publish');}),0);
  } finally {store.close();journal.close();}
});

test('two connections cannot overwrite a version already committed by another writer',async t=>{
  const {file}=await fixture();const a=new MemoryStore(file),b=new MemoryStore(file);t.after(()=>{a.close();b.close();});const s=scope();
  const one=a.mutate(s,{action:'create',requestId:'one',value:value()});
  b.mutate(s,{action:'revise',requestId:'two',id:one.id,expectedVersion:1,value:value('已更新')});
  assert.throws(()=>a.mutate(s,{action:'delete',requestId:'old',id:one.id,expectedVersion:1,reason:'过期请求'}),/version_conflict/);
  assert.equal(a.read(s,one.id)?.content,'已更新');
});

test('unsupported and unrelated databases are refused without reinitialization',async()=>{
  const {file}=await fixture();const db=new DatabaseSync(file);db.exec('CREATE TABLE unrelated(value TEXT); INSERT INTO unrelated VALUES(\'preserve\'); PRAGMA user_version=1;');db.close();
  assert.throws(()=>new MemoryStore(file),/Unsupported/);
  const check=new DatabaseSync(file);try{assert.equal(check.prepare('SELECT value FROM unrelated').get()?.value,'preserve');}finally{check.close();}
});
