import { lstat, readdir, realpath, unlink, rmdir, statfs } from 'node:fs/promises';
import { resolve, relative, isAbsolute, dirname, sep } from 'node:path';

const key = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
export function within(path: string, root: string): boolean {
  const rest = relative(key(root), key(path));
  return rest !== '' && rest !== '..' && !rest.startsWith('..' + sep) && !isAbsolute(rest);
}
export async function physicalDirectory(path: string): Promise<string> {
  const absolute = resolve(path), info = await lstat(absolute);
  if (info.isSymbolicLink()) throw new Error('TEST_PATH_LINK_REFUSED');
  if (!info.isDirectory()) throw new Error('TEST_PATH_NOT_DIRECTORY');
  const actual = await realpath(absolute);
  if (key(actual) !== key(absolute)) throw new Error('TEST_PATH_LINK_REFUSED');
  return absolute;
}
export interface TreeSize { bytes: number; files: number; links: number }
/** Does not follow links, including Windows directory junctions. */
export async function treeSize(path: string): Promise<TreeSize> {
  const result: TreeSize = { bytes: 0, files: 0, links: 0 };
  async function visit(file: string): Promise<void> {
    let info; try { info = await lstat(file); } catch (error) { if (code(error) === 'ENOENT') return; throw error; }
    if (info.isSymbolicLink()) { result.links++; return; }
    if (info.isDirectory()) {
      let names: string[]; try { names = await readdir(file); } catch (error) { if (code(error) === 'ENOENT') return; throw error; }
      for (const name of names) await visit(resolve(file, name));
    }
    else { result.files++; result.bytes += info.size; }
  }
  await visit(path); return result;
}
export function code(error: unknown): string { return error && typeof error === 'object' && 'code' in error ? String(error.code) : 'UNKNOWN'; }
export function alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch (error) { return code(error) !== 'ESRCH'; } }
export async function freeBytes(path: string): Promise<number> { const stat = await statfs(path); return stat.bavail * stat.bsize; }

/** Exact owned target only. A link is unlinked, never descended; the root and each parent are checked. */
export async function removeTree(path: string, allowedRoot: string): Promise<void> {
  const root = await physicalDirectory(allowedRoot), target = resolve(path);
  if (!within(target, root)) throw new Error('TEST_DELETE_OUTSIDE_ROOT');
  await physicalDirectory(dirname(target));
  async function remove(file: string): Promise<void> {
    if (!within(file, root)) throw new Error('TEST_DELETE_OUTSIDE_ROOT');
    await physicalDirectory(dirname(file));
    const info = await lstat(file);
    if (info.isSymbolicLink() || !info.isDirectory()) { await unlink(file); return; }
    await physicalDirectory(file);
    const names = await readdir(file);
    names.sort((a, b) => Number(a.startsWith('.')) - Number(b.startsWith('.')) || a.localeCompare(b));
    for (const name of names) await remove(resolve(file, name));
    await rmdir(file);
  }
  for (let attempt = 0; ; attempt++) {
    try { await remove(target); return; }
    catch (error) {
      if (code(error) === 'ENOENT') {
        try { await lstat(target); } catch (missing) { if (code(missing) === 'ENOENT') return; throw missing; }
        if (attempt < 3) continue;
      }
      if (attempt >= 3 || !['EBUSY', 'EPERM', 'ENOTEMPTY', 'EACCES'].includes(code(error))) throw error;
      await new Promise(done => setTimeout(done, 100 * (attempt + 1)));
    }
  }
}
