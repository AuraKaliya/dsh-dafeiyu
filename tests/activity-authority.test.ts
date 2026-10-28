import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { ExecutionContext,ActivityAnchor,PersonaSourceRef } from '@dafeiyu/contracts';
import { ActivityStore } from '../packages/activity/lib/store.js';
import * as Activity from '@dafeiyu/activity';
import { executionHarness } from './execution-fixture.js';
import { testTempDir } from './test-temp.js';
import { call,textReply } from './harness.js';
import { RunScheduler } from '../packages/core/lib/run-scheduler.js';

type H=Awaited<ReturnType<typeof executionHarness>>;
const root=()=>mkdtemp(join(testTempDir(),'activity-authority-'));
const request={requestId:'first',title:'虚构规划',goal:'为自己安排一次虚构探索',policyId:'test-policy'};
function extension(fn:(context:ExecutionContext)=>unknown,effects:'read'|'local-write'='local-write') {return {id:'fixture',version:'1',actions:[{id:'fixture_anchor',version:'1',description:'trusted fixture anchor',inputSchema:z.strictObject({}),outputSchema:z.json(),effects,
  execute:async(_i:unknown,c:ExecutionContext)=>({status:'succeeded' as const,effects:effects==='read'?'none' as const:'confirmed' as const,completeness:'complete' as const,data:z.json().parse(await fn(c)),sources:[],receipts:[]})}]};}

test('core anchor needs a real write grant, is pending during its Run and valid only after a confirmed completion',async()=>{
  const directory=await root();let h:H,step=0,anchor:ActivityAnchor|undefined;
  h=await executionHarness(directory,()=>++step===1?call('fixture_anchor',{}):textReply('安排完成'),extension(c=>{
    assert.throws(()=>h.core.captureActivityAnchor({...c},'fixture'),/SCOPE_DENIED/);
    anchor=h.core.captureActivityAnchor(c,'fixture');assert.equal(h.core.activityAnchorStatus(anchor).state,'pending');return {id:anchor.id};
  }),true,{});
  try{const accepted=h.port.submitTask(request);await h.core.whenIdle();assert.equal(h.port.status(accepted.run).state,'completed');assert.ok(anchor);
    assert.equal(h.core.activityAnchorStatus(anchor).state,'valid');assert.equal(h.core.activityAnchorStatus({...anchor,operationId:randomUUID()}).state,'stale');
    h.port.updateTask(accepted.task,{requestId:'revoke',expectedVersion:1,status:'paused'});assert.equal(h.core.activityAnchorStatus(anchor).state,'stale');
  }finally{await h.close();}
});

test('read-only capabilities cannot mint future execution authority',async()=>{
  const directory=await root();let h:H,n=0,denied=false;h=await executionHarness(directory,()=>++n===1?call('fixture_anchor',{}):textReply('已拒绝'),extension(c=>{assert.throws(()=>h.core.captureActivityAnchor(c,'fixture'),/SCOPE_DENIED/);denied=true;return null;},'read'),true,{});
  try{h.port.submitTask(request);await h.core.whenIdle();assert.equal(denied,true);}finally{await h.close();}
});

test('captured source dependencies remain checked after restart and deletion cannot revive the anchor',async()=>{
  const directory=await root();let h:H,step=0,anchor:ActivityAnchor|undefined,source:PersonaSourceRef|undefined;
  const spec=extension(c=>{if(step===1)return source=h.memory.growth!.recordObservation(c,{requestId:'source',text:'虚构来源，决定暂时探索蓝灯',kind:'primary',resource:'fixture:light',occurredAt:'2026-10-25T00:00:00Z',coverage:['test'],completeness:'partial'},'fixture');
    anchor=h.core.captureActivityAnchor(c,'fixture');return {id:anchor.id};});
  h=await executionHarness(directory,()=>++step<=2?call('fixture_anchor',{}):textReply('规划结束'),spec,true,{});
  h.port.submitTask(request);await h.core.whenIdle();assert.ok(anchor);assert.ok(source);assert.equal(h.core.activityAnchorStatus(anchor).state,'valid');await h.close();
  h=await executionHarness(directory,()=>textReply('不会自行运行'),spec,false,{});try{
    assert.equal(h.core.activityAnchorStatus(anchor).state,'valid');const db=new DatabaseSync(join(directory,'memory/memory.sqlite'));try{db.prepare('UPDATE execution_sources SET deleted=1,state_version=2 WHERE id=?').run(source.id);}finally{db.close();}
    assert.equal(h.core.activityAnchorStatus(anchor).state,'stale');const restored=new DatabaseSync(join(directory,'memory/memory.sqlite'));try{restored.prepare('UPDATE execution_sources SET deleted=0,state_version=3 WHERE id=?').run(source.id);}finally{restored.close();}
    assert.equal(h.core.activityAnchorStatus(anchor).state,'stale');assert.equal(h.adapter.requests.length,0);
  }finally{await h.close();}
});

