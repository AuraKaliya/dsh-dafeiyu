import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { TestStorage, selectRetained, retention, childEnvironment } from '../../scripts/testing/workspace.ts';
import { removeTree, treeSize } from '../../scripts/testing/files.ts';

async function fixture() { const outer = await mkdtemp(join(tmpdir(), 'test-governance-')); const storage = new TestStorage(join(outer, 'managed')); await storage.open(); return { outer, storage }; }
const missing = async (path: string) => { await assert.rejects(access(path), { code: 'ENOENT' }); };

test('test processes and descendants allocate scratch and home data only within the managed D-drive run', async () => {
  const root = process.env.DAFEIYU_TEST_RUN!; assert.ok(tmpdir().startsWith(root)); assert.ok(process.env.DSH_HOME?.startsWith(root));
  if (process.platform === 'win32') assert.match(root, /^D:\\/i);
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', 'import {tmpdir,homedir} from "node:os";console.log(JSON.stringify({tmp:tmpdir(),home:homedir(),dsh:process.env.DSH_HOME,pid:process.pid}))'], { windowsHide: true });
  const child: { tmp: string; home: string; dsh: string; pid: number } = JSON.parse(stdout);
  assert.ok(child.tmp.startsWith(root)); assert.ok(child.home.startsWith(root)); assert.ok(child.dsh.startsWith(root)); assert.notEqual(child.tmp, tmpdir());
});

test('success cleanup waits for the owning run to end, preserving repeated close/reopen data within that run', async () => {
  const { storage } = await fixture(), run = await storage.create(), file = join(run.root, 'restart-proof.txt');
  await writeFile(file, 'RESTART_PROOF'); assert.equal(await readFile(file, 'utf8'), 'RESTART_PROOF');
  const early = await storage.sweep(); assert.ok(early.blocked.some(row => row.code === 'TEST_PROCESS_ACTIVE')); assert.equal(await readFile(file, 'utf8'), 'RESTART_PROOF');
  const result = await storage.finish(run, 'passed'); assert.deepEqual(result.removed, [run.id]); assert.deepEqual(result.blocked, []); await missing(run.root);
});

test('retention retains no more than three failures, expires after 72 hours and applies the combined 1 GiB cap', async () => {
  const { storage } = await fixture(), failures: string[] = [];
  for (let i = 0; i < 4; i++) { const run = await storage.create(); failures.push(run.root); await writeFile(join(run.root, 'failure.txt'), String(i)); await storage.finish(run, 'failed'); await new Promise(done => setTimeout(done, 5)); }
  await missing(failures[0]!); for (const path of failures.slice(1)) await access(path);
  const expired = await storage.sweep(Date.now() + retention.ageMs + 1); assert.equal(expired.retained.length, 0); for (const path of failures) await missing(path);
  const now = Date.now(), at = (age: number) => new Date(now - age).toISOString();
  const kept = selectRetained([{ id: 'new', finishedAt: at(0), bytes: 600 * 1024 ** 2 }, { id: 'over-combined', finishedAt: at(1), bytes: 500 * 1024 ** 2 },
    { id: 'fits', finishedAt: at(2), bytes: 400 * 1024 ** 2 }, { id: 'oversize', finishedAt: at(3), bytes: retention.bytes + 1 },
    { id: 'expired', finishedAt: at(retention.ageMs + 1), bytes: 1 }], now);
  assert.deepEqual([...kept], ['new', 'fits']);
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

test('a killed process leaves a discoverable run that is retained as interrupted and later expires', async () => {
  const { storage } = await fixture();
  const child = spawn(process.execPath, ['tests/tooling/crash-fixture.ts', storage.root], { cwd: resolve('.'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = once(child, 'close'); let data = '';
  const info = await new Promise<{ root: string; id: string }>((done, reject) => { child.once('error', reject); child.stdout.on('data', chunk => { data += String(chunk); if (data.includes('\n')) done(JSON.parse(data.trim())); }); child.once('exit', () => { if (!data) reject(new Error('CRASH_FIXTURE_DID_NOT_START')); }); });
  child.kill('SIGKILL'); await closed;
  const result = await storage.sweep(); assert.equal(result.retained[0]?.id, info.id); const row = await storage.read(basename(info.root)); assert.equal(row.state, 'interrupted');
  await storage.sweep(Date.now() + retention.ageMs + 1); await missing(info.root);
});

test('an active worker prevents success cleanup and retry succeeds only after that worker exits', async () => {
  const { storage } = await fixture(), run = await storage.create();
  const child = spawn(process.execPath, ['-e', 'console.log("READY");setInterval(()=>{},1000)'], { windowsHide: true, env: childEnvironment(run), stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = once(child, 'close'); await once(child.stdout, 'data');
  const result = await storage.finish(run, 'passed'); assert.ok(result.blocked.some(row => row.code === 'TEST_PROCESS_ACTIVE')); await access(run.root);
  child.kill('SIGKILL'); await closed; const retried = await storage.sweep(); assert.ok(retried.removed.includes(run.id)); await missing(run.root);
});

test('cleanup reports a real Windows locked-file failure and removes the run on a later retry', { skip: process.platform !== 'win32' }, async () => {
  const { storage } = await fixture(), run = await storage.create(), file = join(run.root, 'locked.txt'); await writeFile(file, 'LOCK_FIXTURE');
  const literal = file.replaceAll("'", "''");
  const script = `$f=[IO.File]::Open('${literal}',[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None);try{[Console]::WriteLine('READY');[Console]::In.ReadLine()|Out-Null}finally{$f.Dispose()}`;
  const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = once(child, 'close'); await once(child.stdout, 'data');
  try { const result = await storage.finish(run, 'passed'); assert.ok(result.blocked.some(row => row.code === 'TEST_CLEANUP_FAILED')); await access(run.root); }
  finally { child.stdin.end('\n'); await closed; }
  assert.ok((await storage.sweep()).removed.includes(run.id)); await missing(run.root);
});

test('ordinary test fixtures cannot bypass the guarded temporary-directory helper', async () => {
  for (const file of (await readdir('tests')).filter(name => name.endsWith('.ts') && name !== 'test-temp.ts')) {
    const text = await readFile(join('tests', file), 'utf8'); assert.doesNotMatch(text, /import\s*\{[^}]*tmpdir[^}]*\}\s*from\s*['"]node:os['"]/, file);
  }
});

test('disk accounting tolerates test directories disappearing during a concurrent cleanup', async () => {
  const { storage } = await fixture(), run = await storage.create();
  for (let i = 0; i < 40; i++) { const directory = join(run.root, String(i)); await mkdir(directory); await writeFile(join(directory, 'sample.txt'), 'TEMPORARY'); }
  const [size] = await Promise.all([treeSize(run.root), storage.finish(run, 'passed')]); assert.ok(size.bytes >= 0); await missing(run.root);
});
