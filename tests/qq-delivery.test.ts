import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import type { Reply } from '@dafeiyu/contracts';
import { qqCapabilityFixture,scene,bot,group,until,lastPage } from './qq-capabilities-fixture.js';
import { call,textReply } from './harness.js';
const text='第一段说明\n'+'🐟'.repeat(2600)+'\r\n'+'尾部文字'.repeat(1100);
const sentText=(sent:Record<string,unknown>)=>z.object({message:z.array(z.object({type:z.string(),data:z.object({text:z.string().optional()})}))}).parse(sent).message.filter(s=>s.type==='text').map(s=>s.data.text??'').join('');
const signal=()=>new AbortController().signal;

test('long QQ replies use real DSH and ordered loopback segments with a durable whole-message receipt',async t=>{
  const h=await qqCapabilityFixture();t.after(h.close);h.setResponse(()=>textReply(text));await h.message('请回复长文',{trigger:true});
  const item=h.core.journal.list()[0]!;assert.equal(item.state,'delivered');assert.ok(h.platform.sent.length>2);assert.equal(h.platform.sent.map(sentText).join(''),text);assert.ok(h.platform.sent.every(sent=>sentText(sent).length<=4000));
  const progress=h.ctx.dafeiyuQQ.deliveryStatus(item.reply!.id)!;assert.equal(progress.state,'sent');assert.equal(progress.confirmed,h.platform.sent.length);assert.ok(!JSON.stringify(progress).includes('尾部文字'));
  assert.equal(h.ctx.dafeiyuQQ.getStatus().counters.delivered,1);assert.equal(h.ctx.dafeiyuQQ.getStatus().counters.segmentsConfirmed,h.platform.sent.length);
  const before=h.platform.sent.length;assert.equal((await h.ctx.dafeiyuQQ.deliver(item.reply!,signal())).status,'sent');assert.equal(h.platform.sent.length,before);
  await h.reload();assert.equal((await h.ctx.dafeiyuQQ.deliver(item.reply!,signal())).status,'sent');assert.equal(h.platform.sent.length,before);
});

test('persisted answer dependencies stop later segments when previously read memory loses its source',async t=>{
  const h=await qqCapabilityFixture();t.after(h.close);const observed=await h.message('MEMORY_DEPENDENCY_SENTINEL');let step=0;
  h.setResponse(request=>++step===1?call('qq_browse',{requestId:'read'}):step===2?call('qq_observe_select',{requestId:'remember',snapshotId:lastPage(request).snapshotId,mode:'original',reason:'虚构记忆'}):textReply('已记忆'));
  await h.message('观察',{trigger:true});assert.equal(h.rows().memories.length,1);const before=h.platform.sent.length;step=0;
  h.platform.afterSend=async count=>{if(count!==before+1)return;h.emit({post_type:'notice',notice_type:'group_recall',self_id:Number(bot),group_id:Number(group),message_id:Number(observed.id)});await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.recalled===1);};
  h.setResponse(()=>++step===1?call('dafeiyu_memory_search',{query:'MEMORY_DEPENDENCY_SENTINEL',limit:'5'}):textReply(text));await h.message('依据记忆回复',{trigger:true});
  const item=h.core.journal.list().at(-1)!;assert.equal(item.state,'uncertain');assert.equal(h.platform.sent.length,before+1);assert.equal(h.ctx.dafeiyuQQ.deliveryStatus(item.reply!.id)?.state,'partial');
});

test('a definitely unsent reply revalidates persisted evidence on explicit retry without another model call',async t=>{
  const h=await qqCapabilityFixture();t.after(h.close);h.setResponse(()=>{h.platform.identity='99887766';return textReply(text);});await h.message('先不发送',{trigger:true});const item=h.core.journal.list()[0]!;
  assert.equal(item.state,'reply-ready');assert.equal(h.platform.sent.length,0);const calls=h.adapter.requests.length;h.platform.identity=bot;await h.reload();h.core.retryDelivery(item.id);await h.core.whenIdle();
  assert.equal(h.core.journal.get(item.id).state,'delivered');assert.equal(h.adapter.requests.length,calls);assert.equal(h.platform.sent.map(sentText).join(''),text);
});

test('same QQ reply is sent by one concurrent caller and conflicting content is never merged',async t=>{
  const h=await qqCapabilityFixture();t.after(h.close);const seed=await h.message('被动来源');const reply:Reply={id:'concurrent',conversation:scene,sourceMessageId:seed.id,text};
  let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{entered=resolve;});h.platform.afterSend=async count=>{if(count===1){entered();await gate;}};
  const a=h.ctx.dafeiyuQQ.deliver(reply,signal()),b=h.ctx.dafeiyuQQ.deliver(reply,signal());await ready;
  const conflict=await h.ctx.dafeiyuQQ.deliver({...reply,text:'不同正文'},signal());assert.equal(conflict.status,'unknown');release();assert.deepEqual(await a,await b);
  assert.equal(h.platform.sent.map(sentText).join(''),text);assert.equal(h.adapter.requests.length,0);
});