test('task creation is idempotent and does not start a model until a Run is explicitly submitted',async()=>{
  const h=await executionHarness(await root());try{const task=h.port.createTask({requestId:'deferred',title:'计划中的任务',goal:'未来才探索'});assert.equal(h.adapter.requests.length,0);
    assert.equal(h.port.createTask({requestId:'deferred',title:'计划中的任务',goal:'未来才探索'}).id,task.id);
    assert.throws(()=>h.port.createTask({requestId:'deferred',title:'计划中的任务',goal:'不同目标'}));assert.equal(h.port.taskState(task).status,'active');
    const run=h.port.submitTask({requestId:'start',taskId:task.id,expectedVersion:1,policyId:'test-policy'},task);await h.core.whenIdle();assert.equal(h.port.status(run.run).state,'completed');assert.equal(h.adapter.requests.filter(r=>String(r.sessionId).startsWith('dafeiyu-task-')).length,1);assert.equal(h.adapter.requests.filter(r=>String(r.sessionId).startsWith('dafeiyu-assessment-')).length,1);
  }finally{await h.close();}
});

test('activity plan tools bind actual Task ownership, support rest and reject unrelated Task access',async()=>{
  const directory=await root(),dataDir=join(directory,'activity');new ActivityStore(join(dataDir,'activity.sqlite'),{agentId:'dafeiyu',profileId:'test'},{},true).close();
  let step=0,planId='',second=false,h:H;
  h=await executionHarness(directory,()=>{
    step++;if(second)return step===1?call('dafeiyu_activity_status',{id:planId}):textReply('访问范围受限');
    if(step===1)return call('dafeiyu_activity_plan',{requestId:'plan',goal:'想探索虚构灯光的变化',trigger:{kind:'once',at:'2026-12-01T00:00:00Z'}});
    if(step===2){const plans=h.ctx.dafeiyuActivity.store.counts();assert.equal(plans.plans,1);const db=new DatabaseSync(join(dataDir,'activity.sqlite'),{readOnly:true});try{planId=String(db.prepare('SELECT id FROM activity_schedules').get()?.id);}finally{db.close();}return call('dafeiyu_activity_update',{id:planId,requestId:'rest',expectedVersion:1,state:'paused'});}
    if(step===3)return call('dafeiyu_activity_status',{});return textReply('计划好后先休息');
  },undefined,true,{extraActions:[...Activity.ACTIVITY_ACTIONS],extraProducers:['activity'],beforeActivate:async ctx=>{
    await ctx.plugin(Activity,{agentId:'dafeiyu',profileId:'test',dataDir,settings:{explorationPolicy:'test-policy'}});ctx.dafeiyuActivity.recover();ctx.dafeiyuActivity.activate();
  }});
  try{const first=h.port.submitTask(request);await h.core.whenIdle();assert.equal(h.port.status(first.run).operations.length,3);assert.ok(h.port.status(first.run).operations.every(op=>op.status==='succeeded'));
    assert.equal(h.ctx.dafeiyuActivity.store.get(planId).status,'paused');assert.equal(h.ctx.dafeiyuActivity.store.task(planId),null);
    const body=h.ctx.dafeiyuActivity.store.get(planId).body;assert.equal(h.core.activityAnchorStatus(body.anchor).state,'valid');
    second=true;step=0;const other=h.port.submitTask({...request,requestId:'other'});await h.core.whenIdle();assert.equal(h.port.status(other.run).operations[0]?.status,'failed');
  }finally{await h.close();}
});

