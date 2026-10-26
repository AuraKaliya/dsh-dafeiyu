import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { QqStore,QqBatchConfigSchema,qqTaskDirective } from '@dafeiyu/qq';
import { MessageSchema,messageMainText,messageParts,conversationKey } from '@dafeiyu/contracts';
import type { InboundMessage } from '@dafeiyu/contracts';
import { testTempDir } from './test-temp.js';
import { qqCapabilityFixture,scene,bot,group,owner,until } from './qq-capabilities-fixture.js';
import { call,textReply } from './harness.js';

function fixture(){const root=mkdtempSync(join(testTempDir(),'qq-batch-')),file=join(root,'qq.sqlite');let store=new QqStore(file),now=100000;const sent:InboundMessage[]=[],revoked=new Set<string>();
  const settings=QqBatchConfigSchema.parse({enabled:true}),host={current:(message:InboundMessage)=>messageParts(message).every(part=>!revoked.has(part.id)),submit:(message:InboundMessage)=>{sent.push(message);},failed:()=>assert.fail('unexpected batch failure')};let batch=store.batches(settings,host,()=>now);batch.start();
  const message=(id:string,text=id,sender=owner,target=scene)=>MessageSchema.parse({id,occurredAt:new Date(now).toISOString(),conversation:target,sender:{id:sender,displayName:sender},text,mainText:text});
  return {sent,revoked,message,get batch(){return batch;},advance:(ms:number)=>{now+=ms;batch.drain();},reload:()=>{batch.pause();store.close();store=new QqStore(file);batch=store.batches(settings,host,()=>now);batch.start();},close:()=>{batch.pause();store.close();}};
}
test('five seconds of quiet coalesce authentic sources; sender and conversation windows stay separate',()=>{
  const h=fixture();try{h.batch.enqueue(h.message('a','任务：整理'),true);h.advance(4000);h.batch.enqueue(h.message('b','再附一份清单'),false);h.batch.enqueue(h.message('c','他人','99999999'),true);h.batch.enqueue(h.message('d','另一会话',owner,{...scene,id:'22334455'}),true);h.advance(4999);assert.equal(h.sent.length,0);h.advance(1);
    assert.equal(h.sent.length,3);assert.deepEqual(messageParts(h.sent[0]!).map(part=>part.id),['a','b']);assert.equal(h.sent[0]!.id,'b');assert.equal(h.sent[0]!.text,'再附一份清单');assert.equal(qqTaskDirective(h.sent[0]!).text,'整理\n再附一份清单');
  }finally{h.close();}
});
test('sustained typing is bounded at fifteen seconds and duplicate input never extends a deadline',()=>{
  const h=fixture();try{const first=h.message('1');h.batch.enqueue(first,true);h.advance(4000);h.batch.enqueue(first,true);h.advance(1000);assert.equal(h.sent.length,1);
    for(let i=2;i<=5;i++){h.batch.enqueue(h.message(String(i)),true);h.advance(i===5?3000:4000);}assert.equal(h.sent.length,2);assert.equal(messageParts(h.sent[1]!).length,4);
  }finally{h.close();}
});
test('pending batches survive reload, remove recalled parts and cancel when their attention source disappears',()=>{
  const h=fixture();try{h.batch.enqueue(h.message('1'),true);h.advance(3000);h.batch.enqueue(h.message('2'),false);h.reload();assert.equal(h.sent.length,0);h.revoked.add('2');h.advance(5000);assert.deepEqual(h.sent.map(message=>message.id),['1']);
    h.batch.enqueue(h.message('3'),true);h.batch.enqueue(h.message('4'),false);h.revoked.add('3');h.advance(5000);assert.equal(h.sent.length,1);assert.equal(h.batch.count(),0);
  }finally{h.close();}
});
test('a forced ten-message cut keeps a still-typing sender focused without repeated @',()=>{
  const h=fixture();try{for(let i=0;i<10;i++)h.batch.enqueue(h.message(String(i)),i===0);assert.equal(h.sent.length,1);assert.equal(h.batch.has(h.message('followup')),true);
    h.batch.enqueue(h.message('followup','续上的一句'),false);h.advance(5000);assert.equal(h.sent.length,2);assert.equal(h.sent[1]!.text,'续上的一句');assert.equal(h.batch.has(h.message('later')),false);
  }finally{h.close();}
});
test('message/media budgets flush before overflow and a later owner control discards the pending lane',()=>{
  const h=fixture();try{for(let i=0;i<10;i++)h.batch.enqueue(h.message(String(i)),true);assert.equal(h.sent.length,1);assert.equal(messageParts(h.sent[0]!).length,10);
    h.batch.enqueue(h.message('long','字'.repeat(20000)),true);h.batch.enqueue(h.message('next','句'.repeat(20000)),true);assert.equal(h.sent.length,2);h.batch.discard(h.message('control'));h.advance(20000);assert.equal(h.sent.length,2);
    const one=h.message('media');one.media=Array.from({length:8},(_,i)=>({schemaVersion:1,source:{provider:'qq-media',key:String(i)},kind:'image',name:null}));h.batch.enqueue(one,true);h.batch.enqueue({...h.message('overflow'),media:one.media.slice(0,1)},true);assert.equal(h.sent.length,3);
  }finally{h.close();}
});
test('actual DSH receives one ordered batch and keeps every original identity available for duplicate and recall checks',async t=>{
  const h=await qqCapabilityFixture({batch:{quietMs:90,maxWaitMs:500}});t.after(h.close);
  await h.message('大肥鱼，先听我说',{id:'8101'});await h.message('这是一句话的后半段',{id:'8102'});assert.equal(h.adapter.requests.length,0);await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.accepted===1);await h.core.whenIdle();
  assert.equal(h.adapter.requests.length,1);assert.equal(h.platform.sent.length,1);const scope={agentId:'dafeiyu',route:conversationKey('dafeiyu',scene)},item=h.core.journal.messageFor(scope,'8101')!;assert.equal(item.message.id,'8102');assert.equal(h.core.journal.messageFor(scope,'8102')?.id,item.id);assert.equal(messageMainText(item.message),'大肥鱼，先听我说\n这是一句话的后半段');
  const rendered=JSON.stringify(h.adapter.requests[0]!.messages);assert.ok(rendered.includes('8101')&&rendered.includes('8102')&&rendered.includes('后半段'));
  await h.message('这是一句话的后半段',{id:'8102'});assert.equal(h.adapter.requests.length,1);
  h.emit({post_type:'notice',notice_type:'group_recall',self_id:Number(bot),group_id:Number(group),message_id:8101});await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.recalled===1);assert.equal(h.core.journal.messageRecalled(scope,'8102'),true);
});
test('pending group inputs cannot revive after being put in and taken out of the assistant',async t=>{
  const h=await qqCapabilityFixture({batch:{quietMs:80,maxWaitMs:500}});t.after(h.close);await h.message('稍后合并',{trigger:true,id:'8201'});h.platform.groups[0]!.msgMask=2;await h.ctx.dafeiyuQQ.refreshGroups();await new Promise(resolve=>setTimeout(resolve,120));assert.equal(h.adapter.requests.length,0);
  h.platform.groups[0]!.msgMask=1;await h.ctx.dafeiyuQQ.refreshGroups();assert.equal(h.ctx.dafeiyuQQ.getStatus().messageBatch.pending,0);assert.equal(h.platform.sent.length,0);
});
test('a split explicit task is derived from authentic combined text instead of only the last sentence',async t=>{
  const h=await qqCapabilityFixture({tasks:true,batch:{quietMs:80,maxWaitMs:500}});t.after(h.close);let submitted=false;
  h.setResponse(request=>String(request.sessionId).startsWith('dafeiyu-task-')?textReply('任务完成'):!submitted?(submitted=true,call('qq_task_submit',{kind:'explicit-task',requestId:'batch-task'})):textReply('已受理'));
  await h.message('任务：整理第一部分',{trigger:true,id:'8301'});await h.message('然后列出第二部分',{id:'8302'});await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.accepted===1);await h.core.whenIdle();const db=new DatabaseSync(join(h.root,'core/runtime.sqlite'),{readOnly:true});try{const row=db.prepare("SELECT body FROM execution_requests WHERE producer='qq-tasks'").get();assert.ok(row);const body=JSON.parse(String(row.body));assert.equal(body.input.goal,'整理第一部分\n然后列出第二部分');}finally{db.close();}
});
