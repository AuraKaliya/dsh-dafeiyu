import { mkdir, readFile, writeFile, rename, readdir, lstat, unlink } from 'node:fs/promises';
import { resolve, join, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { alive, code, freeBytes, physicalDirectory, removeTree, treeSize, within } from './files.ts';

export const repository = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const defaultRoot = join(repository, '.runtime', 'tests');
export const retention = Object.freeze({ count: 3, ageMs: 72 * 60 * 60 * 1000, bytes: 1024 ** 3 });
export const budgets = Object.freeze({ minFreeBytes: 5 * 1024 ** 3, runBytes: 2 * 1024 ** 3, runMs: 10 * 60 * 1000 });
export function selectRetained(candidates: readonly { id: string; finishedAt: string; bytes: number }[], now: number): Set<string> {
  const selected = new Set<string>(); let bytes = 0;
  for (const candidate of [...candidates].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt) || a.id.localeCompare(b.id))) {
    const age = now - Date.parse(candidate.finishedAt);
    if (age >= 0 && age <= retention.ageMs && selected.size < retention.count && bytes + candidate.bytes <= retention.bytes) {
      selected.add(candidate.id); bytes += candidate.bytes;
    }
  }
  return selected;
}
const ownerSchema = z.strictObject({ kind: z.literal('dafeiyu-test-storage-v1'), repository: z.string(), root: z.string() });
const runSchema = z.strictObject({ kind: z.literal('dafeiyu-test-run-v1'), id: z.uuid(), repository: z.string(), root: z.string(),
  pid: z.number().int().positive(), createdAt: z.iso.datetime(), finishedAt: z.iso.datetime().nullable(),
  state: z.enum(['running', 'passed', 'failed', 'interrupted', 'cleanup-failed']), reason: z.string().regex(/^[A-Z0-9_]{1,100}$/).nullable() });
export type TestRun = z.infer<typeof runSchema>;
export const processSchema = z.strictObject({ kind: z.literal('dafeiyu-test-process-v1'), id: z.uuid(), runId: z.uuid(),
  pid: z.number().int().positive(), parentPid: z.number().int().nonnegative(), state: z.enum(['running', 'exited']), exitCode: z.number().int().nullable() });
export interface CleanupResult { removed: string[]; retained: { id: string; bytes: number }[]; blocked: { name: string; code: string }[] }
async function json(file: string): Promise<unknown> { const info = await lstat(file); if (!info.isFile() || info.isSymbolicLink() || info.size > 65536) throw new Error('TEST_MARKER_INVALID'); return JSON.parse(await readFile(file, 'utf8')) as unknown; }
async function save(file: string, value: unknown): Promise<void> { const temp = file + '.' + randomUUID() + '.tmp'; await writeFile(temp, JSON.stringify(value) + '\n', { flag: 'wx' }); await rename(temp, file); }

