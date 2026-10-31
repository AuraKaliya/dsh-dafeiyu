import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { Context } from '@deepseek-ai/cordis';
import type { DafeiyuService } from '@dafeiyu/core';
import type { ExecutionContext,ExecutionGrant,Extension,PersonaAccess,PersonaSourceRef,ResourceProof } from '@dafeiyu/contracts';
import { taskScopeKey,MediaReadSchema } from '@dafeiyu/contracts';
import { BiliService } from '@dafeiyu/bilibili';
import { MediaService } from '@dafeiyu/media';
import { readBiliBrowser } from '../packages/plugin/lib/bili-browser.js';
import { FixtureAdapter,sdkFixture,textResponse } from './sdk-fixture.js';
import { testTempDir } from './test-temp.js';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZ0AAAAASUVORK5CYII=','base64');
const bvid='BV1xNpFedEwH';
async function fixture(cancelVision=false){
  const root=await mkdtemp(join(testTempDir(),'bili-media-service-')),controller=new AbortController();
  let ctx:Context,modelImages=0,navigations=0,elapsed=0;
  const adapter=new FixtureAdapter(async function*(request){
    const images=request.messages.flatMap(message=>message.content.filter(block=>block.type==='image'));
    modelImages+=images.length;
    for(const image of images)await ctx.attachments.readImageRequest(image.attachment,{width:1,height:1,maxBytes:png.length},request.signal);
    if(cancelVision){controller.abort();request.signal?.throwIfAborted();}
    const user=request.messages.findLast(message=>message.role==='user')!;
    const input=JSON.parse(user.content.filter(block=>block.type==='text').map(block=>block.text).join('')) as {images:{image:number;requestedMs:number;ptsMs:number}[]};
    assert.deepEqual(input.images.map(image=>image.requestedMs),[1000,2000,3000]);
    assert.deepEqual(input.images.map(image=>image.ptsMs),[1040,2040,3040]);
    yield* textResponse(JSON.stringify({schemaVersion:1,observations:input.images.map(image=>({image:image.image,description:'Visible fixture frame',visibleText:[],uncertainties:[]})),gaps:[]}));
  });
  ctx=await sdkFixture(join(root,'host-sessions'),adapter);
  const extensions=new Map<string,Extension>(),observations=new Map<string,PersonaSourceRef>();
  const taskId=randomUUID(),scope={kind:'task' as const,agentId:'fish',taskId,scopeKey:taskScopeKey('fish',taskId)};
  const context:ExecutionContext={agentId:'fish',taskId,scope,runId:randomUUID(),operationId:randomUUID(),intentVersion:1,
    origin:{kind:'native',producerId:'fixture',requestId:'read'},grant:{} as ExecutionGrant,signal:controller.signal};
  const access=(execution:ExecutionContext,producer:string):PersonaAccess=>({view:{runId:execution.runId,taskId,scope,origin:execution.origin,signal:execution.signal},
    producer,operationId:execution.operationId,startedEventId:randomUUID(),intentVersion:1,motivation:{kind:'explicit-task',basis:[]},inputs:[],admittedSources:[],
    historyTracked:true,historyDependencies:[],guard:()=>execution.signal.throwIfAborted()});
  let media:MediaService;
  const core={registerExtension:(extension:Extension)=>{extensions.set(extension.id,extension);return {dispose(){extensions.delete(extension.id);}};},
    bindMedia:()=>()=>{},registerMediaProvider:(provider:Parameters<MediaService['registerProvider']>[0])=>media.registerProvider(provider),
    capabilityManifest:()=>({features:['media.assets.v1']}),capabilityResourceEpochWithout:()=>'',
    authorizeCapabilityResource:()=>({channel:'bilibili',account:'public',kind:'local',id:'public'}),
    capabilityResourceCurrent:(proof:ResourceProof)=>extensions.get(proof.provider)?.resourceProofs?.current(proof)??false,
    personaAccess:access,mediaAccess:(execution:ExecutionContext,owner:string,origin:ResourceProof)=>({origin,execution:access(execution,owner),guard:()=>execution.signal.throwIfAborted()}),
    recordCapabilityObservation:(execution:ExecutionContext,owner:string,input:{requestId:string;text:string})=>{
      const key=owner+':'+input.requestId;let source=observations.get(key);if(!source){source={kind:'execution-source',id:randomUUID(),agentId:'fish',scopeKey:scope.scopeKey,version:1,contentHash:createHash('sha256').update(input.text).digest('hex')};observations.set(key,source);}return {source,duplicate:false};
    },journal:{appendExecutionOnce(){},appendOnce(){}}};
  ctx.provide('dafeiyu',core as unknown as DafeiyuService);
  media=new MediaService(ctx,{agentId:'fish',profileId:'fixture',dataDir:join(root,'media'),createStore:true,ffmpeg:process.execPath,ffprobe:process.execPath,
    vision:{provider:'fixture',model:'fixture'}},{decoder:{
      inspect:async()=>({kind:'image',width:1,height:1,durationMs:null,startMs:0,videoCodec:'png',audioCodec:null,sampleRate:null,channels:null,format:'png_pipe',peakCommitBytes:0}),
      image:async()=>({data:png,mime:'image/png',width:1,height:1,hasAlpha:true,requestedMs:null,ptsMs:null}),
      audio:async()=>{throw new Error('NOT_AUDIO');}}});
  const calls=new Map<number,number>(),url=`https://www.bilibili.com/video/${bvid}/`;
  const bili=new BiliService(ctx,{agentId:'fish',profileId:'fixture',dataDir:join(root,'bili'),createStore:true,settings:{browser:{expectedUid:'42'},minIntervalMs:100}},
    async url=>{
      if(url.pathname!=='/x/v2/reply')throw new Error('NETWORK_FORBIDDEN');
      const page=Number(url.searchParams.get('pn')),ids=page===1?['1','2']:['2','3'];
      const bytes=Buffer.from(JSON.stringify({code:0,data:{page:{count:3},replies:ids.map(id=>({rpid:id,parent:0,root:0,member:{uname:'Fixture'},content:{message:'Comment '+id},like:1,rcount:0}))}}));
      return {status:200,headers:{'content-length':String(bytes.length)},body:(async function*(){yield bytes;})(),close(){}};
    },{read:request=>readBiliBrowser(request,'42',async(name,args)=>{
      const target=request.section==='search'?`https://search.bilibili.com/all?keyword=${encodeURIComponent(request.keyword!)}&order=${request.order??'totalrank'}&page=${request.page??1}`:url;
      if(name==='dsh_browser_open'){navigations++;return {url:target};}
      const evaluated=(value:unknown)=>({ok:true,value:JSON.stringify(value)});
      if(String(args.script).includes('space.bilibili.com'))return evaluated({url:target,ids:['42']});
      if(request.section==='search')return evaluated({title:'搜索结果',text:'一条结果',truncated:false,items:[{bvid,title:'养鱼视频',author:'Fixture'}]});
      if(request.section==='video')return evaluated({title:'养鱼视频',text:'浏览器简介',truncated:false});
      const point=Number(/const target=(\d+)\/1000/.exec(String(args.script))?.[1]),count=(calls.get(point)??0)+1;calls.set(point,count);
      if(count===1)return evaluated(null);
      return evaluated({url,title:'Fixture',text:'Frame',truncated:true,frame:{dataUrl:'data:image/jpeg;base64,/9j/2Q==',positionMs:point+40,durationMs:10000}});
    },controller.signal,{now:()=>elapsed,wait:async ms=>{elapsed+=ms;}})});
  await media.recover();media.activate();bili.recover();bili.activate();
  return {root,context,media,bili,adapter,extensions,controller,stats:()=>({modelImages,navigations}),close:async()=>{await bili.close();await media.close();await ctx.fiber.dispose();}};
}

