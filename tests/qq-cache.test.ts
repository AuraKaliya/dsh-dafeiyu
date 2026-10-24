import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { QqStore, QQ_APPLICATION_ID } from '@dafeiyu/channel-qq';
import { inspectStorage } from '@dafeiyu/host';
import { testTempDir as tmpdir } from './test-temp.js';

const route = JSON.stringify(['group', '11223344']), owner = 'core-issued-scope-A';
const metadata = { occurredAt: '2026-10-25T00:00:00.000Z', unsupported: [] };
async function file() { return join(await mkdtemp(join(tmpdir(), 'dafeiyu-qq-cache-')), 'qq.sqlite'); }

test('QQ v2 migration preserves existing cache and receipts without inventing metadata', async () => {
  const path = await file(), legacy = new DatabaseSync(path);
  legacy.exec(`CREATE TABLE messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,route TEXT NOT NULL,id TEXT NOT NULL,sender TEXT NOT NULL,text TEXT NOT NULL,UNIQUE(route,id));
    CREATE TABLE receipts(reply_id TEXT PRIMARY KEY,platform_id TEXT NOT NULL);
    CREATE TABLE handled(route TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(route,id));
    CREATE TABLE qq_group_snapshots(account TEXT PRIMARY KEY,at TEXT NOT NULL,revision INTEGER NOT NULL,groups_json TEXT NOT NULL);
    PRAGMA user_version=2; PRAGMA application_id=${QQ_APPLICATION_ID};`);
  legacy.prepare('INSERT INTO messages(route,id,sender,text) VALUES(?,?,?,?)').run(route, '-10', 'old-sender', '旧缓存 token=fictional-legacy-key-123'); legacy.exec("INSERT INTO receipts VALUES('reply','-20')"); legacy.close();
  const before = await readFile(path); assert.equal(inspectStorage(path, 'qq').version, 2); assert.throws(() => new QqStore(path), /MIGRATION_REQUIRED/); assert.deepEqual(await readFile(path), before);
  const store = new QqStore(path, { migrate: true });
  try {
    assert.equal(store.receipt('reply'), '-20'); const page = store.cache.browse(route, owner, { requestId: 'old' });
    assert.equal(page.page.messages[0]?.text, '旧缓存 token=[REDACTED]'); assert.equal(store.find(route, '-10')?.text, '旧缓存 token=[REDACTED]'); assert.equal(page.page.messages[0]?.occurredAt, null); assert.equal(page.page.messages[0]?.legacyMetadata, true); assert.equal(page.page.messages[0]?.cacheTextTruncated, null);
  } finally { store.close(); }
  assert.equal(inspectStorage(path, 'qq').version, 3);
});

test('QQ cache pagination fixes a receive watermark and repeated requests keep the same page', async () => {
  const store = new QqStore(await file());
  try {
    for (let n = 1; n <= 5; n++) store.remember(route, String(n), 'sender', '消息' + n, metadata);
    const first = store.cache.browse(route, owner, { requestId: 'first', limit: 2 }); assert.deepEqual(first.page.messages.map(row => row.id), ['5', '4']);
    store.remember(route, '6', 'sender', '后到的新消息', metadata);
    const second = store.cache.browse(route, owner, { requestId: 'second', limit: 2, cursor: first.id }); assert.deepEqual(second.page.messages.map(row => row.id), ['3', '2']);
    assert.equal(second.page.watermark, first.page.watermark); assert.equal(store.cache.browse(route, owner, { requestId: 'first', limit: 2 }).id, first.id);
    assert.throws(() => store.cache.browse(route, owner, { requestId: 'first', limit: 1 }), /IDEMPOTENCY_CONFLICT/);
  } finally { store.close(); }
});

test('QQ view tickets reject other owners, routes, changed query parameters and a new store incarnation', async () => {
  const path = await file(); let store = new QqStore(path);
  store.remember(route, '1', 'sender', '虚构消息', metadata); store.remember(route, '2', 'sender', '虚构消息2', metadata);
  const first = store.cache.browse(route, owner, { requestId: 'first', limit: 1 });
  assert.throws(() => store.cache.snapshot('scope-B', first.id), /SNAPSHOT_UNAVAILABLE/);
  assert.throws(() => store.cache.browse('another-route', owner, { requestId: 'other', limit: 1, cursor: first.id }), /CURSOR_STALE/);
  assert.throws(() => store.cache.browse(route, owner, { requestId: 'other', limit: 2, cursor: first.id }), /CURSOR_STALE/);
  assert.equal(store.cache.proofCurrent({ ...first.proof, hash: '0'.repeat(64) }), false);
  store.close(); store = new QqStore(path);
  try { assert.throws(() => store.cache.snapshot(owner, first.id), /SNAPSHOT_UNAVAILABLE/); assert.equal(store.cache.proofCurrent(first.proof), true); }
  finally { store.close(); }
});

