import { mkdtemp,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { testTempDir } from './test-temp.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { HostRuntimeOptions } from '@dafeiyu/host';

const root=await mkdtemp(join(testTempDir(),'host-activity-flow-')),file=join(root,'host.json'),coordination=join(root,'coordination.sqlite');
process.env.DSH_HOME=join(root,'data/core/dsh-home');
const {ManagedHost,loadHostConfig,initializeProfile,readHostStatus,owners}=await import('@dafeiyu/host');
const {ScriptedModel,call,textReply}=await import('./harness.js');
const activityActions=['dafeiyu_activity_plan','dafeiyu_activity_update','dafeiyu_activity_status','dafeiyu_memory_maintenance_request'];
const config={schemaVersion:1,profileId:'activity-flow',agent:{id:'dafeiyu'},paths:{core:'./data/core',memory:'./data/memory',sessions:'./data/sessions',query:'./data/query.sqlite'},
  modelRoutes:{chat:{provider:'local-test',model:'scripted'}},persona:{fixedFile:'./persona.md',kind:'test'},runtime:{turnTimeoutMs:60000,shutdownGraceMs:3000},diagnostics:{snapshotIntervalMs:100},
  plugins:[{id:'model-scripted',required:true,config:{}},{id:'timeline',required:true,config:{execution:true}},{id:"memory-growth",required:true,config:{maintenance:{}}},{id:'activity',required:true,config:{maintenance:true,tickMs:50}}],
  authorityPolicies:[{id:'local',producers:['host-cli'],actions:activityActions,allowLocalWrite:true},
    {id:'activity-explore',producers:['activity'],actions:[...activityActions,'fixture_observe'],allowLocalWrite:true},
    {id:'activity-maintenance',producers:['activity'],actions:['dafeiyu_memory_maintenance_status','dafeiyu_memory_consolidate','dafeiyu_memory_maintenance_result'],allowLocalWrite:true}]};
await writeFile(join(root,'persona.md'),'仅用于本地虚构测试：爱世界，保持好奇，也可以选择休息。');await writeFile(file,JSON.stringify(config));
const prepared=loadHostConfig(file);initializeProfile(prepared,coordination);
const read=(sql:string,kind='activity')=>{const db=new DatabaseSync(join(kind==='activity'?prepared.paths.core:prepared.paths.memory,kind==='activity'?'activity.sqlite':'memory.sqlite'),{readOnly:true});try{return db.prepare(sql).all();}finally{db.close();}};
const goal='PRIVATE_ACTIVITY_GOAL_SENTINEL 观察虚构星空',observation='PRIVATE_ACTIVITY_OBSERVATION_SENTINEL 虚构星点在本次窗口内偏蓝';
let now=Date.now(),monotonic=0,mode:'planning'|'exploring'|'maintaining'='planning',step=0,phase='',calls=0,bootCalls=0,analysisCalls=0,planId='';
const adapter=new ScriptedModel(options=>{
  calls++;assert.ok(['ready','degraded','draining'].includes(phase));
  if(JSON.stringify(options).includes('独立经历分析器')){analysisCalls++;return textReply(JSON.stringify({schemaVersion:1,summary:'仅针对虚构窗口',gaps:['未观察其它窗口'],experiences:[{content:{observation:'本次偏蓝',action:'虚构观察',outcome:'只覆盖本次窗口',interpretation:'不能概括所有星点',conditions:['虚构窗口'],unknowns:['其它时间和方向']},supports:[{sourceId:'S1',quote:observation}],counters:[],target:null}],relations:[],persona:[]}));}
  step++;
  if(mode==='planning')return step===1?call('dafeiyu_activity_plan',{requestId:'plan',goal,trigger:{kind:'once',at:new Date(now+60000).toISOString()}}):textReply('计划保存，尚未探索');
  if(mode==='exploring'){
    assert.match(JSON.stringify(options.messages),/activity-occurrence/);
    return step===1?call('fixture_observe',{}):step===2?call('dafeiyu_activity_update',{id:planId,requestId:'rest',expectedVersion:1,state:'paused'}):step===3?call('dafeiyu_memory_maintenance_request',{requestId:'explicit-review',sources:[],reason:'整理这次主动观察的条件与未知'}):textReply('已经观察虚构样本，先休息');
  }
  if(step===1){const id=String(read("SELECT id FROM maintenance_requests WHERE state='ready' AND json_extract(body,'$.sources[0]') IS NOT NULL ORDER BY rowid DESC LIMIT 1",'memory')[0]?.id);
    assert.ok(JSON.stringify(options.messages).includes(id));return call('dafeiyu_memory_consolidate',{id});}
  return textReply('条件和未知已保留');
});
const options:HostRuntimeOptions={coordination,adapter,activityClock:{now:()=>now,monotonic:()=>monotonic},onPhase:(value,host)=>{phase=value;
  if(value==='recovering')assert.equal(calls,bootCalls);
  if(value==='binding')host.core.registerExtension({protocolVersion:4,id:'fixture',version:'1',agentId:'dafeiyu',actions:[{id:'fixture_observe',version:'1',description:'fictional sky source',effects:'local-write',inputSchema:z.strictObject({}),outputSchema:z.json(),execute:async(_i,c)=>{
    const source=host.ctx.dafeiyuMemory.growth!.recordObservation(c,{requestId:'star',text:observation,kind:'primary',resource:'fixture:sky',occurredAt:new Date().toISOString(),coverage:['fictional-window'],completeness:'partial'},'fixture');
    const saved=host.ctx.dafeiyuMemory.growth!.contribute(c,{requestId:'keep',source:source.id,version:source.version,mode:'original',reason:'自己选择保留虚构观察'},'fixture');
    return {status:'succeeded',effects:'confirmed',completeness:'partial',data:z.json().parse(saved),sources:[],receipts:[]};}}]});
}};
let host=await ManagedHost.start(prepared,{...options,mode:'single-run'});
try{
  assert.equal(host.snapshot().services.activity?.running,false);assert.equal(host.snapshot().services.memory?.maintenance.scheduler,'connected');
  await host.run({requestId:'planning',title:'虚构探索安排',goal:'为自己安排一次虚构探索',policyId:'local'});
  planId=String(read('SELECT id FROM activity_schedules')[0]!.id);now+=120000;monotonic+=120000;await host.ctx.dafeiyuActivity.tick();assert.equal(calls,2);assert.equal(read('SELECT * FROM activity_occurrences').length,0);
  await host.close();assert.equal(readHostStatus(prepared,coordination).snapshot?.services.activity?.lifecycle,'closed');assert.equal(owners(coordination).length,0);
  mode='exploring';step=0;bootCalls=calls;host=await ManagedHost.start(prepared,{...options,mode:'daemon'});await host.ctx.dafeiyuActivity.tick();await host.core.whenIdle();
  assert.equal(host.ctx.dafeiyuActivity.store.get(planId).status,'paused');assert.equal(read('SELECT state FROM activity_occurrences')[0]?.state,'completed');
  await host.ctx.dafeiyuActivity.tick();assert.equal(read('SELECT * FROM activity_schedules').length,2);assert.equal(analysisCalls,0);
  mode='maintaining';step=0;now+=60000;monotonic+=60000;await host.ctx.dafeiyuActivity.tick();await host.core.whenIdle();
  assert.equal(analysisCalls,1);assert.equal(read('SELECT * FROM experience_items','memory').length,1);assert.ok(read('SELECT state FROM activity_occurrences').every(r=>r.state==='completed'));
  host.publish();const status=readHostStatus(prepared,coordination).snapshot!;assert.equal(status.services.activity?.counts.occurrences.completed,2);assert.equal(status.schemas.activity,1);
  assert.ok(!JSON.stringify(status).includes(goal));assert.ok(!JSON.stringify(status).includes(observation));const beforeRestart=calls;await host.close();
  bootCalls=calls;host=await ManagedHost.start(prepared,{...options,mode:'daemon'});now+=3600000;monotonic+=3600000;await host.ctx.dafeiyuActivity.tick();await host.core.whenIdle();assert.equal(calls,beforeRestart);
  await host.close();const closed=readHostStatus(prepared,coordination).snapshot;assert.equal(closed?.services.activity?.running,false);assert.equal(closed?.services.activity?.counts.occurrences.completed,2);
  console.log(JSON.stringify({passed:true,realModel:false,realPlatform:false,serverAccess:false,restartAdditionalModelCalls:0,singleRunBackgroundCalls:0,analysisCalls,completedOccurrences:2}));
}finally{await host.close();}
