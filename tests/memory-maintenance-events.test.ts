import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { ExecutionContextV3,ExtensionV3,PersonaSourceRef } from '@dafeiyu/contracts';
import { executionHarness } from './execution-fixture.js';
import { call,textReply } from './harness.js';
import { testTempDir } from './test-temp.js';

type H=Awaited<ReturnType<typeof executionHarness>>;
const root=()=>mkdtemp(join(testTempDir(),'maintenance-events-'));
function rows(root:string,sql:string,kind='memory'){const db=new DatabaseSync(join(root,kind==='memory'?'memory/memory.sqlite':'core/runtime.sqlite'),{readOnly:true});try{return db.prepare(sql).all();}finally{db.close();}}
const request={requestId:'first',title:'虚构任务',goal:'观察虚构蓝色气球',policyId:'test-policy'};
function extension(fn:(context:ExecutionContextV3)=>unknown):Omit<ExtensionV3,'protocolVersion'|'agentId'> {return {id:'fixture',version:'1',actions:[{id:'fixture_event',version:'1',description:'virtual event test',effects:'local-write',inputSchema:z.strictObject({}),outputSchema:z.json(),
  execute:async(_i,c)=>({status:'succeeded',effects:'confirmed',completeness:'complete',data:z.json().parse(await fn(c)),sources:[],receipts:[]})}]};}
const observed={requestId:'balloon',text:'虚构蓝色气球在风中向东移动。',occurredAt:'2026-10-25T00:00:00.000Z',kind:'primary',resource:'fixture:balloon',coverage:['fictional-window'],completeness:'partial'};

test('core completion persists selected memory references, actual goal and motivation without starting an analyzer',async()=>{
  const directory=await root();let h:H,n=0;
  h=await executionHarness(directory,()=>++n===1?call('fixture_event',{}):textReply('观察结束'),extension(c=>{const source=h.memory.persona!.recordObservation(c,observed,'fixture');
    return h.memory.persona!.contribute(c,{requestId:'keep',source:source.id,version:1,mode:'original',reason:'选择保存本次观察'},'fixture');}),true,{maintenance:{},sourceTracking:true});
  try{const accepted=h.port.submitTask(request);await h.core.whenIdle();assert.equal(h.port.status(accepted.run).state,'completed');
    const requests=rows(directory,'SELECT state,body FROM maintenance_requests');assert.equal(requests.length,1);assert.equal(requests[0]?.state,'waiting-scheduler');
    const body=JSON.parse(String(requests[0]!.body));assert.equal(body.goal,request.goal);assert.equal(body.motivation.kind,'explicit-task');assert.equal(body.sources.length,1);assert.equal(body.sources[0].kind,'memory');
    assert.equal(body.event.operations[0].status,'succeeded');assert.equal(rows(directory,'SELECT * FROM experience_items').length,0);assert.equal(h.adapter.requests.filter(r=>String(r.sessionId).startsWith('dafeiyu-task-')).length,2);assert.equal(h.adapter.requests.filter(r=>String(r.sessionId).startsWith('dafeiyu-assessment-')).length,1);
    assert.equal(rows(directory,'SELECT * FROM maintenance_events').length,2);
  }finally{await h.close();}
});

test('an unselected observation creates only an activity request, never copies its text into maintenance',async()=>{
  const directory=await root();let h:H,n=0;h=await executionHarness(directory,()=>++n===1?call('fixture_event',{}):textReply('未选择内容'),extension(c=>h.memory.persona!.recordObservation(c,observed,'fixture')),true,{maintenance:{},sourceTracking:true});
  try{h.port.submitTask(request);await h.core.whenIdle();const body=String(rows(directory,'SELECT body FROM maintenance_requests')[0]!.body);assert.ok(!body.includes(observed.text));assert.equal(JSON.parse(body).sources.length,0);}
  finally{await h.close();}
});

test('completed Run with unknown operation effects preserves unknown instead of reporting task success',async()=>{
  const directory=await root();let n=0;const h=await executionHarness(directory,()=>++n===1?call('fixture_event',{}):textReply('无法确认'),extension(()=>{throw new Error('FIXTURE_EFFECT_UNKNOWN');}),true,{maintenance:{},sourceTracking:true});
  try{const accepted=h.port.submitTask(request);await h.core.whenIdle();assert.equal(h.port.status(accepted.run).state,'completed');const body=JSON.parse(String(rows(directory,'SELECT body FROM maintenance_requests')[0]!.body));
    assert.equal(body.event.type,'run.completed');assert.equal(body.event.operations[0].status,'unknown');assert.equal(body.event.operations[0].effects,'unknown');}
  finally{await h.close();}
});