test('long cached messages continue by Unicode codepoint without silently losing or duplicating text', async () => {
  const store = new QqStore(await file()), text = '😀'.repeat(5000) + '字'.repeat(5000);
  try {
    store.remember(route, '-9', 'sender', text, metadata); let cursor: string | undefined, reconstructed = '', pages = 0;
    do { const view = store.cache.browse(route, owner, { requestId: 'page-' + pages++, limit: 1, ...(cursor ? { cursor } : {}) });
      assert.ok(JSON.stringify(view.page).length <= 8000); const item = view.page.messages[0]!; assert.equal(item.range.start, Array.from(reconstructed).length);
      assert.equal(Array.from(item.text).length, item.range.end - item.range.start); reconstructed += item.text; cursor = view.next ? view.id : undefined;
    } while (cursor);
    assert.equal(reconstructed, text); assert.ok(pages > 1);
  } finally { store.close(); }
});

test('revisions and recall invalidate proofs, and late duplicates cannot resurrect a recalled message', async () => {
  const store = new QqStore(await file());
  try {
    store.remember(route, '1', 'sender', '原文', metadata); const original = store.cache.browse(route, owner, { requestId: 'original' });
    store.remember(route, '1', 'sender', '原文', metadata); assert.equal(store.cache.proofCurrent(original.proof), true);
    store.remember(route, '1', 'sender', '修订', metadata); assert.equal(store.cache.proofCurrent(original.proof), false);
    const revised = store.cache.browse(route, owner, { requestId: 'revised' }); store.cache.revoke(route, '1'); store.cache.revoke(route, '1');
    assert.equal(store.cache.proofCurrent(revised.proof), false); assert.equal(store.find(route, '1'), null); assert.throws(() => store.cache.snapshot(owner, revised.id), /SNAPSHOT_UNAVAILABLE/);
    assert.equal(store.remember(route, '1', 'sender', '迟到的旧事件', metadata), false); store.cache.revoke(route, 'unseen'); assert.equal(store.remember(route, 'unseen', 'sender', '迟到', metadata), false);
  } finally { store.close(); }
});

test('cache eviction invalidates cursors while retained version facts still prove previously observed material', async () => {
  const store = new QqStore(await file());
  try {
    store.remember(route, '1', 'sender', '旧1', metadata); store.remember(route, '2', 'sender', '旧2', metadata);
    const old = store.cache.browse(route, owner, { requestId: 'old', limit: 1 });
    for (let n = 3; n <= 202; n++) store.remember(route, String(n), 'sender', '新' + n, metadata);
    assert.equal(store.find(route, '2'), null); assert.equal(store.cache.proofCurrent(old.proof), true); assert.equal(store.cache.snapshot(owner, old.id).page.messages[0]?.text, '旧2');
    assert.throws(() => store.cache.browse(route, owner, { requestId: 'later', limit: 1, cursor: old.id }), /CURSOR_STALE/);
    store.cache.revoke(route, '2'); assert.equal(store.cache.proofCurrent(old.proof), false);
  } finally { store.close(); }
});

test('metadata reports unsupported media, safe truncation and credential redaction', async () => {
  const store = new QqStore(await file());
  try {
    store.remember(route, '1', 'sender', 'token=fictional-secret-1234567890', { ...metadata, unsupported: ['image', 'record'] });
    const view = store.cache.browse(route, owner, { requestId: 'media' }); assert.match(view.page.messages[0]!.text, /REDACTED/); assert.deepEqual(view.page.messages[0]?.unsupported, ['image', 'record']);
    store.remember(route, '2', 'sender', 'a'.repeat(31999) + '😀多余文字', metadata);
    const long = store.cache.browse(route, owner, { requestId: 'long' }); assert.equal(long.page.messages[0]?.cacheTextTruncated, true); assert.equal(store.find(route, '2')?.text.length, 31999);
  } finally { store.close(); }
});

test('expired views are reclaimed and a bounded snapshot pool still permits exact retries', async () => {
  let clock = Date.parse(metadata.occurredAt); const store = new QqStore(await file(), { cache: { clock: () => clock, snapshotTtlMs: 100, maxSnapshots: 2 } });
  try {
    store.remember(route, '1', 'sender', '虚构', metadata); const first = store.cache.browse(route, owner, { requestId: 'one' }); store.cache.browse(route, owner, { requestId: 'two' });
    assert.equal(store.cache.browse(route, owner, { requestId: 'one' }).id, first.id); assert.throws(() => store.cache.browse(route, owner, { requestId: 'three' }), /CAPACITY/);
    clock += 101; assert.throws(() => store.cache.snapshot(owner, first.id), /SNAPSHOT_UNAVAILABLE/); assert.ok(store.cache.browse(route, owner, { requestId: 'three' }).id);
  } finally { store.close(); }
});
