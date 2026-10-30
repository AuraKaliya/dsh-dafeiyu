import assert from 'node:assert/strict';
import test from 'node:test';

import { readingFacts } from '../packages/bilibili/lib/reading-facts.js';
import type { BiliPage } from '../packages/bilibili/lib/store.js';

const bvid = 'BV1xNpFedEwH';
const page = (id: string, kind: string, data: unknown) => ({ id, kind, data, owner: 'o', sourceKey: `${kind}:1`, sourceVersion: 1, fetchedAt: '2026-10-31T00:00:00.000Z', coverage: [], fields: [] } as unknown as BiliPage);

test('reading facts are derived from observed pages, never from judgement input', () => {
  const facts = readingFacts([
    page('p1', 'video', { bvid, aid: '900', title: '养鱼第一年', author: { uid: '1', name: 'UP甲' } }),
    page('p2', 'subtitles', { bvid, cid: '123', range: { startMs: 0, endMs: 60000 } }),
    page('p3', 'comments', { aid: '900', page: 2, parent: null }),
    page('p4', 'browser', { bvid, capture: { source: { key: 'frame:abc' }, positionMs: 12000 } }),
    page('p5', 'video', { bvid: 'BV1WqpS66E7w', aid: '901', title: '别的视频' }),
  ], bvid);

  assert.deepEqual(facts.watched, [{ cid: '123', startMs: 0, endMs: 60000 }]);
  assert.deepEqual(facts.commentCursor, { aid: '900', parent: null, sort: 'hot', page: 2, seen: [] });
  assert.deepEqual(facts.frames, [{ positionMs: 12000, sourceKey: 'frame:abc' }]);
  assert.deepEqual(facts.sources, ['page:p1', 'page:p2', 'page:p3', 'page:p4']);
  assert.equal(facts.title, '养鱼第一年');
  assert.equal(facts.author, 'UP甲');
});

test('an unobserved video yields no facts and no sources', () => {
  const facts = readingFacts([page('p1', 'video', { bvid: 'BV1WqpS66E7w', aid: '901', title: '别的视频' })], bvid);
  assert.equal(facts.sources.length, 0);
  assert.equal(facts.title, null);
  assert.equal(facts.commentCursor, null);
  assert.deepEqual(facts.frames, []);
});
