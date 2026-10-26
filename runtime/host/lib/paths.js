import { existsSync, realpathSync, statSync, readdirSync } from 'node:fs';
import { dirname, resolve, join, relative, sep, isAbsolute } from 'node:path';
export function physicalPath(path) { const absolute = resolve(path); if (existsSync(absolute))
    return realpathSync.native(absolute); const parent = dirname(absolute); if (parent === absolute)
    return absolute; return join(physicalPath(parent), relative(parent, absolute)); }
export function pathIdentity(path) { const value = physicalPath(path); return process.platform === 'win32' ? value.toLowerCase() : value; }
export function within(path, directory) { const diff = relative(pathIdentity(directory), pathIdentity(path)); return !diff || diff !== '..' && !diff.startsWith('..' + sep) && !isAbsolute(diff); }
export function resource(path, kind) { const target = physicalPath(path); if (existsSync(target) && (kind === 'directory' ? !statSync(target).isDirectory() : !statSync(target).isFile()))
    throw new Error('HOST_PATH_KIND_MISMATCH'); return { path: target, identity: pathIdentity(target), kind }; }
function files(value) { if (!existsSync(value.path))
    return []; return value.kind === 'file' ? [value.path] : readdirSync(value.path, { withFileTypes: true }).filter(entry => entry.name.endsWith('.sqlite') && (entry.isFile() || entry.isSymbolicLink())).map(entry => join(value.path, entry.name)); }
export function overlap(a, b) {
    if (a.identity === b.identity || a.kind === 'directory' && within(b.path, a.path) || b.kind === 'directory' && within(a.path, b.path))
        return true;
    // realpath alone cannot detect two hard links to the same SQLite file.
    const left = files(a).map(file => statSync(file, { bigint: true }));
    return files(b).some(file => { const right = statSync(file, { bigint: true }); return right.ino !== 0n && left.some(value => value.dev === right.dev && value.ino === right.ino); });
}
