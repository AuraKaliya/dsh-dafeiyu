import { createHash } from 'node:crypto';
import { closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { check, freeze, samePath } from './safety.js';
import type { FileIdentity } from './safety.js';
import type { LegacyFileVersion } from './legacy-types.js';

const maxBytes = 2097152;
const identity = (stat: BigIntStats): FileIdentity => ({ dev: stat.dev.toString(), ino: stat.ino.toString() });
const sameIdentity = (a: FileIdentity, b: FileIdentity) => a.dev === b.dev && a.ino === b.ino;
const stamp = (stat: BigIntStats) => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, stat.nlink].map(String).join(':');
function statExisting(path: string): BigIntStats | null {
  try { return lstatSync(path, { bigint: true }); }
  catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null;
    throw new Error('LEGACY_FILE_UNAVAILABLE');
  }
}
export interface LegacyFileSnapshot { readonly path: string; readonly text: string; readonly version: LegacyFileVersion }

/** Existing-only bounded reads. No directory creation, writable handles or constructor side effects. */
export class LegacyFiles {
  readonly rootIdentity: FileIdentity;
  constructor(readonly root: string) {
    check(isAbsolute(root) && !root.includes('\0') && !/^\\\\|^\/\//.test(root) && samePath(root, resolve(root)), 'LEGACY_PATH_INVALID');
    this.rootIdentity = freeze(this.directory(root));
  }
  private directory(path: string): FileIdentity {
    const stat = statExisting(path);
    check(stat && stat.isDirectory() && !stat.isSymbolicLink() && samePath(realpathSync.native(path), path), 'LEGACY_PATH_INVALID');
    return identity(stat);
  }
  assertRoot(): void { check(sameIdentity(this.directory(this.root), this.rootIdentity), 'LEGACY_ROOT_CHANGED'); }
  read(relative: string): LegacyFileSnapshot | null {
    this.assertRoot();
    const parts = relative.split('/');
    check(parts.length > 1 && parts.every(part => !!part && part !== '.' && part !== '..' && !/[\\:\0]/.test(part)), 'LEGACY_PATH_INVALID');
    const directories: { path: string; identity: FileIdentity }[] = [];
    let current = this.root;
    for (const part of parts.slice(0, -1)) {
      current = join(current, part);
      const stat = statExisting(current);
      if (!stat) { this.assertRoot(); return null; }
      directories.push({ path: current, identity: this.directory(current) });
    }
    const path = join(current, parts.at(-1)!);
    const before = statExisting(path);
    if (!before) { this.assertRoot(); return null; }
    check(before.isFile() && !before.isSymbolicLink() && before.nlink === 1n && samePath(realpathSync.native(path), path), 'LEGACY_PATH_INVALID');
    check(before.size <= BigInt(maxBytes), 'LEGACY_FILE_TOO_LARGE');
    let descriptor: number;
    try { descriptor = openSync(path, 'r'); } catch { throw new Error('LEGACY_FILE_UNAVAILABLE'); }
    let bytes: Buffer;
    try {
      check(stamp(fstatSync(descriptor, { bigint: true })) === stamp(before), 'LEGACY_FILE_CHANGED');
      bytes = Buffer.alloc(Number(before.size));
      let offset = 0;
      while (offset < bytes.length) {
        const read = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
        check(read > 0, 'LEGACY_FILE_CHANGED'); offset += read;
      }
      check(readSync(descriptor, Buffer.alloc(1), 0, 1, bytes.length) === 0, 'LEGACY_FILE_CHANGED');
      check(stamp(fstatSync(descriptor, { bigint: true })) === stamp(before), 'LEGACY_FILE_CHANGED');
    } finally { closeSync(descriptor); }
    const after = statExisting(path);
    check(after && !after.isSymbolicLink() && stamp(after) === stamp(before), 'LEGACY_FILE_CHANGED');
    for (const directory of directories) check(sameIdentity(this.directory(directory.path), directory.identity), 'LEGACY_FILE_CHANGED');
    this.assertRoot();
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Error('LEGACY_ENCODING_INVALID'); }
    return freeze({ path: relative, text, version: { path: relative, ...identity(before), bytes: bytes.length,
      mtimeNs: before.mtimeNs.toString(), ctimeNs: before.ctimeNs.toString(), hash: createHash('sha256').update(bytes).digest('hex') } });
  }
  /** Detects ordinary concurrent replacement/edits; this is not a cross-file OS transaction. */
  unchanged(reads: ReadonlyMap<string, LegacyFileSnapshot | null>): void {
    for (const [path, previous] of reads) {
      const current = this.read(path);
      check(JSON.stringify(current?.version ?? null) === JSON.stringify(previous?.version ?? null), 'LEGACY_FILE_CHANGED');
    }
  }
}
