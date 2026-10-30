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
    const saved = f.store.saveReading(f.first, record());
    assert.equal(saved.version, 1);
    assert.equal(f.store.reading(f.first, bvid)!.nextStep, '继续读评论区');
    assert.equal(f.store.reading(f.second, bvid), null, 'another task must not see this progress');

    const again = f.store.saveReading(f.first, record({ nextStep: '看评论' }));
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
      f.store.saveReading(f.first, record({ bvid: 'BV1xNpFedE' + 'ABCDE'[index]! + '1', title: '视频' + index }));
    const summary = f.store.readingSummary(f.first, 2);
    assert.equal(summary.total, 5);
    assert.equal(summary.recent.length, 2);
    assert.equal(f.store.readingSummary(f.second).total, 0);
  } finally { f.store.close(); }
});

test('closed records need a conclusion or a recorded gap', async () => {
  const f = await fixture();
  try {
    assert.throws(() => f.store.saveReading(f.first, record({ status: 'closed' })), /conclusion/i);
    assert.equal(f.store.saveReading(f.first, record({ status: 'closed', gaps: ['没有字幕'] })).status, 'closed');
  } finally { f.store.close(); }
});
