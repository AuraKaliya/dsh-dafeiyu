import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { qqCapabilityFixture } from './qq-capabilities-fixture.js';
import { call,textReply } from './harness.js';
const assessment=(next:'deliver'|'continue'|'wait',goalStatus='partial')=>textReply(JSON.stringify({goalStatus,summary:'当前只完成部分目标，评价与真实操作状态分别记录。',evidenceIds:[],limitations:['仍有资料缺口'],unfinished:['剩余部分'],next}));
function state(root:string){const db=new DatabaseSync(join(root,'core/runtime.sqlite'),{readOnly:true});try{const run=db.prepare("SELECT id,state,error FROM runs WHERE json_extract(definition,'$.scope.kind')='task' ORDER BY rowid DESC LIMIT 1").get()!;return {run,assessment:db.prepare("SELECT body FROM run_inputs WHERE run_id=? AND input_id='task-assessment'").get(run.id!),draft:db.prepare("SELECT body FROM run_inputs WHERE run_id=? AND input_id='draft-result:0'").get(run.id!),checkpoints:db.prepare('SELECT count(*) AS n FROM run_checkpoints WHERE run_id=?').get(run.id!)};}finally{db.close();}}

test('a normal task stop is followed by a separate persisted model assessment',async t=>{
  const h=await qqCapabilityFixture({tasks:true});t.after(h.close);let chat=0;
  h.adapter.assessmentResponse=()=>assessment('deliver');h.setResponse(request=>String(request.sessionId).startsWith('dafeiyu-task-')?textReply('只完成部分工作。'):++chat===1?call('qq_task_submit',{requestId:'assessment'}):textReply(''));
  await h.message('查一查这个问题',{trigger:true});const s=state(h.root);assert.equal(s.run.state,'completed');assert.ok(s.assessment);const body=JSON.parse(String(s.assessment.body));assert.equal(body.assessment.goalStatus,'partial');assert.equal(body.assessment.next,'deliver');assert.ok(s.draft);
});

test('missing assessment retains a waiting task and its draft instead of declaring the goal complete',async t=>{
  const h=await qqCapabilityFixture({tasks:true});t.after(h.close);let chat=0;h.adapter.assessmentResponse=()=>textReply('没有按契约提供评价');
  h.setResponse(request=>String(request.sessionId).startsWith('dafeiyu-task-')?textReply('已有工作保留。'):++chat===1?call('qq_task_submit',{requestId:'invalid-assessment'}):textReply(''));
  await h.message('检查这个情况',{trigger:true});const s=state(h.root);assert.equal(s.run.state,'waiting');assert.equal(s.run.error,'TASK_ASSESSMENT_INVALID');assert.equal(s.assessment,undefined);assert.ok(s.draft);
});

test('a model can continue exploration under the same task before submitting its final assessment',async t=>{
  const h=await qqCapabilityFixture({tasks:true});t.after(h.close);let chat=0,turns=0,reviews=0;
  h.adapter.assessmentResponse=()=>assessment(++reviews===1?'continue':'deliver');
  h.setResponse(request=>{if(String(request.sessionId).startsWith('dafeiyu-task-')){turns++;if(turns===2)assert.match(JSON.stringify(request.messages),/previousAssessment/);return textReply('阶段成果'+turns);}return ++chat===1?call('qq_task_submit',{requestId:'continue-assessment'}):textReply('');});
  await h.message('探索一个问题并评价结果',{trigger:true});assert.equal(turns,2);assert.equal(reviews,2);assert.equal(state(h.root).run.state,'completed');
});
