import {createHash, randomUUID} from 'node:crypto';
import {readFileSync, readdirSync, lstatSync, writeFileSync, renameSync, realpathSync} from 'node:fs';
import {join, relative, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

export const repository = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');

function walk(directory, accept) {
  return readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    if (entry.isSymbolicLink()) throw new Error('ACCEPTANCE_LINK_REFUSED');
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path, accept) : accept(path) ? [path] : [];
  });
}

/** Content identity, including uncommitted edits. No private runtime files are scanned. */
export function fingerprint(kind) {
  const packages = readdirSync(join(repository, 'packages'), {withFileTypes: true}).filter(entry => entry.isDirectory());
  let files;
  if (kind === 'runtime') files = packages.flatMap(entry => walk(join(repository, 'packages', entry.name, 'lib'), path => path.endsWith('.js')));
  else if (kind === 'source') files = ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.base.json'].map(path => join(repository, path)).concat(
    packages.flatMap(entry => [join(repository, 'packages', entry.name, 'package.json'), ...walk(join(repository, 'packages', entry.name, 'src'), path => path.endsWith('.ts'))]));
  else if (kind === 'driver') files = [...walk(join(repository, 'scripts'), path => /\.(?:ts|mjs|json)$/.test(path)), ...walk(join(repository, 'tests'), path => /\.(?:ts|json)$/.test(path))];
  else throw new Error('ACCEPTANCE_FINGERPRINT_KIND');
  return hash(files.map(path => [relative(repository, path).replaceAll('\\', '/'), hash(readFileSync(path).toString('utf8'))]).sort((a, b) => a[0].localeCompare(b[0], 'en')));
}

export function readJson(file) {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) throw new Error('ACCEPTANCE_FILE_INVALID');
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** All acceptance files are UTF-8 without BOM, installed from a same-directory temporary file. */
export function saveJson(file, value) {
  const temp = file + '.' + randomUUID() + '.tmp';
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
  renameSync(temp, file);
}

/** Called only by synthetic fixtures. Ordinary npm test runs have no artifact side effect. */
export function captureEvidence(scenarioId, version, apiVersion, evidence) {
  const directory = process.env.DAFEIYU_ACCEPTANCE_DIR;
  if (!directory) return;
  if (!/^[a-z][a-z0-9-]+$/.test(scenarioId)) throw new Error('ACCEPTANCE_SCENARIO_INVALID');
  if (realpathSync.native(directory).toLowerCase() !== resolve(directory).toLowerCase()) throw new Error('ACCEPTANCE_LINK_REFUSED');
  const binding = readJson(join(directory, 'manifest.json'));
  if (binding.runId !== process.env.DAFEIYU_ACCEPTANCE_RUN || binding.mode !== 'offline-sdk' || !binding.scenarios.includes(scenarioId)) throw new Error('ACCEPTANCE_BINDING_INVALID');
  const sourceHash = fingerprint('source'), driverHash = fingerprint('driver');
  if (sourceHash !== binding.sourceHash || driverHash !== binding.driverHash) throw new Error('ACCEPTANCE_CONTENT_CHANGED');
  const target = join(directory, scenarioId + '.json');
  // A completed artifact is never replaced by a later test invocation.
  const claim = join(dirname(target), scenarioId + '.claim');
  writeFileSync(claim, binding.runId, {flag: 'wx'});
  saveJson(target, {schemaVersion: 1, runId: binding.runId, scenarioId, capturedAt: new Date().toISOString(),
    version, apiVersion, sourceHash, driverHash, runtimeHash: fingerprint('runtime'), evidence});
}
