import assert from 'node:assert/strict';
import test from 'node:test';

import { BiliCommentCursorSchema, BiliSearchResultSchema } from '../packages/contracts/lib/bili-reading.js';
import { listing } from '../packages/bilibili/lib/pages.js';

test('search listing normalizes views, publish time and duration from platform rows', () => {
  const listed = listing({
    result: [
      { bvid: 'BV1xNpFedEwH', title: '<em>养鱼</em> 的第一年', author: 'UP甲', play: '1.2万', pubdate: 1767139200, duration: '03:21' },
      { bvid: 'BV1WqpS66E7w', title: '没有字段的视频', duration: 61 },
    ],
    numPages: 5,
  }, 'search', 1, 2);
  const first = listed.data.items[0]!;
  assert.equal(first.views, 12000);
  assert.equal(first.durationSeconds, 201);
  assert.equal(first.publishedAt, new Date(1767139200 * 1000).toISOString());
  assert.equal(first.author, 'UP甲');
  assert.equal(listed.data.items[1]!.views, null);
  assert.equal(listed.data.items[1]!.publishedAt, null);
  assert.equal(listed.data.nextPage, 2);
  assert.equal(listed.data.nextPageReason, 'next-page');

  const result = BiliSearchResultSchema.parse({ keyword: '养鱼', order: 'click', ...listed.data, coverage: listed.coverage });
  assert.equal(result.keyword, '养鱼');
  assert.equal(result.items.length, 2);
});

test('search listing stops when the platform has no more pages or returns a short page', () => {
  const short = listing({ result: [{ bvid: 'BV1xNpFedEwH', title: 't', duration: '00:10' }], numPages: 5 }, 'search', 1, 2);
  assert.equal(short.data.nextPage, null);
  assert.equal(short.data.nextPageReason, 'platform-no-more');
  const last = listing({ result: Array.from({ length: 5 }, () => ({ bvid: 'BV1xNpFedEwH', title: 't' })), numPages: 2 }, 'search', 2, 5);
  assert.equal(last.data.nextPage, null);
  assert.equal(last.data.nextPageReason, 'platform-no-more');
});

test('discover listing shares the candidate shape and view counts', () => {
  const listed = listing({ list: [{ bvid: 'BV1WqpS66E7w', title: '热门', owner: { name: 'UP乙' }, stat: { view: 9876 }, pubdate: 1767139200, duration: 125 }], no_more: false }, 'discover', 1, 10);
  const item = listed.data.items[0]!;
  assert.equal(item.author, 'UP乙');
  assert.equal(item.views, 9876);
  assert.equal(item.durationSeconds, 125);
  assert.equal(listed.data.nextPage, null);
});

test('a local page limit is reported separately from the platform having no more', () => {
  const rows = Array.from({ length: 5 }, () => ({ bvid: 'BV1xNpFedEwH', title: 't' }));
  const capped = listing({ result: rows, numPages: 99 }, 'search', 50, 5);
  assert.equal(capped.data.nextPage, null);
  assert.equal(capped.data.nextPageReason, 'local-page-limit');
});

test('comment cursors share one bound between input and output', () => {
  const seen = Array.from({ length: 500 }, (_, index) => String(1000 + index));
  const cursor = BiliCommentCursorSchema.parse({ aid: '900', seen });
  assert.equal(cursor.seen.length, 500);
  assert.throws(() => BiliCommentCursorSchema.parse({ aid: '900', seen: [...seen, '9999'] }));
});
