import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {taskScopeKey} from '@dafeiyu/contracts';
import {buildTaskProgress,taskFailureNotice} from '../packages/core/lib/task-progress.js';
import type {TaskProgressInput} from '../packages/core/lib/task-progress.js';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {z} from 'zod';
import type {TaskProgress} from '@dafeiyu/contracts';
const require=createRequire(import.meta.url);
const React:{createElement(component:unknown,props:unknown):unknown}=require('react');
const {renderToStaticMarkup}:{renderToStaticMarkup(element:unknown):string}=require('react-dom/server');

function fixture():TaskProgressInput {
  const taskId=randomUUID(),runId=randomUUID();
  return {task:{id:taskId,agentId:'fixture',version:1,epoch:1,status:'active',title:'检查',goal:'核对指定范围'},
    run:{id:runId,requestKey:randomUUID(),definition:{taskId,scope:{kind:'task',agentId:'fixture',taskId,scopeKey:taskScopeKey('fixture',taskId)},origin:{kind:'native',producerId:'fixture',requestId:'r'},intentVersion:1,policyId:'fixture',parentRunId:null},
      state:'completed',version:3,snapshot:null,result:null,error:null,createdAt:'2026-11-08T00:00:00.000Z',updatedAt:'2026-11-08T00:01:00.000Z'},
    review:null,disposition:null,phase:{phase:'verification'},checkpoints:1,operations:[],delivery:{deliveryId:randomUUID(),runId,taskId,state:'sent',version:8,receiptId:'123',error:null,
      recovery:{available:false,phase:null,reason:'DELIVERY_RECOVERY_STATE',pendingRequestId:null,lastError:null,draftCount:1}}};
}

test('execution ending and confirmed delivery do not manufacture a goal assessment',()=>{
  const view=buildTaskProgress(fixture());
  assert.equal(view.execution.state,'completed');assert.equal(view.execution.phase,null);assert.equal(view.delivery.state,'sent');
  assert.deepEqual(view.goal,{status:'uncertain',source:'none',reviewStatus:null,programVerified:false});assert.match(view.labels.execution,/执行已结束/);
  assert.match(view.labels.goal,/尚不能确认/);assert.equal(taskFailureNotice(view),null);
});
test('explicit goal assessment and review remain distinct from program evidence and current intent',()=>{
  const input=fixture();input.disposition={next:'complete',reason:'已达成',goalStatus:'met',requiredCapabilities:[]};
  assert.deepEqual(buildTaskProgress(input).goal,{status:'met',source:'agent',reviewStatus:null,programVerified:false});
  input.disposition=null;input.review={review:{goalStatus:'partial',summary:'仅完成部分',evidenceIds:[],limitations:['缺少材料'],unfinished:['待补读'],next:'continue',requiredCapabilities:[]}};
  assert.equal(buildTaskProgress(input).goal.status,'uncertain');assert.equal(buildTaskProgress(input).goal.reviewStatus,'partial');assert.equal(buildTaskProgress(input).delivery.state,'sent');
  input.disposition={next:'complete',reason:'只完成部分',goalStatus:'partial',requiredCapabilities:[]};assert.equal(buildTaskProgress(input).goal.status,'partial');
  input.task.epoch=2;assert.equal(buildTaskProgress(input).goal.status,'uncertain');assert.equal(buildTaskProgress(input).currentIntent,false);
});
test('configuration receipt proves saved revision, not background execution; directory listing is not an inspection',()=>{
  const input=fixture(),id=randomUUID();
  input.operations=[{id:randomUUID(),action:'dafeiyu_activity_update',state:'finished',outcome:{status:'succeeded',effects:'confirmed',completeness:'complete',sources:[],receipts:[],data:{id,version:2,purpose:'group-watch',state:'active',trigger:{kind:'interval',anchorAt:'2026-11-08T00:00:00.000Z',intervalMs:120000},timeZone:'Asia/Shanghai',quiet:[],recordedAt:'2026-11-08T00:00:00.000Z'}}},
    {id:randomUUID(),action:'dsh_tool_list',state:'finished',outcome:{status:'succeeded',effects:'none',completeness:'complete',data:{tools:['read']},sources:[],receipts:[]}}];
  const view=buildTaskProgress(input);assert.deepEqual(view.facts.plans,[{id,version:2,intervalMs:120000,configurationOnly:true}]);
  assert.equal(view.facts.inspection.catalogCalls,1);assert.equal(view.facts.inspection.dispatchCalls,0);assert.equal(view.facts.inspection.resultReads,0);
});
test('unknown receipts dominate claimed delivery and status identity changes only with material state',()=>{
  const input=fixture(),first=buildTaskProgress(input);
  assert.equal(buildTaskProgress(input).version,first.version);
  input.counts={total:2,confirmed:1,pending:0,sending:0,unknown:1,receiptIds:['1']};
  const unknown=buildTaskProgress(input);assert.equal(unknown.delivery.state,'uncertain');assert.equal(unknown.next.action,'verify-delivery');assert.notEqual(unknown.version,first.version);
  assert.match(taskFailureNotice(unknown)??'',/不能自动重发/);
  input.task.status='paused';assert.equal(taskFailureNotice(buildTaskProgress(input)),null);
});

