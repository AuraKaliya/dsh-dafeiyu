import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { Context } from '@deepseek-ai/cordis';
import type { ExecutionContext,ActivityConfigSchema,Extension,PersonaSourceRef } from '@dafeiyu/contracts';
import { ActivityService,ACTIVITY_ACTIONS } from '@dafeiyu/activity';
import { ActivityStore } from '../packages/activity/lib/store.js';
import { executionHarness } from './execution-fixture.js';
import { call,textReply } from './harness.js';
import type { Response } from './harness.js';
import { testTempDir } from './test-temp.js';

type H=Awaited<ReturnType<typeof executionHarness>>;
const memoryActions=['dafeiyu_memory_maintenance_status','dafeiyu_memory_consolidate','dafeiyu_memory_maintenance_result','dafeiyu_execution_select'];
const request={requestId:'plan',title:'虚构探索安排',goal:'决定一次自主探索',policyId:'test-policy'};
async function fixture(response:Response,options:{settings?:z.input<typeof ActivityConfigSchema>;extension?:Omit<Extension,'protocolVersion'|'agentId'>;directory?:string;now?:number;maxConcurrentRuns?:number;turnTimeoutMs?:number;context?:NonNullable<Parameters<typeof executionHarness>[4]>['context']}={}){
  const directory=options.directory??await mkdtemp(join(testTempDir(),'activity-scheduler-')),dataDir=join(directory,'activity'),settings={explorationPolicy:'test-policy',maintenancePolicy:'test-policy',...options.settings};
  if(!options.directory)new ActivityStore(join(dataDir,'activity.sqlite'),{agentId:'dafeiyu',profileId:'test'},settings,true).close();let now=options.now??Date.now(),monotonic=0,activity!:ActivityService;
  const configure=async(ctx:Context)=>{activity=new ActivityService(ctx,{agentId:'dafeiyu',profileId:'test',dataDir,settings},()=>now,()=>monotonic);
    if(settings.maintenance)activity.bindMaintenance(ctx.dafeiyuMemory.maintenance!.schedulingPort());activity.recover();activity.activate();};
  const h=await executionHarness(directory,response,options.extension,!options.directory,{...(settings.maintenance?{maintenance:{}}:{}),...(options.turnTimeoutMs?{turnTimeoutMs:options.turnTimeoutMs}:{}),...(options.context?{context:options.context}:{}),...(options.maxConcurrentRuns?{maxConcurrentRuns:options.maxConcurrentRuns}:{}),extraActions:[...ACTIVITY_ACTIONS,...memoryActions],extraProducers:['activity'],beforeActivate:configure});
  return {h,activity,directory,now:()=>now,advance:(ms:number)=>{now+=ms;monotonic+=Math.max(0,ms);},start:()=>activity.start(false),tick:()=>activity.tick(),close:h.close};
}
function read(directory:string,sql:string,which='activity'){const file=which==='activity'?'activity/activity.sqlite':which==='memory'?'memory/memory.sqlite':'core/runtime.sqlite';const db=new DatabaseSync(join(directory,file),{readOnly:true});try{return db.prepare(sql).all();}finally{db.close();}}
const planInput=(at:number)=>({requestId:'explore',goal:'观察虚构星空，也可以调整计划或休息',trigger:{kind:'once',at:new Date(at).toISOString()}});