test('real browser adapter, Bili service and media service expose three frame sources in one vision call',async()=>{
  const f=await fixture();try{
    const action=f.extensions.get('bilibili')!.actions!.find(action=>action.id==='bili_frames')!;
    const result=await action.execute({requestId:'frames-1',bvid,pointsMs:[1000,2000,3000]},f.context);
    assert.equal(result.status,'succeeded',result.errorCode);
    const points=z.object({points:z.array(z.object({sourceKey:z.string(),ok:z.boolean()}))}).parse(z.object({page:z.object({data:z.unknown()})}).parse(result.data).page.data).points;
    const sources=points.map(point=>({provider:'bilibili',key:point.sourceKey}));
    const input=MediaReadSchema.parse({requestId:'vision-1',mode:'images',sources});
    const observed=z.object({text:z.string(),coverage:z.object({processed:z.array(z.object({start:z.number()}))})}).parse(await f.media.read({...f.context,operationId:randomUUID()},'media',input));
    assert.deepEqual(observed.coverage.processed.map(point=>point.start),[1040,2040,3040]);
    assert.match(observed.text,/requestedMs/);assert.equal(f.adapter.requests.length,1);assert.deepEqual(f.stats(),{modelImages:3,navigations:1});
    await f.media.read({...f.context,operationId:randomUUID()},'media',input);assert.equal(f.adapter.requests.length,1,'same request must reuse its exposure');
    const repeated=await action.execute({requestId:'frames-again',bvid,pointsMs:[1000,2000,3000]},f.context);
    assert.equal(z.object({cacheHit:z.boolean()}).parse(repeated.data).cacheHit,true);assert.equal(f.stats().navigations,1);
    await f.media.read({...f.context,operationId:randomUUID()},'media',MediaReadSchema.parse({...input,requestId:'vision-again'}));
    assert.equal(f.adapter.requests.length,1,'a new request for the same frame set must reuse verified analysis');
  }finally{await f.close();}
});

