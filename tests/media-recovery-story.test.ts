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
import {FixtureAdapter,textResponse,toolResponse} from './sdk-fixture.js';
import {testTempDir} from './test-temp.js';
import {readBiliBrowser} from '../packages/plugin/lib/bili-browser.js';

test('a paused media exploration resumes only the missing frame, delivers its finding and stays deduplicated',{timeout:45000},async t=>{
  const root=await mkdtemp(join(testTempDir(),'media-recovery-story-'));process.env.DSH_HOME=join(root,'data/core/dsh-home');
  const {ManagedHost,loadHostConfig,initializeProfile}=await import('@dafeiyu/host');
  const file=join(root,'host.json'),bvid='BV1xNpFedEwH',delivered:Reply[]=[],qqStore=new QqStore(join(root,'qq.sqlite'));
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZ0AAAAASUVORK5CYII=','base64');
  let now=Date.now(),step=0,restored=false,videoReads=0,navigations=0,visionCalls=0,host:Awaited<ReturnType<typeof ManagedHost.start>>|undefined;
  let frameKeys:string[]=[],elapsed=0;const points:number[]=[];
  const adapter=new FixtureAdapter(async function*(request){
    const session=String(request.sessionId);
    if(session.startsWith('media-analysis-')){
      const user=request.messages.findLast(message=>message.role==='user')!,input=JSON.parse(user.content.filter(b=>b.type==='text').map(b=>b.text).join('')) as {images:{image:number;ptsMs:number}[]};
      visionCalls++;points.push(input.images[0]!.ptsMs);
      for(const image of request.messages.flatMap(message=>message.content.filter(b=>b.type==='image')))await host!.ctx.attachments.readImageRequest(image.attachment,{width:1,height:1,maxBytes:png.length},request.signal);
      if(visionCalls===2&&!restored)throw new LlmError('fixture vision unavailable','HTTP_ERROR',{status:402});
      yield* textResponse(JSON.stringify({schemaVersion:1,observations:input.images.map(image=>({image:image.image,description:'修复画面中的人工采样夹具',visibleText:[],uncertainties:[]})),gaps:[]}));return;
    }
    if(session.startsWith('memory-expression-verify-')){yield* textResponse('{"faithful":true,"issues":[]}');return;}
    if(session.startsWith('dafeiyu-delivery-')){yield* textResponse('{"qq_messages":[{"type":"text","text":"刚把缺少的第二个采样画面补读了，已有画面没有重读；这仍只是采样。"}]}');return;}
    const found=[...new Set(JSON.stringify(request.messages).match(/frame:[0-9a-f-]{36}/g)??[])];if(found.length>=2)frameKeys=found.slice(0,2);
    if(!restored){
      switch(step++){
        case 0:yield* toolResponse('bili_video',{requestId:'video',bvid});return;
        case 1:yield* toolResponse('bili_frames',{requestId:'frames',bvid,pointsMs:[1000,2000]});return;
        case 2:yield* toolResponse('dafeiyu_media_read',{requestId:'first-frame',mode:'images',sources:[{provider:'bilibili',key:frameKeys[0]}]});return;
        case 3:yield* toolResponse('bili_reading_save',{requestId:'first-reading',bvid,status:'checkpoint',conclusion:'已读第一张采样画面',gaps:['第二张画面未读'],nextStep:'只补第二张画面'});return;
        case 4:yield* toolResponse('dafeiyu_media_read',{requestId:'second-frame',mode:'images',sources:[{provider:'bilibili',key:frameKeys[1]}]});return;
        case 5:yield* toolResponse('dafeiyu_task_outcome',{next:'wait',reason:'第二张画面的视觉依赖需要恢复',requiredCapabilities:[]});return;
        default:yield* textResponse('保存第一张采样画面，等待视觉依赖恢复后只补第二张。');return;
      }
    }
    switch(step++){
      case 7:yield* toolResponse('bili_reading_get',{requestId:'resume-coverage',bvid});return;
      case 8:yield* toolResponse('dafeiyu_media_read',{requestId:'second-frame-after-recovery',mode:'images',sources:[{provider:'bilibili',key:frameKeys[1]}]});return;
      case 9:yield* toolResponse('bili_reading_save',{requestId:'finished-reading',bvid,status:'closed',conclusion:'两张采样画面已读取，第一张证据复用，第二张本次补齐。',gaps:['仍非完整观看'],nextStep:null});return;
      default:yield* textResponse('两张采样画面已经读取，保存了本次补齐的第二张画面；不代表看完整个视频。');
    }
  });
  await writeFile(join(root,'persona.md'),'本机隔离验收人格。');
  await writeFile(file,JSON.stringify({schemaVersion:1,profileId:'media-recovery-story',agent:{id:'fish'},paths:{core:'./data/core',memory:'./data/memory',sessions:'./data/sessions',query:'./data/query.sqlite'},modelRoutes:{chat:{provider:'local-test',model:'scripted'}},persona:{fixedFile:'./persona.md',kind:'test'},
    plugins:[{id:'model-scripted',required:true},{id:'timeline',required:true,config:{execution:true}},{id:'memory-growth',required:true},
      {id:'media',required:true,config:{ffmpeg:process.execPath,ffprobe:process.execPath,vision:{provider:'local-test',model:'vision'}}},
      {id:'activity',required:true,config:{idleAfterMs:0,tickMs:60000,explorationIntervalMs:60000,maintenance:false,plans:false,ownerSharing:{enabled:true,cooldownMs:60000}}},
      {id:'bilibili',required:true,config:{capabilities:{minIntervalMs:100,browser:{expectedUid:'42'}}}}],
    authorityPolicies:[{id:'activity-explore',producers:['activity'],actions:['bili_video','bili_frames','bili_reading_save','bili_reading_get','dafeiyu_media_read','dafeiyu_task_outcome','dafeiyu_activity_rest'],allowLocalWrite:true,resources:[{channel:'bilibili',account:'public',kind:'local',id:'public'}]}]}));
  const config=loadHostConfig(file),coordination=join(root,'coordination.sqlite');initializeProfile(config,coordination);
  const options:Parameters<typeof ManagedHost.start>[1]={coordination,adapter,signal:t.signal,activityClock:{now:()=>now,monotonic:()=>performance.now()},installChannels:ctx=>{
    ctx.dafeiyuMedia.decoder.inspect=async()=>({kind:'image',width:1,height:1,durationMs:null,startMs:0,videoCodec:'png',audioCodec:null,sampleRate:null,channels:null,format:'png_pipe',peakCommitBytes:0});
    ctx.dafeiyuMedia.decoder.image=async()=>({data:png,mime:'image/png',width:1,height:1,hasAlpha:true,requestedMs:null,ptsMs:null});
    const transport=new QqSegmentedTransport({ledger:qqStore.delivery,confirmed:()=>{},check:async reply=>ctx.dafeiyu.verifyActivityShareReply(reply),send:async reply=>{delivered.push(reply);return '123456';}});
    ctx.dafeiyu.registerExtension({id:'fixture-qq',version:'1',protocolVersion:API_VERSION,agentId:'fish',ownerDirectory:{channelExtensionId:'fixture-qq',channel:'qq',account:'100001',ownerId:'200001',snapshot:()=>({revision:'1',available:true,resources:[{channel:'qq',account:'100001',kind:'private',id:'200001'}]})},channels:[{channel:'qq',account:'100001',deliver:async()=>assert.fail('no artificial inbound'),deliverTaskResult:async(reply,anchor,signal,authority,begin)=>{assert.equal(anchor.kind,'activity-result');return transport.deliver(reply,signal,authority,begin);}}]});
  },biliTransport:async url=>{const video={bvid,aid:'1',title:'古画修复',desc:'人工夹具',duration:60,pages:[{cid:'100',page:1,part:'第一部分',duration:60}],owner:{mid:42,name:'Fixture'}},listing=String(url).includes('popular');if(!listing)videoReads++;
    const bytes=Buffer.from(JSON.stringify({code:0,data:listing?{list:[video],no_more:true}:video}));return {status:200,headers:{'content-length':String(bytes.length)},body:(async function*(){yield bytes;})(),close(){}};
  },biliBrowser:{read:request=>readBiliBrowser(request,'42',async(name,args)=>{const url=`https://www.bilibili.com/video/${bvid}/`;if(name==='dsh_browser_open'){navigations++;return {url};}
    const evaluated=(value:unknown)=>({ok:true,value:JSON.stringify(value)});if(String(args.script).includes('space.bilibili.com'))return evaluated({url,ids:['42']});
    const point=Number(/const target=(\d+)\/1000/.exec(String(args.script))?.[1]);return evaluated({url,title:'Fixture',text:'Frame',truncated:true,frame:{dataUrl:'data:image/jpeg;base64,/9j/2Q==',positionMs:point+40,durationMs:10000}});
  },t.signal,{now:()=>elapsed,wait:async ms=>{elapsed+=ms;}})}};
  host=await ManagedHost.start(config,options);const tick=async()=>{await host!.ctx.dafeiyuActivity.tick();await host!.ctx.dafeiyu.whenIdle();await host!.ctx.dafeiyuActivity.tick();};
  try{
    await tick();await tick();const activity=host.ctx.dafeiyuActivity,work=activity.store.recovery.list()[0];
    assert.equal(work?.state,'blocked');assert.match(work!.dependencyKey,/capability:/);assert.equal(visionCalls,2);assert.equal(delivered.length,0);
    const calls=adapter.requests.length;for(let i=0;i<100;i++){now+=60000;await tick();}assert.equal(adapter.requests.length,calls);
    restored=true;await host.management('media','recovery.arm',{key:work!.dependencyKey,expectedGeneration:work!.generation,requestId:randomUUID()});await tick();await tick();await host.core.whenIdle();
    assert.equal(activity.store.admission.read('bilibili:'+bvid)?.state,'complete');assert.equal(visionCalls,3);assert.deepEqual(points,[1040,2040,2040]);assert.equal(videoReads,1);assert.equal(navigations,1);assert.equal(delivered.length,1);
    const media=new DatabaseSync(join(root,'data/core/media.sqlite'),{readOnly:true});try{assert.equal(media.prepare('SELECT count(*) n FROM media_exposures').get()!.n,2);}finally{media.close();}
    const usage=host.core.getStatus().modelUsage!;assert.equal(usage.calls,adapter.requests.length);assert.equal(usage.byPhase.media?.calls,3);assert.equal(usage.unassignedCalls,0);
    await host.close();host=await ManagedHost.start(config,options);now+=600000;await tick();assert.equal(delivered.length,1);assert.equal(visionCalls,3);
  }finally{await host?.close();qqStore.close();}
});
