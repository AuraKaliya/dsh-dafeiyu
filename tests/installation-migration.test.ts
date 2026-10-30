import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { migrateInstallation, prepareInstallation } from '../packages/plugin/lib/installation.js';
import { BILI_SCHEMA_VERSION } from '../packages/bilibili/lib/store.js';
import { legacyBiliStore } from './bili-migration-fixture.js';
import { testTempDir } from './test-temp.js';

const profile = { agentId: 'fish', profileId: 'test' };

async function fixture() {
  const root = await mkdtemp(join(testTempDir(), 'install-migration-')), data = join(root, 'data'), core = join(data, 'core');
  await mkdir(core, { recursive: true });
  const settingsFile = join(root, 'dafeiyu.config.json');
  await writeFile(settingsFile, JSON.stringify({
    schemaVersion: 1, dataDir: data, instanceName: 'test',
    model: { model: 'deepseek-flash', credentialStore: join(root, 'cred.yaml') },
    qq: { botId: '10001', ownerId: '10002', tokenFile: join(root, 'token'), httpURL: 'http://127.0.0.1:13000', wsURL: 'ws://127.0.0.1:13001' },
    activity: { enabled: false },
  }));
  await writeFile(join(core, 'host-profile.json'), JSON.stringify(profile));
  const store = join(core, 'bilibili.sqlite');
  legacyBiliStore(store,profile,3);
  return { root, data, settingsFile, store };
}

test('the CLI migration entry upgrades an installed v3 store with a backup', async () => {
  const f = await fixture();
  assert.throws(() => prepareInstallation(f.settingsFile), /INSTALL_MIGRATION_REQUIRED/);

  const result = migrateInstallation(f.settingsFile);
  assert.equal(result.code, 'INSTALL_MIGRATED');
  assert.equal(result.version, BILI_SCHEMA_VERSION);
  assert.ok(result.backup && existsSync(result.backup));

  assert.equal(migrateInstallation(f.settingsFile).code, 'INSTALL_CURRENT');
});

test('a missing store reports INSTALL_NO_STORE instead of creating one', async () => {
  const f = await fixture();
  await import('node:fs/promises').then(fs => fs.rm(f.store));
  assert.deepEqual(migrateInstallation(f.settingsFile), { code: 'INSTALL_NO_STORE', version: 0, backup: null });
  assert.equal(existsSync(f.store), false);
});
