import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { QqStore,splitQqText,QQ_SCHEMA_VERSION } from '@dafeiyu/qq';
import { inspectStorage } from '@dafeiyu/host';
import type { Reply } from '@dafeiyu/contracts';
import { testTempDir } from './test-temp.js';
const reply:Reply={id:'fictional-reply',conversation:{channel:'qq',account:'12345678',kind:'group',id:'11223344'},sourceMessageId:'-123',text:'鱼'.repeat(8001)};
async function file(){return join(await mkdtemp(join(testTempDir(),'dafeiyu-qq-delivery-')),'qq.sqlite');}

test('QQ splitting preserves newlines, CRLF and surrogate pairs without adding or dropping any characters',()=>{
  for(const text of ['鱼','a'.repeat(4000),'a'.repeat(3999)+'🐟'+'中'.repeat(5000),'a'.repeat(3999)+'\r\n'+'b'.repeat(4000),('第一行\n'+'鱼'.repeat(3900)+'🐟\n').repeat(7),'a'.repeat(32000)]){
    const parts=splitQqText(text);assert.equal(parts.join(''),text);assert.ok(parts.every(part=>part.length>0&&part.length<=4000));
    assert.ok(parts.every(part=>!/[\uD800-\uDBFF]$/.test(part)&&!/^[\uDC00-\uDFFF]/.test(part)));}
  assert.equal(splitQqText('short\n'+'a'.repeat(4000))[0],'short\n');
  for(const text of ['', 'x'.repeat(32001),'bad\ud800','\udfff'])assert.throws(()=>splitQqText(text),/TEXT_SIZE_UNSUPPORTED|INVALID_TEXT_ENCODING/);
});

test('QQ delivery fixes content, account, target and anchor, and rejects concurrent duplicate segment claims',async()=>{
  const store=new QqStore(await file());try{const plan=store.delivery.prepare(reply)!;assert.equal(plan.segments.length,3);assert.deepEqual(store.delivery.prepare(reply),plan);
    for(const changed of [{...reply,text:reply.text+'x'},{...reply,sourceMessageId:'another'},{...reply,conversation:{...reply.conversation,id:'99887766'}},{...reply,conversation:{...reply.conversation,account:'99887766'}}])assert.throws(()=>store.delivery.prepare(changed),/DELIVERY_PLAN_CONFLICT/);
    assert.throws(()=>store.delivery.begin(reply.id,1),/NOT_RESUMABLE/);store.delivery.begin(reply.id,0);assert.throws(()=>store.delivery.begin(reply.id,0),/NOT_RESUMABLE/);
    store.delivery.confirm(reply.id,0,'-901');assert.equal(store.delivery.progress(reply.id)?.state,'partial');assert.equal(store.receipt(reply.id),null);
    store.delivery.defer(reply.id,1,'TARGET_NOT_ALLOWED');assert.equal(store.delivery.progress(reply.id)?.segments[1]?.code,'TARGET_NOT_ALLOWED');
    store.delivery.begin(reply.id,1);store.delivery.confirm(reply.id,1,'-902');store.delivery.begin(reply.id,2);store.delivery.confirm(reply.id,2,'-903');
    assert.equal(store.delivery.progress(reply.id)?.state,'sent');assert.equal(store.receipt(reply.id),'-901');assert.equal(store.delivery.progress(reply.id)?.confirmed,3);
    assert.throws(()=>store.delivery.confirm(reply.id,2,'-903'),/STATE_CONFLICT/);
  }finally{store.close();}
});

test('interrupted QQ sends become unknown on explicit recovery and cannot consume pending segments',async()=>{
  const path=await file(),first=new QqStore(path);first.delivery.prepare(reply);first.delivery.begin(reply.id,0);first.delivery.confirm(reply.id,0,'-1');first.delivery.begin(reply.id,1);first.close();
  const reopened=new QqStore(path);try{assert.equal(reopened.delivery.progress(reply.id)?.state,'sending');assert.equal(reopened.delivery.recover(),1);assert.equal(reopened.delivery.recover(),0);
    const progress=reopened.delivery.progress(reply.id)!;assert.equal(progress.state,'uncertain');assert.equal(progress.confirmed,1);assert.equal(progress.unknown,1);assert.equal(progress.pending,1);assert.equal(progress.segments[1]?.code,'PROCESS_INTERRUPTED');
    assert.throws(()=>reopened.delivery.begin(reply.id,2),/NOT_RESUMABLE/);assert.equal(reopened.receipt(reply.id),null);
  }finally{reopened.close();}
});

test('QQ known unsent plans can continue after reopen, while legacy whole-message receipts never get a new plan',async()=>{
  const path=await file(),first=new QqStore(path);first.delivery.prepare(reply);first.delivery.begin(reply.id,0);first.delivery.confirm(reply.id,0,'-1');first.sent('legacy','-321');first.close();
  const second=new QqStore(path);try{second.delivery.recover();assert.equal(second.delivery.progress(reply.id)?.state,'partial');second.delivery.begin(reply.id,1);second.delivery.unknown(reply.id,1,'PLATFORM_RESULT_UNKNOWN');
    assert.equal(second.delivery.prepare({...reply,id:'legacy'}),null);assert.equal(second.delivery.progress('legacy')?.legacy,true);assert.equal(second.delivery.counts().plans,1);
  }finally{second.close();}
});

test('QQ v3 migration preserves caches, metadata, group snapshots and receipts while adding empty delivery tables',async()=>{
  const path=await file(),store=new QqStore(path);store.remember('room','-123','user','虚构旧文字');store.acknowledge('room','-123');store.sent('old','-99');store.saveGroups('12345678',[],'2026-10-25T00:00:00.000Z');store.close();
  const db=new DatabaseSync(path);db.exec('DROP TABLE qq_media_sources; DROP TABLE qq_media_drafts; DROP TABLE qq_media_deliveries; DROP TABLE qq_media_parts; DROP TABLE qq_delivery_segments; DROP TABLE qq_delivery_plans; PRAGMA user_version=3;');db.close();const before=await readFile(path);
  assert.equal(inspectStorage(path,'qq').supported,true);assert.throws(()=>new QqStore(path),/MIGRATION_REQUIRED/);assert.deepEqual(await readFile(path),before);
  const migrated=new QqStore(path,{migrate:true});try{assert.equal(migrated.find('room','-123')?.text,'虚构旧文字');assert.ok(migrated.handled('room','-123'));assert.equal(migrated.receipt('old'),'-99');assert.equal(migrated.groupSnapshot('12345678')?.revision,1);assert.equal(migrated.delivery.counts().plans,0);}finally{migrated.close();}
  assert.equal(inspectStorage(path,'qq').version,QQ_SCHEMA_VERSION);
});
