import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import {taskScopeKey} from '@dafeiyu/contracts';
import type {GenerateOptions} from '@deepseek-ai/dsh-llm';
import {executionHarness} from './execution-fixture.js';
import {call,textReply} from './harness.js';
import {testTempDir} from './test-temp.js';

const request={requestId:'first',title:'虚构阅读',goal:'阅读虚构资料并给出自己的回答',policyId:'test-policy'};
const root=()=>mkdtemp(join(testTempDir(),'current-agent-'));
const reflectionActions=['dafeiyu_memory_reflect','dafeiyu_memory_self_update','dafeiyu_memory_self_status','dafeiyu_memory_experience'];
function lastData(input:GenerateOptions){const result=input.messages.findLast(message=>message.role==='tool');assert.ok(result);return z.object({data:z.record(z.string(),z.json())}).parse(JSON.parse(result.content.filter(block=>block.type==='text').map(block=>block.text).join(''))).data;}

test('one DSH work loop observes, retains its own thought and returns the final answer without mandatory assessment',async t=>{
  let step=0;
  const h=await executionHarness(await root(),()=>++step===1?call('fixture_observe',{}):step===2?call('dafeiyu_memory_reflect',{requestId:'note',thought:'只读到一部分，解释方法很有意思，暂时不作整体结论。',uncertainty:'覆盖不完整',next:'需要时继续阅读'}):textReply('这是我根据已读部分形成的回答。'),
    {id:'fixture',version:'1',actions:[{id:'fixture_observe',version:'1',description:'读取虚构资料',effects:'read',inputSchema:z.strictObject({}),outputSchema:z.json(),execute:async()=>({status:'partial',effects:'none',completeness:'partial',data:{text:'虚构阅读片段'},sources:[],receipts:[]})}]},true,{extraActions:reflectionActions});t.after(h.close);
  const accepted=h.port.submitTask(request);await h.core.whenIdle();const status=h.port.status(accepted.run);
  assert.equal(status.state,'completed');assert.equal(await h.port.readResult(accepted.run),'这是我根据已读部分形成的回答。');
  assert.equal(h.adapter.requests.length,3);assert.ok(h.adapter.requests.every(row=>String(row.sessionId).startsWith('dafeiyu-task-')));
  const experience=h.memory.growth!.autobiography.read({kind:'task',agentId:'dafeiyu',taskId:accepted.task.id,scopeKey:taskScopeKey('dafeiyu',accepted.task.id)},status.id);
  assert.equal(experience.state,'completed');assert.equal(experience.thoughts[0]?.thought,'只读到一部分，解释方法很有意思，暂时不作整体结论。');assert.equal(experience.events.length,2);
});

test('the main Agent can wait explicitly without a separate outcome evaluator',async t=>{
  let step=0;const h=await executionHarness(await root(),()=>++step===1?call('dafeiyu_task_outcome',{next:'wait',reason:'需要用户补充具体范围'}):textReply('请补充具体范围。'));t.after(h.close);
  const accepted=h.port.submitTask(request);await h.core.whenIdle();assert.equal(h.port.status(accepted.run).state,'waiting');assert.equal(h.adapter.requests.length,2);
});

test('a retained reflection can update self-memory and is projected into a subsequent real DSH turn',async t=>{
  let step=0;const h=await executionHarness(await root(),input=>{
    if(String(input.sessionId).startsWith('memory-self-review-'))return textReply(JSON.stringify({selfOnly:true,faithful:true}));
    step++;
    if(step===1)return call('dafeiyu_memory_reflect',{requestId:'note',thought:'这次受托阅读让我发现自己偏好朴素解释。'});
    if(step===2)return call('dafeiyu_memory_self_update',{requestId:'self',expectedVersion:0,text:'我开始偏好朴素的解释。',applicability:'目前限于阅读说明材料',reflections:[lastData(input).id]});
    return textReply('已完成虚构阅读。');
  },undefined,true,{extraActions:reflectionActions});t.after(h.close);
  const first=h.port.submitTask(request);await h.core.whenIdle();assert.equal(h.port.status(first.run).state,'completed');
  assert.equal(h.memory.growth!.autobiography.status()[0]?.text,'我开始偏好朴素的解释。');
  const second=h.port.submitTask({...request,requestId:'second'});await h.core.whenIdle();assert.equal(h.port.status(second.run).state,'completed');
  const modelInput=JSON.stringify(h.adapter.requests.at(-1)?.messages);assert.ok(modelInput.includes('我开始偏好朴素的解释。'));assert.ok(!modelInput.includes('这次受托阅读让我发现'));
});
