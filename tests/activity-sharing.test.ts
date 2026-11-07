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

test('an autonomous result uses verified native delivery without inventing an inbound and does not resend after restart',{timeout:30000},async t=>{
  const root=await mkdtemp(join(testTempDir(),'activity-sharing-'));process.env.DSH_HOME=join(root,'data/core/dsh-home');
  const {ManagedHost,loadHostConfig,initializeProfile}=await import('@dafeiyu/host');const file=join(root,'host.json'),delivered:Reply[]=[],bvid='BV1xNpFedEwH';let step=0,renderAttempts=0;
  const qqStore=new QqStore(join(root,'qq.sqlite'));
  const adapter=new FixtureAdapter(request=>{
    if(String(request.sessionId).startsWith('memory-expression-verify-'))return verificationResponse(request);
    if(String(request.sessionId).startsWith('dafeiyu-delivery-')){if(renderAttempts++===0)return (async function*(){throw new LlmError('fixture transient failure','TRANSPORT');})();return textResponse('{"qq_messages":[{"type":"text","text":"刚读到一条关于古画修复的视频资料，这轮还没有看画面。"}]}');}
    if(step++===0)return toolResponse('bili_video',{requestId:'video',bvid});
    if(step===2)return toolResponse('bili_reading_save',{requestId:'reading',bvid,status:'closed',conclusion:'资料介绍修复过程，未读画面。',gaps:['未读取画面'],nextStep:null});
    return textResponse('内部探索已结束，长篇反思不直接对外发送。');
  });
  await writeFile(join(root,'persona.md'),'本机隔离验收人格。');
  await writeFile(file,JSON.stringify({schemaVersion:1,profileId:'activity-sharing',agent:{id:'fish'},paths:{core:'./data/core',memory:'./data/memory',sessions:'./data/sessions',query:'./data/query.sqlite'},modelRoutes:{chat:{provider:'local-test',model:'scripted'}},persona:{fixedFile:'./persona.md',kind:'test'},plugins:[{id:'model-scripted',required:true},{id:'timeline',required:true,config:{execution:true}},{id:'memory-growth',required:true},{id:'media',required:true,config:{ffmpeg:process.execPath,ffprobe:process.execPath}},{id:'bilibili',required:true,config:{capabilities:{minIntervalMs:100}}}],authorityPolicies:[{id:'activity-explore',producers:['activity'],actions:['bili_video','bili_reading_save'],allowLocalWrite:true,resources:[{channel:'bilibili',account:'public',kind:'local',id:'public'}]}]}));
  const config=loadHostConfig(file),coordination=join(root,'coordination.sqlite');initializeProfile(config,coordination);
  const options:Parameters<typeof ManagedHost.start>[1]={coordination,adapter,signal:t.signal,installChannels:ctx=>{
    ctx.dafeiyu.bindActivitySharing(()=>({enabled:true,cooldownMs:60000}));
    const transport=new QqSegmentedTransport({ledger:qqStore.delivery,confirmed:()=>{},check:async reply=>{
      assert.equal(reply.taskResult?.kind,'activity-result','the persisted transport snapshot must retain the autonomous result authority');
      ctx.dafeiyu.verifyActivityShareReply(reply);
    },send:async reply=>{delivered.push(reply);return '123456';}});
    ctx.dafeiyu.registerExtension({id:'fixture-qq',version:'1',protocolVersion:API_VERSION,agentId:'fish',ownerDirectory:{channelExtensionId:'fixture-qq',channel:'qq',account:'100001',ownerId:'200001',snapshot:()=>({revision:'1',available:true,resources:[{channel:'qq',account:'100001',kind:'private',id:'200001'}]})},channels:[{channel:'qq',account:'100001',deliver:async()=>assert.fail('native delivery must use its write window'),deliverTaskResult:async(reply,anchor,signal,authority,begin)=>{
      signal.throwIfAborted();authority();ctx.dafeiyu.verifyActivityShareReply(reply);assert.equal(anchor.kind,'activity-result');assert.equal(reply.sourceMessageId,'');
      return transport.deliver(reply,signal,authority,begin);
    }}]});
  },biliTransport:async()=>{const bytes=Buffer.from(JSON.stringify({code:0,data:{bvid,aid:'1',title:'古画修复',desc:'虚构资料',duration:60,pages:[{cid:'100',page:1,part:'第一部分',duration:60}],owner:{mid:42,name:'Fixture'}}}));return {status:200,headers:{'content-length':String(bytes.length)},body:(async function*(){yield bytes;})(),close(){}};}};
  let host=await ManagedHost.start(config,options);
  try{const producer=host.ctx.dafeiyu.executionProducer('activity',{motivation:{kind:'self-exploration',basis:['fixture-new-material']}}),accepted=producer.submitTask({requestId:'explore',title:'自己的阅读',goal:'读视频资料并保存阅读范围',policyId:'activity-explore'});
    await host.ctx.dafeiyu.whenIdle();assert.equal(producer.status(accepted.run).state,'completed');
    assert.ok(host.ctx.dafeiyu.requestActivityShare(accepted.run.id,'public-video:'+bvid));await host.ctx.dafeiyu.whenIdle();
    assert.equal(delivered.length,1);assert.match(delivered[0]!.text,/没有看画面/);assert.doesNotMatch(delivered[0]!.text,/内部探索/);
    assert.equal(renderAttempts,2,'a transient pre-send model failure retries without replaying platform writes');
    const usage=host.ctx.dafeiyu.getStatus().modelUsage!;assert.equal(usage.calls,adapter.requests.length,'all actual task, rendering and verification requests must be counted');
    assert.ok(usage.byPhase.rendering?.calls);assert.ok(usage.byPhase.verification?.calls);assert.equal(usage.unassignedCalls,0);assert.equal(usage.unknownCalls,usage.calls,'fixture omits provider usage; it must not become zero usage');
    host.ctx.dafeiyu.requestActivityShare(accepted.run.id,'public-video:'+bvid);await host.ctx.dafeiyu.whenIdle();assert.equal(delivered.length,1);
    await host.close();host=await ManagedHost.start(config,options);await host.ctx.dafeiyu.whenIdle();assert.equal(delivered.length,1);
    const db=new DatabaseSync(join(root,'data/core/journal.sqlite'),{readOnly:true});try{assert.equal(db.prepare('SELECT COUNT(*) n FROM inbox').get()!.n,0,'no artificial inbound was created');}finally{db.close();}
  }finally{await host.close();qqStore.close();}
});
