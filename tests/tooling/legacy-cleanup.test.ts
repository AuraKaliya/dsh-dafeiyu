import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access, symlink, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planLegacy, applyLegacy } from '../../scripts/testing/legacy.ts';
import type { LegacyResult } from '../../scripts/testing/legacy.ts';

async function fixture(name = 'dafeiyu-qq-storage-ABC123') { const temp = await mkdtemp(join(tmpdir(), 'legacy-cleanup-fixture-')), root = join(temp, name); await mkdir(root); await writeFile(join(root, 'old-test.bin'), 'HISTORICAL_TEST'); return { temp, root }; }
async function apply(plan: unknown) { const results: LegacyResult[] = []; await applyLegacy(plan, async result => { results.push(result); }); return results; }

test('authorized historical directories are removed by source identity without interpreting test contents', async () => {
  const f = await fixture(), plan = await planLegacy(f.temp); assert.equal(plan.entries[0]?.status, 'selected'); assert.ok(plan.entries[0]?.sources.includes('tests/qq-storage.test.ts'));
  await writeFile(join(f.root, 'negative-model-config.json'), '{"provider":"example-real-route-used-as-test-data"}');
  assert.equal((await apply(plan))[0]?.state, 'removed'); await assert.rejects(access(f.root), { code: 'ENOENT' });
});
test('unknown directories and explicit old result reports remain protected', async () => {
  for (const name of ['dafeiyu-debug-ABC123', 'dafeiyu-qq-storage-ABC123']) { const f = await fixture(name); if (name.includes('storage')) await writeFile(join(f.root, 'report.json'), '{"evidence":true}');
    const plan = await planLegacy(f.temp); assert.equal(plan.entries[0]?.status, 'preserved'); assert.equal((await apply(plan))[0]?.state, 'preserved'); await access(f.root); }
});
test('tampered manifests and replaced directories cannot become deletion authority', async () => {
  const f = await fixture(), plan = await planLegacy(f.temp); await assert.rejects(apply({ ...plan, root: '..' }), /LEGACY_PLAN_CHANGED/);
  await rename(f.root, f.root + '-retained'); await mkdir(f.root); await writeFile(join(f.root, 'KEEP.txt'), 'NEW_DIRECTORY');
  assert.equal((await apply(plan))[0]?.reason, 'DIRECTORY_REPLACED'); assert.equal(await readFile(join(f.root, 'KEEP.txt'), 'utf8'), 'NEW_DIRECTORY');
});
test('directory links never expand historical cleanup beyond the selected Temp child', async () => {
  const f = await fixture(), protectedRoot = await mkdtemp(join(tmpdir(), 'protected-evidence-')); await writeFile(join(protectedRoot, 'KEEP.txt'), 'PROTECTED');
  await symlink(protectedRoot, join(f.temp, 'dafeiyu-test-XYZ123'), process.platform === 'win32' ? 'junction' : 'dir');
  await symlink(protectedRoot, join(f.root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  const results = await apply(await planLegacy(f.temp)); assert.equal(results.find(row => row.name === 'dafeiyu-test-XYZ123')?.state, 'preserved'); assert.equal(results.find(row => row.name === 'dafeiyu-qq-storage-ABC123')?.state, 'removed');
  assert.equal(await readFile(join(protectedRoot, 'KEEP.txt'), 'utf8'), 'PROTECTED');
});