test('a due plan runs through real DSH without QQ, and may pause its future schedule while finishing its current Run',async()=>{
  let f:Awaited<ReturnType<typeof fixture>>,phase='plan',step=0,id='';f=await fixture(options=>{
    step++;if(phase==='plan')return step===1?call('dafeiyu_activity_plan',planInput(f.now()+60000)):textReply('计划已保存');
    assert.match(JSON.stringify(options.messages),/activity-occurrence/);return step===1?call('dafeiyu_activity_update',{id,requestId:'rest',expectedVersion:1,state:'paused'}):textReply('我决定先休息，下次再探索');
  });
  try{f.h.port.submitTask(request);await f.h.core.whenIdle();id=String(read(f.directory,'SELECT id FROM activity_schedules')[0]!.id);assert.equal(f.h.adapter.requests.filter(r=>String(r.sessionId).startsWith('dafeiyu-task-')).length,2);assert.equal(f.h.adapter.requests.filter(r=>String(r.sessionId).startsWith('dafeiyu-assessment-')).length,1);
    f.start();await f.tick();assert.equal(read(f.directory,'SELECT * FROM activity_occurrences').length,0);phase='explore';step=0;f.advance(60000);await f.tick();await f.h.core.whenIdle();
    const occurrence=read(f.directory,'SELECT state FROM activity_occurrences')[0];assert.equal(occurrence?.state,'completed');assert.equal(f.activity.store.get(id).status,'paused');assert.equal(f.h.core.journal.list().length,0);
    const count=f.h.adapter.requests.length;f.advance(3600000);await f.tick();await f.h.core.whenIdle();assert.equal(f.h.adapter.requests.length,count);assert.equal(f.activity.health.error,null);
  }finally{await f.close();}
});

test('a lost acknowledgement cannot reject an accepted Run and restart never replays it',async()=>{
  let f:Awaited<ReturnType<typeof fixture>>,n=0,planning=true;const response:Response=()=>planning&&++n===1?call('dafeiyu_activity_plan',planInput(f.now()+60000)):textReply('虚构结果');
  f=await fixture(response);f.h.port.submitTask(request);await f.h.core.whenIdle();planning=false;f.start();f.advance(60000);
  const acknowledge=f.activity.store.acknowledge.bind(f.activity.store);f.activity.store.acknowledge=()=>{throw new Error('SIMULATED_ACK_LOSS');};
  await f.tick();await f.h.core.whenIdle();f.activity.store.acknowledge=acknowledge;assert.equal(read(f.directory,'SELECT state FROM activity_occurrences')[0]?.state,'completed');
  const directory=f.directory,now=f.now();await f.close();f=await fixture(()=>textReply('不应重跑'),{directory,now});
  try{f.start();await f.tick();await f.h.core.whenIdle();assert.equal(f.h.adapter.requests.length,0);assert.equal(read(f.directory,'SELECT * FROM activity_occurrences').length,1);}
  finally{await f.close();}
});