test('management renders the shared three-axis projection without inventing completion',async()=>{
  const imported:unknown=await import(pathToFileURL(resolve('packages/core/client/management.js')).href);
  const module=z.object({TaskProgressSummary:z.custom<(props:{progress:TaskProgress})=>unknown>(value=>typeof value==='function')}).parse(imported);
  const view=buildTaskProgress(fixture()),html=renderToStaticMarkup(React.createElement(module.TaskProgressSummary,{progress:view}));
  assert.match(html,/目标达成情况尚不能确认/);assert.match(html,/执行已结束/);assert.match(html,/结果已确认送达/);assert.doesNotMatch(html,/目标已达成/);
});

test('a denied DSH call is not counted as dispatch and a nonzero exit is not successful inspection evidence',()=>{
  const input=fixture(),id=randomUUID();input.operations=[{id,action:'dsh_tool_call',state:'finished',outcome:{status:'failed',effects:'none',completeness:'unknown',data:{dispatched:false},sources:[],receipts:[]}}];
  let view=buildTaskProgress(input);assert.equal(view.facts.inspection.dispatchCalls,0);assert.equal(view.facts.inspection.failedCalls,1);
  input.operations=[{id,action:'dsh_tool_call',state:'finished',outcome:{status:'succeeded',effects:'confirmed',completeness:'complete',data:{page:{view:{coverage:{complete:true},entries:[{key:'exitCode',value:1}]}}},sources:[],receipts:[{kind:'dsh-operation',id}]}}];
  view=buildTaskProgress(input);assert.equal(view.facts.inspection.dispatchCalls,1);assert.equal(view.facts.inspection.failedCommands,1);assert.equal(view.goal.status,'uncertain');
});

test('a newer run or unresolved condition suppresses stale failure notices and restart suggestions',()=>{
  const input=fixture();input.run.state='failed';input.run.error='MODEL_HTTP_500';input.delivery=null;
  const first=buildTaskProgress(input);assert.equal(first.next.action,'resume-task');assert.ok(taskFailureNotice(first));
  input.latestRunId=randomUUID();let current=buildTaskProgress(input);assert.equal(current.currentRun,false);assert.equal(current.next.action,'none');assert.equal(taskFailureNotice(current),null);assert.notEqual(current.version,first.version);
  delete input.latestRunId;input.intentState='blocked';current=buildTaskProgress(input);assert.equal(current.next.action,'review-source');assert.equal(current.blocked.code,'TASK_OBJECTION_UNRESOLVED');
});
