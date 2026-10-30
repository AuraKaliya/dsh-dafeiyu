import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';

import { MediaReadSchema } from '../packages/contracts/lib/media.js';

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