test('caller-side mutation cannot change a persisted in-flight QQ target, quote anchor or segment body',async t=>{
  const h=await qqCapabilityFixture();t.after(h.close);const source=await h.message('真实夹具来源'),mutable={id:'snapshot',conversation:{...scene},sourceMessageId:source.id,text};
  let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{entered=resolve;});h.platform.afterSend=async count=>{if(count===1){entered();await gate;}};
  const pending=h.ctx.dafeiyuQQ.deliver(mutable,signal());await ready;mutable.conversation.id='22334455';mutable.sourceMessageId='999';mutable.text='不同的正文';release();assert.equal((await pending).status,'sent');
  assert.ok(h.platform.sent.every(sent=>sent.group_id===Number(scene.id)));assert.equal(h.platform.sent.map(sentText).join(''),text);
});

test('a missing middle-segment receipt stops delivery and neither reload nor duplicate invocation resends',async t=>{
  const h=await qqCapabilityFixture();t.after(h.close);h.platform.loseAt=2;h.setResponse(()=>textReply(text));await h.message('丢回执',{trigger:true});const item=h.core.journal.list()[0]!;
  assert.equal(item.state,'uncertain');assert.equal(h.platform.sent.length,2);let progress=h.ctx.dafeiyuQQ.deliveryStatus(item.reply!.id)!;
  assert.equal(progress.confirmed,1);assert.equal(progress.unknown,1);assert.ok(progress.pending>0);assert.throws(()=>h.core.retryDelivery(item.id),/definitely unsent/);
  await h.reload();h.platform.loseAt=0;assert.equal((await h.ctx.dafeiyuQQ.deliver(item.reply!,signal())).status,'unknown');assert.equal(h.platform.sent.length,2);progress=h.ctx.dafeiyuQQ.deliveryStatus(item.reply!.id)!;assert.equal(progress.unknown,1);
});

for(const change of ['membership','identity','recall'] as const)test(`QQ ${change} between segments preserves confirmed progress and blocks the remaining send`,async t=>{
  const h=await qqCapabilityFixture();t.after(h.close);h.setResponse(()=>textReply(text));
  h.platform.afterSend=async count=>{if(count!==1)return;
    if(change==='membership'){h.platform.groups=[];await h.ctx.dafeiyuQQ.refreshGroups();}
    else if(change==='identity')h.platform.identity='99887766';
    else{h.emit({post_type:'notice',notice_type:'group_recall',self_id:Number(bot),group_id:Number(group),message_id:1});await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.recalled===1);}
  };
  await h.message('分段间变更',{trigger:true});const item=h.core.journal.list()[0]!;assert.equal(item.state,'uncertain');assert.equal(h.platform.sent.length,1);
  const progress=h.ctx.dafeiyuQQ.deliveryStatus(item.reply!.id)!;assert.equal(progress.state,'partial');assert.equal(progress.confirmed,1);assert.equal(progress.unknown,0);assert.ok(progress.pending>0);
});

test('per-segment authority is rechecked after async identity verification and cancellation never becomes a whole-message retry',async t=>{
  const h=await qqCapabilityFixture();t.after(h.close);const seed=await h.message('来源');let allowed=true;
  const reply:Reply={id:'guard',conversation:scene,sourceMessageId:seed.id,text};h.platform.beforeVerify=async()=>{allowed=false;};
  const guard=()=>{if(!allowed)throw new Error('PRIVATE_GUARD_DETAIL');};const rejected=await h.ctx.dafeiyuQQ.deliver(reply,signal(),guard);assert.equal(rejected.status,'not-sent');assert.equal(h.platform.sent.length,0);assert.ok(!JSON.stringify(rejected).includes('PRIVATE_GUARD_DETAIL'));
  const controller=new AbortController();h.platform.beforeVerify=async()=>{if(h.platform.sent.length===1)controller.abort();};
  const cancelled=await h.ctx.dafeiyuQQ.deliver({...reply,id:'cancel'},controller.signal);assert.equal(cancelled.status,'unknown');assert.equal(h.platform.sent.length,1);assert.equal(h.ctx.dafeiyuQQ.deliveryStatus('cancel')?.state,'partial');
});

test('QQ shutdown cancels an in-flight segment and status remains a read-only local operation',async t=>{
  const h=await qqCapabilityFixture();t.after(h.close);const seed=await h.message('来源');const channel=h.ctx.dafeiyuQQ,reply:Reply={id:'close',conversation:scene,sourceMessageId:seed.id,text};
  let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{entered=resolve;});h.platform.afterSend=async()=>{entered();await gate;};
  const sending=channel.deliver(reply,signal());await ready;const closed=channel.close();release();await closed;assert.equal((await sending).status,'unknown');
  const count=h.platform.sent.length;assert.equal(channel.deliveryStatus(reply.id)?.state,'uncertain');assert.equal(channel.getStatus().delivery.unknown,1);assert.equal(h.platform.sent.length,count);
});
