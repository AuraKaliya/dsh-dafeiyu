import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { testTempDir as tmpdir } from './test-temp.js';
import { join } from 'node:path';
import { QqStore, QQ_APPLICATION_ID, QQ_SCHEMA_VERSION } from '@dafeiyu/qq';
import {inspectStorage,loadHostConfig,initializeProfile,inspectHost} from '@dafeiyu/host';

async function file() { return join(await mkdtemp(join(tmpdir(), 'dafeiyu-qq-storage-')), 'qq.sqlite'); }

test('passive observation batching keeps durable receipts atomic and preserves FULL synchronization',async()=>{
  const path=await file(),store=new QqStore(path),db=new DatabaseSync(path),route='batch-room',metadata={occurredAt:new Date().toISOString(),unsupported:[]};
  try{db.exec("CREATE TRIGGER inject_receipt_failure BEFORE INSERT ON handled WHEN NEW.id='bad' BEGIN SELECT RAISE(ABORT,'injected');END;");
    assert.throws(()=>store.observeBatch([[route,'first','member','first',metadata],[route,'bad','member','second',metadata]]),/injected/);
    assert.equal(store.find(route,'first'),null);assert.equal(store.handled(route,'first'),false);
    db.exec('DROP TRIGGER inject_receipt_failure');store.observeBatch([[route,'first','member','first',metadata],[route,'second','member','second',metadata]]);
    assert.equal(store.handled(route,'first'),true);assert.equal(store.handled(route,'second'),true);assert.equal(store.find(route,'second')?.text,'second');
    assert.equal(db.prepare('PRAGMA synchronous').get()?.synchronous,2);
  }finally{db.close();store.close();}
  const reopened=new QqStore(path);try{assert.equal(reopened.handled(route,'first'),true);assert.equal(reopened.find(route,'second')?.text,'second');}finally{reopened.close();}
});

test('received mentions survive cache restart while historical unknown mention state stays unknown',async()=>{
  const path=await file(),route=JSON.stringify(['100001','group','300001']),occurredAt=new Date().toISOString();let store=new QqStore(path);
  store.remember(route,'1','200001','实际提及',{occurredAt,unsupported:[],mentionedBot:true});
  store.remember(route,'2','200001','普通文字',{occurredAt,unsupported:[],mentionedBot:false});
  store.remember(route,'3','200001','旧记录',{occurredAt,unsupported:[]});store.close();store=new QqStore(path);
  try{const page=store.cache.browse(route,'owner',{requestId:'read',limit:20,includeRecentHistory:false}).page;
    assert.equal(page.messages.find(message=>message.id==='1')?.mentionedBot,true);
    assert.equal(page.messages.find(message=>message.id==='2')?.mentionedBot,false);
    assert.equal(page.messages.find(message=>message.id==='3')?.mentionedBot,undefined);
  }finally{store.close();}
});

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