test('cancellation during a real media analysis loop releases all image leases',async()=>{
  const f=await fixture(true);try{
    const action=f.extensions.get('bilibili')!.actions!.find(action=>action.id==='bili_frames')!;
    const result=await action.execute({requestId:'frames-1',bvid,pointsMs:[1000,2000,3000]},f.context);
    const points=z.object({points:z.array(z.object({sourceKey:z.string()}))}).parse(z.object({page:z.object({data:z.unknown()})}).parse(result.data).page.data).points;
    await assert.rejects(f.media.read({...f.context,operationId:randomUUID()},'media',MediaReadSchema.parse({requestId:'cancel-vision',mode:'images',sources:points.map(point=>({provider:'bilibili',key:point.sourceKey}))})),/CANCEL|abort/i);
    const db=new DatabaseSync(join(f.root,'media/media.sqlite'),{readOnly:true});try{assert.equal(db.prepare('SELECT count(*) n FROM media_leases WHERE released=0').get()!.n,0);}finally{db.close();}
  }finally{await f.close();}
});

test('comment cursors round-trip through the service without echoing the deduplication set',async()=>{
  const f=await fixture();try{
    const action=f.extensions.get('bilibili')!.actions!.find(action=>action.id==='bili_comments')!;
    const first=await action.execute({requestId:'comments-1',aid:'123',limit:2},f.context);assert.equal(first.status,'succeeded',first.errorCode);
    const unpack=(value:unknown)=>z.object({page:z.object({data:z.object({items:z.array(z.object({id:z.string(),rootId:z.string().nullable()})),cursor:z.object({seen:z.array(z.string())}),nextCursor:z.string().nullable()})})}).parse(value).page.data;
    const page=unpack(first.data);assert.ok(page.nextCursor);assert.deepEqual(page.cursor.seen,[]);assert.equal(page.items[0]!.rootId,null);
    const second=await action.execute({requestId:'comments-2',cursor:page.nextCursor,limit:2},f.context);assert.equal(second.status,'succeeded',second.errorCode);
    assert.deepEqual(unpack(second.data).items.map(item=>item.id),['3']);assert.equal(unpack(second.data).nextCursor,null);
    const other=randomUUID(),foreign={...f.context,taskId:other,scope:{...f.context.scope,kind:'task' as const,taskId:other,scopeKey:taskScopeKey('fish',other)}};
    const denied=await action.execute({requestId:'comments-other',cursor:page.nextCursor,limit:2},foreign);assert.equal(denied.errorCode,'BILI_CURSOR_UNAVAILABLE');
  }finally{await f.close();}
});

