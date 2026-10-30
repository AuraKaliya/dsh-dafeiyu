import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { parseDocument } from 'yaml';

const plugin = 'dsh-dafeiyu';
const stripBom = text => text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
const samePath = (left, right) => process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
const linkInfo = file => { try { return lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };

function snapshot(profileDirectory) {
  const directory = resolve(profileDirectory), manifestFile = join(directory, 'package.json'), lockFile = join(directory, 'pnpm-lock.yaml');
  const manifestBytes = readFileSync(manifestFile), manifestText = stripBom(manifestBytes.toString('utf8'));
  let manifest;
  try { manifest = JSON.parse(manifestText); } catch { throw new Error('PROFILE_JSON_INVALID'); }
  const dependency = manifest.dependencies?.[plugin];
  if (typeof dependency !== 'string' || !dependency.startsWith('link:')) throw new Error('PROFILE_LOCAL_PLUGIN_REQUIRED');
  const target = realpathSync(resolve(directory, dependency.slice(5)));
  const packageJson = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'));
  if (packageJson.name !== plugin) throw new Error('PROFILE_PLUGIN_IDENTITY_MISMATCH');
  const entry = typeof packageJson.main === 'string' ? resolve(target, packageJson.main) : '';
  if (!entry.startsWith(target + '/') && !entry.startsWith(target + '\\')) throw new Error('PROFILE_PLUGIN_ENTRY_OUTSIDE_PACKAGE');
  if (!existsSync(entry)) throw new Error('PROFILE_PLUGIN_ENTRY_MISSING');
  const lockBytes = readFileSync(lockFile), lockText = stripBom(lockBytes.toString('utf8')), lock = parseDocument(lockText);
  if (lock.errors.length) throw new Error('PROFILE_LOCK_INVALID');
  const key = ['importers', '.', 'dependencies', plugin], locked = lock.getIn(key, true)?.toJSON();
  if (!locked || typeof locked !== 'object') throw new Error('PROFILE_LOCK_PLUGIN_MISSING');
  const link = join(directory, 'node_modules', plugin), info = linkInfo(link);
  let installed = null;
  if (info) { try { installed = realpathSync(link); } catch { /* A broken link can be replaced explicitly. */ } }
  const faults = [];
  if (manifestText !== manifestBytes.toString('utf8')) faults.push('PROFILE_JSON_BOM');
  if (lockText !== lockBytes.toString('utf8')) faults.push('PROFILE_LOCK_BOM');
  if (locked.specifier !== dependency || locked.version !== dependency) faults.push('PROFILE_LOCK_TARGET_MISMATCH');
  if (!installed || !samePath(installed, target)) faults.push('PROFILE_LINK_TARGET_MISMATCH');
  return { directory, manifestFile, manifestBytes, manifestText, lockFile, lockBytes, lockText, lock, key, locked,
    dependency, target, link, info, installed, faults };
}

function view(state, backup = null) {
  return { ready: state.faults.length === 0, faults: state.faults, declaredTarget: state.target,
    installedTarget: state.installed, backup };
}

function replaceFile(file, bytes) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  writeFileSync(temporary, bytes, { flag: 'wx' });
  try { renameSync(temporary, file); }
  catch (error) { unlinkSync(temporary); throw error; }
}

/** Check by default. Repair preserves JSON bytes except its BOM; alignment is an explicit extra option. */
export function repairDshProfile(profileDirectory, { repair = false, alignPlugin = false } = {}) {
  if (alignPlugin && !repair) throw new Error('PROFILE_ALIGNMENT_REQUIRES_REPAIR');
  const state = snapshot(profileDirectory);
  if (!repair || !state.faults.length) return view(state);
  const relink = alignPlugin && state.faults.includes('PROFILE_LINK_TARGET_MISMATCH');
  if (relink && state.info && !state.info.isSymbolicLink()) throw new Error('PROFILE_INSTALLED_DIRECTORY_NOT_A_LINK');
  const changes = state.faults.some(code => code.endsWith('_BOM')) || alignPlugin;
  if (!changes) return view(state);
  const backup = join(state.directory, '.profile-repair', new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID());
  mkdirSync(backup, { recursive: true });
  writeFileSync(join(backup, 'package.json'), state.manifestBytes, { flag: 'wx' });
  writeFileSync(join(backup, 'pnpm-lock.yaml'), state.lockBytes, { flag: 'wx' });
  writeFileSync(join(backup, 'targets.json'), JSON.stringify({ declared: state.target, installed: state.installed }, null, 2) + '\n', { flag: 'wx' });
  if (!readFileSync(state.manifestFile).equals(state.manifestBytes) || !readFileSync(state.lockFile).equals(state.lockBytes)) throw new Error('PROFILE_CHANGED_DURING_REPAIR');
  const oldLink = join(backup, 'previous-plugin-link');
  let movedLink = false, createdLink = false;
  try {
    replaceFile(state.manifestFile, state.manifestText);
    if (alignPlugin) {
      state.lock.setIn(state.key, { ...state.locked, specifier: state.dependency, version: state.dependency });
      replaceFile(state.lockFile, state.lock.toString());
    } else replaceFile(state.lockFile, state.lockText);
    if (relink) {
      mkdirSync(dirname(state.link), { recursive: true });
      // lstat above requires an actual link; rename/unlink never operate recursively on its target.
      if (state.info) { renameSync(state.link, oldLink); movedLink = true; }
      symlinkSync(state.target, state.link, process.platform === 'win32' ? 'junction' : 'dir'); createdLink = true;
    }
    const after = snapshot(state.directory);
    if (alignPlugin && after.faults.length) throw new Error('PROFILE_REPAIR_VERIFICATION_FAILED');
    return view(after, backup);
  } catch (error) {
    if (createdLink) { if (!lstatSync(state.link).isSymbolicLink()) throw new Error('PROFILE_ROLLBACK_LINK_CHANGED'); unlinkSync(state.link); }
    if (movedLink) renameSync(oldLink, state.link);
    replaceFile(state.manifestFile, state.manifestBytes);
    replaceFile(state.lockFile, state.lockBytes);
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2), index = args.indexOf('--profile'), directory = args[index + 1];
    if (index < 0 || !directory || args.some((arg, at) => at !== index + 1 && !['--profile', '--repair', '--align-plugin'].includes(arg))) throw new Error('USAGE_REPAIR_DSH_PROFILE');
    const result = repairDshProfile(directory, { repair: args.includes('--repair'), alignPlugin: args.includes('--align-plugin') });
    console.log(JSON.stringify(result));
    if (!result.ready) process.exitCode = 2;
  } catch (error) { console.error(JSON.stringify({ code: /^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : 'PROFILE_REPAIR_FAILED' })); process.exitCode = 1; }
}
