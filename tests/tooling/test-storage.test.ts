import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { TestStorage, selectRetained, retention } from '../../scripts/testing/workspace.ts';
import { removeTree, treeSize } from '../../scripts/testing/files.ts';

async function fixture() { const outer = await mkdtemp(join(tmpdir(), 'test-governance-')); const storage = new TestStorage(join(outer, 'managed')); await storage.open(); return { outer, storage }; }
const missing = async (path: string) => { await assert.rejects(access(path), { code: 'ENOENT' }); };

test('success cleanup waits for the owning run to end, preserving repeated close/reopen data within that run', async () => {
  const { storage } = await fixture(), run = await storage.create(), file = join(run.root, 'restart-proof.txt');
  await writeFile(file, 'RESTART_PROOF'); assert.equal(await readFile(file, 'utf8'), 'RESTART_PROOF');
  const early = await storage.sweep(); assert.ok(early.blocked.some(row => row.code === 'TEST_PROCESS_ACTIVE')); assert.equal(await readFile(file, 'utf8'), 'RESTART_PROOF');
  const result = await storage.finish(run, 'passed'); assert.deepEqual(result.removed, [run.id]); assert.deepEqual(result.blocked, []); await missing(run.root);
});

test('unknown ownership, path escape and a replaced run junction cannot become cleanup targets', async () => {
  const { storage, outer } = await fixture(); await mkdir(join(storage.root, 'unrelated')); await writeFile(join(storage.root, 'unrelated', 'KEEP'), 'KEEP');
  const run = await storage.create(), marker = join(run.root, '.run.json'), saved: Record<string, unknown> = JSON.parse(await readFile(marker, 'utf8'));
  await writeFile(marker, JSON.stringify({ ...saved, repository: 'not-this-project' }));
  const result = await storage.sweep(); assert.equal(result.blocked.length, 2); await access(join(storage.root, 'unrelated', 'KEEP'));
  await assert.rejects(removeTree(storage.root, storage.root), /OUTSIDE_ROOT/); await assert.rejects(removeTree(outer, storage.root), /OUTSIDE_ROOT/);
  const other = await storage.create(); await removeTree(other.root, storage.root); await symlink(outer, other.root, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(storage.read(basename(other.root)), /LINK_REFUSED/); await access(join(storage.root, 'unrelated', 'KEEP'));
});

test('owned directory junctions are unlinked without following or removing their target', async () => {
  const { storage, outer } = await fixture(), run = await storage.create(), external = join(outer, 'protected');
  await mkdir(external); await writeFile(join(external, 'KEEP.txt'), 'PROTECTED'); await symlink(external, join(run.root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await treeSize(run.root)).links, 1); const result = await storage.finish(run, 'passed'); assert.deepEqual(result.blocked, []);
  await missing(run.root); assert.equal(await readFile(join(external, 'KEEP.txt'), 'utf8'), 'PROTECTED');
});

test('disk accounting tolerates test directories disappearing during a concurrent cleanup', async () => {
  const { storage } = await fixture(), run = await storage.create();
  for (let i = 0; i < 40; i++) { const directory = join(run.root, String(i)); await mkdir(directory); await writeFile(join(directory, 'sample.txt'), 'TEMPORARY'); }
  const [size] = await Promise.all([treeSize(run.root), storage.finish(run, 'passed')]); assert.ok(size.bytes >= 0); await missing(run.root);
});


test('retention enforces count, age and total bytes without waiting for wall time',()=>{
  const now=Date.parse('2026-10-29T00:00:00Z');
  const row=(id:string,age:number,bytes=1)=>({id,finishedAt:new Date(now-age).toISOString(),bytes});
  assert.deepEqual([...selectRetained([row('a',0),row('b',1),row('c',2),row('d',3)],now)],['a','b','c']);
  assert.deepEqual([...selectRetained([row('large',0,retention.bytes-1),row('overflow',1,2),row('fits',2),row('expired',retention.ageMs+1),row('future',-1)],now)],['large','fits']);
});
