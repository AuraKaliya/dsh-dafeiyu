import { mkdtemp,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { testTempDir } from './test-temp.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { PersonaSourceRef } from '@dafeiyu/contracts';
import type { HostRuntimeOptions } from '@dafeiyu/host';

const root=await mkdtemp(join(testTempDir(),'host-memory-flow-')),file=join(root,'host.json'),coordination=join(root,'coordination.sqlite');
process.env.DSH_HOME=join(root,'data/core/dsh-home');
const {ManagedHost,loadHostConfig,initializeProfile,readHostStatus,owners}=await import('@dafeiyu/host');
const {ScriptedModel,call,textReply}=await import('./harness.js');
const actions=['fixture_observation','dafeiyu_memory_maintenance_status','dafeiyu_memory_consolidate','dafeiyu_memory_maintenance_result','dafeiyu_experience_read','dafeiyu_experience_review','dafeiyu_memory_persona_candidate','dafeiyu_execution_source_state'];
const config={schemaVersion:1,profileId:'memory-e4-fixture',agent:{id:'dafeiyu'},paths:{core:'./data/core',memory:'./data/memory',sessions:'./data/sessions',query:'./data/query.sqlite'},
  modelRoutes:{chat:{provider:'local-test',model:'scripted'}},persona:{fixedFile:'./persona.md',kind:'test'},runtime:{turnTimeoutMs:30000,shutdownGraceMs:2000},diagnostics:{snapshotIntervalMs:100},
  plugins:[{id:'model-scripted',required:true,config:{}},{id:'timeline',required:true,config:{execution:true}},{id:'memory',required:true,config:{maintenance:{}}}],
  authorityPolicies:[{id:'local',producers:['host-cli'],actions,allowLocalWrite:true}]};
await writeFile(join(root,'persona.md'),'这是虚构的本地测试底色。保持好奇和独立判断，爱世界，不假定真实经历。');
await writeFile(file,JSON.stringify({...config,plugins:config.plugins.map(p=>p.id==='memory'?{...p,config:{maintenance:{}}}:p)}));
assert.throws(()=>loadHostConfig(file),/HOST_MAINTENANCE_SOURCE_TRACKING_REQUIRED/);
await writeFile(file,JSON.stringify(config));const prepared=loadHostConfig(file);initializeProfile(prepared,coordination);
const read=(sql:string)=>{const db=new DatabaseSync(join(prepared.paths.memory,'memory.sqlite'),{readOnly:true});try{return db.prepare(sql).all();}finally{db.close();}};
const sentinel='PRIVATE_EXPERIENCE_SENTINEL_虚构观测：蓝色气球向东移动。';
let stage:'collect'|'maintain'|'delete'|'after-delete'='collect',step=0,phase='',id='',experienceId='',source:PersonaSourceRef|undefined,modelCalls=0,analysisCalls=0;
const adapter=new ScriptedModel(options=>{
  modelCalls++;assert.ok(['ready','draining'].includes(phase));
  if(JSON.stringify(options).includes('独立经历分析器')){analysisCalls++;return textReply(JSON.stringify({schemaVersion:1,summary:'在虚构观测窗口中气球向东移动',gaps:['未观察其它时间'],
    experiences:[{content:{observation:'气球向东',action:'本地虚构观察',outcome:'仅记录移动方向',interpretation:'不能据此判断长期风向',conditions:['本次虚构窗口'],unknowns:['之后的方向']},
      supports:[{sourceId:'S1',quote:sentinel}],counters:[],target:null}],relations:[],persona:[]}));}
  step++;
  if(stage==='collect')return step===1?call('fixture_observation',{}):textReply('观察和选择完成');
  if(stage==='maintain'){
    if(step===1)return call('dafeiyu_memory_maintenance_status',{});
    if(step===2)return call('dafeiyu_memory_consolidate',{id});
    if(step===3)return call('dafeiyu_memory_maintenance_result',{id});
    if(step===4){experienceId=String(read('SELECT id FROM experience_items')[0]!.id);return call('dafeiyu_experience_read',{id:experienceId});}
    return textReply('经验是有条件的推断，已保留未知');
  }
  if(stage==='delete')return step===1?call('dafeiyu_execution_source_state',{requestId:'delete',id:source!.id,expectedVersion:source!.version,deleted:true}):textReply('来源已撤下');
  if(step===1)return call('dafeiyu_experience_read',{id:experienceId});
  assert.ok(!JSON.stringify(options.messages).includes(sentinel));return textReply('旧经验来源不可用，不能补造正文');
});
const options:HostRuntimeOptions={coordination,adapter,onPhase:(value,host)=>{phase=value;
  if(value==='binding')host.core.registerExtension({protocolVersion:4,id:'fixture',version:'1',agentId:'dafeiyu',actions:[{id:'fixture_observation',version:'1',description:'virtual local observation',effects:'local-write',inputSchema:z.strictObject({}),outputSchema:z.json(),execute:async(_i,c)=>{
    const captured=host.ctx.dafeiyuMemory.growth!.recordObservation(c,{requestId:'observe',occurredAt:'2026-10-25T00:00:00.000Z',text:sentinel,kind:'primary',resource:'fixture:balloon',coverage:['fictional-window'],completeness:'partial'},'fixture');source=captured;
    const data=host.ctx.dafeiyuMemory.growth!.contribute(c,{requestId:'select',source:captured.id,version:captured.version,mode:'original',reason:'明确选择保留观察'},'fixture');
    return {status:'succeeded',effects:'confirmed',completeness:'partial',data:z.json().parse(data),sources:[],receipts:[]};}}]});
}};
let host=await ManagedHost.start(prepared,options);
try{
  assert.ok(host.snapshot().features.includes('memory.maintenance.v1'));
  const first=await host.run({requestId:'collect',title:'虚构探索',goal:'记录并保留虚构观察',policyId:'local'});assert.equal(first.state,'completed');
  id=String(read('SELECT id FROM maintenance_requests')[0]!.id);assert.equal(read('SELECT state FROM maintenance_requests')[0]?.state,'waiting-scheduler');assert.equal(analysisCalls,0);
  const port=host.core.executionProducer('host-cli',{motivation:{kind:'maintenance',basis:['explicit-local-check']}}),task=port.openTask(first.taskId);
  stage='maintain';step=0;const run=port.submitTask({requestId:'maintain',taskId:task.id,expectedVersion:1,policyId:'local'},task);await host.core.whenIdle();assert.equal(port.status(run.run).state,'completed');
  assert.equal(analysisCalls,1);assert.equal(read('SELECT * FROM experience_revisions').length,1);assert.equal(read('SELECT * FROM maintenance_requests').length,1);assert.equal(read('SELECT * FROM persona_profiles').length,0);
  host.publish();const live=readHostStatus(prepared,coordination).snapshot!;assert.equal(live.services.memory?.maintenance?.requests.completed,1);assert.equal(live.services.memory?.maintenance?.scheduler,'not-configured');assert.ok(!JSON.stringify(live).includes(sentinel));
  await host.close();assert.equal(readHostStatus(prepared,coordination).snapshot?.services.memory?.maintenance?.state,'closed');assert.equal(owners(coordination).length,0);
  const calls=modelCalls;host=await ManagedHost.start(prepared,options);assert.equal(modelCalls,calls);assert.equal(host.snapshot().services.memory?.maintenance.requests.completed,1);
  const maintenance=host.core.executionProducer('host-cli',{motivation:{kind:'maintenance',basis:['local-source-test']}}),sameTask=maintenance.openTask(first.taskId);
  stage='delete';step=0;maintenance.submitTask({requestId:'delete',taskId:sameTask.id,expectedVersion:1,policyId:'local'},sameTask);await host.core.whenIdle();
  assert.equal(read('SELECT state_version FROM execution_sources WHERE id='+"'"+source!.id+"'")[0]?.state_version,2);
  stage='after-delete';step=0;const last=maintenance.submitTask({requestId:'after-delete',taskId:sameTask.id,expectedVersion:1,policyId:'local'},sameTask);await host.core.whenIdle();
  assert.equal(maintenance.status(last.run).operations[0]?.status,'failed');assert.equal(read('SELECT * FROM experience_revisions').length,1);
  console.log(JSON.stringify({passed:true,realModel:false,realPlatform:false,serverAccess:false,restartAdditionalModelCalls:0,analysisCalls,schema:host.snapshot().schemas.memory}));
}finally{await host.close();}