test('foreground pressure is observable and a waiting explicit task acquires the next slot first',async()=>{
  const scheduler=new RunScheduler(1),first=await scheduler.acquire(false),order:string[]=[];
  const background=scheduler.acquire(false).then(release=>{order.push('background');release();});
  const foreground=scheduler.acquire(true).then(release=>{order.push('foreground');release();});
  assert.equal(scheduler.status.foregroundWaiting,1);first();await Promise.all([background,foreground]);assert.deepEqual(order,['foreground','background']);
});

test('a changed authority policy invalidates a previously persisted planning anchor',async()=>{
  const directory=await root();let h:H,n=0,anchor:ActivityAnchor|undefined;
  const spec=extension(c=>{anchor=h.core.captureActivityAnchor(c,'fixture');return {id:anchor.id};});
  h=await executionHarness(directory,()=>++n===1?call('fixture_anchor',{}):textReply('已规划'),spec,true,{});h.port.submitTask(request);await h.core.whenIdle();assert.ok(anchor);await h.close();
  h=await executionHarness(directory,()=>textReply('不会运行'),spec,false,{extraActions:['dafeiyu_task_intent']});
  try{assert.deepEqual(h.core.activityAnchorStatus(anchor),{state:'stale',code:'ACTIVITY_POLICY_CHANGED'});assert.equal(h.adapter.requests.length,0);}finally{await h.close();}
});

test('a paused wake cannot bypass a revoked plan by resuming as a continuation',async()=>{
  const directory=await root();let entered!:()=>void,finish!:()=>void;const started=new Promise<void>(r=>{entered=r;}),hold=new Promise<void>(r=>{finish=r;});
  const h=await executionHarness(directory,()=>call('fixture_anchor',{}),extension(async()=>{entered();await hold;return {saved:true};}));
  let allowed=true;h.core.bindWakeAuthority({producerId:'wake-test',validate:()=>allowed});
  try{const port=h.core.executionProducer('wake-test'),task=port.createTask({requestId:'task',title:'自主任务',goal:'保留进度'});
    const accepted=port.acceptWake({requestId:'occurrence',taskId:task.id,expectedVersion:1,policyId:'test-policy',origin:{kind:'wake',producerId:'wake-test',scheduleId:'fixture',scheduleVersion:1,occurrenceId:'occurrence',dueAt:'2026-10-25T00:00:00Z'}},task);
    await started;port.pause(accepted.run,{requestId:'pause',expectedVersion:port.status(accepted.run).version,reason:'让出资源'});finish();await h.core.whenIdle();
    const status=port.status(accepted.run);assert.equal(status.state,'waiting');allowed=false;
    assert.throws(()=>port.resume(task,{requestId:'resume',taskId:task.id,expectedVersion:1,policyId:'test-policy',parentRunId:accepted.run.id,checkpointId:status.checkpoints.at(-1)}),/WAKE_NOT_AUTHORIZED/);
    assert.equal(h.adapter.requests.length,1);
  }finally{finish();await h.close();}
});

test('model-supplied identity or unexposed interest references cannot create a plan',async()=>{
  const directory=await root(),dataDir=join(directory,'activity');new ActivityStore(join(dataDir,'activity.sqlite'),{agentId:'dafeiyu',profileId:'test'},{},true).close();
  let n=0;const valid={requestId:'forged',goal:'虚构探索',trigger:{kind:'once',at:'2026-12-01T00:00:00Z'}};
  const h=await executionHarness(directory,()=>++n===1?call('dafeiyu_activity_plan',{...valid,agentId:'another'}):n===2?call('dafeiyu_activity_plan',{...valid,basis:[{kind:'execution-source',id:randomUUID(),agentId:'dafeiyu',scopeKey:'made-up',version:1,contentHash:'a'.repeat(64)}]}):textReply('未创建'),undefined,true,
    {extraActions:[...Activity.ACTIVITY_ACTIONS],extraProducers:['activity'],beforeActivate:async ctx=>{await ctx.plugin(Activity,{agentId:'dafeiyu',profileId:'test',dataDir});ctx.dafeiyuActivity.recover();ctx.dafeiyuActivity.activate();}});
  try{const accepted=h.port.submitTask(request);await h.core.whenIdle();assert.equal(h.ctx.dafeiyuActivity.store.counts().plans,0);assert.ok(h.port.status(accepted.run).operations.every(op=>op.status==='failed'));}
  finally{await h.close();}
});
