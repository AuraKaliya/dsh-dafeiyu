import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {stageHandoff} from '../packages/core/lib/context-handoff.js';
import {qqCapabilityFixture} from './qq-capabilities-fixture.js';
import {call,textReply} from './harness.js';
import type {InboundMessage} from '@dafeiyu/contracts';
import {z} from 'zod';

test('handoff preserves original and corrected requests without granting execution or inventing tasks',()=>{
  const request:InboundMessage={id:'one',conversation:{channel:'qq',account:'123456',kind:'group',id:'123123'},sender:{id:'456456',displayName:'fixture'},occurredAt:new Date().toISOString(),text:'只分析，不实施；先确认',mainText:'只分析，不实施；先确认'};
  const next={...request,id:'two',text:'补充：只列三个选项',mainText:'补充：只列三个选项'};
  const handoff=stageHandoff('assessment','分析方案',null,request,{state:'running'},next);
  assert.equal(handoff.task,null);assert.equal(handoff.originalRequest?.text,request.text);assert.equal(handoff.latestRequest?.text,next.text);
  assert.equal(handoff.stage,'assessment');assert.equal(handoff.facts.state,'running');
});

test('unified task refreshes newly selected evidence at the next model step and keeps one owned snapshot',async t=>{
  let added=false,taskStep=0,chat=0,refreshed=false;
  const h=await qqCapabilityFixture({tasks:true,context:{assembly:{mode:'unified'}},extraTaskActions:['fixture_context_add'],beforeActivate:async ctx=>{
    ctx.dafeiyu.registerExtensionV3({protocolVersion:3,id:'fixture-context',version:'1',agentId:'dafeiyu',contexts:[{id:'evidence',prepare:async()=>added?[{id:'new',version:'1',text:'NEW_TASK_CONTEXT',expiresAt:'9999-12-31T23:59:59.999Z',sources:[{ref:'fixture:context',version:'1',hash:'fixture'}]}]:[],validate:()=>added}],
      actions:[{id:'fixture_context_add',version:'1',description:'fixture evidence selection',inputSchema:z.strictObject({}),outputSchema:z.json(),effects:'local-write',requiresTask:true,execute:async()=>{added=true;return {status:'succeeded',effects:'confirmed',completeness:'complete',data:{added:true},sources:[],receipts:[]};}}]});
  }});t.after(h.close);
  h.setResponse(request=>{if(String(request.sessionId).startsWith('dafeiyu-task-')){
    if(++taskStep===1){assert.ok(!JSON.stringify(request.messages).includes('NEW_TASK_CONTEXT'));return call('fixture_context_add',{});}
    assert.match(JSON.stringify(request.messages),/NEW_TASK_CONTEXT/);
    const carriers=request.messages.flatMap(message=>message.role==='user'&&'source'in message&&message.source.kind==='runtime-context'&&message.source.form==='snapshot'?message.source.sections.filter(section=>section.name==='dafeiyu:persona-context:v1'):[]);assert.equal(carriers.length,1);refreshed=true;return textReply('fixture result');
  }return ++chat===1?call('qq_task_submit',{requestId:'refresh'}):textReply('');});
  await h.message('任务：读取更新后的虚构资料',{trigger:true});assert.equal(taskStep,2);assert.equal(refreshed,true);
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

test('a waiting task remains in the same conversation responsibility index without becoming a new task',async t=>{
  const h=await qqCapabilityFixture({tasks:true,context:{assembly:{mode:'unified'}}});t.after(h.close);let chat=0;
  h.adapter.assessmentResponse=()=>textReply('fixture invalid assessment retains work');
  h.setResponse(request=>String(request.sessionId).startsWith('dafeiyu-task-')?textReply('saved draft'):++chat===1?call('qq_task_submit',{requestId:'responsibility'}):textReply(''));
  await h.message('任务：只分析 RESPONSIBILITY_PENDING',{trigger:true});
  let observed=false;h.setResponse(request=>{const text=JSON.stringify(request.messages);assert.ok(text.includes('current-responsibility'));assert.ok(text.includes('RESPONSIBILITY_PENDING'));assert.ok(text.includes('waiting'));observed=true;return textReply('仍在等待补齐评价。');});
  await h.message('刚才那个任务还欠什么',{trigger:true});
  const tasks=h.core.getStatus().execution;assert.ok(tasks);assert.equal(observed,true);assert.ok(h.adapter.requests.some(request=>String(request.sessionId).startsWith('dafeiyu-task-')));
});