test('task completion with selected evidence is scheduled for maintenance while redundant selection requests coalesce',async()=>{
  let f:Awaited<ReturnType<typeof fixture>>,step=0,maintenance=false,maintenanceId='',source:PersonaSourceRef|undefined;const text='虚构气球在观察窗口内向东移动';
  const extension={id:'fixture',version:'1',actions:[{id:'fixture_observe',version:'1',description:'fictional observation',inputSchema:z.strictObject({}),outputSchema:z.json(),effects:'local-write' as const,
    execute:async(_i:unknown,c:ExecutionContext)=>{source=f.h.memory.growth!.recordObservation(c,{requestId:'source',text,kind:'primary',resource:'fixture:balloon',occurredAt:new Date().toISOString(),coverage:['fictional-window'],completeness:'partial'},'fixture');return {status:'succeeded' as const,effects:'confirmed' as const,completeness:'partial' as const,data:z.json().parse(source),sources:[],receipts:[]};}}]};
  f=await fixture(options=>{
    if(JSON.stringify(options).includes('独立经历分析器'))return textReply(JSON.stringify({schemaVersion:1,summary:'一次有界观察',gaps:['未知未来'],experiences:[{content:{observation:'气球向东',action:'虚构观察',outcome:'窗口内向东',interpretation:'不能推断永久方向',conditions:['本次窗口'],unknowns:['未来方向']},supports:[{sourceId:'S1',quote:text}],counters:[],target:null}],relations:[],persona:[]}));
    step++;if(!maintenance)return step===1?call('fixture_observe',{}):step===2?call('dafeiyu_execution_select',{requestId:'select',expectedVersion:0,entries:[source],reason:'选择观察'}):textReply('观察结束');
    const id=maintenanceId||=String(read(f.directory,"SELECT id FROM maintenance_requests WHERE state='waiting-scheduler' ORDER BY rowid DESC LIMIT 1",'memory')[0]?.id);
    const program=options.messages.flatMap(message=>message.role==='user'?message.content.filter(block=>block.type==='text').map(block=>{try{return JSON.parse(block.text);}catch{return null;}}):[]).find(value=>value?.work?.kind==='memory-maintenance');
    assert.ok(program);assert.equal(program.work.requestId,id);assert.notEqual(program.goal,request.goal);assert.equal(program.work.backgroundTaskGoal,request.goal);
    assert.deepEqual(program.work.toolArguments.dafeiyu_memory_consolidate,{id});
    if(step===2)assert.match(JSON.stringify(options.messages),/MAINTENANCE_REQUEST_ID_REQUIRED/);
    return step===1?call('dafeiyu_memory_maintenance_status',{id:program.work.taskId}):step===2?call('dafeiyu_memory_maintenance_status',{id}):step===3?call('dafeiyu_memory_consolidate',{id}):textReply('整理完成');
  // Includes an independent analysis turn and durable source sealing. This checks state,
  // not a 10-second latency guarantee while other regression workers contend for IO.
  },{extension,settings:{maintenance:true},turnTimeoutMs:30000});
  try{f.h.port.submitTask(request);await f.h.core.whenIdle();assert.equal(read(f.directory,'SELECT * FROM maintenance_requests','memory').length,2);f.start();await f.tick();
    assert.equal(read(f.directory,"SELECT count(*) AS n FROM maintenance_requests WHERE error='COALESCED_REQUEST'",'memory')[0]?.n,1);assert.equal(read(f.directory,'SELECT * FROM activity_schedules').length,1);
    maintenance=true;step=0;f.advance(60000);await f.tick();await f.h.core.whenIdle();assert.equal(f.activity.health.error,null);
    assert.equal(read(f.directory,'SELECT state FROM activity_occurrences')[0]?.state,'completed');
    assert.equal(read(f.directory,'SELECT * FROM experience_items','memory').length,1);assert.equal(read(f.directory,"SELECT state FROM maintenance_requests WHERE error IS NULL",'memory')[0]?.state,'completed');
    const count=f.h.adapter.requests.length;f.advance(3600000);await f.tick();await f.h.core.whenIdle();assert.equal(f.h.adapter.requests.length,count);
  }finally{await f.close();}
});

test('metadata-only task events settle without an auxiliary model or another Core Run',async()=>{
  const f=await fixture(()=>textReply('没有选择可保存内容'),{settings:{maintenance:true}});
  try{f.h.port.submitTask(request);await f.h.core.whenIdle();f.start();await f.tick();assert.equal(f.h.adapter.requests.filter(r=>String(r.sessionId).startsWith('dafeiyu-task-')).length,1);assert.equal(f.h.adapter.requests.filter(r=>String(r.sessionId).startsWith('dafeiyu-assessment-')).length,1);assert.equal(read(f.directory,'SELECT * FROM activity_schedules').length,0);
    assert.equal(read(f.directory,'SELECT state FROM maintenance_requests','memory')[0]?.state,'completed');assert.equal(read(f.directory,'SELECT * FROM experience_items','memory').length,0);}
  finally{await f.close();}
});

