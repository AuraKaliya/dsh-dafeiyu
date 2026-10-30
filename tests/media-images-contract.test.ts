import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';

import { MediaReadSchema } from '../packages/contracts/lib/media.js';
import { imageSetGroupKey } from '../packages/media/lib/service.js';

const asset = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1 as const, id: randomUUID(), version: 1, kind: 'image' as const,
  sha256: 'a'.repeat(64), bytes: 1024, mime: 'image/jpeg', ...over,
});

function rejects(value: unknown, path: string) {
  try {
    MediaReadSchema.parse(value);
  } catch (error) {
    const issues = (error as { issues?: { path: (string | number)[] }[] }).issues ?? [];
    assert.ok(issues.length > 0, 'expected zod issues');
    if (path) assert.ok(issues.some(issue => issue.path.join('.') === path), `expected ${path}, got ${JSON.stringify(issues.map(issue => issue.path))}`);
    return;
  }
  assert.fail(`expected parse failure at ${path}`);
}

test('image sets are addressed by assets only and stay bounded', () => {
  const input = MediaReadSchema.parse({ requestId: randomUUID(), mode: 'images', assets: [asset(), asset()] });
  assert.equal(input.mode, 'images');
  assert.equal(input.assets?.length, 2);
  rejects({ requestId: randomUUID(), mode: 'images' }, '');
  rejects({ requestId: randomUUID(), mode: 'images', assets: [] }, 'assets');
  rejects({ requestId: randomUUID(), mode: 'images', assets: Array.from({ length: 7 }, () => asset()) }, 'assets');
  rejects({ requestId: randomUUID(), mode: 'images', assets: [asset()], source: { provider: 'bilibili', key: 'k' } }, '');
});

test('other read modes cannot smuggle an asset set', () => {
  rejects({ requestId: randomUUID(), mode: 'image', assets: [asset()] }, '');
  const single = MediaReadSchema.parse({ requestId: randomUUID(), mode: 'image', source: { provider: 'bilibili', key: 'frame:1' } });
  assert.equal(single.mode, 'image');
  assert.equal(single.assets, undefined);
});

test('frames from one batch group by provenance, not by their per-frame identity', () => {
  const origin = { provider: 'bilibili', key: 'page:1', version: 1, hash: 'a'.repeat(64), roots: [] };
  const base = { origin, kind: 'image', mimeHint: 'image/jpeg', rangeReadable: false, sourceFrame: { positionMs: 12000, durationMs: 180000 } };
  const first = imageSetGroupKey({ ...base, ref: { provider: 'bilibili', key: 'frame:1' }, name: 'frame-12000.jpg' });
  const second = imageSetGroupKey({ ...base, ref: { provider: 'bilibili', key: 'frame:2' }, name: 'frame:62000.jpg', sourceFrame: { positionMs: 62000, durationMs: 180000 } });
  assert.equal(first, second);
  const otherOrigin = imageSetGroupKey({ ...base, origin: { ...origin, key: 'page:2' }, ref: { provider: 'bilibili', key: 'frame:3' } });
  assert.notEqual(first, otherOrigin);
});

test('image sets accept either assets or sources, never both', () => {
  const source = { provider: 'bilibili', key: 'frame:1' };
  const bySource = MediaReadSchema.parse({ requestId: randomUUID(), mode: 'images', sources: [source] });
  assert.equal(bySource.sources?.length, 1);
  rejects({ requestId: randomUUID(), mode: 'images', assets: [asset()], sources: [source] }, '');
  rejects({ requestId: randomUUID(), mode: 'images' }, '');
  rejects({ requestId: randomUUID(), mode: 'image', sources: [source] }, '');
});
