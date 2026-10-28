import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {stageHandoff} from '../packages/core/lib/context-handoff.js';
import {qqCapabilityFixture} from './qq-capabilities-fixture.js';
import {call,textReply} from './harness.js';
import type {InboundMessage} from '@dafeiyu/contracts';

test('handoff preserves original and corrected requests without granting execution or inventing tasks',()=>{
  const request:InboundMessage={id:'one',conversation:{channel:'qq',account:'123456',kind:'group',id:'123123'},sender:{id:'456456',displayName:'fixture'},occurredAt:new Date().toISOString(),text:'只分析，不实施；先确认',mainText:'只分析，不实施；先确认'};
  const next={...request,id:'two',text:'补充：只列三个选项',mainText:'补充：只列三个选项'};
  const handoff=stageHandoff('assessment','分析方案',null,request,{state:'running'},next);
  assert.equal(handoff.task,null);assert.equal(handoff.originalRequest?.text,request.text);assert.equal(handoff.latestRequest?.text,next.text);
  assert.equal(handoff.stage,'assessment');assert.equal(handoff.facts.state,'running');
});
test('unified task carries the actual request into exploration, assessment and public result evidence',async t=>{
  const h=await qqCapabilityFixture({tasks:true,deliverResults:true,context:{assembly:{mode:'unified'}}});t.after(h.close);
  let chat=0;const marker='HANDOFF_ORIGINAL_ONLY_ANALYZE';let evaluated=false,rendered=false;
  h.adapter.assessmentResponse=request=>{const body=JSON.stringify(request.messages);assert.match(body,/handoff/);assert.ok(body.includes(marker));evaluated=true;return textReply(JSON.stringify({goalStatus:'partial',summary:'fixture analysis',evidenceIds:[],limitations:['fixture'],unfinished:[],next:'deliver'}));};
  h.setResponse(request=>{const id=String(request.sessionId);
    if(id.startsWith('dafeiyu-task-')){assert.ok(JSON.stringify(request.messages).includes(marker));return textReply('fixture analysis completed');}
    if(id.startsWith('dafeiyu-delivery-v3-')){assert.ok(JSON.stringify(request.messages).includes(marker));assert.match(JSON.stringify(request.messages),/stage-handoff/);rendered=true;return textReply('fixture public analysis');}
    if(id.startsWith('memory-expression-verify-delivery-'))return textReply(JSON.stringify({faithful:true,issues:[]}));
    return ++chat===1?call('qq_task_submit',{requestId:randomUUID()}):textReply('');
  });
  await h.message('任务：只分析不实施 '+marker,{trigger:true});
  assert.equal(evaluated,true);assert.equal(rendered,true);
});
