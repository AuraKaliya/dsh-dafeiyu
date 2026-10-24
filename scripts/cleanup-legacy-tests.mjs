import { mkdir, writeFile, readFile, appendFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { planLegacy, applyLegacy } from './testing/legacy.ts';
import { freeBytes, physicalDirectory } from './testing/files.ts';
import { repository, TestStorage } from './testing/workspace.ts';

const directory = join(repository, '.runtime', 'test-cleanup');
await mkdir(directory, { recursive: true }); await physicalDirectory(directory);
const [mode, argument] = process.argv.slice(2);
const progress = (done, total) => console.log(JSON.stringify({ progress: done, total }));
const storage = new TestStorage(), unlock = await storage.lock(); let run, failed = false;
try {
const recovered = await storage.sweep(); if (recovered.blocked.length) throw new Error('TEST_CLEANUP_REQUIRED'); run = await storage.create();
if (mode === 'plan' && !argument) {
  const plan = await planLegacy(tmpdir());
  await writeFile(join(directory, plan.id + '.json'), JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' });
  const selected = plan.entries.filter(entry => entry.status === 'selected');
  const preserved = Object.fromEntries([...new Set(plan.entries.filter(entry => entry.status === 'preserved').map(entry => entry.reason))].map(reason => [reason, plan.entries.filter(entry => entry.reason === reason).length]));
  console.log(JSON.stringify({ id: plan.id, digest: plan.digest, directories: plan.entries.length, selected: selected.length, preserved, path: join(directory, plan.id + '.json') }));
} else if (mode === 'apply' && /^[a-f0-9-]{36}$/.test(argument ?? '')) {
  if (process.platform === 'win32') {
    const count = Number(execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', "@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match '(build-tests[\\/]|--test |run-tests\\.mjs)' }).Count"], { encoding: 'utf8', windowsHide: true }).trim());
    if (!Number.isFinite(count) || count > 0) throw new Error('LEGACY_TEST_PROCESS_ACTIVE');
  }
  const plan = JSON.parse(await readFile(join(directory, argument + '.json'), 'utf8'));
  const log = join(directory, argument + '.results.jsonl'); await writeFile(log, '', { flag: 'wx' });
  const before = await freeBytes(tmpdir()), counts = { removed: 0, preserved: 0, failed: 0 }, reasons = {}; let removedBytes = 0;
  await applyLegacy(plan, async result => {
    counts[result.state]++; reasons[result.reason] = (reasons[result.reason] ?? 0) + 1; if (result.state === 'removed') removedBytes += result.bytes;
    await appendFile(log, JSON.stringify(result) + '\n');
  }, progress);
  const after = await freeBytes(tmpdir()), remaining = (await readdir(tmpdir())).filter(name => name.startsWith('dafeiyu-')).length;
  const report = { schemaVersion: 1, id: plan.id, planDigest: plan.digest, at: new Date().toISOString(), counts, reasons, removedLogicalBytes: removedBytes, freeBytesBefore: before, freeBytesAfter: after,
    freeBytesChange: after - before, remaining, realModel: false, realPlatform: false, serverAccess: false };
  await writeFile(join(directory, argument + '.summary.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); console.log(JSON.stringify(report));
  if (counts.failed) process.exitCode = 1;
} else throw new Error('USE_PLAN_OR_APPLY_WITH_EXACT_PLAN_ID');
} catch (error) { failed = true; throw error; }
finally { try { if (run) { const cleanup = await storage.finish(run, failed ? 'failed' : 'passed'); if (cleanup.blocked.length) throw new Error('LEGACY_SCRATCH_CLEANUP_FAILED'); } } finally { await unlock(); } }
