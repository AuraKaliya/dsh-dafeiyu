import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { QqStore } from '@dafeiyu/qq';
import { ReplyMediaManifestSchema } from '@dafeiyu/contracts';
import type { Reply,MediaAssetRef } from '@dafeiyu/contracts';
import { qqMediaDeliveryPlan,qqTextHash,qqMediaHash } from '../packages/channel-qq/lib/media-delivery.js';
import { testTempDir } from './test-temp.js';

function fixtureReply(text='正文'):Reply {const inboundId=randomUUID(),replyId=inboundId+':reply',target={channel:'qq',account:'100001',kind:'private' as const,id:'200001'};
  const asset=(kind:MediaAssetRef['kind'],hash:string):MediaAssetRef=>({schemaVersion:1,id:randomUUID(),version:2,kind,sha256:hash.repeat(64),bytes:100,mime:kind==='image'?'image/png':kind==='audio'?'audio/wav':'text/plain'});
  return {id:replyId,conversation:target,sourceMessageId:'123',text,media:ReplyMediaManifestSchema.parse({schemaVersion:1,id:randomUUID(),replyId,runId:randomUUID(),target,sourceMessageId:'123',anchor:{kind:'reply',inboundId},textHash:qqTextHash(text),draft:{id:randomUUID(),version:1},
    parts:[{kind:'image',asset:asset('image','a')},{kind:'record',asset:asset('audio','b')},{kind:'file',asset:asset('document','c'),name:'fixture.txt'}],sourceStamp:'d'.repeat(64),credential:'e'.repeat(64),expiresAt:'2026-10-26T00:00:00Z'})};}
async function storeFile(){return join(await mkdtemp(join(testTempDir(),'qq-media-ledger-')),'qq.sqlite');}

test('v2 plans preserve final text exactly and fix image, audio and file order',()=>{
  const text='蓝鱼🐟\r\n'.repeat(900),reply=fixtureReply(text),plan=qqMediaDeliveryPlan(reply),segments=plan.parts.filter(p=>p.kind==='text');
  assert.equal(segments.map(s=>s.text).join(''),text);assert.ok(segments.every(s=>s.text.length<=4000));assert.deepEqual(plan.parts.slice(segments.length).map(p=>p.kind),['image','record','file']);assert.equal(plan.version,2);
  assert.throws(()=>qqMediaDeliveryPlan({...reply,text:text+'改动'}),/MANIFEST_MISMATCH/);
  assert.throws(()=>qqMediaDeliveryPlan({...reply,conversation:{...reply.conversation,id:'foreign'}}),/MANIFEST_MISMATCH/);
  assert.throws(()=>ReplyMediaManifestSchema.parse({...reply.media,parts:[{kind:'file',asset:reply.media!.parts[0]!.asset,name:'../private'}]}));
  assert.throws(()=>ReplyMediaManifestSchema.parse({...reply.media,parts:[{kind:'image',asset:{...reply.media!.parts[0]!.asset,bytes:17*1024**2}}]}));
});

test('durable media plan rejects replaced bytes, manifest identity and a different native anchor',async()=>{
  const file=await storeFile(),store=new QqStore(file),reply=fixtureReply();try{store.mediaDelivery.prepare(reply);assert.equal(store.mediaDelivery.prepare(structuredClone(reply)).replyId,reply.id);
    const changed=structuredClone(reply);changed.media!.parts[0]!.asset.sha256='f'.repeat(64);assert.throws(()=>store.mediaDelivery.prepare(changed),/PLAN_CONFLICT/);
    assert.throws(()=>store.mediaDelivery.prepare({...reply,media:{...reply.media!,id:randomUUID()}}),/PLAN_CONFLICT/);
    const runId=randomUUID(),anchor={kind:'task-result' as const,schemaVersion:1 as const,taskId:randomUUID(),runId,inboundId:randomUUID(),target:reply.conversation,intentVersion:1,authorityVersion:'1'.repeat(64),expiresAt:'2026-10-26T00:00:00Z'};
    const native={...fixtureReply(),id:'native:'+randomUUID(),taskResult:anchor};native.media={...native.media!,replyId:native.id,target:native.conversation,runId,anchor};assert.equal(qqMediaDeliveryPlan(native).manifest.anchor.kind,'task-result');
    assert.throws(()=>qqMediaDeliveryPlan({...native,taskResult:{...anchor,intentVersion:2}}),/MANIFEST_MISMATCH/);
  }finally{store.close();}
});

