import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { testTempDir as tmpdir } from './test-temp.js';
import { join } from 'node:path';
import { QqStore, QQ_APPLICATION_ID, QQ_SCHEMA_VERSION } from '@dafeiyu/qq';
import {inspectStorage,loadHostConfig,initializeProfile,inspectHost} from '@dafeiyu/host';

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

test('QQ refuses unknown, incomplete, forged and future schemas before persistent changes', async () => {
  for (const sql of [
    'CREATE TABLE alien(secret TEXT)', 'CREATE TABLE sqliteXshadow(secret TEXT)', 'DROP TABLE handled', 'PRAGMA user_version=99',
    `PRAGMA application_id=${QQ_APPLICATION_ID+1}`, 'PRAGMA application_id=321',
    "CREATE TRIGGER covert AFTER INSERT ON messages BEGIN DELETE FROM receipts; END",
    'DROP TABLE receipts; CREATE TABLE receipts(reply_id TEXT,platform_id TEXT)',
  ]) {
    const path = await file(); new QqStore(path).close(); const db = new DatabaseSync(path); db.exec(sql); db.close(); const before = await readFile(path);
    assert.equal(inspectStorage(path, 'qq').supported, false);
    assert.throws(() => new QqStore(path, { }), /QQ_STORAGE_UNSUPPORTED/);
    assert.deepEqual(await readFile(path), before);
  }
});
