import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BiliCommentCursorSchema, BiliCommentPageSchema, BiliFrameBatchRequestSchema, BiliFrameBatchResultSchema,
  BiliReadingIndexSchema, BiliReadingRecordSchema, BiliSearchQuerySchema, BiliSearchResultSchema,
} from '../packages/contracts/lib/bili-reading.js';

const bvid = 'BV1xNpFedEwH';

function rejects(schema: { parse: (value: unknown) => unknown }, value: unknown, path: string) {
  try {
    schema.parse(value);
  } catch (error) {
    const issues = (error as { issues?: { path: (string | number)[] }[] }).issues ?? [];
    assert.ok(issues.some(issue => issue.path.join('.') === path), `expected issue at ${path}, got ${JSON.stringify(issues.map(issue => issue.path))}`);
    return;
  }
  assert.fail(`expected parse failure at ${path}`);
}

test('search query is keyword-first, bounded and defaulted', () => {
  const query = BiliSearchQuerySchema.parse({ keyword: '  养鱼  ' });
  assert.equal(query.keyword, '养鱼');
  assert.equal(query.order, 'totalrank');
  assert.equal(query.page, 1);
  assert.equal(query.limit, 10);
  rejects(BiliSearchQuerySchema, { keyword: '   ' }, 'keyword');
  rejects(BiliSearchQuerySchema, { keyword: 'x', limit: 21 }, 'limit');
  assert.throws(() => BiliSearchQuerySchema.parse({ keyword: 'x', source: 'B站搜索：x' }), /source/i);
});

test('search results keep missing platform fields null and expose the next page', () => {
  const result = BiliSearchResultSchema.parse({
    keyword: '养鱼', order: 'click', page: 1, limit: 2,
    items: [{ bvid, title: '标题' }, { bvid: 'BV1WqpS66E7w', title: '标题二', author: 'UP', views: 1200, durationSeconds: 61 }],
    nextPage: 2,
  });
  assert.equal(result.items[0]!.aid, null);
  assert.equal(result.items[0]!.author, '');
  assert.equal(result.items[0]!.publishedAt, null);
  assert.equal(result.items[1]!.views, 1200);
  assert.deepEqual(result.coverage, []);
  assert.equal(BiliSearchResultSchema.parse({ keyword: 'k', order: 'pubdate', page: 1, limit: 10, items: [], nextPage: null }).nextPage, null);
});

test('comment cursors carry position and dedupe ids instead of replaying page one', () => {
  const cursor = BiliCommentCursorSchema.parse({ aid: '123' });
  assert.equal(cursor.parent, null);
  assert.equal(cursor.sort, 'hot');
  assert.deepEqual(cursor.seen, []);
  const page = BiliCommentPageSchema.parse({
    cursor: { aid: '123', page: 2, seen: ['9'] },
    items: [{ id: '10', text: '评论', author: '人', likes: 3 }],
    nextCursor: { aid: '123', page: 3 },
  });
  assert.equal(page.items[0]!.rootId, null);
  assert.notEqual(typeof page.nextCursor,'string');
  assert.equal(typeof page.nextCursor==='object'?page.nextCursor?.page:null,3);
});

test('frame batches reject duplicates and cap at six points', () => {
  const request = BiliFrameBatchRequestSchema.parse({ bvid, pointsMs: [12000, 62000, 112000] });
  assert.deepEqual(request.pointsMs, [12000, 62000, 112000]);
  rejects(BiliFrameBatchRequestSchema, { bvid, pointsMs: [1000, 1000] }, 'pointsMs');
  rejects(BiliFrameBatchRequestSchema, { bvid, pointsMs: [1, 2, 3, 4, 5, 6, 7] }, 'pointsMs');
  const result = BiliFrameBatchResultSchema.parse({
    bvid, reused: true, coverage: ['同一页面复用'],
    points: [{ positionMs: 12000, sourceKey: 'browser-frame:a', ok: true }, { positionMs: 62000, ok: false, errorCode: 'BILI_FRAME_MISSING' }],
  });
  assert.equal(result.points[0]!.ok, true);
  assert.equal(result.points[0]!.errorCode, null);
  assert.equal(result.points[1]!.ok, false);
});

test('reading records separate program facts from persona judgement', () => {
  const base = {
    schemaVersion: 1 as const, bvid, title: '标题', author: 'UP', status: 'checkpoint' as const,
    watched: [{ cid: '1', startMs: 0, endMs: 60000 }], commentCursor: null,
    frames: [{ positionMs: 12000, sourceKey: 'browser-frame:a' }], sources: ['page:1'],
    conclusion: null, gaps: [], nextStep: null, updatedAt: new Date().toISOString(),
  };
  assert.equal(BiliReadingRecordSchema.parse(base).status, 'checkpoint');
  rejects(BiliReadingRecordSchema, { ...base, watched: [{ cid: '1', startMs: 60000, endMs: 60000 }] }, 'watched');
  rejects(BiliReadingRecordSchema, { ...base, status: 'closed' }, 'conclusion');
  assert.equal(BiliReadingRecordSchema.parse({ ...base, status: 'closed', gaps: ['没有字幕'] }).gaps.length, 1);
});

test('reading index stays a bounded projection for long-task context', () => {
  const index = BiliReadingIndexSchema.parse({ total: 20, recent: [], highlights: [], next: null });
  assert.equal(index.total, 20);
  assert.equal(index.next, null);
  rejects(BiliReadingIndexSchema, {
    total: 1, next: null,
    recent: Array.from({ length: 9 }, () => ({ bvid, title: 't', status: 'closed', conclusion: null })),
    highlights: [],
  }, 'recent');
});