test('each confirmed part survives restart and an interrupted part becomes terminal unknown',async()=>{
  const file=await storeFile(),reply=fixtureReply();let store=new QqStore(file);store.mediaDelivery.prepare(reply);store.mediaDelivery.begin(reply.id,0);assert.throws(()=>store.mediaDelivery.begin(reply.id,0),/NOT_RESUMABLE/);store.mediaDelivery.confirm(reply.id,0,'-1');
  assert.equal(store.mediaDelivery.progress(reply.id)?.state,'partial');store.mediaDelivery.begin(reply.id,1);store.close();store=new QqStore(file);
  try{assert.equal(store.mediaDelivery.recover(),1);const status=store.mediaDelivery.progress(reply.id)!;assert.equal(status.confirmed,1);assert.equal(status.unknown,1);assert.equal(status.parts[0]?.receipt,'-1');assert.equal(status.parts[1]?.code,'PROCESS_INTERRUPTED');
    assert.throws(()=>store.mediaDelivery.begin(reply.id,1),/NOT_RESUMABLE/);assert.throws(()=>store.mediaDelivery.begin(reply.id,2),/NOT_RESUMABLE/);assert.equal(store.mediaDelivery.recover(),0);assert.equal(store.receipt(reply.id),null);
  }finally{store.close();}
});

test('pending preparation failures can retain a fixed plan and only complete confirmation creates the whole receipt',async()=>{
  const store=new QqStore(await storeFile()),reply=fixtureReply();try{const plan=store.mediaDelivery.prepare(reply);store.mediaDelivery.defer(reply.id,0,'MEDIA_UNAVAILABLE');assert.equal(store.mediaDelivery.progress(reply.id)?.state,'ready');
    assert.throws(()=>store.mediaDelivery.begin(reply.id,1),/NOT_RESUMABLE/);
    for(let i=0;i<plan.parts.length;i++){store.mediaDelivery.begin(reply.id,i);store.mediaDelivery.confirm(reply.id,i,String(-100-i));if(i<plan.parts.length-1)assert.equal(store.receipt(reply.id),null);}
    assert.equal(store.mediaDelivery.progress(reply.id)?.state,'sent');assert.equal(store.receipt(reply.id),'-100');assert.equal(store.mediaDelivery.counts().pending,0);
  }finally{store.close();}
});

test('v1 and v2 plans cannot coexist under one reply id, and existing receipts never authorize extra media',async()=>{
  const store=new QqStore(await storeFile());try{const a=fixtureReply(),{media:_a,...textOnly}=a;store.delivery.prepare(textOnly);assert.throws(()=>store.mediaDelivery.prepare(a),/PROTOCOL_CONFLICT/);
    const b=fixtureReply();store.mediaDelivery.prepare(b);const {media:_b,...stripped}=b;assert.throws(()=>store.delivery.prepare(stripped),/PROTOCOL_CONFLICT/);
    const c=fixtureReply();store.sent(c.id,'-99');assert.throws(()=>store.mediaDelivery.prepare(c),/PROTOCOL_CONFLICT/);assert.equal(store.mediaDelivery.progress(c.id),null);
  }finally{store.close();}
});

test('corrupted media ledger bodies and receipts are rejected before resuming',async()=>{
  const file=await storeFile(),store=new QqStore(file),reply=fixtureReply();try{store.mediaDelivery.prepare(reply);const db=new DatabaseSync(file);try{db.prepare("UPDATE qq_media_parts SET state='sent',receipt='not-a-message-id' WHERE reply_id=? AND position=0").run(reply.id);assert.throws(()=>store.mediaDelivery.progress(reply.id),/LEDGER_CORRUPT/);
      db.prepare("UPDATE qq_media_deliveries SET plan_hash=? WHERE reply_id=?").run('0'.repeat(64),reply.id);assert.throws(()=>store.mediaDelivery.prepare(reply),/LEDGER_CORRUPT/);
    }finally{db.close();}}finally{store.close();}
});

test('rewriting both plan bytes and their hash cannot diverge from the fixed approved manifest',async()=>{
  const file=await storeFile(),store=new QqStore(file),reply=fixtureReply();try{const plan=store.mediaDelivery.prepare(reply),changed=structuredClone(plan),item=changed.parts[1]!;assert.notEqual(item.kind,'text');if(item.kind!=='text')item.asset.sha256='f'.repeat(64);
    const db=new DatabaseSync(file);try{db.prepare('UPDATE qq_media_deliveries SET body=?,plan_hash=? WHERE reply_id=?').run(JSON.stringify(changed),qqMediaHash(changed),reply.id);}finally{db.close();}
    assert.throws(()=>store.mediaDelivery.plan(reply.id),/LEDGER_CORRUPT/);
  }finally{store.close();}
});