test('foreground work pauses an activity and resumes its verified checkpoint without repeating the confirmed action',async()=>{
  let f:Awaited<ReturnType<typeof fixture>>,mode='planning',step=0,operations=0,entered!:()=>void,finish!:()=>void;
  const started=new Promise<void>(r=>{entered=r;}),hold=new Promise<void>(r=>{finish=r;});
  const extension={id:'fixture',version:'1',actions:[{id:'fixture_progress',version:'1',description:'cooperative progress fixture',inputSchema:z.strictObject({}),outputSchema:z.json(),effects:'local-write' as const,
    execute:async()=>{operations++;entered();await hold;return {status:'succeeded' as const,effects:'confirmed' as const,completeness:'complete' as const,data:{saved:true},sources:[],receipts:[]};}}]};
  f=await fixture(options=>{
    if(JSON.stringify(options.messages).includes('EXPLICIT_PRIORITY_SENTINEL'))return textReply('明确任务已处理');
    step++;if(mode==='planning')return step===1?call('dafeiyu_activity_plan',planInput(f.now()+60000)):textReply('安排完成');
    if(mode==='resume'){assert.match(JSON.stringify(options.messages),/parentRunId/);return textReply('沿检查点继续，已经完成的操作不重做');}
    return call('fixture_progress',{});
  },{extension,maxConcurrentRuns:1});
  try{f.h.port.submitTask(request);await f.h.core.whenIdle();mode='activity';step=0;f.start();f.advance(60000);await f.tick();await started;
    const foreground=f.h.port.submitTask({...request,requestId:'foreground',goal:'EXPLICIT_PRIORITY_SENTINEL 立即处理明确任务'});
    await new Promise<void>(r=>setImmediate(r));await f.tick();finish();await f.h.core.whenIdle();
    assert.equal(f.h.port.status(foreground.run).state,'completed');assert.equal(read(f.directory,'SELECT state FROM activity_occurrences')[0]?.state,'waiting');
    mode='resume';step=0;f.advance(60000);await f.tick();await f.h.core.whenIdle();assert.equal(f.activity.health.error,null);
    assert.equal(read(f.directory,'SELECT state FROM activity_occurrences')[0]?.state,'completed');assert.equal(operations,1);
    assert.equal(read(f.directory,"SELECT count(DISTINCT json_extract(body,'$.runId')) AS n FROM activity_run_events")[0]?.n,2);
  }finally{finish();await f.close();}
});

test('unknown local effects block the plan and are never retried as a fresh wake',async()=>{
  let f:Awaited<ReturnType<typeof fixture>>,planning=true,step=0,calls=0;
  const extension={id:'fixture',version:'1',actions:[{id:'fixture_uncertain',version:'1',description:'unknown effect fixture',inputSchema:z.strictObject({}),outputSchema:z.json(),effects:'local-write' as const,
    execute:async()=>{calls++;throw new Error('FICTIONAL_UNKNOWN_EFFECT');}}]};
  f=await fixture(()=>++step===1?planning?call('dafeiyu_activity_plan',{...planInput(f.now()+60000),trigger:{kind:'interval',anchorAt:new Date(f.now()+60000).toISOString(),intervalMs:60000}}):call('fixture_uncertain',{}):textReply('无法确认操作结果'),{extension});
  try{f.h.port.submitTask(request);await f.h.core.whenIdle();planning=false;step=0;f.start();f.advance(60000);await f.tick();await f.h.core.whenIdle();
    assert.equal(read(f.directory,'SELECT state FROM activity_occurrences')[0]?.state,'blocked');const count=f.h.adapter.requests.length;
    f.advance(3600000);await f.tick();await f.h.core.whenIdle();assert.equal(calls,1);assert.equal(f.h.adapter.requests.length,count);
  }finally{await f.close();}
});

