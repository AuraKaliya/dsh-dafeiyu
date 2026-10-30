import assert from 'node:assert/strict';
import test from 'node:test';

import { boundedReadingView } from '../packages/bilibili/lib/reading-view.js';
import type { BiliReadingRecord } from '@dafeiyu/contracts';

const record = (index: number, over: Partial<BiliReadingRecord> = {}): BiliReadingRecord => ({
  schemaVersion: 1, version: 1, aid: null, bvid: 'BV1xNpFedE' + ['12', '34', '56', '78', '9A', 'BC', 'DE', 'FG', 'HJ', 'KL'][index % 10]!,
  title: '视频' + index, author: 'UP',
  status: index === 0 ? 'open' : 'closed',
  watched: [{ cid: '1', startMs: 0, endMs: 60000 }], commentCursor: null, frames: [], sources: ['page:1'],
  conclusion: '结论'.repeat(200), gaps: [], nextStep: index === 0 ? '继续看评论区'.repeat(20) : null,
  updatedAt: '2026-10-31T00:00:00.000Z', ...over,
});

test('a bounded view stays small while the store keeps growing', () => {
  const small = JSON.stringify(boundedReadingView([record(0)]));
  const large = JSON.stringify(boundedReadingView(Array.from({ length: 100 }, (_, index) => record(index))));
  assert.ok(large.length < 4096, `view too large: ${large.length}`);
  assert.ok(large.length < small.length * 8, 'view must not grow linearly: ' + large.length + ' vs ' + small.length);
});

test('only the most recent records and one next step enter the view', () => {
  const view = boundedReadingView(Array.from({ length: 20 }, (_, index) => record(index)), 8);
  assert.equal(view.total, 20);
  assert.equal(view.recent.length, 8);
  assert.equal(view.open?.bvid, record(0).bvid);
  assert.ok((view.open?.nextStep?.length ?? 0) <= 200);
  assert.ok(view.recent.every(item => (item.conclusion?.length ?? 0) <= 300));
  assert.deepEqual(view.reopen, view.recent.map(item => item.bvid));
});

test('a fully closed history exposes no next step', () => {
  const view = boundedReadingView([record(1), record(2)]);
  assert.equal(view.open, null);
  assert.equal(view.total, 2);
});
