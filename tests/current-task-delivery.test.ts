import {test} from 'node:test';
import assert from 'node:assert/strict';
import {qqCapabilityFixture} from './qq-capabilities-fixture.js';
import {call,textReply} from './harness.js';

test('pending experience snapshots remain valid through consecutive channel deliveries',async t=>{
  const h=await qqCapabilityFixture();t.after(h.close);h.setResponse(()=>textReply('当前回复'));
  await h.message('第一次交流',{trigger:true});await h.message('第二次交流',{trigger:true});
  assert.deepEqual(h.core.journal.list().map(item=>item.state),['delivered','delivered']);assert.equal(h.platform.sent.length,2);
});

test('one Agent completes and delivers its final answer without mandatory review or rewriting',async t=>{
  const h=await qqCapabilityFixture({tasks:true,deliverResults:true});t.after(h.close);let chat=0;
  h.setResponse(request=>String(request.sessionId).startsWith('dafeiyu-task-')?textReply('主 Agent 的最终回答'):++chat===1?call('qq_task_submit',{requestId:'current-flow'}):textReply('已经受理'));
  await h.message('任务：完成当前测试',{trigger:true});
  assert.deepEqual(h.core.journal.list().map(item=>({state:item.state,events:h.core.journal.events(item.route).filter(e=>e.traceId===item.id&&e.type.startsWith('delivery.')).map(e=>({type:e.type,data:e.data}))})),[{state:'delivered',events:[{type:'delivery.started',data:{replyId:h.core.journal.list()[0]!.reply!.id}},{type:'delivery.sent',data:{receiptId:'-1'}}]}]);
  assert.equal(h.platform.sent.filter(item=>JSON.stringify(item).includes('主 Agent 的最终回答')).length,1);
  assert.ok(h.adapter.requests.every(request=>!String(request.sessionId).startsWith('dafeiyu-review-')&&!String(request.sessionId).startsWith('dafeiyu-delivery-v3-')));
});
