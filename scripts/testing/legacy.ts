import { readFile, readdir, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { physicalDirectory, removeTree, treeSize, within } from './files.ts';
import { repository } from './workspace.ts';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
async function sources(): Promise<Record<string, string[]>> {
  const result: Record<string, string[]> = {};
  for (const name of (await readdir(join(repository, 'tests'))).filter(name => name.endsWith('.ts'))) {
    for (const match of (await readFile(join(repository, 'tests', name), 'utf8')).matchAll(/mkdtemp\(join\(tmpdir\(\),\s*['"](dafeiyu-[a-z0-9-]+-)['"]/g)) (result[match[1]!] ??= []).push('tests/' + name);
  }
  return result;
}
async function allowedRoot(raw: string): Promise<string> {
  const root = await physicalDirectory(raw), temp = resolve(tmpdir());
  if (root !== temp && (!process.env.DAFEIYU_TEST_RUN || !within(root, temp) || !within(root, process.env.DAFEIYU_TEST_RUN))) throw new Error('LEGACY_ROOT_REFUSED');
  return root;
}
const entrySchema = z.strictObject({ name: z.string(), sources: z.array(z.string()), identity: z.string().nullable(),
  status: z.enum(['selected', 'preserved']), reason: z.string() });
const planSchema = z.strictObject({ kind: z.literal('dafeiyu-legacy-directory-cleanup-v1'), id: z.uuid(), repository: z.string(), root: z.string(),
  createdAt: z.iso.datetime(), entries: z.array(entrySchema), digest: z.string() });
export type LegacyPlan = z.infer<typeof planSchema>;
export interface LegacyResult { name: string; state: 'removed' | 'preserved' | 'failed'; reason: string; bytes: number }
async function identify(root: string, name: string, known: Record<string, string[]>): Promise<z.infer<typeof entrySchema>> {
  const prefix = Object.keys(known).find(prefix => name.startsWith(prefix) && /^[A-Za-z0-9]{6}$/.test(name.slice(prefix.length)));
  const entry: z.infer<typeof entrySchema> = { name, sources: prefix ? known[prefix]! : [], identity: null, status: 'preserved', reason: 'UNKNOWN_PREFIX' };
  if (!prefix) return entry;
  try {
    const path = join(root, name); await physicalDirectory(path); const stat = await lstat(path, { bigint: true });
    if (!stat.isDirectory()) throw new Error('NOT_A_DIRECTORY');
    // These old migration demonstrations have explicit result artifacts; preserve them separately.
    if ((await readdir(path)).some(file => /^report(?:[-.].*)?\.json$/i.test(file))) { entry.reason = 'PROTECTED_REPORT'; return entry; }
    entry.identity = `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`; entry.status = 'selected'; entry.reason = 'HISTORICAL_TEST_DIRECTORY';
  } catch { entry.reason = 'PATH_NOT_VERIFIED'; }
  return entry;
}
/** User-authorized directory cleanup, without re-evaluating or retaining individual old test contents. */
export async function planLegacy(rawRoot = tmpdir()): Promise<LegacyPlan> {
  const root = await allowedRoot(rawRoot), known = await sources(), entries: z.infer<typeof entrySchema>[] = [];
  for (const name of (await readdir(root)).filter(name => name.startsWith('dafeiyu-')).sort()) entries.push(await identify(root, name, known));
  const body = { kind: 'dafeiyu-legacy-directory-cleanup-v1' as const, id: randomUUID(), repository, root, createdAt: new Date().toISOString(), entries };
  return { ...body, digest: hash(JSON.stringify(body)) };
}
export async function applyLegacy(raw: unknown, record: (entry: LegacyResult) => Promise<void>, progress?: (done: number, total: number) => void): Promise<void> {
  const plan = planSchema.parse(raw), { digest, ...body } = plan;
  if (plan.repository !== repository || hash(JSON.stringify(body)) !== digest) throw new Error('LEGACY_PLAN_CHANGED');
  const root = await allowedRoot(plan.root), known = await sources(); let next = 0, done = 0;
  let recording = Promise.resolve();
  const save = (result: LegacyResult) => { recording = recording.then(() => record(result)); return recording; };
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < plan.entries.length) {
      const entry = plan.entries[next++]!;
      if (entry.status === 'preserved') await save({ name: entry.name, state: 'preserved', reason: entry.reason, bytes: 0 });
      else {
        const current = await identify(root, entry.name, known);
        if (current.status !== 'selected' || current.identity !== entry.identity) await save({ name: entry.name, state: 'preserved', reason: current.status !== 'selected' ? current.reason : 'DIRECTORY_REPLACED', bytes: 0 });
        else {
          let bytes = 0;
          try { const path = join(root, entry.name); bytes = (await treeSize(path)).bytes; await removeTree(path, root); await save({ name: entry.name, state: 'removed', reason: 'HISTORICAL_TEST_REMOVED', bytes }); }
          catch { await save({ name: entry.name, state: 'failed', reason: 'DELETE_FAILED', bytes }); }
        }
      }
      done++; if (done % 1000 === 0) progress?.(done, plan.entries.length);
    }
  }));
}
