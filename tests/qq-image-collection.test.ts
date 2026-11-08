import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import type {DafeiyuService} from '@dafeiyu/core';
import type {ExecutionContext,ExecutionGrant,Extension,PersonaAccess,PersonaSourceRef,ResourceProof} from '@dafeiyu/contracts';
import {MediaSourceDescriptionSchema,MediaReadSchema,taskScopeKey} from '@dafeiyu/contracts';
import {MediaService} from '@dafeiyu/media';
import {FixtureAdapter,sdkFixture,textResponse} from './sdk-fixture.js';
import {testTempDir} from './test-temp.js';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZ0AAAAASUVORK5CYII=','base64');

test('QQ images from separate nodes use one vision call and each can be collected from that exposure without rereading',{timeout:30000},async()=>{
  const root=await mkdtemp(join(testTempDir(),'qq-image-collect-')),taskId=randomUUID(),scope={kind:'task' as const,agentId:'fish',taskId,scopeKey:taskScopeKey('fish',taskId)};
  const refs:PersonaSourceRef[]=[],extensions=new Map<string,Extension>(),revoked=new Set<string>();
  const adapter=new FixtureAdapter(async function*(request){for(const image of request.messages.flatMap(m=>m.content.filter(b=>b.type==='image')))await ctx.attachments.readImageRequest(image.attachment,{width:1,height:1,maxBytes:png.length},request.signal);const user=request.messages.findLast(m=>m.role==='user')!,input=JSON.parse(user.content.filter(b=>b.type==='text').map(b=>b.text).join(''));yield* textResponse(JSON.stringify({schemaVersion:1,observations:input.images.map((x:{image:number})=>({image:x.image,description:'fixture image '+x.image,visibleText:[],uncertainties:[]})),gaps:[]}));});
  const ctx=await sdkFixture(join(root,'sessions'),adapter),context:ExecutionContext={agentId:'fish',taskId,scope,runId:randomUUID(),operationId:randomUUID(),intentVersion:1,origin:{kind:'native',producerId:'fixture',requestId:'read'},grant:{} as ExecutionGrant,signal:new AbortController().signal};
  const access=(execution:ExecutionContext,producer:string):PersonaAccess=>({view:{runId:execution.runId,taskId,scope,origin:execution.origin,signal:execution.signal},producer,operationId:execution.operationId,startedEventId:randomUUID(),intentVersion:1,motivation:{kind:'explicit-task',basis:[]},inputs:[],admittedSources:[],historyTracked:true,validateHistory:dependencies=>dependencies.every(dep=>dep.kind==='execution-source'&&refs.some(ref=>ref.id===dep.ref.id&&ref.contentHash===dep.ref.contentHash)),historyDependencies:refs.map(ref=>({kind:'execution-source',agentId:'fish',route:scope.scopeKey,ref})),guard:()=>execution.signal.throwIfAborted()});
  ctx.provide('dafeiyu',{registerExtension:(e:Extension)=>{extensions.set(e.id,e);return {dispose(){extensions.delete(e.id);}};},bindMedia:()=>()=>{},capabilityResourceEpochWithout:()=>'',
    capabilityResourceCurrent:(p:ResourceProof)=>p.provider==='qq-media'?!revoked.has(p.key):extensions.get(p.provider)?.resourceProofs?.current(p)??false,
    mediaAccess:(execution:ExecutionContext,owner:string,origin:ResourceProof)=>({origin,execution:access(execution,owner),guard:()=>{execution.signal.throwIfAborted();if(revoked.has(origin.key))throw new Error('MEDIA_SOURCE_STALE');}}),
    recordCapabilityObservation:(_c:unknown,_owner:unknown,input:{text:string})=>{const source:PersonaSourceRef={kind:'execution-source',id:randomUUID(),agentId:'fish',scopeKey:scope.scopeKey,version:1,contentHash:createHash('sha256').update(input.text).digest('hex')};refs.push(source);return {source,duplicate:false};},journal:{appendExecutionOnce(){},appendOnce(){}}} as unknown as DafeiyuService);
  const sources=[0,1,2].map(i=>MediaSourceDescriptionSchema.parse({ref:{provider:'qq-media',key:'image-'+i},kind:'image',name:null,bytesHint:png.length+1,mimeHint:'image/png',durationMsHint:null,rangeReadable:false,publicContent:false,
    origin:{provider:'qq-media',scene:{channel:'qq',account:'100001',kind:'private',id:'200001'},key:'origin-'+i,version:1,hash:String(i+1).repeat(64),roots:['qq:100001:private:200001:message:wrapper'],detail:{messageId:'wrapper',sender:'200001',position:i}}}));
  const media=new MediaService(ctx,{agentId:'fish',profileId:'fixture',dataDir:join(root,'media'),createStore:true,ffmpeg:process.execPath,ffprobe:process.execPath,vision:{provider:'fixture',model:'fixture'}},{decoder:{inspect:async()=>({kind:'image',width:1,height:1,durationMs:null,startMs:0,videoCodec:'png',audioCodec:null,sampleRate:null,channels:null,format:'png_pipe',peakCommitBytes:0}),image:async()=>({data:png,mime:'image/png',width:1,height:1,hasAlpha:true,requestedMs:null,ptsMs:null}),audio:async()=>{throw new Error('NOT_AUDIO');}}});
  const remove=media.registerProvider({id:'qq-media',describe:key=>sources.find(s=>s.ref.key===key&&!revoked.has(s.origin.key))??null,open:async key=>{const i=sources.findIndex(s=>s.ref.key===key),bytes=Buffer.concat([png,Buffer.from([i])]);return {bytes:bytes.length,mime:'image/png',stream:(async function*(){yield bytes;})()};}});
  await media.recover();media.activate();
  try{
    const result=z.object({exposureId:z.string()}).parse(await media.read(context,'media',MediaReadSchema.parse({requestId:'batch',mode:'images',sources:sources.map(s=>s.ref)})));
    assert.equal(adapter.requests.length,1);await assert.rejects(media.imageOriginal(context,'qq-stickers',result.exposureId),/IMAGE_INDEX_REQUIRED/);
    for(let i=0;i<3;i++){const original=await media.imageOriginal(context,'qq-stickers',result.exposureId,i);assert.equal(original.source.ref.key,'image-'+i);assert.deepEqual(original.data,Buffer.concat([png,Buffer.from([i])]));}
    assert.equal(adapter.requests.length,1,'collection must not invoke vision again');
    const single=z.object({exposureId:z.string()}).parse(await media.read(context,'media',MediaReadSchema.parse({requestId:'single-array',mode:'images',sources:[sources[0]!.ref]})));
    assert.equal((await media.imageOriginal(context,'qq-stickers',single.exposureId)).source.ref.key,'image-0');assert.equal(adapter.requests.length,2,'a singleton images exposure is directly collectible without a second single-image analysis');
    revoked.add('origin-2');await assert.rejects(media.imageOriginal(context,'qq-stickers',result.exposureId,0),/SOURCE_STALE/);
  }finally{remove();await media.close();await ctx.fiber.dispose();}
});
