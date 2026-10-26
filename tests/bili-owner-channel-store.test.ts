import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { BiliOwnerStore,initializeBiliOwnerStorage,inspectBiliOwnerStorage,BILI_OWNER_APPLICATION_ID,BILI_OWNER_SCHEMA_VERSION,
  BILI_OWNER_ACCOUNT,BILI_OWNER_UID,BILI_OWNER_SCENE,biliOwnerTextHash } from '@dafeiyu/channel-bili-owner';
import type { BiliOwnerMessage,BiliOwnerPage,BiliOwnerIdentity } from '@dafeiyu/channel-bili-owner';
import { testTempDir } from './test-temp.js';

const identity:BiliOwnerIdentity={agentId:'dafeiyu',profileId:'bili-owner-test',accountUid:BILI_OWNER_ACCOUNT,ownerUid:BILI_OWNER_UID};
const now=1793000000000,pin='a'.repeat(64),stamp='b'.repeat(64);
const message=(id='9007199254740993123',seqno=id):BiliOwnerMessage=>({id,seqno,senderUid:BILI_OWNER_UID,receiverUid:BILI_OWNER_ACCOUNT,type:1,timestamp:now/1000,text:'虚构主人文字'});
const page=(messages:BiliOwnerMessage[],hasMore=false,nextBeforeSeqno:string|null=null):BiliOwnerPage=>({accountUid:BILI_OWNER_ACCOUNT,ownerUid:BILI_OWNER_UID,loggedIn:true,bindingStamp:stamp,messages,hasMore,nextBeforeSeqno});
async function fixture(fresh=true){const root=await mkdtemp(join(testTempDir(),'bili-owner-store-')),file=join(root,'bili-owner.sqlite'),store=new BiliOwnerStore(file,identity,true);
  if(fresh)store.initializeFresh({requestId:'explicit-cutover',since:now-100000,cutoverHash:pin},now);return {root,file,store};}
function accept(store:BiliOwnerStore,value=message()){store.acceptPage(page([value]),store.cursor().version,1000,now);return store.accepted(value.id,randomUUID(),now);}

test('fresh reception ignores pre-start messages without importing an old queue and preserves exact new IDs',async()=>{
  const f=await fixture();try{
    assert.equal('importLegacy' in f.store,false);
    const old={...message('9007199254740993122'),timestamp:now/1000-101},current=message();
    f.store.acceptPage(page([old,current]),f.store.cursor().version,1000,now);
    assert.equal(f.store.source(old.id)?.state,'before-start');assert.equal(f.store.source(old.id)?.message,null);
    assert.deepEqual(f.store.pending().map(item=>item.id),[current.id]);
    f.store.acceptPage(page([old,current]),f.store.cursor().version,1000,now);
    assert.deepEqual(f.store.pending().map(item=>item.id),[current.id]);
  }finally{f.store.close();}
});

test('Bili owner schema creation is explicit and cannot invent a handover boundary on startup',async()=>{
  const root=await mkdtemp(join(testTempDir(),'bili-owner-init-')),file=join(root,'bili-owner.sqlite');
  assert.throws(()=>new BiliOwnerStore(file,identity),/BILI_OWNER_INITIALIZATION_REQUIRED/);assert.equal(existsSync(file),false);
  const initialized=initializeBiliOwnerStorage(root,identity);assert.equal(initialized.supported,true);assert.equal(initialized.bindingReady,false);assert.deepEqual(initialized.codes,['BILI_OWNER_HANDOVER_REQUIRED']);
  const store=new BiliOwnerStore(file,identity);try{assert.equal(store.cursor().since,null);assert.equal(store.bindingReady(),false);
    assert.throws(()=>store.acceptPage(page([message()]),store.cursor().version),/BILI_OWNER_HANDOVER_REQUIRED/);
    assert.deepEqual(store.initializeFresh({requestId:'fresh',since:now,cutoverHash:pin},now),{duplicate:false,bindingReady:true});
    assert.deepEqual(store.initializeFresh({requestId:'fresh',since:now,cutoverHash:pin},now),{duplicate:true,bindingReady:true});
    assert.throws(()=>store.initializeFresh({requestId:'fresh',since:now+1,cutoverHash:pin},now),/BILI_OWNER_HANDOVER_CONFLICT/);
  }finally{store.close();}
  assert.equal(inspectBiliOwnerStorage(file,identity).version,BILI_OWNER_SCHEMA_VERSION);assert.equal(inspectBiliOwnerStorage(file,identity).bindingReady,true);
  const db=new DatabaseSync(file,{readOnly:true});try{assert.equal(db.prepare('PRAGMA application_id').get()?.application_id,BILI_OWNER_APPLICATION_ID);}finally{db.close();}
});

