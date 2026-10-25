import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { testTempDir as tmpdir } from './test-temp.js';
import { join } from 'node:path';
import { QqStore, QQ_APPLICATION_ID, QQ_SCHEMA_VERSION } from '@dafeiyu/channel-qq';
import { inspectStorage, planMigration, applyMigration, verifyMigration, loadHostConfig, initializeProfile, inspectHost } from '@dafeiyu/host';
import { migrationFixture } from './runtime-migration-fixture.js';

// Independently encoded legacy schema, before QQ database versioning existed.
function legacy(file: string) {
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,route TEXT NOT NULL,id TEXT NOT NULL,sender TEXT NOT NULL,text TEXT NOT NULL,UNIQUE(route,id));
    CREATE TABLE receipts(reply_id TEXT PRIMARY KEY,platform_id TEXT NOT NULL);
    CREATE TABLE handled(route TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(route,id));`);
  db.prepare('INSERT INTO messages(route,id,sender,text) VALUES(?,?,?,?)').run('fictional-room', '-321', 'fictional-user', '仅供迁移测试');
  db.prepare('INSERT INTO receipts VALUES(?,?)').run('fictional-reply', '-456');
  db.prepare('INSERT INTO handled VALUES(?,?)').run('fictional-room', '-321');
  db.close();
}
async function file() { return join(await mkdtemp(join(tmpdir(), 'dafeiyu-qq-storage-')), 'qq.sqlite'); }

test('QQ fresh storage has an application identity and reopens without losing receipts', async () => {
  const path = await file(), store = new QqStore(path);
  store.sent('reply-one', '-100'); store.remember('room', '-1', 'sender', '虚构'); store.acknowledge('room', '-1'); store.close();
  const inspection = inspectStorage(path, 'qq');
  assert.equal(inspection.version, QQ_SCHEMA_VERSION); assert.equal(inspection.applicationId, QQ_APPLICATION_ID); assert.equal(inspection.supported, true);
  const reopened = new QqStore(path);
  try { assert.equal(reopened.receipt('reply-one'), '-100'); assert.equal(reopened.handled('room', '-1'), true); assert.equal(reopened.find('room', '-1')?.text, '虚构'); }
  finally { reopened.close(); }
});

test('QQ legacy inspection and rejected implicit migration leave the original file byte-for-byte intact', async () => {
  const path = await file(); legacy(path); const before = await readFile(path);
  assert.equal(inspectStorage(path, 'qq').supported, true); assert.equal(inspectStorage(path, 'qq').version, 0);
  assert.throws(() => new QqStore(path), /QQ_MIGRATION_REQUIRED/); assert.deepEqual(await readFile(path), before);
  const store = new QqStore(path, { migrate: true });
  try { assert.equal(store.find('fictional-room', '-321')?.text, '仅供迁移测试'); assert.equal(store.receipt('fictional-reply'), '-456'); assert.ok(store.handled('fictional-room', '-321')); }
  finally { store.close(); }
  const db = new DatabaseSync(path, { readOnly: true });
  try { assert.equal(db.prepare('SELECT seq FROM messages').get()?.seq, 1); } finally { db.close(); }
});

test('QQ refuses unknown, incomplete, forged and future schemas before persistent changes', async () => {
  for (const sql of [
    'CREATE TABLE alien(secret TEXT)', 'CREATE TABLE sqliteXshadow(secret TEXT)', 'DROP TABLE handled', 'PRAGMA user_version=99',
    `PRAGMA application_id=${QQ_APPLICATION_ID}`, 'PRAGMA application_id=321',
    "CREATE TRIGGER covert AFTER INSERT ON messages BEGIN DELETE FROM receipts; END",
    'DROP TABLE receipts; CREATE TABLE receipts(reply_id TEXT,platform_id TEXT)',
  ]) {
    const path = await file(); legacy(path); const db = new DatabaseSync(path); db.exec(sql); db.close(); const before = await readFile(path);
    assert.equal(inspectStorage(path, 'qq').supported, false);
    assert.throws(() => new QqStore(path, { migrate: true }), /QQ_STORAGE_UNSUPPORTED/);
    assert.deepEqual(await readFile(path), before);
  }
});

test('Host QQ migration backs up legacy rows and resumes forward after the QQ step is interrupted', async () => {
  const fixture = await migrationFixture(), path = join(fixture.root, 'qq.sqlite'); legacy(path);
  const before = await readFile(path), plan = await planMigration({ ...fixture, qqFiles: [path] });
  assert.deepEqual(await readFile(path), before); assert.equal(plan.files.find(item => item.kind === 'qq')?.targetVersion, QQ_SCHEMA_VERSION);
  await assert.rejects(applyMigration(plan, { afterStep: kind => { if (kind === 'qq') throw new Error('FICTIONAL_INTERRUPTION'); } }), /BACKUP_RETAINED/);
  const backup = join(fixture.backupDir, plan.id, `${plan.files.findIndex(item => item.kind === 'qq')}-qq.sqlite`);
  assert.equal(inspectStorage(backup, 'qq').version, 0);
  await applyMigration(plan); assert.equal(verifyMigration(plan).passed, true);
  const store = new QqStore(path); store.sent('post-migration', '-900'); store.close();
  // A completed apply validates versions; it must not roll legitimate new rows back to the backup.
  await applyMigration(plan);
  const reopened = new QqStore(path);
  try { assert.equal(reopened.receipt('fictional-reply'), '-456'); assert.equal(reopened.receipt('post-migration'), '-900'); }
  finally { reopened.close(); }
});

test('Host init uses the QQ schema target and read-only inspection requests migration for an old profile', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dafeiyu-qq-profile-')), configFile = join(root, 'host.json'), coordination = join(root, 'coordination.sqlite');
  await writeFile(join(root, 'persona.md'), '本机虚构底色');
  await writeFile(configFile, JSON.stringify({ schemaVersion: 1, profileId: 'fixture', agent: { id: 'fish' },
    paths: { core: './data/core', memory: './data/memory', sessions: './data/sessions', query: './data/query.sqlite', channels: { 'channel-qq': './data/qq' } },
    persona: { fixedFile: './persona.md', kind: 'test' }, modelRoutes: { chat: { provider: 'local-test', model: 'scripted' } },
    plugins: [{ id: 'model-scripted', config: {} }, { id: 'channel-qq', config: { botId: '12345678', ownerId: '87654321', groupIds: [], httpURL: 'http://127.0.0.1:1/', wsURL: 'ws://127.0.0.1:1/', tokenFile: './token' } }] }));
  const prepared = loadHostConfig(configFile); assert.equal(initializeProfile(prepared, coordination).ready, true);
  const path = join(root, 'data/qq/qq.sqlite'), db = new DatabaseSync(path); db.exec('DROP TABLE qq_media_sources; DROP TABLE qq_media_drafts; DROP TABLE qq_media_deliveries; DROP TABLE qq_media_parts; DROP TABLE qq_delivery_segments; DROP TABLE qq_delivery_plans; DROP TABLE qq_browse_snapshots; DROP TABLE qq_cache_state; DROP TABLE qq_message_meta; DROP TABLE qq_group_snapshots; PRAGMA user_version=0; PRAGMA application_id=0;'); db.close();
  const before = await readFile(path), result = inspectHost(prepared, coordination);
  assert.ok(result.codes.includes('HOST_MIGRATION_REQUIRED')); assert.equal(result.ready, false); assert.deepEqual(await readFile(path), before);
});

test('QQ v1 upgrades additively and stores account-bound membership without changing old receipts', async () => {
  const path = await file(); legacy(path); const db = new DatabaseSync(path); db.exec(`PRAGMA user_version=1; PRAGMA application_id=${QQ_APPLICATION_ID};`); db.close();
  const before = await readFile(path); assert.equal(inspectStorage(path, 'qq').supported, true); assert.throws(() => new QqStore(path), /MIGRATION_REQUIRED/); assert.deepEqual(await readFile(path), before);
  const store = new QqStore(path, { migrate: true });
  try {
    assert.equal(store.groupSnapshot('12345678'), null);
    store.saveGroups('12345678', [{ id: '11223344', name: '虚构群' }], '2026-10-25T00:00:00.000Z');
    const next = store.saveGroups('12345678', [], '2026-10-25T00:01:00.000Z');
    assert.equal(next.revision, 2); assert.deepEqual(next.groups, []); assert.equal(store.groupSnapshot('87654321'), null);
    assert.equal(store.receipt('fictional-reply'), '-456'); assert.ok(store.handled('fictional-room', '-321'));
  } finally { store.close(); }
});