test('the service search fallback passes client binding and browser metadata can become a reading record',async()=>{
  const f=await fixture();try{
    // An endpoint-scoped anonymous pause makes the HTTP read raise BILI_DIAGNOSTIC_REQUIRED,
    // and the service still falls back once to the configured browser channel.
    const diagnostics=f.bili.store.diagnostics,policy={rateDelaysMs:[10000,30000,60000],riskDelayMs:30000};
    diagnostics.failure('search','risk',Date.now(),policy,null,'anonymous-http',null);
    diagnostics.failure('search','risk',Date.now(),policy,null,'anonymous-http',null);
    assert.equal(diagnostics.summary.held,true);
    const actions=f.extensions.get('bilibili')!.actions!,search=actions.find(action=>action.id==='bili_search')!,video=actions.find(action=>action.id==='bili_video')!;
    const result=await search.execute({requestId:'search-1',keyword:'养鱼'},f.context);assert.equal(result.status,'succeeded',result.errorCode);
    const boundary=await search.execute({requestId:'search-50',keyword:'养鱼',page:50,limit:1},f.context);
    assert.equal(boundary.status,'succeeded',boundary.errorCode);
    const last=z.object({page:z.object({data:z.object({nextPage:z.null(),nextPageReason:z.literal('local-page-limit')})})}).parse(boundary.data);
    assert.equal(last.page.data.nextPage,null);
    assert.equal(z.object({page:z.object({data:z.object({items:z.array(z.object({bvid:z.string()}))})})}).parse(result.data).page.data.items[0]!.bvid,bvid);
    const info=await video.execute({requestId:'video-1',bvid},f.context);assert.equal(info.status,'succeeded',info.errorCode);
    const saved=await actions.find(action=>action.id==='bili_reading_save')!.execute({requestId:'reading-1',bvid,status:'closed',conclusion:'只读到简介',gaps:['未观看画面']},f.context);
    assert.equal(saved.status,'succeeded',saved.errorCode);assert.equal(f.bili.store.reading(f.context,bvid)?.title,'养鱼视频');
  }finally{await f.close();}
});

test('five hundred seen comment ids remain in storage instead of growing the tool result',async()=>{
  const f=await fixture();try{
    const cursor=f.bili.store.saveCommentCursor(f.context,{aid:'123',page:1,seen:Array.from({length:500},(_,i)=>String(i+1))});
    const action=f.extensions.get('bilibili')!.actions!.find(action=>action.id==='bili_comments')!;
    const result=await action.execute({requestId:'bounded-comments',cursor,limit:2},f.context);
    assert.equal(result.status,'succeeded',result.errorCode);assert.ok(Buffer.byteLength(JSON.stringify(result))<3000);
  }finally{await f.close();}
});

test('subtitle material reuse is bounded, isolated from caller mutation and does not retain empty files',async()=>{
  const f=await fixture();try{
    let downloads=0;const signal=f.controller.signal,guard=()=>signal.throwIfAborted();
    const read=async()=>{downloads++;return {body:[{from:0,to:1,content:'字幕'}]};};
    const first=await f.bili.client.material('subtitle-track',60000,read,signal,guard) as {body:{content:string}[]};
    first.body[0]!.content='changed';
    const second=await f.bili.client.material('subtitle-track',60000,read,signal,guard) as {body:{content:string}[]};
    assert.equal(downloads,1);assert.equal(second.body[0]!.content,'字幕');
    for(let i=0;i<2;i++)await f.bili.client.material('empty',60000,async()=>{downloads++;return [];},signal,guard,()=>false);
    assert.equal(downloads,3);
    for(let i=0;i<40;i++)await f.bili.client.material('track-'+i,60000,read,signal,guard);
    assert.ok(f.bili.client.cacheStats.entries<=32);assert.ok(f.bili.client.cacheStats.bytes<=16*1024**2);
  }finally{await f.close();}
});
