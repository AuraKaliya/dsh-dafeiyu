import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {setTimeout as delay} from 'node:timers/promises';
import {API_VERSION} from '@dafeiyu/contracts';
import {LlmError} from '@deepseek-ai/dsh-llm';
import type {Reply} from '@dafeiyu/contracts';
import {QqStore} from '@dafeiyu/qq';
import {QqSegmentedTransport} from '../packages/channel-qq/lib/transport.js';
import {FixtureAdapter,textResponse,toolResponse,verificationResponse} from './sdk-fixture.js';
import {testTempDir} from './test-temp.js';

test('real SDK recovery keeps the task, reads saved coverage, finishes and shares exactly once after restart',{timeout:45000},async t=>{
  const root=await mkdtemp(join(testTempDir(),'activity-recovery-story-'));process.env.DSH_HOME=join(root,'data/core/dsh-home');
  const {ManagedHost,loadHostConfig,initializeProfile}=await import('@dafeiyu/host');
  const file=join(root,'host.json'),bvid='BV1xNpFedEwH',delivered:Reply[]=[],qqStore=new QqStore(join(root,'qq.sqlite'));
  let now=Date.now(),step=0,restored=false,videoReads=0,sawContinuation=false,sawSavedReading=false;
  const adapter=new FixtureAdapter(request=>{
    const session=String(request.sessionId);
    if(session.startsWith('dafeiyu-recovery-probe-'))return textResponse('OK');
    if(session.startsWith('memory-expression-verify-'))return verificationResponse(request);
    if(session.startsWith('dafeiyu-delivery-'))return textResponse('{"qq_messages":[{"type":"text","text":"刚才的阅读已接着完成，沿用了已经读到的古画资料。"}]}');
    if(!restored){
      if(step++===0)return toolResponse('bili_video',{requestId:'initial-video',bvid});
      if(step===2)return toolResponse('bili_reading_save',{requestId:'partial-reading',bvid,status:'checkpoint',conclusion:'已读古画修复资料。',gaps:['结论尚未整理'],nextStep:'接续整理现有证据'});
      return (async function*(){throw new LlmError('fixture account unavailable','HTTP_ERROR',{status:402});})();
    }
    const context=JSON.stringify(request.messages);sawContinuation ||= context.includes('parentRunId');
    if(step++===3)return toolResponse('bili_reading_get',{requestId:'resume-reading',bvid});
    sawSavedReading ||= context.includes('已读古画修复资料');
    if(step===5)return toolResponse('bili_reading_save',{requestId:'completed-reading',bvid,status:'closed',conclusion:'古画修复资料已接续整理，保留历史痕迹是本次认识。',gaps:[],nextStep:null});
    return textResponse('古画修复资料已接续整理，已保存已有证据与本次认识。');
  });
  await writeFile(join(root,'persona.md'),'本机隔离验收人格。');
  await writeFile(file,JSON.stringify({schemaVersion:1,profileId:'recovery-story',agent:{id:'fish'},paths:{core:'./data/core',memory:'./data/memory',sessions:'./data/sessions',query:'./data/query.sqlite'},modelRoutes:{chat:{provider:'local-test',model:'scripted'}},persona:{fixedFile:'./persona.md',kind:'test'},
    plugins:[{id:'model-scripted',required:true},{id:'timeline',required:true,config:{execution:true}},{id:'memory-growth',required:true},{id:'media',required:true,config:{ffmpeg:process.execPath,ffprobe:process.execPath}},
      {id:'activity',required:true,config:{idleAfterMs:0,tickMs:60000,explorationIntervalMs:60000,maintenance:false,plans:false,ownerSharing:{enabled:true,cooldownMs:60000}}},
      {id:'bilibili',required:true,config:{capabilities:{minIntervalMs:100}}}],
    authorityPolicies:[{id:'activity-explore',producers:['activity'],actions:['bili_video','bili_reading_save','bili_reading_get','dafeiyu_activity_rest'],allowLocalWrite:true,resources:[{channel:'bilibili',account:'public',kind:'local',id:'public'}]}]}));
  const config=loadHostConfig(file),coordination=join(root,'coordination.sqlite');initializeProfile(config,coordination);
  const options:Parameters<typeof ManagedHost.start>[1]={coordination,adapter,signal:t.signal,activityClock:{now:()=>now,monotonic:()=>performance.now()},installChannels:ctx=>{
    const transport=new QqSegmentedTransport({ledger:qqStore.delivery,confirmed:()=>{},check:async reply=>ctx.dafeiyu.verifyActivityShareReply(reply),send:async reply=>{delivered.push(reply);return '123456';}});
    ctx.dafeiyu.registerExtension({id:'fixture-qq',version:'1',protocolVersion:API_VERSION,agentId:'fish',ownerDirectory:{channelExtensionId:'fixture-qq',channel:'qq',account:'100001',ownerId:'200001',snapshot:()=>({revision:'1',available:true,resources:[{channel:'qq',account:'100001',kind:'private',id:'200001'}]})},channels:[{channel:'qq',account:'100001',deliver:async()=>assert.fail('no artificial inbound'),deliverTaskResult:async(reply,anchor,signal,authority,begin)=>{
      assert.equal(anchor.kind,'activity-result');assert.equal(reply.sourceMessageId,'');return transport.deliver(reply,signal,authority,begin);
    }}]});
  },biliTransport:async url=>{
    const video={bvid,aid:'1',title:'古画修复',desc:'虚构资料',duration:60,pages:[{cid:'100',page:1,part:'第一部分',duration:60}],owner:{mid:42,name:'Fixture'}};
    const listing=String(url).includes('popular');if(!listing)videoReads++;
    const bytes=Buffer.from(JSON.stringify({code:0,data:listing?{list:[video],no_more:true}:video}));return {status:200,headers:{'content-length':String(bytes.length)},body:(async function*(){yield bytes;})(),close(){}};
  }};
  let host=await ManagedHost.start(config,options);
  const tick=async()=>{await host.ctx.dafeiyuActivity.tick();await host.ctx.dafeiyu.whenIdle();await host.ctx.dafeiyuActivity.tick();};
  try{
    await tick();await tick();const activity=host.ctx.dafeiyuActivity;
    assert.equal(activity.store.admission.read('bilibili:'+bvid)?.state,'blocked');assert.equal(activity.store.recovery.list()[0]?.state,'blocked');
    const parent=activity.store.recovery.list()[0]!.parentRunId,gate=activity.store.admission.gate('idle.model')!;
    assert.equal(gate.reason,'MODEL_HTTP_402');const before=adapter.requests.length;
    for(let i=0;i<100;i++){now+=60000;await tick();}assert.equal(adapter.requests.length,before,'402 must not trigger periodic model calls');
    restored=true;
    const receipt=await host.management('activity','recovery.probe',{requestId:randomUUID(),expectedGeneration:gate.generation});assert.equal((receipt as {state:string}).state,'running');
    for(let i=0;i<200&&activity.store.recovery.probes()[0]?.state==='running';i++)await delay(5);
    assert.equal(activity.store.recovery.probes()[0]?.state,'succeeded');await tick();await tick();await host.ctx.dafeiyu.whenIdle();
    assert.equal(activity.store.admission.read('bilibili:'+bvid)?.state,'complete');assert.equal(videoReads,1,'resume reuses the original material instead of downloading it again');
    assert.equal(sawContinuation,true);assert.equal(sawSavedReading,true);assert.equal(delivered.length,1);
    const db=new DatabaseSync(join(root,'data/core/runtime.sqlite'),{readOnly:true});try{
      const runs=db.prepare("SELECT definition FROM runs WHERE json_extract(definition,'$.policyId')='activity-explore'").all().map(row=>JSON.parse(String(row.definition)));
      assert.equal(runs.length,2);assert.equal(runs[0].taskId,runs[1].taskId);assert.equal(runs[1].parentRunId,parent);
    }finally{db.close();}
    const usage=host.core.getStatus().modelUsage!;assert.equal(usage.calls,adapter.requests.length);assert.equal(usage.byPhase.recovery?.calls,1);assert.equal(usage.byWorkType.maintenance?.calls,1);
    assert.equal(usage.unassignedCalls,1,'the standalone health probe has no business Run and is explicitly categorized as maintenance');
    await host.close();host=await ManagedHost.start(config,options);now+=600000;await tick();assert.equal(delivered.length,1);
  }finally{await host.close();qqStore.close();}
});

