import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { memoryFixture } from '../build-tests/memory-fixture.js';

const root = resolve('.runtime/demos', `memory-${randomUUID()}`);
await mkdir(root, { recursive: true });
const h = await memoryFixture(root);
const okay = result => { assert.equal(result.status, 'ok'); return result; };
try {
  const source = await h.evidence('scene-a', '虚构测试约定：本项目代号是紫帆731。');
  const created = okay(await h.probe('scene-a', context => h.memory.create(context, {
    requestId: 'demo-create', kind: 'knowledge', claimType: 'self_report', content: '虚构项目代号：紫帆731', sourceRefs: [source.ref],
  })));
  const correction = await h.evidence('scene-a', '更正：项目代号改为青鱼888。');
  const revised = okay(await h.probe('scene-a', context => h.memory.revise(context, {
    id: created.id, expectedVersion: created.version, requestId: 'demo-revise', kind: 'knowledge', claimType: 'self_report',
    content: '虚构项目代号：青鱼888', sourceRefs: [source.ref, correction.ref],
  })));
  const historical = okay(await h.probe('scene-a', context => h.memory.read(context, { id: created.id, mode: 'history', revision: 1 })));
  const foreign = await h.probe('scene-b', context => h.memory.read(context, { id: created.id }));
  assert.equal(foreign.status, 'not_found');
  const deleted = okay(await h.probe('scene-a', context => h.memory.delete(context, {
    id: created.id, expectedVersion: revised.version, requestId: 'demo-delete', reason: '虚构用户明确要求遗忘',
  })));
  const normal = okay(await h.probe('scene-a', context => h.memory.search(context, {})));
  assert.equal(normal.items.length, 0);
  const deletedLookup = okay(await h.probe('scene-a', context => h.memory.readDeleted(context, { id: created.id })));
  assert.equal(deletedLookup.item.useRestriction, 'deleted_lookup_only');
  const restored = okay(await h.probe('scene-a', context => h.memory.restore(context, {
    id: created.id, expectedVersion: deleted.version, requestId: 'demo-restore', reason: '虚构用户明确要求恢复',
  })));
  const final = okay(await h.probe('scene-a', context => h.memory.read(context, { id: created.id })));
  assert.equal(final.item.content, '虚构项目代号：青鱼888');
  const result = {
    scenario: 'Real DSH services with scripted model and fictional evidence; no live QQ or server',
    created, revised, deleted, restored, historicalContent: historical.item.content,
    crossConversation: foreign.status, normalResultsAfterDelete: normal.items.length,
    deletedLookupRestriction: deletedLookup.item.useRestriction, restoredContent: final.item.content,
    restoredSources: final.item.sources, root,
  };
  await writeFile(resolve(root, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally { await h.close(); }