export class TestStorage {
  readonly root: string;
  constructor(root = defaultRoot) {
    this.root = resolve(root);
    // Alternative roots are test fixtures inside an already managed run, never arbitrary cleanup destinations.
    if (this.root !== defaultRoot && (!process.env.DAFEIYU_TEST_RUN || !within(this.root, process.env.DAFEIYU_TEST_RUN))) throw new Error('TEST_STORAGE_ROOT_REFUSED');
    if (process.platform === 'win32' && !/^D:\\/i.test(this.root)) throw new Error('TEST_STORAGE_REQUIRES_D_DRIVE');
  }
  async open(): Promise<void> {
    await physicalDirectory(repository);
    await mkdir(dirname(this.root), { recursive: true }); await physicalDirectory(dirname(this.root));
    try { await mkdir(this.root); } catch (error) { if (code(error) !== 'EEXIST') throw error; }
    await physicalDirectory(this.root);
    const owner = join(this.root, '.owner.json');
    try {
      const stored = ownerSchema.parse(await json(owner));
      if (stored.repository !== repository || stored.root !== this.root) throw new Error('TEST_STORAGE_OWNER_MISMATCH');
    } catch (error) {
      if (code(error) !== 'ENOENT') throw error;
      if ((await readdir(this.root)).length) throw new Error('TEST_STORAGE_UNMARKED');
      await writeFile(owner, JSON.stringify({ kind: 'dafeiyu-test-storage-v1', repository, root: this.root }) + '\n', { flag: 'wx' });
    }
  }
  async lock(): Promise<() => Promise<void>> {
    await this.open(); const file = join(this.root, '.runner.lock'), id = randomUUID();
    for (let attempt = 0; attempt < 2; attempt++) {
      try { await writeFile(file, JSON.stringify({ id, pid: process.pid }), { flag: 'wx' }); return async () => {
        const held = z.object({ id: z.uuid(), pid: z.number().int().positive() }).parse(await json(file));
        if (held.id !== id || held.pid !== process.pid) throw new Error('TEST_LOCK_CHANGED'); await unlink(file);
      }; } catch (error) {
        if (code(error) !== 'EEXIST') throw error;
        const old = z.strictObject({ id: z.uuid(), pid: z.number().int().positive() }).parse(await json(file));
        if (alive(old.pid)) throw new Error('TEST_RUN_ALREADY_ACTIVE'); await unlink(file);
      }
    }
    throw new Error('TEST_LOCK_UNAVAILABLE');
  }
  async create(): Promise<TestRun> {
    await this.open(); const id = randomUUID(), root = join(this.root, 'run-' + id);
    await mkdir(root); await mkdir(join(root, 'workers')); await mkdir(join(root, 'environment', 'tmp'), { recursive: true }); await mkdir(join(root, 'environment', 'home'));
    const run: TestRun = { kind: 'dafeiyu-test-run-v1', id, repository, root, pid: process.pid, createdAt: new Date().toISOString(), finishedAt: null, state: 'running', reason: null };
    await writeFile(join(root, '.run.json'), JSON.stringify(run) + '\n', { flag: 'wx' }); return run;
  }
  async read(name: string): Promise<TestRun> {
    if (!/^run-[a-f0-9-]{36}$/.test(name)) throw new Error('TEST_RUN_NAME_INVALID');
    const root = join(this.root, name); await physicalDirectory(root); const value = runSchema.parse(await json(join(root, '.run.json')));
    if (value.repository !== repository || value.root !== root || name !== 'run-' + value.id) throw new Error('TEST_RUN_OWNER_MISMATCH'); return value;
  }
  async workersLive(run: TestRun): Promise<boolean> {
    const root = join(run.root, 'workers'); await physicalDirectory(root);
    for (const name of await readdir(root)) {
      if (!/^worker-[a-f0-9-]{36}$/.test(name)) throw new Error('TEST_WORKER_INVALID');
      await physicalDirectory(join(root, name)); const entry = processSchema.parse(await json(join(root, name, '.process.json')));
      if (entry.runId !== run.id || name !== 'worker-' + entry.id) throw new Error('TEST_WORKER_INVALID');
      if (entry.state === 'running' && alive(entry.pid)) return true;
    }
    return false;
  }
  async finish(run: TestRun, state: 'passed' | 'failed' | 'interrupted', reason: string | null = null): Promise<CleanupResult> {
    const value = await this.read(basename(run.root));
    if (value.pid !== process.pid || value.id !== run.id) throw new Error('TEST_RUN_OWNER_MISMATCH');
    await save(join(run.root, '.run.json'), runSchema.parse({ ...value, state, reason, finishedAt: new Date().toISOString() }));
    return this.sweep(Date.now(), run.id);
  }
  async sweep(now = Date.now(), finishingId?: string): Promise<CleanupResult> {
    await this.open(); const result: CleanupResult = { removed: [], retained: [], blocked: [] }, failures: TestRun[] = [];
    for (const name of await readdir(this.root)) {
      if (['.owner.json', '.runner.lock'].includes(name)) continue;
      try {
        let run = await this.read(name);
        if (run.id !== finishingId && alive(run.pid) && run.state === 'running' || await this.workersLive(run)) { result.blocked.push({ name, code: 'TEST_PROCESS_ACTIVE' }); continue; }
        if (run.state === 'running') {
          run = { ...run, state: 'interrupted', finishedAt: run.createdAt, reason: 'TEST_PROCESS_EXITED_WITHOUT_CLEANUP' };
          await save(join(run.root, '.run.json'), run);
        }
        if (run.state === 'passed' || run.state === 'cleanup-failed') await this.remove(run, result);
        else failures.push(run);
      } catch { result.blocked.push({ name, code: 'TEST_RUN_INSPECTION_FAILED' }); }
    }
    const sizes = new Map<string, number>();
    for (const run of failures) try { sizes.set(run.id, (await treeSize(run.root)).bytes); } catch { result.blocked.push({ name: basename(run.root), code: 'TEST_RETENTION_FAILED' }); }
    const selected = selectRetained(failures.filter(run => sizes.has(run.id)).map(run => ({ id: run.id, finishedAt: run.finishedAt ?? run.createdAt, bytes: sizes.get(run.id)! })), now);
    for (const run of failures) {
      if (!sizes.has(run.id)) continue;
      try {
        if (selected.has(run.id)) result.retained.push({ id: run.id, bytes: sizes.get(run.id)! });
        else await this.remove(run, result);
      } catch { result.blocked.push({ name: basename(run.root), code: 'TEST_RETENTION_FAILED' }); }
    }
    return result;
  }
  private async remove(run: TestRun, result: CleanupResult): Promise<void> {
    try { await this.read(basename(run.root)); await removeTree(run.root, this.root); result.removed.push(run.id); }
    catch {
      try { await physicalDirectory(run.root); await save(join(run.root, '.run.json'), run); } catch { /* Never restore a marker through a link or missing path. */ }
      result.blocked.push({ name: basename(run.root), code: 'TEST_CLEANUP_FAILED' });
    }
  }
}
export function childEnvironment(run: TestRun): NodeJS.ProcessEnv {
  const preloader = pathToFileURL(join(repository, 'scripts', 'testing', 'preload.mjs')).href;
  return { ...process.env, DAFEIYU_TEST_RUN: run.root, DAFEIYU_TEST_WORKER: '', TEMP: join(run.root, 'environment', 'tmp'), TMP: join(run.root, 'environment', 'tmp'), TMPDIR: join(run.root, 'environment', 'tmp'),
    NODE_OPTIONS: [process.env.NODE_OPTIONS ?? '', '--import=' + preloader].filter(Boolean).join(' ') };
}
export async function budgetCheck(run: TestRun): Promise<string | null> {
  if (Date.now() - Date.parse(run.createdAt) > budgets.runMs) return 'TEST_TIME_BUDGET_EXCEEDED';
  if (await freeBytes(run.root) < budgets.minFreeBytes) return 'TEST_DISK_RESERVE_LOW';
  if ((await treeSize(run.root)).bytes > budgets.runBytes) return 'TEST_DISK_BUDGET_EXCEEDED';
  return null;
}
