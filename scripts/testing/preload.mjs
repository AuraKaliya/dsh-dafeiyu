// Applies only to explicitly managed test child processes; never installed in a user/global environment.
import { mkdirSync, readFileSync, writeFileSync, realpathSync, lstatSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isMainThread } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

if (isMainThread) {
  const root = process.env.DAFEIYU_TEST_RUN, repository = resolve(fileURLToPath(new URL('../..', import.meta.url)));
  if (!root || !/^run-[a-f0-9-]{36}$/.test(root.split(/[\\/]/).at(-1)) || realpathSync.native(root).toLowerCase() !== resolve(root).toLowerCase()) throw new Error('MANAGED_TEST_RUN_REQUIRED');
  const run = JSON.parse(readFileSync(join(root, '.run.json'), 'utf8'));
  const storage = JSON.parse(readFileSync(join(dirname(root), '.owner.json'), 'utf8'));
  if (run.kind !== 'dafeiyu-test-run-v1' || run.repository !== repository || run.root !== root || run.state !== 'running'
    || storage.kind !== 'dafeiyu-test-storage-v1' || storage.repository !== repository || storage.root !== dirname(root)) throw new Error('TEST_OWNER_MISMATCH');
  const workers = join(root, 'workers');
  if (lstatSync(workers).isSymbolicLink() || realpathSync.native(workers).toLowerCase() !== workers.toLowerCase()) throw new Error('TEST_PATH_LINK_REFUSED');
  const id = randomUUID(), worker = join(workers, 'worker-' + id), temp = join(worker, 'tmp');
  mkdirSync(temp, { recursive: true });
  const home = join(root, 'environment', 'home');
  for (const dir of [home, join(home, 'AppData', 'Local'), join(home, 'AppData', 'Roaming'), join(worker, 'dsh-home')]) mkdirSync(dir, { recursive: true });
  Object.assign(process.env, { DAFEIYU_TEST_WORKER: worker, TEMP: temp, TMP: temp, TMPDIR: temp, DSH_HOME: join(worker, 'dsh-home'),
    HOME: home, USERPROFILE: home, LOCALAPPDATA: join(home, 'AppData', 'Local'), APPDATA: join(home, 'AppData', 'Roaming') });
  const entry = { kind: 'dafeiyu-test-process-v1', id, runId: run.id, pid: process.pid, parentPid: process.ppid, state: 'running', exitCode: null };
  const marker = join(worker, '.process.json'); writeFileSync(marker, JSON.stringify(entry), { flag: 'wx' });
  process.on('exit', exitCode => { try { writeFileSync(marker, JSON.stringify({ ...entry, state: 'exited', exitCode })); } catch { process.exitCode = 1; } });
}
