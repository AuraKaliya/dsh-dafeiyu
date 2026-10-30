import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { BiliStore,BILI_APPLICATION_ID,BILI_SCHEMA_VERSION, biliHash } from '../packages/bilibili/lib/store.js';
import { legacyBiliStore } from './bili-migration-fixture.js';
import { inspectBiliMigration, migrateBiliStorage } from '../packages/bilibili/lib/migration.js';
import { testTempDir } from './test-temp.js';

const identity = { agentId: 'fish', profileId: 'test' } as const;
const bvid = 'BV1xNpFedEwH';
const legacy = { schemaVersion: 1, bvid, title: '旧记录', author: '', status: 'checkpoint', watched: [], commentCursor: null, frames: [], sources: [], conclusion: null, gaps: [], nextStep: '继续', updatedAt: '2026-01-01T00:00:00.000Z' };

async function v3Fixture() {
  const root = await mkdtemp(join(testTempDir(), 'bili-migration-')), file = join(root, 'bilibili.sqlite');
  legacyBiliStore(file,identity,3,legacy);
  return { root, file, backup: join(root, 'backup.sqlite') };
}

const digest = async (file: string) => createHash('sha256').update(await readFile(file)).digest('hex');

test('a v3 store is reported upgradable and migrates legacy records explicitly', async () => {
  const f = await v3Fixture();
  assert.deepEqual(inspectBiliMigration(f.file, identity), { exists: true, version: 3, applicationId: BILI_APPLICATION_ID, integrity: true, identityMatches: true, state: 'upgradable' });

  const result = migrateBiliStorage(f.file, identity, { backup: f.backup });
  assert.equal(result.migrated, true);
  assert.equal(result.version, BILI_SCHEMA_VERSION);

  const db = new DatabaseSync(f.file, { readOnly: true });
  try {
    assert.deepEqual(db.prepare('SELECT bvid,body FROM bili_reading_legacy').all().map(row => row.bvid), [bvid]);
    assert.equal(db.prepare('SELECT count(*) AS n FROM bili_reading').get()!.n, 0);
    assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, BILI_SCHEMA_VERSION);
  } finally { db.close(); }
  assert.equal(inspectBiliMigration(f.file, identity).state, 'current');

  const again = migrateBiliStorage(f.file, identity, { backup: f.backup });
  assert.equal(again.migrated, false);
});

test('an identity mismatch is rejected before any write', async () => {
  const f = await v3Fixture();
  const before = await digest(f.file);
  assert.throws(() => migrateBiliStorage(f.file, { agentId: 'other', profileId: 'test' }, { backup: f.backup }), /IDENTITY_MISMATCH/);
  assert.equal(await digest(f.file), before);
  assert.equal(inspectBiliMigration(f.file, identity).version, 3);
});

test('v4 scoped records and receipts survive v5 and only existing versions are backfilled',async()=>{
  const root=await mkdtemp(join(testTempDir(),'bili-v4-')),file=join(root,'bili.sqlite'),backup=join(root,'backup.sqlite');
  new BiliStore(file,identity,true).close();const db=new DatabaseSync(file);
  try{
    db.exec('DROP TABLE bili_reading_history; DROP TABLE bili_comment_cursors; PRAGMA user_version=4;');
    db.prepare('INSERT INTO bili_reading VALUES(?,?,?,?,?)').run('owner-task',bvid,7,JSON.stringify(legacy),123);
    db.prepare('INSERT INTO bili_reading_receipts VALUES(?,?,?,?)').run('owner-task','saved-request',bvid,7);
  }finally{db.close();}
  assert.equal(inspectBiliMigration(file,identity).state,'upgradable');
  assert.equal(migrateBiliStorage(file,identity,{backup}).version,5);
  const upgraded=new DatabaseSync(file,{readOnly:true});try{
    assert.equal(upgraded.prepare('SELECT version FROM bili_reading').get()!.version,7);
    assert.equal(upgraded.prepare('SELECT version FROM bili_reading_receipts').get()!.version,7);
    const history=upgraded.prepare('SELECT version,body,fingerprint FROM bili_reading_history').all();
    assert.equal(history.length,1);assert.equal(history[0]!.version,7);assert.equal(history[0]!.body,JSON.stringify(legacy));
    assert.match(String(history[0]!.fingerprint),/^legacy:/);
  }finally{upgraded.close();}
  const before=await digest(file);
  assert.throws(()=>migrateBiliStorage(file,{...identity,agentId:'wrong'},{backup}),/IDENTITY_MISMATCH/);
  assert.equal(await digest(file),before);
});

test('the backup is a consistent pre-migration snapshot', async () => {
  const f = await v3Fixture();
  const before = await digest(f.file);
  const result = migrateBiliStorage(f.file, identity, { backup: f.backup });
  assert.equal(result.backup, f.backup);
  const backup = inspectBiliMigration(f.backup, identity);
  assert.equal(backup.version, 3);
  assert.equal(backup.integrity, true);
  assert.equal(backup.identityMatches, true);
  const db = new DatabaseSync(f.backup, { readOnly: true });
  try { assert.equal(db.prepare('SELECT count(*) AS n FROM bili_reading').get()!.n, 1); } finally { db.close(); }
  assert.notEqual(await digest(f.file), before);
});

test('committed WAL pages are included in the backup', async () => {
  const f = await v3Fixture();
  const db = new DatabaseSync(f.file);
  db.exec('PRAGMA journal_mode=WAL; UPDATE bili_reading SET updated_at=123456789;');
  db.close();
  migrateBiliStorage(f.file, identity, { backup: f.backup });
  const backup = new DatabaseSync(f.backup, { readOnly: true });
  try { assert.equal(backup.prepare('SELECT updated_at FROM bili_reading').get()!.updated_at, 123456789); } finally { backup.close(); }
});

test('a v2 store without a reading table upgrades to v4 with an empty legacy table', async () => {
  const f = await v3Fixture();
  const db = new DatabaseSync(f.file);
  db.exec('DROP TABLE bili_reading; PRAGMA user_version=2;');
  db.close();
  assert.equal(inspectBiliMigration(f.file, identity).version, 2);
  const result = migrateBiliStorage(f.file, identity, { backup: f.backup });
  assert.equal(result.version, BILI_SCHEMA_VERSION);
  const check = new DatabaseSync(f.file, { readOnly: true });
  try {
    assert.equal(check.prepare('SELECT count(*) AS n FROM bili_reading_legacy').get()!.n, 0);
    assert.equal(check.prepare('PRAGMA user_version').get()!.user_version, BILI_SCHEMA_VERSION);
  } finally { check.close(); }
});
