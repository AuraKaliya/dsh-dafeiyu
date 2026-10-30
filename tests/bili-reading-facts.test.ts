import assert from 'node:assert/strict';
import test from 'node:test';

import { readingFacts } from '../packages/bilibili/lib/reading-facts.js';
import type { BiliPage } from '../packages/bilibili/lib/store.js';

const bvid = 'BV1xNpFedEwH';
const page = (id: string, kind: string, data: unknown) => ({ id, kind, data, owner: 'o', sourceKey: `${kind}:1`, sourceVersion: 1, fetchedAt: '2026-10-31T00:00:00.000Z', coverage: [], fields: [] } as unknown as BiliPage);

test('reading facts are derived from observed pages, never from judgement input', () => {
  const facts = readingFacts([
    page('p1', 'video', { bvid, aid: '900', title: '养鱼第一年', author: { uid: '1', name: 'UP甲' } }),
    page('p2', 'subtitles', { bvid, cid: '123', range: { startMs: 0, endMs: 60000 },entries:[{startMs:0,endMs:1000,text:'一'},{startMs:2000,endMs:3000,text:'二'}],nextOffset:2 }),
    page('p3', 'comments', { cursor: { aid: '900', page: 2, parent: null, sort: 'hot', seen: ['11', '22'] } }),
    page('p4', 'browser', { bvid, points: [{ positionMs: 12000, sourceKey: 'frame:abc', ok: true, errorCode: null }, { positionMs: 62000, sourceKey: null, ok: false, errorCode: 'BILI_BROWSER_POINT_TIMEOUT' }] }),
    page('p5', 'video', { bvid: 'BV1WqpS66E7w', aid: '901', title: '别的视频' }),
  ], bvid);

  assert.deepEqual(facts.watched, [{ cid: '123', startMs: 0, endMs: 1000 },{cid:'123',startMs:2000,endMs:3000}]);
  assert.deepEqual(facts.commentCursor, { aid: '900', parent: null, sort: 'hot', page: 2, seen: ['11', '22'] });
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