test('lost event acknowledgement replays once after restart, then on-demand maintenance advances the watermark without waking itself',async()=>{
  const directory=await root();let h=await executionHarness(directory,()=>textReply('没有内容贡献'),undefined,true,{maintenance:{},sourceTracking:true});
  const accepted=h.port.submitTask(request);await h.core.whenIdle();const stored=JSON.parse(String(rows(directory,'SELECT body FROM maintenance_requests')[0]!.body));await h.close();
  const db=new DatabaseSync(join(directory,'core/runtime.sqlite'));db.prepare('UPDATE runtime_outbox SET delivered=0 WHERE id=?').run(stored.event.id);db.close();
  let n=0;h=await executionHarness(directory,()=>++n===1?call('fixture_event',{}):textReply('整理结束'),extension(c=>h.memory.maintenance!.consolidate(c,stored.id,'fixture')),false,{maintenance:{},sourceTracking:true});
  try{assert.equal(h.adapter.requests.length,0);assert.equal(rows(directory,'SELECT * FROM maintenance_requests').length,1);assert.equal(rows(directory,"SELECT * FROM runtime_outbox WHERE delivered=0",'core').length,0);
    const port=h.core.executionProducer('local-test',{motivation:{kind:'maintenance',basis:['on-demand-fixture']}}),task=port.openTask(accepted.task.id);
    const maintained=port.submitTask({requestId:'maintenance',taskId:task.id,expectedVersion:1,policyId:'test-policy'},task);await h.core.whenIdle();
    assert.equal(port.status(maintained.run).state,'completed');assert.equal(rows(directory,'SELECT state FROM maintenance_requests')[0]?.state,'completed');assert.equal(rows(directory,'SELECT * FROM maintenance_requests').length,1);
    assert.equal(rows(directory,'SELECT * FROM maintenance_watermarks').length,1);assert.equal(rows(directory,'SELECT * FROM experience_items').length,0);assert.equal(h.adapter.requests.filter(r=>String(r.sessionId).startsWith('dafeiyu-task-')).length,2);assert.equal(h.adapter.requests.filter(r=>String(r.sessionId).startsWith('dafeiyu-assessment-')).length,1);
  }finally{await h.close();}
});

test('new task epoch invalidates a pending old request before any analysis',async()=>{
  const directory=await root();let h:H,stage=0,id='',rejected=false;
  h=await executionHarness(directory,()=>stage++===1?call('fixture_event',{}):textReply('完成'),extension(async c=>{try{await h.memory.maintenance!.consolidate(c,id,'fixture');}catch(error){assert.match(String(error),/TASK_NOT_ACTIVE/);rejected=true;}return {rejected};}),true,{maintenance:{},sourceTracking:true});
  try{const first=h.port.submitTask(request);await h.core.whenIdle();id=String(rows(directory,'SELECT id FROM maintenance_requests')[0]!.id);
    h.port.updateTask(first.task,{requestId:'change',expectedVersion:1,title:'新任务目标',goal:'改为观察红色气球',status:'active'});
    const second=h.port.submitTask({requestId:'next',taskId:first.task.id,expectedVersion:2,policyId:'test-policy'},first.task);await h.core.whenIdle();
    assert.equal(rejected,true);assert.equal(rows(directory,'SELECT state FROM maintenance_requests ORDER BY rowid')[0]?.state,'stale');assert.equal(h.port.status(second.run).state,'completed');
    assert.equal(h.adapter.requests.filter(r=>JSON.stringify(r).includes('独立经历分析器')).length,0);
  }finally{await h.close();}
});

test('legacy configuration leaves automatic maintenance unconfigured',async()=>{
  const directory=await root(),h=await executionHarness(directory);try{h.port.submitTask(request);await h.core.whenIdle();assert.equal(rows(directory,'SELECT * FROM maintenance_events').length,0);assert.equal(rows(directory,'SELECT * FROM maintenance_requests').length,0);}
  finally{await h.close();}
});

test('a registered selection action produces a typed evidence event with only its fixed selected references',async()=>{
  const directory=await root();let h:H,n=0,source:PersonaSourceRef;
  h=await executionHarness(directory,()=>++n===1?call('fixture_event',{}):n===2?call('dafeiyu_execution_select',{requestId:'select',expectedVersion:0,entries:[source],reason:'明确保留观察为任务证据'}):textReply('选择结束'),
    extension(c=>source=h.memory.persona!.recordObservation(c,observed,'fixture')),true,{maintenance:{},sourceTracking:true,executionActions:true});
  try{h.port.submitTask(request);await h.core.whenIdle();const requests=rows(directory,'SELECT body FROM maintenance_requests').map(r=>JSON.parse(String(r.body)));
    assert.equal(requests.length,2);assert.equal(requests[0].event.type,'evidence.changed');assert.equal(requests[0].sources[0].id,source!.id);assert.equal(requests[1].sources[0].id,source!.id);}
  finally{await h.close();}
});