test('the first authenticated binding stamp and a confirmed binding fault survive restarts without replacing prior evidence',async()=>{
  const f=await fixture();assert.equal(f.store.verifiedBinding(),null);assert.equal(f.store.bindVerified(stamp,now),true);assert.equal(f.store.bindVerified(stamp,now),false);f.store.close();
  const reopened=new BiliOwnerStore(f.file,identity);try{assert.equal(reopened.verifiedBinding(),stamp);assert.throws(()=>reopened.bindVerified(pin,now),/BILI_OWNER_BINDING_CHANGED/);assert.equal(reopened.verifiedBinding(),stamp);
    reopened.rejectBinding('BILI_OWNER_BINDING_CHANGED',now);reopened.rejectBinding('BILI_OWNER_BINDING_CHANGED',now);assert.throws(()=>reopened.bindVerified(stamp,now),/BILI_OWNER_BINDING_REJECTED/);assert.deepEqual(inspectBiliOwnerStorage(f.file,identity).codes,['BILI_OWNER_BINDING_REJECTED']);
    const db=new DatabaseSync(f.file,{readOnly:true});try{assert.equal(db.prepare("SELECT count(*) AS n FROM bili_owner_events WHERE object_id='binding-fault'").get()?.n,1);}finally{db.close();}
  }finally{reopened.close();}
});

test('inbound deduplication verifies immutable bytes and refuses third parties without partially admitting a page',async()=>{
  const f=await fixture(),entry=message();try{f.store.acceptPage(page([entry]),f.store.cursor().version,1000,now);const first=f.store.source(entry.id);
    f.store.acceptPage(page([entry]),f.store.cursor().version,1000,now);assert.deepEqual(f.store.source(entry.id),first);
    assert.throws(()=>f.store.acceptPage(page([{...entry,text:'changed'}]),f.store.cursor().version,1000,now),/BILI_OWNER_MESSAGE_CONFLICT/);
    assert.throws(()=>f.store.acceptPage(page([{...message('101'),senderUid:'123456'}]),f.store.cursor().version,1000,now));assert.equal(f.store.source('101'),null);
    const own={...message('102'),senderUid:BILI_OWNER_ACCOUNT,receiverUid:BILI_OWNER_UID};f.store.acceptPage(page([own]),f.store.cursor().version,1000,now);assert.equal(f.store.source(own.id),null);
  }finally{f.store.close();}
});

test('bounded pagination retains its unfinished frontier and a capacity error rolls back the entire page',async()=>{
  const f=await fixture();try{const a=message('300','300'),b=message('200','200');
    const first=f.store.acceptPage(page([a,b],true,'200'),f.store.cursor().version,1000,now);assert.equal(first.complete,false);assert.equal(first.cursor.frontier,null);assert.equal(first.cursor.before,'200');assert.equal(first.cursor.upper,'300');
    const cursor=f.store.cursor();assert.throws(()=>f.store.acceptPage(page([message('150','150')],true,'151'),cursor.version,1000,now),/BILI_OWNER_CURSOR_INVALID/);assert.deepEqual(f.store.cursor(),cursor);assert.equal(f.store.source('150'),null);
    const complete=f.store.acceptPage(page([message('150','150')]),cursor.version,1000,now);assert.equal(complete.complete,true);assert.equal(complete.cursor.frontier,'300');assert.equal(complete.cursor.before,null);
    const before=f.store.cursor();assert.throws(()=>f.store.acceptPage(page([message('600','600'),message('500','500')]),before.version,4,now),/BILI_OWNER_CAPACITY/);assert.equal(f.store.source('600'),null);assert.equal(f.store.source('500'),null);assert.deepEqual(f.store.cursor(),before);
  }finally{f.store.close();}
});

test('delivery binds exact reply/source hashes, accepts 1000 Unicode codepoints and never truncates 1001',async()=>{
  const f=await fixture();try{const source=accept(f.store),text='\n'+ '鱼'.repeat(999)+'🐟'+'\n',reply={id:'reply-a',conversation:BILI_OWNER_SCENE,sourceMessageId:source.id,text};
    const planned=f.store.prepareReply(reply,now);assert.equal(planned.state,'prepared');assert.equal(Array.from(planned.plan.text).length,1000);assert.equal(planned.plan.text,'鱼'.repeat(999)+'🐟');assert.equal(planned.plan.bodyHash,biliOwnerTextHash(text));assert.equal(planned.plan.wireHash,biliOwnerTextHash(planned.plan.text));
    assert.deepEqual(f.store.prepareReply(reply,now),planned);assert.throws(()=>f.store.prepareReply({...reply,text:'changed'},now),/BILI_OWNER_DELIVERY_CONFLICT/);
    const second=accept(f.store,message('201'));const tooLong=f.store.prepareReply({...reply,id:'reply-long',sourceMessageId:second.id,text:'🐟'.repeat(1001)},now);assert.equal(tooLong.state,'blocked');assert.equal(tooLong.code,'BILI_OWNER_TEXT_LIMIT');assert.equal(Array.from(tooLong.plan.text).length,1001);assert.throws(()=>f.store.begin(tooLong.plan.replyId,now),/BILI_OWNER_DELIVERY_STATE/);
    assert.throws(()=>f.store.prepareReply({...reply,id:'foreign',conversation:{...BILI_OWNER_SCENE,id:'123456'}},now),/BILI_OWNER_TARGET_DENIED/);
  }finally{f.store.close();}
});