test('revoked source epochs prevent a wake and status cannot reveal or silently reactivate the stale goal',async()=>{
  let f:Awaited<ReturnType<typeof fixture>>,mode='planning',step=0,id='';const secret='PRIVATE_STALE_PLAN_SENTINEL';
  f=await fixture(options=>{
    step++;if(mode==='planning')return step===1?call('dafeiyu_activity_plan',{...planInput(f.now()+60000),goal:secret}):textReply('计划完成');
    if(step===1)return call('dafeiyu_activity_status',{id});
    assert.ok(!JSON.stringify(options.messages).includes(secret));
    return step===2?call('dafeiyu_activity_update',{id,requestId:'retry',expectedVersion:1,state:'active'}):textReply('需要形成新的计划依据');
  });
  try{const first=f.h.port.submitTask(request);await f.h.core.whenIdle();id=String(read(f.directory,'SELECT id FROM activity_schedules')[0]!.id);
    f.h.port.updateTask(first.task,{requestId:'pause-source',expectedVersion:1,status:'paused'});f.start();f.advance(60000);await f.tick();assert.equal(read(f.directory,'SELECT * FROM activity_occurrences').length,0);
    assert.equal(f.activity.store.get(id).status,'blocked');f.h.port.updateTask(first.task,{requestId:'resume-source',expectedVersion:2,status:'active'});
    mode='status';step=0;const run=f.h.port.submitTask({requestId:'inspect',taskId:first.task.id,expectedVersion:3,policyId:'test-policy'},first.task);await f.h.core.whenIdle();
    assert.equal(f.h.port.status(run.run).operations[1]?.status,'failed');assert.equal(f.activity.store.get(id).body.version,1);
  }finally{await f.close();}
});

test('the activity time budget pauses cooperation and keeps the unfinished occurrence blocked for deliberate replanning',async()=>{
  let f:Awaited<ReturnType<typeof fixture>>,planning=true,step=0,entered!:()=>void,finish!:()=>void;
  const started=new Promise<void>(r=>{entered=r;}),hold=new Promise<void>(r=>{finish=r;});
  const extension={id:'fixture',version:'1',actions:[{id:'fixture_budget',version:'1',description:'bounded active time',inputSchema:z.strictObject({}),outputSchema:z.json(),effects:'local-write' as const,
    execute:async()=>{entered();await hold;return {status:'succeeded' as const,effects:'confirmed' as const,completeness:'complete' as const,data:{checkpoint:true},sources:[],receipts:[]};}}]};
  f=await fixture(()=>planning?++step===1?call('dafeiyu_activity_plan',planInput(f.now()+60000)):textReply('安排完成'):call('fixture_budget',{}),{extension,settings:{maxActiveMs:1000}});
  try{f.h.port.submitTask(request);await f.h.core.whenIdle();planning=false;f.start();f.advance(60000);await f.tick();await started;
    f.advance(999);await f.tick();assert.equal(read(f.directory,'SELECT state FROM activity_occurrences')[0]?.state,'running');
    f.advance(2);await f.tick();finish();await f.h.core.whenIdle();assert.equal(read(f.directory,'SELECT state FROM activity_occurrences')[0]?.state,'waiting');
    await f.tick();assert.equal(read(f.directory,'SELECT error FROM activity_schedules')[0]?.error,'ACTIVITY_TIME_BUDGET');
    const count=f.h.adapter.requests.length;f.advance(86400000);await f.tick();await f.h.core.whenIdle();assert.equal(f.h.adapter.requests.length,count);
  }finally{finish();await f.close();}
});

test('a missed lifecycle consumer is repaired from bounded authoritative Run receipts without rerunning the model',async()=>{
  let f:Awaited<ReturnType<typeof fixture>>,planning=true,step=0;f=await fixture(()=>planning&&++step===1?call('dafeiyu_activity_plan',planInput(f.now()+60000)):textReply('已完成虚构活动'));
  try{f.h.port.submitTask(request);await f.h.core.whenIdle();planning=false;f.start();const record=f.activity.store.runEvent.bind(f.activity.store);f.activity.store.runEvent=()=>{};
    f.advance(60000);await f.tick();await f.h.core.whenIdle();assert.equal(read(f.directory,'SELECT state FROM activity_occurrences')[0]?.state,'accepted');f.activity.store.runEvent=record;
    const calls=f.h.adapter.requests.length;await f.tick();assert.equal(read(f.directory,'SELECT state FROM activity_occurrences')[0]?.state,'completed');assert.equal(f.h.adapter.requests.length,calls);
    const task=String(read(f.directory,"SELECT json_extract(body,'$.taskId') AS id FROM activity_occurrences")[0]!.id),run=String(read(f.directory,'SELECT run_id FROM activity_occurrences')[0]!.run_id);
    assert.deepEqual(f.h.core.journal.executionRunStates('other-agent',task,run),[]);
  }finally{await f.close();}
});

