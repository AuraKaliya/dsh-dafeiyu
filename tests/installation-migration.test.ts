import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { migrateInstallation, prepareInstallation } from '../packages/plugin/lib/installation.js';
import { BILI_APPLICATION_ID } from '../packages/bilibili/lib/store.js';
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
  const db = new DatabaseSync(store);
  db.exec(`CREATE TABLE bili_metadata(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL);
    CREATE TABLE bili_reading(bvid TEXT PRIMARY KEY,body TEXT NOT NULL,updated_at INTEGER NOT NULL);
    INSERT INTO bili_metadata VALUES(1,'${JSON.stringify(profile)}');
    PRAGMA application_id=${BILI_APPLICATION_ID};
    PRAGMA user_version=3;`);
  db.close();
  return { root, data, settingsFile, store };
}

test('the CLI migration entry upgrades an installed v3 store with a backup', async () => {
  const f = await fixture();
  assert.throws(() => prepareInstallation(f.settingsFile), /INSTALL_MIGRATION_REQUIRED/);

  const result = migrateInstallation(f.settingsFile);
  assert.equal(result.code, 'INSTALL_MIGRATED');
  assert.equal(result.version, 4);
  assert.ok(result.backup && existsSync(result.backup));

  assert.equal(migrateInstallation(f.settingsFile).code, 'INSTALL_CURRENT');
});

test('a missing store reports INSTALL_NO_STORE instead of creating one', async () => {
  const f = await fixture();
  await import('node:fs/promises').then(fs => fs.rm(f.store));
  assert.deepEqual(migrateInstallation(f.settingsFile), { code: 'INSTALL_NO_STORE', version: 0, backup: null });
  assert.equal(existsSync(f.store), false);
});
