import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {z} from 'zod';
import {API_VERSION,ActionOutcomeSchema,MessageInstructionSubmitSchema} from '@dafeiyu/contracts';
import type {ExtensionHandle,Reply} from '@dafeiyu/contracts';
import {FixtureAdapter,textResponse,toolResponse} from './sdk-fixture.js';
import {testTempDir} from './test-temp.js';

test('a message task crosses a segment and delivers exactly one verified leaf result',{timeout:30000},async t=>{
  const root=await mkdtemp(join(testTempDir(),'bili-delivery-')),file=join(root,'host.json');
  process.env.DSH_HOME=join(root,'data/core/dsh-home');
  const {ManagedHost,loadHostConfig,initializeProfile}=await import('@dafeiyu/host');
  let step=0,submitted=false,channel:ExtensionHandle|undefined;
  const delivered:Reply[]=[],videos=['BV1xNpFedE11','BV1xNpFedE12','BV1xNpFedE13','BV1xNpFedE14'];
  const adapter=new FixtureAdapter(request=>{
    const session=String(request.sessionId);
    if(session.startsWith('memory-expression-verify-'))return textResponse('{"faithful":true,"issues":[]}');
    if(session.startsWith('dafeiyu-delivery-')){
      assert.match(JSON.stringify(request.messages),/bilibili-reading-progress/);
      return textResponse('已保存四条视频的阅读记录。本轮依据视频资料，未完整观看视频或音轨。');
    }
    if(request.tools?.some(tool=>tool.name==='fixture_task_submit')){
      if(submitted)return textResponse('已受理。');submitted=true;
      return toolResponse('fixture_task_submit',{requestId:'submit-reading',title:'B站阅读验收'});
    }
    assert.ok(!session.startsWith('dafeiyu-progress-'),'Task unexpectedly failed');
    if(step>=8)return textResponse('已保存四条视频阅读记录。');
    const index=Math.floor(step/2),read=step++%2===0,bvid=videos[index]!;
    return read?toolResponse('bili_video',{requestId:'video-'+index,bvid}):toolResponse('bili_reading_save',{
      requestId:'save-'+index,bvid,status:'closed',conclusion:'观察'+index,gaps:[],nextStep:null});
  });
  await writeFile(join(root,'persona.md'),'本机虚构验收人格。');
  await writeFile(file,JSON.stringify({schemaVersion:1,profileId:'reading-delivery',agent:{id:'fish'},
    paths:{core:'./data/core',memory:'./data/memory',sessions:'./data/sessions',query:'./data/query.sqlite'},
    modelRoutes:{chat:{provider:'local-test',model:'scripted'}},persona:{fixedFile:'./persona.md',kind:'test'},
    plugins:[{id:'model-scripted',required:true},{id:'timeline',required:true,config:{execution:true}},{id:'memory-growth',required:true},
      {id:'media',required:true,config:{ffmpeg:process.execPath,ffprobe:process.execPath}},
      {id:'bilibili',required:true,config:{capabilities:{minIntervalMs:100}}}],
    authorityPolicies:[{id:'conversation',producers:['fixture-channel'],actions:['fixture_task_submit'],allowLocalWrite:true},
      {id:'reading',producers:['fixture-tasks'],actions:['bili_video','bili_reading_save','bili_reading_get'],allowLocalWrite:true,
        resources:[{channel:'bilibili',account:'public',kind:'local',id:'public'}]}]}));
  const config=loadHostConfig(file),coordination=join(root,'coordination.sqlite');initializeProfile(config,coordination);
  const options:Parameters<typeof ManagedHost.start>[1]={coordination,adapter,signal:t.signal,installChannels:ctx=>{
    channel=ctx.dafeiyu.registerExtension({id:'fixture-channel',version:'1',protocolVersion:API_VERSION,agentId:'fish',channels:[{
      channel:'fixture',account:'local',deliver:async(_reply,signal,authority)=>{signal.throwIfAborted();authority?.();return {status:'sent',receiptId:'ack'};},
      deliverTaskResult:async(reply,_anchor,signal,authority,writeWindow)=>{
        signal.throwIfAborted();authority();const end=writeWindow();try{delivered.push(reply);return {status:'sent',receiptId:'result'};}finally{end();}
      }}]});
    ctx.dafeiyu.registerExtension({id:'fixture-tasks',version:'1',protocolVersion:API_VERSION,agentId:'fish',actions:[{
      id:'fixture_task_submit',version:'1',description:'受理当前真实任务',inputSchema:MessageInstructionSubmitSchema,
      outputSchema:ActionOutcomeSchema,effects:'local-write',scope:'conversation',execute:async(input,context)=>({
        status:'succeeded',effects:'confirmed',completeness:'complete',sources:[],receipts:[],
        data:z.json().parse(ctx.dafeiyu.submitMessageTask(context,'fixture-tasks',{...MessageInstructionSubmitSchema.parse(input),kind:'explicit-task'}))})}]});
    ctx.dafeiyu.bindMessageTasks({id:'fixture-tasks',pluginId:'fixture-tasks',channelExtensionId:'fixture-channel',channel:'fixture',account:'local',
      ownerId:'owner',policyId:'reading',version:'1',autoDeliver:true,classify:message=>({kind:'submit',text:message.mainText??''}),active:()=>true});
  },biliTransport:async url=>{
    const bvid=url.searchParams.get('bvid')!,i=videos.indexOf(bvid);assert.notEqual(i,-1);
    const bytes=Buffer.from(JSON.stringify({code:0,data:{bvid,aid:String(i+1),title:'视频'+i,desc:'虚构视频资料',duration:60,
      pages:[{cid:String(i+100),page:1,part:'第一部分',duration:60}],owner:{mid:42,name:'Fixture'}}}));
    return {status:200,headers:{'content-length':String(bytes.length)},body:(async function*(){yield bytes;})(),close(){}};
  }};
  let host=await ManagedHost.start(config,options);
  try{
    const text='读取四条B站视频并保存阅读记录';
    channel!.ingest({id:'inbound-reading',occurredAt:new Date().toISOString(),conversation:{channel:'fixture',account:'local',kind:'private',id:'owner'},
      sender:{id:'owner',displayName:'验收'},text,mainText:text});
    await host.ctx.dafeiyu.whenIdle();
    const db=new DatabaseSync(join(root,'data/core/runtime.sqlite'),{readOnly:true});
    try{
      const runs=db.prepare('SELECT id,state,error FROM runs').all();
      assert.equal(delivered.length,1,JSON.stringify({runs,deliveries:db.prepare('SELECT state,error FROM native_deliveries').all()}));
      assert.equal(runs.filter(run=>run.state==='continued').length,0,'Four videos no longer force a segment handoff');
      assert.equal(runs.find(run=>run.id===delivered[0]!.taskResult?.runId)?.state,'completed');
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM native_deliveries WHERE state='sent'").get()!.n,1);
    }finally{db.close();}
    assert.match(delivered[0]!.text,/四条/);
    assert.ok(adapter.requests.some(request=>String(request.sessionId).startsWith('memory-expression-verify-')));
    const runId=delivered[0]!.taskResult!.runId;
    await host.close();host=await ManagedHost.start(config,options);
    const restored=await host.ctx.dafeiyu.prepareMessageTaskExpression(runId);
    assert.match(JSON.stringify(restored.evidence),/bilibili-reading-progress/);
    assert.match(JSON.stringify(restored.evidence),/视频0/);
    assert.equal(delivered.length,1,'A restart must not send the already delivered leaf again');
    host.ctx.dafeiyuBilibili.store.unavailable('video:'+videos[0]);
    await assert.rejects(host.ctx.dafeiyu.prepareMessageTaskExpression(runId),/SOURCE_STALE/);
  }finally{await host.close();}
});
