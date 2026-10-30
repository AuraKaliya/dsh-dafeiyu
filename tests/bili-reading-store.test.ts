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

async function fixture() {
  const root = await mkdtemp(join(testTempDir(), 'bili-reading-')), file = join(root, 'bilibili.sqlite'), identity = { agentId: 'fish', profileId: 'test' };
  const taskId = randomUUID(), context: ExecutionContext = {
    agentId: 'fish', taskId, scope: { kind: 'task', agentId: 'fish', taskId, scopeKey: taskScopeKey('fish', taskId) },
    runId: randomUUID(), operationId: randomUUID(), origin: { kind: 'native', producerId: 'fixture', requestId: 'start' }, intentVersion: 1,
    grant: {} as ExecutionGrant, signal: new AbortController().signal,
  };
  return { file, identity, context, store: new BiliStore(file, identity, true) };
}

test('reading records persist with program facts and persona judgement', async () => {
  const f = await fixture();
  const saved = f.store.saveReading(f.context, {
    schemaVersion: 1, bvid, title: '养鱼第一年', author: 'UP甲', status: 'checkpoint',
    watched: [{ cid: '123', startMs: 0, endMs: 60000 }], commentCursor: { aid: '456', page: 2, seen: ['9'] },
    frames: [{ positionMs: 12000, sourceKey: 'frame:1' }], sources: ['page:1'],
    conclusion: null, gaps: ['评论区还没翻完'], nextStep: '继续读评论区',
  });
  assert.equal(saved.status, 'checkpoint');
  assert.ok(saved.updatedAt);
  assert.equal(f.store.reading(bvid)!.nextStep, '继续读评论区');
  f.store.close();

  const reopened = new BiliStore(f.file, f.identity);
  try {
    assert.equal(reopened.reading(bvid)!.gaps.length, 1);
    assert.equal(reopened.reading('BV1WqpS66E7w'), null);
  } finally {
    reopened.close();
  }
});

test('reading summary stays a bounded projection instead of replaying every record', async () => {
  const f = await fixture();
  try {
    for (let index = 0; index < 10; index += 1) {
      f.store.saveReading(f.context, {
        schemaVersion: 1, bvid: 'BV1xNpFedE' + ['12','34','56','78','9A','BC','DE','FG','HJ','KL'][index]!, title: `视频${index}`, author: 'UP',
        status: index === 0 ? 'closed' : 'checkpoint', watched: [], commentCursor: null, frames: [], sources: [],
        conclusion: index === 0 ? '这一条值得回看' : null, gaps: [], nextStep: `下一步${index}`,
      });
    }
    const summary = f.store.readingSummary(3);
    assert.equal(summary.total, 10);
    assert.equal(summary.recent.length, 3);
    assert.equal(summary.highlights.length, 1);
    assert.ok(summary.next);
  } finally {
    f.store.close();
  }
});

test('closed records need a conclusion or a recorded gap', async () => {
  const f = await fixture();
  try {
    assert.throws(() => f.store.saveReading(f.context, {
      schemaVersion: 1, bvid, title: 't', author: '', status: 'closed', watched: [], commentCursor: null,
      frames: [], sources: [], conclusion: null, gaps: [], nextStep: null,
    }), /conclusion/i);
  } finally {
    f.store.close();
  }
});
