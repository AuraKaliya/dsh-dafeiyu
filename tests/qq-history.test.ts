import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { QqStore } from '@dafeiyu/qq';
import { readRecentQqHistory,QQ_HISTORY_WINDOW_MS } from '../packages/channel-qq/lib/history.js';
import { recentForwardNodes } from '../packages/channel-qq/lib/forward.js';
import { qqCapabilityFixture,scene,bot,group,owner,lastPage,outcomes } from './qq-capabilities-fixture.js';
import { call,textReply } from './harness.js';
import { testTempDir } from './test-temp.js';

const now=Date.parse('2026-10-27T03:00:00.000Z');
const message=(id:string,time=now/1000)=>({message_id:id,message_type:'group',group_id:group,user_id:owner,self_id:bot,time,message:[{type:'text',data:{text:'本地虚构历史'}}]});
test('platform history appends only the observation preceding 24 hours and excludes foreign/future records',async()=>{
  const seen:string[]=[];const result=await readRecentQqHistory({botId:bot,allowed:()=>true,now:()=>now,fetch:async()=>({messages:[message('-1',(now-QQ_HISTORY_WINDOW_MS)/1000),message('-2',(now-QQ_HISTORY_WINDOW_MS-1000)/1000),message('-3',now/1000+1),{...message('-4'),group_id:'98765432'},message('-5')]}),append:(_scene,item)=>{seen.push(item.message_id);return {added:true,media:0};}},scene,new AbortController().signal);
  assert.deepEqual(seen,['-1','-5']);assert.equal(result.excluded,3);assert.equal(result.pages,1);
});
test('history is bounded to five pages and rechecks permission after every platform response',async()=>{
  let pages=0,added=0;const result=await readRecentQqHistory({botId:bot,allowed:()=>true,now:()=>now,fetch:async()=>({messages:Array.from({length:20},(_,i)=>message(String(-(++pages*100+i)),now/1000-pages))}),append:()=>{added++;return {added:true,media:0};}},scene,new AbortController().signal);
  assert.equal(result.pages,5);assert.equal(added,100);assert.equal(result.limited,true);
  let allowed=true;await assert.rejects(readRecentQqHistory({botId:bot,allowed:()=>allowed,now:()=>now,fetch:async()=>{allowed=false;return {messages:[message('-1')]};},append:()=>{throw new Error('MUST_NOT_APPEND');}},scene,new AbortController().signal),/TARGET_NOT_ALLOWED/);
});
test('append-only history preserves known and recalled messages and does not evict a full live cache',()=>{
  const store=new QqStore(join(mkdtempSync(join(testTempDir(),'qq-history-')),'qq.sqlite')),route=JSON.stringify([bot,'group',group]),meta={occurredAt:new Date(now).toISOString(),unsupported:[]};
  try{store.remember(route,'-1',owner,'原文',meta);assert.equal(store.appendHistory(route,'-1',owner,'不能覆盖',meta),false);store.cache.revoke(route,'-2');assert.equal(store.appendHistory(route,'-2',owner,'不能复活',meta),false);
    for(let i=3;i<=201;i++)store.remember(route,String(-i),owner,'已收到',meta);assert.equal(store.appendHistory(route,'-999',owner,'不能挤出已收到消息',meta),false);assert.equal(store.find(route,'-1')?.text,'原文');}finally{store.close();}
});
test('observation filters even already-cached old or unknown-time text without deleting the retained records',()=>{
  const store=new QqStore(join(mkdtempSync(join(testTempDir(),'qq-window-')),'qq.sqlite'),{cache:{clock:()=>now}}),route=JSON.stringify([bot,'group',group]);
  try{store.remember(route,'-1',owner,'最近',{occurredAt:new Date(now).toISOString(),unsupported:[]});store.remember(route,'-2',owner,'界外',{occurredAt:new Date(now-86400001).toISOString(),unsupported:[]});store.remember(route,'-3',owner,'未知');
    const page=store.cache.browse(route,'scope',{requestId:'window'},true);assert.deepEqual(page.page.messages.map(m=>m.id),['-1']);assert.equal(store.find(route,'-2')?.text,'界外');
    store.appendHistory(route,'-3',owner,'不能覆盖正文',{occurredAt:new Date(now-1000).toISOString(),unsupported:[]});assert.equal(store.find(route,'-3')?.text,'未知');assert.equal(store.cache.browse(route,'scope',{requestId:'after-metadata'},true).page.messages.length,2);
  }finally{store.close();}
});
test('merged forwards discard old and unknown-time nodes and never expand nested forwards',()=>{
  const value=recentForwardNodes({messages:[{time:now/1000,content:[{type:'text',data:{text:'可读'}},{type:'forward',data:{id:'not-followed'}}]},{time:(now-QQ_HISTORY_WINDOW_MS-1000)/1000,content:[{type:'text',data:{text:'不能回看'}}]},{content:[{type:'text',data:{text:'时间未知'}}]}]},now);
  assert.equal(value.messages.length,1);assert.equal(value.excluded,2);assert.equal(value.messages[0]?.text,'可读');
});
test('actual DSH observes history on demand and may quote it without replaying it as inbound',async t=>{
  const h=await qqCapabilityFixture();t.after(h.close);h.platform.history=[message('-700',Math.floor(Date.now()/1000)-3600)];let step=0;
  h.setResponse(request=>{if(++step===1)return call('qq_browse',{requestId:'history',includeRecentHistory:true});if(step===2)return call('qq_reply_quote',{snapshotId:lastPage(request).snapshotId,messageId:'-700'});return textReply('这条历史内容值得回应。');});
  await h.message('回看并自主选择引用',{trigger:true});assert.equal(h.platform.historyCalls.length,1);assert.equal(h.core.journal.list().length,1);assert.equal(h.platform.sent.length,1);
  const sent=h.platform.sent[0];assert.ok(JSON.stringify(sent).includes('"id":"-700"'));assert.ok(!h.core.journal.list().some(item=>item.message.id==='-700'));
});
test('a forwarded message is read through a bound handle and unknown handles cannot be supplied by the model',async t=>{
  const h=await qqCapabilityFixture();t.after(h.close);h.platform.forwards.set('real-forward-handle',{messages:[{time:Math.floor(Date.now()/1000),content:[{type:'text',data:{text:'转发内的实际内容'}}]}]});let step=0;
  h.setResponse(()=>++step===1?call('qq_forward_read',{}):textReply('已按真实内容回答。'));
  await h.message('读这条转发',{trigger:true,parts:[{type:'forward',data:{id:'real-forward-handle'}}]});
  const result=outcomes(h.adapter.requests.at(-1)!);assert.ok(result.some(r=>r.status==='succeeded'&&JSON.stringify(r.data).includes('转发内的实际内容')));assert.ok(!JSON.stringify(result).includes('real-forward-handle'));
});
test('a real QQ task can choose a historical quote for its persona result without changing the acknowledgement',async t=>{
  const h=await qqCapabilityFixture({tasks:true,deliverResults:true});t.after(h.close);h.platform.history=[message('-701',Math.floor(Date.now()/1000)-60)];let chat=0,work=0;
  h.setResponse(request=>{const id=String(request.sessionId);if(id.startsWith('dafeiyu-delivery-v3-'))return textReply('这条历史内容让我想继续讨论。');if(id.startsWith('memory-expression-verify-delivery-'))return textReply('{"faithful":true,"issues":[]}');
    if(id.startsWith('dafeiyu-task-')){if(++work===1)return call('qq_browse',{requestId:'task-history',includeRecentHistory:true,target:scene});if(work===2)return call('qq_reply_quote',{snapshotId:lastPage(request).snapshotId,messageId:'-701'});return textReply('这条历史内容值得回应。');}
    return ++chat===1?call('qq_task_submit',{requestId:'quote-task'}):textReply('已受理');});
  await h.message('任务：回看有兴趣的历史并选择引用',{trigger:true});assert.equal(h.platform.sent.length,2);assert.ok(!JSON.stringify(h.platform.sent[0]).includes('"id":"-701"'));assert.ok(JSON.stringify(h.platform.sent[1]).includes('"id":"-701"'));
});
