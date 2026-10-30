import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = new Map();
for (let at = 2; at < process.argv.length; at += 2) {
  const key = process.argv[at];
  const value = process.argv[at + 1];
  if (!key?.startsWith('--') || !value) throw new Error('usage: node scripts/prepare-local-deploy.mjs --release <dir> --target <dir> --settings <file> --node <exe> [--node-modules <dir>]');
  args.set(key.slice(2), resolve(value));
}
for (const key of ['release', 'target', 'settings', 'node']) if (!args.has(key)) throw new Error(`missing --${key}`);
const release = args.get('release');
const target = args.get('target');
const settings = args.get('settings');
const node = args.get('node');
const nodeModules = args.get('node-modules') ?? resolve('node_modules');
for (const [label, value] of [['release', release], ['settings', settings], ['node', node], ['node-modules', nodeModules]]) {
  if (!existsSync(value)) throw new Error(`missing ${label}: ${value}`);
}
if (existsSync(target)) throw new Error('target already exists');
const manifest = JSON.parse(readFileSync(join(release, 'package.json'), 'utf8'));
if (manifest.name !== 'dsh-dafeiyu') throw new Error('release is not dsh-dafeiyu');
mkdirSync(target, { recursive: true });
cpSync(release, target, { recursive: true, filter: source => !source.split(/[\\/]/).includes('node_modules') });
symlinkSync(nodeModules, join(target, 'node_modules'), 'junction');
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
writeFileSync(join(target, 'cordis.patch.yml'), `- insert:\n    - id: dsh-dafeiyu\n      name: dsh-dafeiyu\n      config:\n        settingsFile: ${quote(settings)}\n        nodePath: ${quote(node)}\n`, 'utf8');
const files = readdirSync(target, { recursive: true }).length;
console.log(JSON.stringify({ target, release, settings, node, nodeModules, version: manifest.version, files }));
