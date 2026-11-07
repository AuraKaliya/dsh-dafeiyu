import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {API_VERSION} from '@dafeiyu/contracts';
import {LlmError} from '@deepseek-ai/dsh-llm';
import type {Reply} from '@dafeiyu/contracts';
import {QqStore} from '@dafeiyu/qq';
import {QqSegmentedTransport} from '../packages/channel-qq/lib/transport.js';
import {FixtureAdapter,textResponse,toolResponse,verificationResponse} from './sdk-fixture.js';
import {testTempDir} from './test-temp.js';

test('autonomous text shares yield before dispatch and between segments, then resume once after restart',{timeout:30000},async t=>{
  const root=await mkdtemp(join(testTempDir(),'activity-share-interruption-'));process.env.DSH_HOME=join(root,'data/core/dsh-home');
  const {ManagedHost,loadHostConfig,initializeProfile}=await import('@dafeiyu/host');const file=join(root,'host.json'),delivered:Reply[]=[],bvid='BV1xNpFedEwH';let step=0,renderAttempts=0,foreground=true,beforeOnce=true,betweenOnce=true;
  const qqStore=new QqStore(join(root,'qq.sqlite'));
  const adapter=new FixtureAdapter(request=>{
    if(String(request.sessionId).startsWith('memory-expression-verify-'))return verificationResponse(request);
    if(String(request.sessionId).startsWith('dafeiyu-delivery-')){if(renderAttempts++===0)return (async function*(){throw new LlmError('fixture transient failure','TRANSPORT');})();return textResponse('{"qq_messages":[{"type":"text","text":"刚读到一条关于古画修复的视频资料。"},{"type":"text","text":"这轮还没有看画面。"}]}');}
    if(step++===0)return toolResponse('bili_video',{requestId:'video',bvid});
    if(step===2)return toolResponse('bili_reading_save',{requestId:'reading',bvid,status:'closed',conclusion:'资料介绍修复过程，未读画面。',gaps:['未读取画面'],nextStep:null});
    return textResponse('内部探索已结束，长篇反思不直接对外发送。');
  });
  await writeFile(join(root,'persona.md'),'本机隔离验收人格。');
  await writeFile(file,JSON.stringify({schemaVersion:1,profileId:'activity-sharing',agent:{id:'fish'},paths:{core:'./data/core',memory:'./data/memory',sessions:'./data/sessions',query:'./data/query.sqlite'},modelRoutes:{chat:{provider:'local-test',model:'scripted'}},persona:{fixedFile:'./persona.md',kind:'test'},plugins:[{id:'model-scripted',required:true},{id:'timeline',required:true,config:{execution:true}},{id:'memory-growth',required:true},{id:'media',required:true,config:{ffmpeg:process.execPath,ffprobe:process.execPath}},{id:'bilibili',required:true,config:{capabilities:{minIntervalMs:100}}}],authorityPolicies:[{id:'activity-explore',producers:['activity'],actions:['bili_video','bili_reading_save'],allowLocalWrite:true,resources:[{channel:'bilibili',account:'public',kind:'local',id:'public'}]}]}));
  const config=loadHostConfig(file),coordination=join(root,'coordination.sqlite');initializeProfile(config,coordination);
  const options:Parameters<typeof ManagedHost.start>[1]={coordination,adapter,signal:t.signal,installChannels:ctx=>{
    ctx.dafeiyu.bindActivitySharing(()=>({enabled:true,cooldownMs:60000}));ctx.dafeiyu.bindActivityPressure('foreground-fixture',()=>foreground?1:0);
    const transport=new QqSegmentedTransport({ledger:qqStore.delivery,confirmed:()=>{},beforeSend:async()=>{assert.ok(ctx.dafeiyu.activityPressure().foregroundRuns>0,'the actual interactive delivery lease must block a second autonomous render');if(beforeOnce){beforeOnce=false;throw new Error('DELIVERY_INTERRUPTED_BY_MESSAGE');}},betweenMessages:async()=>{if(betweenOnce){betweenOnce=false;throw new Error('DELIVERY_INTERRUPTED_BY_MESSAGE');}},check:async reply=>{
      assert.equal(reply.taskResult?.kind,'activity-result','the persisted transport snapshot must retain the autonomous result authority');
      ctx.dafeiyu.verifyActivityShareReply(reply);
    },send:async(reply,text)=>{delivered.push({...reply,text});return String(123456+delivered.length);}});
    ctx.dafeiyu.registerExtension({id:'fixture-qq',version:'1',protocolVersion:API_VERSION,agentId:'fish',ownerDirectory:{channelExtensionId:'fixture-qq',channel:'qq',account:'100001',ownerId:'200001',snapshot:()=>({revision:'1',available:true,resources:[{channel:'qq',account:'100001',kind:'private',id:'200001'}]})},channels:[{channel:'qq',account:'100001',deliveryProgress:id=>{const p=qqStore.delivery.progress(id);return p?{total:p.total,confirmed:p.confirmed,pending:p.pending,unknown:p.unknown,sending:p.segments.filter(s=>s.state==='sending').length,canResume:p.unknown===0&&p.pending>0&&p.segments.some(s=>s.code==='DELIVERY_INTERRUPTED_BY_MESSAGE')}:null;},deliver:async()=>assert.fail('native delivery must use its write window'),deliverTaskResult:async(reply,anchor,signal,authority,begin)=>{
      signal.throwIfAborted();authority();ctx.dafeiyu.verifyActivityShareReply(reply);assert.equal(anchor.kind,'activity-result');assert.equal(reply.sourceMessageId,'');
      return transport.deliver(reply,signal,authority,begin);
    }}]});
  },biliTransport:async()=>{const bytes=Buffer.from(JSON.stringify({code:0,data:{bvid,aid:'1',title:'古画修复',desc:'虚构资料',duration:60,pages:[{cid:'100',page:1,part:'第一部分',duration:60}],owner:{mid:42,name:'Fixture'}}}));return {status:200,headers:{'content-length':String(bytes.length)},body:(async function*(){yield bytes;})(),close(){}};}};
  let host=await ManagedHost.start(config,options);
  try{const producer=host.ctx.dafeiyu.executionProducer('activity',{motivation:{kind:'self-exploration',basis:['fixture-new-material']}}),accepted=producer.submitTask({requestId:'explore',title:'自己的阅读',goal:'读视频资料并保存阅读范围',policyId:'activity-explore'});
    await host.ctx.dafeiyu.whenIdle();assert.equal(producer.status(accepted.run).state,'completed');
    assert.ok(host.ctx.dafeiyu.requestActivityShare(accepted.run.id,'public-video:'+bvid));await host.core.whenIdle();
    assert.equal(renderAttempts,0,'owner foreground pressure defers all model rendering');assert.equal(delivered.length,0);
    foreground=false;host.core.requestActivityShare(accepted.run.id,'public-video:'+bvid);await host.core.whenIdle();
    assert.equal(host.core.messageTaskDeliveryStatus(accepted.run.id)?.state,'ready');assert.equal(delivered.length,0,'nothing was dispatched before the first interruption');
    const rendered=renderAttempts;host.core.requestActivityShare(accepted.run.id,'public-video:'+bvid);await host.core.whenIdle();
    assert.equal(host.core.messageTaskDeliveryStatus(accepted.run.id)?.state,'ready');assert.equal(delivered.length,1);assert.equal(renderAttempts,rendered,'a valid approved body is reused');
    await host.close();host=await ManagedHost.start(config,options);await host.core.whenIdle();
    assert.equal(host.core.messageTaskDeliveryStatus(accepted.run.id)?.state,'sent');assert.equal(delivered.length,2);assert.equal(new Set(delivered.map(r=>r.text)).size,2);
    assert.equal(renderAttempts,rendered,'restart resumes only unsent segments without another rendering request');
    const producerAgain=host.core.executionProducer('activity');assert.equal(producerAgain.status(producerAgain.restoreRun(accepted.run.id)).state,'completed');
    host.core.requestActivityShare(accepted.run.id,'public-video:'+bvid);await host.core.whenIdle();assert.equal(delivered.length,2);
    const usage=host.core.getStatus().modelUsage!;assert.equal(usage.calls,adapter.requests.length);assert.equal(usage.unassignedCalls,0);
    const db=new DatabaseSync(join(root,'data/core/journal.sqlite'),{readOnly:true});try{assert.equal(db.prepare('SELECT COUNT(*) n FROM inbox').get()!.n,0,'no artificial inbound was created');}finally{db.close();}
  }finally{await host.close();qqStore.close();}
});