test('confirmed and uncertain deliveries are immutable and recovery cannot redispatch an interrupted send',async()=>{
  const f=await fixture(),source=accept(f.store),reply={id:'reply-one',conversation:BILI_OWNER_SCENE,sourceMessageId:source.id,text:'虚构回复'};
  f.store.prepareReply(reply,now);f.store.begin(reply.id,now);f.store.confirm(reply.id,'12345678901234567890',now);const confirmed=f.store.delivery(reply.id);assert.equal(confirmed?.state,'sent');
  const second=accept(f.store,message('202'));f.store.prepareReply({...reply,id:'reply-two',sourceMessageId:second.id},now);f.store.begin('reply-two',now);f.store.close();
  const reopened=new BiliOwnerStore(f.file,identity);try{assert.deepEqual(reopened.recover(now),{unknown:1});assert.equal(reopened.delivery('reply-two')?.state,'unknown');assert.deepEqual(reopened.delivery(reply.id),confirmed);assert.deepEqual(reopened.recover(now),{unknown:0});
    assert.throws(()=>reopened.begin('reply-two',now),/BILI_OWNER_DELIVERY_STATE/);assert.throws(()=>reopened.notDispatched('reply-two','NO_SEND',now),/BILI_OWNER_DELIVERY_STATE/);assert.throws(()=>reopened.confirm('reply-two','2',now),/BILI_OWNER_DELIVERY_STATE/);
  }finally{reopened.close();}
});

test('changing reply IDs cannot bypass a logical unknown; acknowledgement and task result remain separate deliveries',async()=>{
  const f=await fixture();try{const source=accept(f.store),reply={id:'ack',conversation:BILI_OWNER_SCENE,sourceMessageId:source.id,text:'虚构受理'};
    f.store.prepareReply(reply,now);f.store.begin(reply.id,now);f.store.unknown(reply.id,'BILI_OWNER_NETWORK_UNKNOWN',now);
    assert.throws(()=>f.store.prepareReply({...reply,id:'another-ack'},now),/BILI_OWNER_LOGICAL_DELIVERY_CONFLICT/);
    const anchor={schemaVersion:1 as const,kind:'task-result' as const,taskId:randomUUID(),runId:randomUUID(),inboundId:source.coreInboundId!,target:BILI_OWNER_SCENE,intentVersion:1,authorityVersion:pin,expiresAt:new Date(now+10000).toISOString()};
    const task={...reply,id:'task-result',taskResult:anchor,text:'虚构任务结果'};assert.equal(f.store.prepareReply(task,now).state,'prepared');
    f.store.begin(task.id,now);f.store.unknown(task.id,'BILI_OWNER_NETWORK_UNKNOWN',now);assert.throws(()=>f.store.prepareReply({...task,id:'renamed-task-result'},now),/BILI_OWNER_LOGICAL_DELIVERY_CONFLICT/);
    assert.equal(f.store.delivery('another-ack'),null);assert.equal(f.store.delivery('renamed-task-result'),null);assert.equal(f.store.counts().deliveries.unknown,2);
  }finally{f.store.close();}
});

test('read-only inspection detects changed binding or unsupported schema without rewriting authoritative bytes',async()=>{
  const f=await fixture();f.store.close();const before=await readFile(f.file);
  assert.equal(inspectBiliOwnerStorage(f.file,{...identity,agentId:'other'}).identityMatches,false);assert.deepEqual(await readFile(f.file),before);
  const db=new DatabaseSync(f.file);db.exec('PRAGMA user_version=999');db.close();const changed=await readFile(f.file);assert.equal(inspectBiliOwnerStorage(f.file,identity).supported,false);
  assert.throws(()=>new BiliOwnerStore(f.file,identity),/BILI_OWNER_SCHEMA_UNSUPPORTED/);assert.deepEqual(await readFile(f.file),changed);
});
