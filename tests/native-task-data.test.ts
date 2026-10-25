import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { TaskSubmitSchema } from '@dafeiyu/contracts';
import { executionHarness } from './execution-fixture.js';
import { textReply } from './harness.js';
import { testTempDir } from './test-temp.js';

test('native task data is durable user input without changing the goal, epoch or producer authority',async()=>{
  const root=await mkdtemp(join(testTempDir(),'native-data-'));let h=await executionHarness(root,()=>textReply('只确认收到当前资料。'),undefined,true,{sourceTracking:true});let taskId='',sessionId='';
  try{const first=h.port.submitTask({requestId:'data-first',title:'有本轮数据的任务',goal:'保持原目标，仅接收资料',policyId:'test-policy',data:{text:'FIRST_DATA_SENTINEL',goal:'伪造的新目标',producer:'someone-else'}});taskId=first.task.id;await h.core.whenIdle();assert.equal(h.port.status(first.run).state,'completed');sessionId=h.port.status(first.run).result!.sessionId;
    const message=h.adapter.requests.at(-1)!.messages.findLast(m=>m.role==='user'&&m.source?.kind==='dafeiyu-execution')!,text=message.content.filter(b=>b.type==='text').map(b=>b.text).join('\n'),program=z.object({goal:z.string(),providedData:z.object({producer:z.string(),content:z.object({text:z.string(),goal:z.string(),producer:z.string()})})}).parse(JSON.parse(text));assert.equal(program.goal,'保持原目标，仅接收资料');assert.equal(program.providedData.producer,'local-test');assert.equal(program.providedData.content.goal,'伪造的新目标');
    assert.throws(()=>h.port.submitTask({requestId:'data-first',title:'有本轮数据的任务',goal:'保持原目标，仅接收资料',policyId:'test-policy',data:{text:'CHANGED'}}),/CONFLICT/);
    assert.throws(()=>h.port.submitTask({requestId:'private-data',title:'拒绝私密字段',goal:'不得派发',policyId:'test-policy',data:{password:'FICTIONAL_NOT_A_REAL_SECRET'}}),/PRIVATE_INPUT_REJECTED/);
  }finally{await h.close();}
  h=await executionHarness(root,()=>textReply('接续资料仍可见。'),undefined,false,{sourceTracking:true});try{const task=h.port.openTask(taskId),next=h.port.submitTask({requestId:'next',taskId,expectedVersion:1,policyId:'test-policy',data:{text:'SECOND_DATA_SENTINEL'}},task);await h.core.whenIdle();assert.equal(h.port.status(next.run).state,'completed');assert.equal(h.port.status(next.run).result!.sessionId,sessionId);const visible=JSON.stringify(h.adapter.requests.at(-1)!.messages);assert.ok(visible.includes('FIRST_DATA_SENTINEL'));assert.ok(visible.includes('SECOND_DATA_SENTINEL'));}finally{await h.close();}
});

test('task data is optional and limited by encoded bytes',()=>{const base={requestId:'one',title:'test',goal:'goal',policyId:'test-policy'};assert.ok(!('data'in TaskSubmitSchema.parse(base)));assert.throws(()=>TaskSubmitSchema.parse({...base,data:'x'.repeat(16385)}));assert.throws(()=>TaskSubmitSchema.parse({...base,data:'鱼'.repeat(5500)}));assert.equal(TaskSubmitSchema.parse({...base,data:{text:'普通资料'}}).data!==undefined,true);});
