import assert from 'node:assert/strict';
import test from 'node:test';

import { BiliCommentPageSchema } from '../packages/contracts/lib/bili-reading.js';
import { commentPage } from '../packages/bilibili/lib/pages.js';

const listed = {
  items: [
    { id: '11', parent: null, root: null, author: '甲', text: '第一条', likes: 3, replies: 1 },
    { id: '12', parent: '11', root: '11', author: '乙', text: '楼中楼', likes: 0, replies: null },
  ],
  nextPage: 2,
};
const cursor = { aid: '900', parent: null as string | null, sort: 'hot' as const, page: 1 };

test('comment pages carry a cursor, drop already seen ids and map reply relations', () => {
  const first = commentPage(listed, cursor, []);
  assert.equal(first.items.length, 2);
  assert.equal(first.items[1]!.rootId, '11');
  assert.equal(first.items[1]!.parentId, '11');
  assert.deepEqual(first.nextCursor, { aid: '900', parent: null, sort: 'hot', page: 2, seen: ['11', '12'] });

  const resumed = commentPage(listed, { ...cursor, page: 2 }, ['11']);
  assert.deepEqual(resumed.items.map(item => item.id), ['12']);
  assert.equal(resumed.nextCursor!.page, 2);
});

test('comment pages stop at the last page and stay parseable as the contract', () => {
  const last = commentPage({ ...listed, nextPage: null }, cursor, []);
  assert.equal(last.nextCursor, null);
  const data = BiliCommentPageSchema.parse({ cursor: { ...cursor, seen: [] }, items: last.items, nextCursor: last.nextCursor, coverage: ['一页'] });
  assert.equal(data.gap, null);
  assert.equal(data.items.length, 2);
});

test('browser fallback marks the missing stable ids instead of faking a cursor', () => {
  const data = BiliCommentPageSchema.parse({
    cursor: { aid: '900', page: 1 },
    items: [], nextCursor: null, gap: 'BILI_COMMENTS_UNSTRUCTURED', text: '浏览器已加载的三条评论',
    coverage: ['没有稳定评论ID'],
  });
  assert.equal(data.gap, 'BILI_COMMENTS_UNSTRUCTURED');
  assert.equal(data.text, '浏览器已加载的三条评论');
  assert.equal(data.nextCursor, null);
});
