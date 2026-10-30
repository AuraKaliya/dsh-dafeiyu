import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { repairDshProfile } from '../../scripts/repair-dsh-profile.mjs';

function fixture() {
  const root = mkdtempSync(join(process.env.DAFEIYU_TEST_RUN ?? tmpdir(), 'profile-repair-'));
  const profile = join(root, 'desktop'), previous = join(root, 'previous'), target = join(root, 'target');
  for (const folder of [previous, target]) {
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'package.json'), JSON.stringify({ name: 'dsh-dafeiyu', main: './index.js' }));
    writeFileSync(join(folder, 'index.js'), 'export {};\n');
  }
  mkdirSync(join(profile, 'node_modules'), { recursive: true });
  symlinkSync(previous, join(profile, 'node_modules', 'dsh-dafeiyu'), process.platform === 'win32' ? 'junction' : 'dir');
  const dependency = 'link:' + target.replaceAll('\\', '/');
  const text = JSON.stringify({ name: 'fixture', private: true, dependencies: { 'dsh-dafeiyu': dependency, untouched: '1.2.3' }, dsh: { keep: true } }, null, 4) + '\r\n';
  writeFileSync(join(profile, 'package.json'), '\ufeff' + text);
  writeFileSync(join(profile, 'pnpm-lock.yaml'), 'lockfileVersion: "9.0"\nimporters:\n  .:\n    dependencies:\n      dsh-dafeiyu:\n        specifier: "link:old"\n        version: "link:old"\n      untouched:\n        specifier: "1.2.3"\n        version: "1.2.3"\n');
  return { root, profile, previous, target, text };
}

test('profile checks are read-only and BOM repair preserves every other JSON byte', () => {
  const f = fixture(), file = join(f.profile, 'package.json'), before = readFileSync(file);
  assert.ok(repairDshProfile(f.profile).faults.includes('PROFILE_JSON_BOM'));
  assert.deepEqual(readFileSync(file), before);
  const result = repairDshProfile(f.profile, { repair: true });
  assert.equal(readFileSync(file, 'utf8'), f.text);
  assert.deepEqual(readFileSync(join(result.backup!, 'package.json')), before);
  assert.ok(result.faults.includes('PROFILE_LINK_TARGET_MISMATCH'));
  assert.equal(realpathSync(join(f.profile, 'node_modules/dsh-dafeiyu')), realpathSync(f.previous));
});

test('explicit alignment updates the lock and installed link without changing other dependencies', () => {
  const f = fixture(), result = repairDshProfile(f.profile, { repair: true, alignPlugin: true });
  assert.equal(result.ready, true);
  assert.equal(realpathSync(join(f.profile, 'node_modules/dsh-dafeiyu')), realpathSync(f.target));
  assert.equal(readFileSync(join(f.profile, 'package.json'), 'utf8'), f.text);
  assert.match(readFileSync(join(f.profile, 'pnpm-lock.yaml'), 'utf8'), /untouched:/);
  assert.equal(realpathSync(join(result.backup!, 'previous-plugin-link')), realpathSync(f.previous));
  assert.equal(repairDshProfile(f.profile, { repair: true, alignPlugin: true }).backup, null);
});

test('invalid JSON is rejected before repair writes', () => {
  const f = fixture(), file = join(f.profile, 'package.json');
  writeFileSync(file, '\ufeff{"broken: true}');
  const before = readFileSync(file);
  assert.throws(() => repairDshProfile(f.profile, { repair: true, alignPlugin: true }), /PROFILE_JSON_INVALID/);
  assert.deepEqual(readFileSync(file), before);
});
