import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = new Map();
for (let at = 2; at < process.argv.length; at += 2) {
  const key = process.argv[at];
  const value = process.argv[at + 1];
  if (!['--release','--target','--settings','--node'].includes(key) || !value) throw new Error('usage: node scripts/prepare-local-deploy.mjs --release <dir> --target <dir> --settings <file> --node <exe>');
  args.set(key.slice(2), resolve(value));
}
for (const key of ['release', 'target', 'settings', 'node']) if (!args.has(key)) throw new Error(`missing --${key}`);
const release = args.get('release');
const target = args.get('target');
const settings = args.get('settings');
const node = args.get('node');
for (const [label, value] of [['release', release], ['settings', settings], ['node', node]]) {
  if (!existsSync(value)) throw new Error(`missing ${label}: ${value}`);
}
if (existsSync(target)) throw new Error('target already exists');
const manifest = JSON.parse(readFileSync(join(release, 'package.json'), 'utf8'));
if (manifest.name !== 'dsh-dafeiyu') throw new Error('release is not dsh-dafeiyu');
mkdirSync(target, { recursive: true });
cpSync(release, target, { recursive: true, filter: source => !source.split(/[\\/]/).includes('node_modules') });
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
writeFileSync(join(target, 'cordis.patch.yml'), `- insert:\n    - id: dsh-dafeiyu\n      name: dsh-dafeiyu\n      config:\n        settingsFile: ${quote(settings)}\n        nodePath: ${quote(node)}\n        startOnLoad: true\n`, 'utf8');
const files = (function count(directory){let total=0;for(const entry of readdirSync(directory,{withFileTypes:true})){if(entry.isSymbolicLink())continue;total+=entry.isDirectory()?count(join(directory,entry.name)):1;}return total;})(target);
console.log(JSON.stringify({ target, release, settings, node, version: manifest.version, files,
  dependencies:'install-required',next:'Run npm install --omit=dev --ignore-scripts in the target directory, then check and init.' }));