test('maintenance cannot reintroduce a revoked planning source through its derived Task goal, even when activity context was omitted',async()=>{
  let f:Awaited<ReturnType<typeof fixture>>,mode='plan',step=0;
  const extension={id:'fixture',version:'1',actions:[{id:'fixture_save',version:'1',description:'selected fictional content',inputSchema:z.strictObject({}),outputSchema:z.json(),effects:'local-write' as const,
    execute:async(_i:unknown,c:ExecutionContext)=>{const source=f.h.memory.growth!.recordObservation(c,{requestId:'source',text:'虚构观察，保留来源',kind:'primary',resource:'fixture:scope',occurredAt:new Date().toISOString(),coverage:['test'],completeness:'partial'},'fixture');
      const saved=f.h.memory.growth!.contribute(c,{requestId:'save',source:source.id,version:source.version,mode:'original',reason:'选择保存'},'fixture');return {status:'succeeded' as const,effects:'confirmed' as const,completeness:'complete' as const,data:z.json().parse(saved),sources:[],receipts:[]};}}]};
  f=await fixture(()=>++step===1?mode==='plan'?call('dafeiyu_activity_plan',planInput(f.now()+60000)):call('fixture_save',{}):textReply('测试步骤结束'),{extension,settings:{maintenance:true},context:{maxBytes:0}});
  try{const parent=f.h.port.submitTask(request);await f.h.core.whenIdle();mode='explore';step=0;f.start();f.advance(60000);await f.tick();await f.h.core.whenIdle();
    assert.equal(read(f.directory,'SELECT state FROM activity_occurrences')[0]?.state,'completed');
    f.h.port.updateTask(parent.task,{requestId:'revoke-parent',expectedVersion:1,status:'paused'});const calls=f.h.adapter.requests.length;
    await f.tick();f.advance(60000);await f.tick();await f.h.core.whenIdle();assert.equal(f.h.adapter.requests.length,calls);
    assert.equal(read(f.directory,"SELECT status FROM activity_schedules WHERE id<>(SELECT id FROM activity_schedules ORDER BY rowid LIMIT 1)")[0]?.status,'blocked');
  }finally{await f.close();}
});


test('a capability loading wait keeps the original activity authority without an independent resume',async()=>{
  let f:Awaited<ReturnType<typeof fixture>>,phase='plan',step=0;
  f=await fixture(()=>phase==='plan'&&++step===1?call('dafeiyu_activity_plan',planInput(f.now()+60000)):textReply('已保存当前阶段'));
  f.h.adapter.assessmentResponse=()=>textReply(JSON.stringify({goalStatus:'partial',summary:'等待需要的能力加载。',evidenceIds:[],limitations:[],unfinished:[],requiredCapabilities:['fixture_future_tool'],next:phase==='plan'?'deliver':'capability-change'}));
  try{f.h.port.submitTask(request);await f.h.core.whenIdle();const id=String(read(f.directory,'SELECT id FROM activity_schedules')[0]!.id);
    phase='explore';f.start();f.advance(60000);await f.tick();await f.h.core.whenIdle();assert.equal(read(f.directory,'SELECT state FROM activity_occurrences')[0]?.state,'waiting');
    const calls=f.h.adapter.requests.length;f.advance(60000);await f.tick();await f.h.core.whenIdle();assert.notEqual(f.activity.store.get(id).status,'blocked');assert.equal(f.h.adapter.requests.length,calls);assert.equal(f.activity.health.error,null);
  }finally{await f.close();}
});
