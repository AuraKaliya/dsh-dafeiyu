import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { testTempDir as tmpdir } from './test-temp.js';
import { join } from 'node:path';
import { GroupDirectory, GroupSyncConfigSchema, QqPluginConfigSchema, QqStore, naturallyAddressed } from '@dafeiyu/channel-qq';

test('natural QQ address matching recognizes explicit Chinese addresses while ignoring quoted or incidental names', () => {
  const names = ['大肥鱼', '蓝色大肥鱼'];
  for (const text of ['大肥鱼', '大肥鱼，帮我看看', '蓝色大肥鱼你怎么看', '  大肥鱼请看看', '@蓝色大肥鱼 你好', '大家好，@大肥鱼 帮忙看看', '大肥鱼在吗？']) {
    assert.equal(naturallyAddressed(text, names), true, text);
  }
  for (const text of ['今天看到一条大肥鱼', '大肥鱼丸很好吃', '> 大肥鱼，帮我', '他说：“@大肥鱼 你好”', '`@大肥鱼 帮我`', '```text\n大肥鱼，看看\n```', 'test@大肥鱼 你好', '“大肥鱼”这个名字', '「大肥鱼请回答」']) {
    assert.equal(naturallyAddressed(text, names), false, text);
  }
  assert.equal(naturallyAddressed('大肥鱼，看看', []), false);
});

test('QQ defaults preserve old triggers and group scope; joined mode and freshness must be explicit and valid', () => {
  const base = { botId: '12345678', ownerId: '87654321', groupIds: [], httpURL: 'http://127.0.0.1:1/', wsURL: 'ws://127.0.0.1:1/', tokenFile: 'fixture' };
  const parsed = QqPluginConfigSchema.parse(base); assert.deepEqual(parsed.naturalNames, []); assert.equal(parsed.groupSync.enabled, false);
  assert.throws(() => GroupSyncConfigSchema.parse({ mode: 'joined' }));
  assert.throws(() => GroupSyncConfigSchema.parse({ enabled: true, intervalMs: 30000, maxStaleMs: 5000 }));
  assert.throws(() => QqPluginConfigSchema.parse({ ...base, naturalNames: ['@大肥鱼'] }));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dafeiyu-groups-')), store = new QqStore(join(root, 'qq.sqlite'));
  const platform = { clock: 0, fail: false, calls: 0, rejected: 0, groups: [{ id: '11223344', name: '虚构A' }, { id: '22334455', name: '虚构B' }] };
  const options = { account: '12345678', allowed: ['11223344'], store,
    config: GroupSyncConfigSchema.parse({ enabled: true, intervalMs: 5000, maxStaleMs: 5000 }), clock: () => platform.clock,
    fetchGroups: async (_signal: AbortSignal) => { platform.calls++; if (platform.fail) throw new Error('PRIVATE_FAILURE_NEVER_LOG'); return platform.groups; },
    rejectIdentity: () => { platform.rejected++; } };
  return { store, platform, options };
}

test('group refresh intersects the allowlist, tolerates only a bounded stale window, and honors removals and empty lists', async () => {
  const f = await fixture(), directory = new GroupDirectory(f.options);
  try {
    assert.deepEqual(directory.effective(), []); await directory.start(); assert.deepEqual(directory.effective(), ['11223344']);
    f.platform.fail = true; f.platform.clock = 4000; await directory.refresh();
    assert.deepEqual(directory.effective(), ['11223344']); assert.equal(directory.status().error, 'GROUP_SYNC_FAILED');
    f.platform.clock = 5000; assert.equal(directory.state(), 'stale'); assert.deepEqual(directory.effective(), []);
    f.platform.fail = false; f.platform.groups = []; await directory.refresh(); assert.equal(directory.state(), 'current'); assert.deepEqual(directory.effective(), []);
    assert.equal(JSON.stringify(directory.status()).includes('PRIVATE_FAILURE'), false);
  } finally { directory.pause(); await directory.whenIdle(); f.store.close(); }
});

test('joined mode needs fresh evidence in this process and cannot reuse persisted membership after restart', async () => {
  const f = await fixture(), options = { ...f.options, config: GroupSyncConfigSchema.parse({ enabled: true, mode: 'joined' }) };
  const first = new GroupDirectory(options);
  await first.start(); assert.deepEqual(first.effective(), ['11223344', '22334455']); first.pause(); await first.whenIdle();
  f.platform.fail = true;
  const restarted = new GroupDirectory(options);
  try {
    assert.equal(restarted.status().lastSuccessAt !== null, true); assert.equal(restarted.status().verifiedThisProcess, false);
    await restarted.start(); assert.deepEqual(restarted.effective(), []);
    f.platform.fail = false; f.platform.groups = [{ id: '22334455', name: '虚构B' }]; await restarted.refresh(); assert.deepEqual(restarted.effective(), ['22334455']);
  } finally { restarted.pause(); await restarted.whenIdle(); f.store.close(); }
});

test('concurrent group refreshes share one request and shutdown aborts it before persisting any snapshot', async () => {
  const f = await fixture(); let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
  const directory = new GroupDirectory({ ...f.options, fetchGroups: signal => {
    f.platform.calls++; entered(); return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
  } });
  try {
    const starting = directory.start(); await started; const a = directory.refresh(), b = directory.refresh(); assert.equal(a, b); assert.equal(f.platform.calls, 1);
    directory.pause(); await starting; await directory.whenIdle(); assert.equal(f.store.groupSnapshot('12345678'), null);
    await directory.refresh(); assert.equal(f.platform.calls, 1);
  } finally { directory.pause(); await directory.whenIdle(); f.store.close(); }
});

test('account mismatch and a failed snapshot commit immediately revoke previously usable membership', async () => {
  const f = await fixture(); let failure: 'identity' | 'store' | null = null;
  const directory = new GroupDirectory({ ...f.options,
    fetchGroups: async () => { if (failure === 'identity') throw new Error('ACCOUNT_MISMATCH'); return f.platform.groups; },
    store: { groupSnapshot: id => f.store.groupSnapshot(id), saveGroups: (id, groups, at) => { if (failure === 'store') throw new Error('SQL_FAILURE'); return f.store.saveGroups(id, groups, at); } },
  });
  try {
    await directory.start(); failure = 'identity'; await directory.refresh(); assert.deepEqual(directory.effective(), []); assert.equal(f.platform.rejected, 1);
    failure = null; await directory.refresh(); assert.deepEqual(directory.effective(), ['11223344']);
    failure = 'store'; await directory.refresh(); assert.deepEqual(directory.effective(), []); assert.equal(directory.status().error, 'GROUP_SNAPSHOT_FAILED');
  } finally { directory.pause(); await directory.whenIdle(); f.store.close(); }
});

test('periodic group refresh has a single schedule and cannot fire again after pause', async t => {
  const f = await fixture();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const directory = new GroupDirectory(f.options);
  try {
    await directory.start(); assert.equal(f.platform.calls, 1);
    t.mock.timers.tick(4999); assert.equal(f.platform.calls, 1);
    t.mock.timers.tick(1); await directory.whenIdle(); await Promise.resolve(); assert.equal(f.platform.calls, 2);
    t.mock.timers.tick(5000); await directory.whenIdle(); await Promise.resolve(); assert.equal(f.platform.calls, 3);
    directory.pause(); t.mock.timers.tick(20000); assert.equal(f.platform.calls, 3);
  } finally { directory.pause(); await directory.whenIdle(); t.mock.timers.reset(); f.store.close(); }
});
