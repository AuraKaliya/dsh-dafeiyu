import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { QqStore,qqReplyDelayMs } from '@dafeiyu/qq';
import { ReplyMediaManifestSchema } from '@dafeiyu/contracts';
import type { Reply } from '@dafeiyu/contracts';
import { QqSegmentedTransport } from '../packages/channel-qq/lib/transport.js';
import { QqMediaTransport } from '../packages/channel-qq/lib/media-transport.js';
import { waitForQqReply } from '../packages/channel-qq/lib/reply-delay.js';
import { qqTextHash } from '../packages/channel-qq/lib/media-delivery.js';
import { testTempDir } from './test-temp.js';
const store=()=>new QqStore(join(mkdtempSync(join(testTempDir(),'qq-delay-')),'qq.sqlite'));
const reply=(text:string):Reply=>({id:randomUUID()+':reply',conversation:{channel:'qq',account:'12345678',kind:'private',id:'87654321'},sourceMessageId:'123',text});
test('reply delay is 2–10 seconds and counts Unicode text only',()=>{
  assert.equal(qqReplyDelayMs(''),2000);assert.equal(qqReplyDelayMs('🐟'),2020);assert.equal(qqReplyDelayMs('字'.repeat(100)),4000);assert.equal(qqReplyDelayMs('x'.repeat(400)),10000);assert.equal(qqReplyDelayMs('x'.repeat(10000)),10000);
});
test('segmented text waits once before the first send and cancellation leaves no external effect',async()=>{
  const s=store();try{let waits=0,sends=0;const transport=new QqSegmentedTransport({ledger:s.delivery,beforeSend:async value=>{waits++;assert.equal(value.text.length,8001);},check:async()=>{},send:async()=>String(++sends),confirmed:()=>{}});
    assert.equal((await transport.deliver(reply('字'.repeat(8001)),new AbortController().signal)).status,'sent');assert.equal(waits,1);assert.equal(sends,11);
    const stop=new AbortController();const cancelled=new QqSegmentedTransport({ledger:s.delivery,beforeSend:(_value,signal)=>waitForQqReply('',signal),check:async()=>{},send:async()=>{throw new Error('MUST_NOT_SEND');},confirmed:()=>{}});
    const work=cancelled.deliver(reply('取消'),stop.signal);stop.abort();assert.deepEqual(await work,{status:'not-sent',code:'DELIVERY_CANCELLED'});
  }finally{s.close();}
});
test('a media-only reply counts zero text and mixed parts do not repeat the wait',async()=>{
  for(const text of ['', '正文']){const s=store();try{const base=reply(text),inboundId=base.id.slice(0,-6),data=Buffer.from('actual-fixture-bytes'),sha=createHash('sha256').update(data).digest('hex');let waits=0,sends=0;
    const media=ReplyMediaManifestSchema.parse({schemaVersion:1,id:randomUUID(),replyId:base.id,runId:randomUUID(),target:base.conversation,sourceMessageId:base.sourceMessageId,anchor:{kind:'reply',inboundId},textHash:qqTextHash(text),draft:{id:randomUUID(),version:1},parts:[{kind:'image',asset:{schemaVersion:1,id:randomUUID(),version:1,kind:'image',sha256:sha,bytes:data.length,mime:'image/png'}}],sourceStamp:'d'.repeat(64),credential:'e'.repeat(64),expiresAt:'2099-01-01T00:00:00Z'});
    const transport=new QqMediaTransport({ledger:s.mediaDelivery,legacyProgress:()=>null,beforeSend:async value=>{waits++;assert.equal(qqReplyDelayMs(value.text),text?2040:2000);},check:async()=>{},send:async()=>String(++sends),confirmed:()=>{}});
    const result=await transport.deliver({...base,media},new AbortController().signal,()=>{},async()=>data);assert.equal(result.status,'sent',JSON.stringify(result));assert.equal(waits,1);assert.equal(sends,text?2:1);
  }finally{s.close();}}
});
