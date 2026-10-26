import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { testTempDir as tmpdir } from './test-temp.js';
import { join } from 'node:path';
import { GroupDirectory, GroupSyncConfigSchema, QqPluginConfigSchema, QqStore, naturallyAddressed } from '@dafeiyu/qq';
import type { GroupInfo } from '@dafeiyu/qq';

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

test('QQ defaults verify receive settings without broadening the configured group scope', () => {
  const base = { botId: '12345678', ownerId: '87654321', groupIds: [], httpURL: 'http://127.0.0.1:1/', wsURL: 'ws://127.0.0.1:1/', tokenFile: 'fixture' };
  const parsed = QqPluginConfigSchema.parse(base); assert.deepEqual(parsed.naturalNames, []); assert.equal(parsed.groupSync.enabled, true);
  assert.throws(() => GroupSyncConfigSchema.parse({ enabled: false, mode: 'joined' }));
  assert.throws(() => GroupSyncConfigSchema.parse({ enabled: true, intervalMs: 30000, maxStaleMs: 5000 }));
  assert.throws(() => QqPluginConfigSchema.parse({ ...base, naturalNames: ['@大肥鱼'] }));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dafeiyu-groups-')), store = new QqStore(join(root, 'qq.sqlite'));
  const groups: GroupInfo[] = [{ id: '11223344', name: '虚构A', msgMask: 1 }, { id: '22334455', name: '虚构B', msgMask: 1 }];
  const platform = { clock: 0, wallClock: 1000000, fail: false, calls: 0, rejected: 0, groups };
  const options = { account: '12345678', allowed: ['11223344'], store,
    config: GroupSyncConfigSchema.parse({ enabled: true, intervalMs: 5000, maxStaleMs: 5000 }), clock: () => platform.clock, wallClock: () => platform.wallClock,
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

test('assistant and blocked groups retain membership while only normal and quiet groups are effective', async () => {
  const f = await fixture();
  const masks: GroupInfo['msgMask'][] = [1, 2, 3, 4, null];
  f.platform.groups = masks.map((mask, i) => ({ id: String(11223344 + i), name: '虚构群', msgMask: mask }));
  const directory = new GroupDirectory({ ...f.options, config: GroupSyncConfigSchema.parse({ mode: 'joined' }) });
  try {
    await directory.start(); assert.deepEqual(directory.effective(), ['11223344', '11223347']);
    assert.equal(directory.status().joinedIds.length, 5); assert.deepEqual(directory.status().assistantIds, ['11223345']);
    assert.deepEqual(directory.status().unknownIds, ['11223348']); assert.equal(directory.status().error, 'GROUP_SETTINGS_UNKNOWN');
  } finally { directory.pause(); await directory.whenIdle(); f.store.close(); }
});

test('disabling group sync cannot bypass assistant filtering with a static allowlist', async () => {
  const f = await fixture(), directory = new GroupDirectory({ ...f.options, config: GroupSyncConfigSchema.parse({ enabled: false }) });
  try { await directory.start(); assert.deepEqual(directory.effective(), []); assert.equal(f.platform.calls, 0); }
  finally { directory.pause(); f.store.close(); }
});

test('assistant transition cancels the current lease and resume persists a new generation and receive boundary', async () => {
  const f = await fixture(), directory = new GroupDirectory(f.options), id = '11223344';
  try {
    f.store.remember('saved-history', '1', 'person', '原有真实记录保留'); f.store.sent('saved-reply', 'receipt');
    await directory.start(); const first = directory.processingSignal(id, f.platform.wallClock), generation = directory.generation(id);
    f.platform.groups[0]!.msgMask = 2; f.platform.wallClock = 1001100; await directory.refresh();
    assert.equal(first.aborted, true); assert.deepEqual(directory.effective(), []); assert.throws(() => directory.processingSignal(id, 1002000), /GROUP_ACCESS_REVOKED/);
    f.platform.groups[0]!.msgMask = 1; f.platform.wallClock = 1002200; await directory.refresh();
    assert.ok(directory.generation(id) > generation); assert.equal(directory.accepts(id, 1002000), false); assert.equal(directory.accepts(id, 1003000), true);
    assert.throws(() => directory.processingSignal(id, 1002000), /GROUP_ACCESS_REVOKED/);
    assert.equal(directory.processingSignal(id, 1003000).aborted, false);
    assert.equal(f.store.find('saved-history', '1')?.text, '原有真实记录保留'); assert.equal(f.store.receipt('saved-reply'), 'receipt');
    const saved = f.store.groupSnapshot(f.options.account)!; assert.equal(saved.groups[0]?.acceptedAfter, 1003000);
    directory.pause(); await directory.whenIdle();
    const restarted = new GroupDirectory(f.options);
    try { await restarted.start(); assert.equal(restarted.generation(id), saved.groups[0]?.generation); assert.equal(restarted.accepts(id, 1002000), false); }
    finally { restarted.pause(); await restarted.whenIdle(); }
  } finally { directory.pause(); await directory.whenIdle(); f.store.close(); }
});

test('leave and rejoin cannot reuse the generation of work accepted before removal', async () => {
  const f = await fixture(), directory = new GroupDirectory(f.options);
  try { await directory.start(); const generation = directory.generation('11223344'); f.platform.groups = []; await directory.refresh();
    f.platform.groups = [{ id: '11223344', name: '虚构群', msgMask: 1 }]; await directory.refresh(); assert.ok(directory.generation('11223344') > generation); }
  finally { directory.pause(); await directory.whenIdle(); f.store.close(); }
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
    f.platform.fail = false; f.platform.groups = [{ id: '22334455', name: '虚构B', msgMask: 1 }]; await restarted.refresh(); assert.deepEqual(restarted.effective(), ['22334455']);
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
