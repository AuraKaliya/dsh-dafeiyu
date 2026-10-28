import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {executionHarness} from './execution-fixture.js';
import {call,textReply} from './harness.js';
import {testTempDir} from './test-temp.js';

const request={requestId:'review',title:'虚构任务',goal:'检查虚构材料并自行判断是否完成',policyId:'test-policy'};
const answer={goalStatus:'uncertain',summary:'现有资料有限，这只是建议。',evidenceIds:[],limitations:['仅有草案'],unfinished:[],next:'wait'};
for(const variant of ['valid','fenced','ambiguous','invalid'] as const)test('optional DSH review '+variant+' cannot decide task state or write personality',async t=>{
  let work=0,reviews=0;const root=await mkdtemp(join(testTempDir(),'task-review-'));
  const h=await executionHarness(root,input=>{
    if(String(input.sessionId).startsWith('dafeiyu-review-')){
      reviews++;assert.equal(input.tools?.length??0,0);assert.match(JSON.stringify(input.messages),/可选工作复核/);
      const json=JSON.stringify(answer);return textReply(variant==='valid'?json:variant==='fenced'?'```json\n'+json+'\n```':variant==='ambiguous'?'```json\n'+json+'\n```\n```json\n'+json+'\n```':'invalid');
    }
    return ++work===1?call('dafeiyu_task_review',{proposal:'这是我的草案，还需要判断依据是否充分。'}):textReply('主Agent自行形成的最终回答。');
  });t.after(h.close);
  const accepted=h.port.submitTask(request);await h.core.whenIdle();assert.equal(h.port.status(accepted.run).state,'completed');
  assert.equal(await h.port.readResult(accepted.run),'主Agent自行形成的最终回答。');assert.equal(work,2);assert.equal(reviews,1);
  assert.deepEqual(h.memory.growth!.autobiography.status(),[]);
  const db=new DatabaseSync(join(root,'core/runtime.sqlite'),{readOnly:true});try{
    const outcome=JSON.parse(String(db.prepare("SELECT outcome FROM run_operations WHERE action='dafeiyu_task_review'").get()?.outcome));
    assert.equal(outcome.status,variant==='valid'||variant==='fenced'?'succeeded':'unknown');assert.equal(outcome.effects,'none');
  }finally{db.close();}
});

test('a main Agent can revise its disposition before finishing the same run',async t=>{
  let step=0;const h=await executionHarness(await mkdtemp(join(testTempDir(),'task-disposition-')),()=>++step===1?call('dafeiyu_task_outcome',{next:'wait',reason:'最初认为缺少资料'}):step===2?call('dafeiyu_task_outcome',{next:'complete',reason:'复核后已有足够资料'}):textReply('已完成。'));t.after(h.close);
  const accepted=h.port.submitTask(request);await h.core.whenIdle();assert.equal(h.port.status(accepted.run).state,'completed');assert.equal(await h.port.readResult(accepted.run),'已完成。');
});
