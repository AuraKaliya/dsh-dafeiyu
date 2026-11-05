import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {API_VERSION} from '@dafeiyu/contracts';
import {FixtureAdapter,toolResponse,textResponse} from './sdk-fixture.js';
import {testTempDir} from './test-temp.js';
import {BiliStore} from '../packages/bilibili/lib/store.js';
import {BiliClient} from '../packages/bilibili/lib/client.js';
import {BiliConfigSchema} from '../packages/bilibili/lib/config.js';

test('a held action leaves the next active SDK tool set and returns after recovery without changing task authority',{timeout:30000},async t=>{
  const root=await mkdtemp(join(testTempDir(),'readiness-'));process.env.DSH_HOME=join(root,'data/core/dsh-home');
  const {ManagedHost,loadHostConfig,initializeProfile}=await import('@dafeiyu/host');let available=true,phase=0,executions=0,readinessReads=0;
  const adapter=new FixtureAdapter(request=>{
    // DSH in-history routes retain old declarations to decode history and explicitly remove them in developer messages.
    const tools=new Set(request.tools?.map(tool=>tool.name)??[]);
    for(const message of request.messages)if(message.role==='developer')for(const block of message.content){if(block.type==='tool-removal')tools.delete(block.toolName);if(block.type==='tool-addition')tools.add(block.toolName);}
    if(phase++===0){assert.ok(tools.has('fixture_live_read'));return toolResponse('fixture_live_read',{});}
    if(phase===2){assert.ok(!tools.has('fixture_live_read'));assert.ok(tools.has('fixture_cached_read'));return toolResponse('dafeiyu_task_outcome',{next:'wait',reason:'等待已提供能力恢复',requiredCapabilities:[]});}
    if(phase===3)return textResponse('依赖暂停，已有任务和读取进度保留。');
    if(phase===4){assert.ok(tools.has('fixture_live_read'));return toolResponse('fixture_live_read',{});}
    return textResponse('已沿原任务继续完成读取。');
  });
  const file=join(root,'host.json');await writeFile(join(root,'persona.md'),'测试人格。');await writeFile(file,JSON.stringify({schemaVersion:1,profileId:'readiness',agent:{id:'fish'},paths:{core:'./data/core',memory:'./data/memory',sessions:'./data/sessions',query:'./data/query.sqlite'},modelRoutes:{chat:{provider:'local-test',model:'scripted'}},persona:{fixedFile:'./persona.md',kind:'test'},plugins:[{id:'model-scripted',required:true},{id:'timeline',required:true,config:{execution:true}},{id:'memory-growth',required:true}],authorityPolicies:[{id:'fixture',producers:['fixture'],actions:['fixture_live_read','fixture_cached_read','dafeiyu_task_outcome'],allowLocalWrite:true}]}));
  const config=loadHostConfig(file),coordination=join(root,'coordination.sqlite');initializeProfile(config,coordination);
  const host=await ManagedHost.start(config,{coordination,adapter,signal:t.signal,installChannels:ctx=>{ctx.dafeiyu.registerExtension({id:'fixture',protocolVersion:API_VERSION,version:'1',agentId:'fish',actions:[
    {id:'fixture_live_read',version:'1',description:'受依赖影响的读取',inputSchema:z.strictObject({}),outputSchema:z.json(),effects:'read',readiness:()=>{readinessReads++;return {available,reason:available?null:'依赖暂停，不是插件缺失'};},execute:async()=>{executions++;if(executions===1){available=false;return {status:'failed',effects:'none',completeness:'unknown',data:{reason:'恢复条件尚未满足'},sources:[],receipts:[],errorCode:'FIXTURE_DEPENDENCY_HELD'};}return {status:'succeeded',effects:'none',completeness:'complete',data:{read:true},sources:[],receipts:[]};}},
    {id:'fixture_cached_read',version:'1',description:'本地已读记录',inputSchema:z.strictObject({}),outputSchema:z.json(),effects:'read',execute:async()=>({status:'succeeded',effects:'none',completeness:'complete',data:{cached:true},sources:[],receipts:[]})}
  ]});}});
  try{const port=host.core.executionProducer('fixture'),accepted=port.submitTask({requestId:'one',title:'读取',goal:'读取内容；依赖暂停则保留任务等待',policyId:'fixture'});await host.core.whenIdle();
    const status=port.status(accepted.run);assert.equal(status.state,'waiting',JSON.stringify({error:status.error,phase,executions,readinessReads}));assert.equal(executions,1);
    available=true;const task=port.openTask(accepted.task.id),state=port.taskState(task),resumed=port.resume(task,{requestId:randomUUID(),taskId:task.id,expectedVersion:state.version,policyId:'fixture',parentRunId:accepted.run.id,checkpointId:status.checkpoints.at(-1)!});
    await host.core.whenIdle();assert.equal(port.status(resumed.run).state,'completed');assert.equal(executions,2);assert.equal(port.status(resumed.run).taskId,status.taskId);
  }finally{await host.close();}
});

test('Bilibili pauses narrow only affected routes and leave local reading records available',async()=>{
  const root=await mkdtemp(join(testTempDir(),'bili-readiness-')),store=new BiliStore(join(root,'bilibili.sqlite'),{agentId:'fish',profileId:'readiness'},true),config=BiliConfigSchema.parse({minIntervalMs:100}),client=new BiliClient(config,store,async()=>{throw new Error('NETWORK_FORBIDDEN');});
  try{const now=Date.now();store.diagnostics.failure('search','risk',now,config.retry,null,'anonymous-http',null);
    assert.equal(client.readAvailability('bili_search').available,false);assert.equal(client.readAvailability('bili_video').available,true);assert.equal(client.readAvailability('bili_reading_get').available,true);
    const browser=new BiliClient(BiliConfigSchema.parse({...config,browser:{expectedUid:'42'}}),store,async()=>{throw new Error('NETWORK_FORBIDDEN');});try{
      assert.equal(browser.readAvailability('bili_search').available,true,'a genuinely available configured fallback remains usable');
      store.diagnostics.failure('video','verification',now,config.retry,null,'browser',null);
      assert.equal(browser.readAvailability('bili_frames').available,false);assert.equal(browser.readAvailability('bili_browser_read').available,true);assert.match(browser.readAvailability('bili_browser_read').reason!,/video/);
    }finally{browser.dispose();}
  }finally{client.dispose();store.close();}
});
