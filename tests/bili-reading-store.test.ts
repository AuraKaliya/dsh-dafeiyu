import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';

import { BiliStore } from '../packages/bilibili/lib/store.js';
import { taskScopeKey } from '@dafeiyu/contracts';
import type { ExecutionContext, ExecutionGrant } from '@dafeiyu/contracts';
import { testTempDir } from './test-temp.js';

const bvid = 'BV1xNpFedEwH';

function context(taskId = randomUUID()): ExecutionContext {
  return {
    agentId: 'fish', taskId, scope: { kind: 'task', agentId: 'fish', taskId, scopeKey: taskScopeKey('fish', taskId) },
    runId: randomUUID(), operationId: randomUUID(), origin: { kind: 'native', producerId: 'fixture', requestId: 'start' }, intentVersion: 1,
    grant: {} as ExecutionGrant, signal: new AbortController().signal,
  };
}

async function fixture() {
  const root = await mkdtemp(join(testTempDir(), 'bili-reading-')), file = join(root, 'bilibili.sqlite'), identity = { agentId: 'fish', profileId: 'test' };
  const first = context(), second = context();
  return { file, identity, first, second, store: new BiliStore(file, identity, true) };
}

const record = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1, bvid, title: '养鱼第一年', author: 'UP甲', status: 'checkpoint',
  watched: [{ cid: '123', startMs: 0, endMs: 60000 }], commentCursor: null,
  frames: [], sources: [], conclusion: null, gaps: [], nextStep: '继续读评论区', ...over,
});

test('reading records are scoped to the task and carry a record version', async () => {
  const f = await fixture();
  try {
    const saved = f.store.saveReading(f.first, randomUUID(), record());
    assert.equal(saved.version, 1);
    assert.equal(f.store.reading(f.first, bvid)!.nextStep, '继续读评论区');
    assert.equal(f.store.reading(f.second, bvid), null, 'another task must not see this progress');

    const again = f.store.saveReading(f.first, randomUUID(), record({ nextStep: '看评论' }));
    assert.equal(again.version, 2);
    assert.equal(f.store.reading(f.first, bvid)!.version, 2);

    const reopened = new BiliStore(f.file, f.identity);
    try {
      assert.equal(reopened.reading(f.first, bvid)!.version, 2);
      assert.equal(reopened.readingSummary(f.second).total, 0);
    } finally { reopened.close(); }
  } finally { }
});

test('reading summary is per task and bounded', async () => {
  const f = await fixture();
  try {
    for (let index = 0; index < 5; index += 1)
      f.store.saveReading(f.first, randomUUID(), record({ bvid: 'BV1xNpFedE' + 'ABCDE'[index]! + '1', title: '视频' + index }));
    const summary = f.store.readingSummary(f.first, 2);
    assert.equal(summary.total, 5);
    assert.equal(summary.recent.length, 2);
    assert.equal(f.store.readingSummary(f.second).total, 0);
  } finally { f.store.close(); }
});

test('closed records need a conclusion or a recorded gap', async () => {
  const f = await fixture();
  try {
    assert.throws(() => f.store.saveReading(f.first, randomUUID(), record({ status: 'closed' })), /conclusion/i);
    assert.equal(f.store.saveReading(f.first, randomUUID(), record({ status: 'closed', gaps: ['没有字幕'] })).status, 'closed');
  } finally { f.store.close(); }
});

test('the same save request returns one record version', async () => {
  const f = await fixture();
  try {
    const requestId = randomUUID();
    const first = f.store.saveReading(f.first, requestId, record());
    const repeat = f.store.saveReading(f.first, requestId, record({ nextStep: '不应写入' }));
    assert.equal(repeat.version, first.version);
    assert.equal(f.store.reading(f.first, bvid)!.nextStep, '继续读评论区');

    const next = f.store.saveReading(f.first, randomUUID(), record({ nextStep: '看评论' }));
    assert.equal(next.version, 2);
  } finally { f.store.close(); }
});

test('the reading index stays bounded as a task accumulates videos', async () => {
  const f = await fixture();
  try {
    const suffixes = ['11', '22', '33', '44', '55', '66', '77', '88', '99', 'AA', 'BB', 'CC', 'DD', 'EE', 'FF', 'GG', 'HH', 'JJ', 'KK', 'LL'];
    for (const [index, suffix] of suffixes.entries()) {
      f.store.saveReading(f.first, randomUUID(), record({ bvid: 'BV1xNpFedE' + suffix, title: '视频' + index, updatedAt: new Date(Date.now() - index * 1000).toISOString() }));
    }
    const summary = f.store.readingSummary(f.first);
    assert.equal(summary.total, 20);
    assert.equal(summary.recent.length, 8);
    assert.ok(JSON.stringify(summary).length < 4096, 'index must stay small: ' + JSON.stringify(summary).length);
  } finally { f.store.close(); }
});

test('reading saves accept the persona request id format used by tools', async () => {
  const f = await fixture();
  try {
    const saved = f.store.saveReading(f.first, 'reading-1', record({ title: '工具请求' }));
    assert.equal(saved.title, '工具请求');
    assert.equal(f.store.reading(f.first, bvid)!.title, '工具请求');
  } finally { f.store.close(); }
});
