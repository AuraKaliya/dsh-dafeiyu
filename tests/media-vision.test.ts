import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions,StreamChunk,LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm';
import type { Context } from '@deepseek-ai/cordis';
import type { MediaSourceDescription } from '@dafeiyu/contracts';
import * as Media from '@dafeiyu/media';
import { ScopedImages } from '../packages/media/lib/images.js';
import { executionHarness } from './execution-fixture.js';
import { createImageFixture } from './phase1-image-fixture.js';
import { testTempDir } from './test-temp.js';
import { call,textReply } from './harness.js';

const tools={ffmpeg:process.env.DAFEIYU_TEST_FFMPEG??'D:/ffmpeg/ffmpeg-8.1-essentials_build/bin/ffmpeg.exe',ffprobe:process.env.DAFEIYU_TEST_FFPROBE??'D:/ffmpeg/ffmpeg-8.1-essentials_build/bin/ffprobe.exe'};
const result={schemaVersion:1,observations:[{image:0,description:'模拟视觉后端的形状观察，不能用于真实准确率结论。',visibleText:[],uncertainties:['这是脚本模型']}],gaps:[]};
async function fixture(options:{modality?:boolean;readBytes?:boolean;revoke?:boolean;select?:boolean}={}){
  const root=await mkdtemp(join(testTempDir(),'media-vision-')),dataDir=join(root,'core'),image=createImageFixture(37);let valid=true,opens=0,reads=0,step=0,modelCalls=0;
  const description:MediaSourceDescription={ref:{provider:'fixture',key:'image'},origin:{provider:'fixture',scene:{channel:'fixture',account:'local',kind:'local',id:'picture'},key:'image',version:1,hash:'a'.repeat(64),roots:['fixture:picture'],detail:{}},kind:'image',name:'input.bin',mimeHint:'image/png',bytesHint:image.data.length,durationMsHint:null,rangeReadable:false,publicContent:false};
  let ctx:Context;
  class Vision extends LlmAdapter {
    override async resolveModel(provider:string,id:string):Promise<LlmResolvedModelInfo>{return {provider,id,name:id,systemPromptUpdate:'in-history',toolUpdate:'in-history',inputModalities:options.modality===false?['text']:['text','image']};}
    override async *stream(request:GenerateOptions):AsyncIterable<StreamChunk>{modelCalls++;assert.equal(request.tools?.length??0,0);assert.ok(!JSON.stringify(request).includes('UNRELATED_PERSONA_SENTINEL'));
      const images=request.messages.flatMap(m=>m.content.filter(b=>b.type==='image'));assert.equal(images.length,1);
      if(options.readBytes!==false)for(const block of images){assert.equal(block.offloaded,undefined);const actual=await ctx.attachments.readImageRequest(block.attachment,{width:1024,height:1024,maxBytes:16*1024**2},request.signal);
        assert.equal(Buffer.from(actual.data).subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(actual.width,480);reads++;}
      if(options.revoke)valid=false;
      yield {type:'block-start',index:5,blockType:'reasoning'};yield {type:'reasoning-delta',index:5,text:'PRIVATE_MEDIA_REASONING'};yield {type:'block-end',index:5,block:{type:'reasoning',text:'PRIVATE_MEDIA_REASONING'}};
      for(const chunk of textReply(JSON.stringify(result)))if(chunk.type!=='finish')yield chunk;
      yield {type:'finish',reason:{kind:'stop'},replayState:{response:'PRIVATE_MEDIA_REPLAY'}};
    }
  }
  const h=await executionHarness(root,()=>{
    step++;if(step===1)return call('dafeiyu_media_read',{requestId:'read',source:description.ref,mode:'image'});
    if(options.select&&step===2){const db=new DatabaseSync(join(dataDir,'media.sqlite'),{readOnly:true}),memory=new DatabaseSync(join(root,'memory/memory.sqlite'),{readOnly:true});
      try{const row=db.prepare('SELECT id FROM media_exposures').get(),observed=memory.prepare("SELECT id FROM capability_observations WHERE producer='media'").get();assert.ok(row);assert.ok(observed);
        return call('dafeiyu_media_select',{requestId:'save',exposureId:String(row.id),observationId:String(observed.id),version:1,mode:'original',reason:'保留脚本样本的来源与局限'});
      }finally{db.close();memory.close();}}
    return textReply('处理完成，真实模型质量未验收');
  },{id:'fixture',version:'1',resourceProofs:{current:proof=>valid&&proof.hash===description.origin.hash,epoch:()=>String(valid)}},true,{extraActions:[...Media.MEDIA_ACTIONS],resources:[description.origin.scene],beforeActivate:async context=>{
    ctx=context;ctx.llm.registerAdapter(['media-fixture'],new Vision());ctx.systemPrompt.section({name:'other-persona',order:0,text:'UNRELATED_PERSONA_SENTINEL'});
    await ctx.plugin(Media,{agentId:'dafeiyu',profileId:'test',dataDir,createStore:true,...tools,vision:{provider:'media-fixture',model:'scripted'}});
    ctx.dafeiyu.registerMediaProvider({id:'fixture',describe:key=>key==='image'?description:null,open:async()=>{opens++;return {bytes:image.data.length,mime:'image/png',stream:(async function*(){yield image.data;})()};}});
    await ctx.dafeiyuMedia.recover();ctx.dafeiyuMedia.activate();
  }});
  const counts=()=>{const db=new DatabaseSync(join(dataDir,'media.sqlite'),{readOnly:true});try{return {exposures:Number(db.prepare('SELECT count(*) AS n FROM media_exposures').get()?.n),completed:Number(db.prepare("SELECT count(*) AS n FROM media_jobs WHERE state='completed'").get()?.n)};}finally{db.close();}};
  const errors=()=>{const db=new DatabaseSync(join(dataDir,'media.sqlite'),{readOnly:true});try{return db.prepare('SELECT error FROM media_jobs WHERE error IS NOT NULL').all().map(r=>String(r.error));}finally{db.close();}};
  return {...h,root,dataDir,description,counts,errors,activity:()=>({opens,reads,modelCalls}),revoke:()=>{valid=false;},close:async()=>{await h.ctx.dafeiyuMedia.close();await h.close();}};
}
async function logs(root:string):Promise<string>{let text='';for(const entry of await readdir(root,{withFileTypes:true})){const path=join(root,entry.name);if(entry.isDirectory())text+=await logs(path);else text+=await readFile(path,'utf8');}return text;}

test('actual decoded bytes enter isolated DSH vision, produce bounded inference and can be explicitly selected',async()=>{
  const h=await fixture({select:true});try{const accepted=h.port.submitTask({requestId:'image',title:'虚构图片',goal:'按需查看图片再选择保存',policyId:'test-policy'});await h.core.whenIdle();
    const status=h.port.status(accepted.run);assert.equal(status.state,'completed');assert.ok(status.operations.every(o=>o.status==='succeeded'),JSON.stringify(status.operations));assert.equal(status.operations.length,2);
    assert.deepEqual(h.activity(),{opens:1,reads:1,modelCalls:1});assert.deepEqual(h.counts(),{exposures:1,completed:1});
    const text=await logs(join(h.dataDir,'media-analysis'));assert.ok(!text.includes('PRIVATE_MEDIA_REASONING'));assert.ok(!text.includes('PRIVATE_MEDIA_REPLAY'));assert.ok(text.includes('"type":"image"'));
    const db=new DatabaseSync(join(h.root,'memory/memory.sqlite'),{readOnly:true});try{const row=db.prepare('SELECT body FROM memory_revisions ORDER BY rowid DESC LIMIT 1').get();assert.ok(row);assert.match(String(row.body),/视觉模型推断/);}finally{db.close();}
    const media=new DatabaseSync(join(h.dataDir,'media.sqlite'),{readOnly:true});let proof;try{const body=JSON.parse(String(media.prepare('SELECT body FROM media_exposures').get()?.body));proof=h.ctx.dafeiyuMedia.store.exposureProof(body);}finally{media.close();}
    assert.equal(h.core.capabilityResourceCurrent(proof),true);const epoch=h.core.capabilityResourceEpoch();h.revoke();assert.notEqual(h.core.capabilityResourceEpoch(),epoch);assert.equal(h.core.capabilityResourceCurrent(proof),false);
  }finally{await h.close();}
});

for(const [name,options,expected] of [
  ['no image-capable route',{modality:false},'MEDIA_IMAGE_MODEL_UNAVAILABLE'],
  ['no actual attachment read',{readBytes:false},'MEDIA_IMAGE_NOT_EXPOSED'],
  ['source revoked during model request',{revoke:true},'MEDIA_SOURCE_STALE'],
] as const)test(`${name} cannot become an observed image`,async()=>{
  const h=await fixture(options);try{const accepted=h.port.submitTask({requestId:'negative',title:'虚构图片负例',goal:'验证图片失败不冒充观察',policyId:'test-policy'});await h.core.whenIdle();
    const status=h.port.status(accepted.run);assert.equal(status.operations[0]?.status,'failed');assert.ok(h.errors().includes(expected),JSON.stringify(h.errors()));assert.deepEqual(h.counts(),{exposures:0,completed:0});
    if(options.modality===false)assert.equal(h.activity().modelCalls,0);
  }finally{await h.close();}
});

test('attachment references require the current isolated lease, exact metadata and fresh source',async()=>{
  const {Context}=await import('@deepseek-ai/cordis'),ctx=new Context(),store=new ScopedImages(ctx),image=createImageFixture(44);let valid=true;
  try{const lease=store.grant([{data:image.data,mime:'image/png',width:image.width,height:image.height,hasAlpha:false,requestedMs:null,ptsMs:null}],()=>{if(!valid)throw new Error('SOURCE_STALE');}),ref=lease.refs[0]!;
    await assert.rejects(store.readImage(ref),/SCOPE_DENIED/);await assert.rejects(store.run(lease.id,()=>store.readImage({...ref,bytes:1})),/SCOPE_DENIED/);
    await assert.rejects(store.run(lease.id,()=>store.readImageRequest(ref,{width:10,height:10,maxBytes:1000})),/TARGET_TOO_SMALL/);
    await store.run(lease.id,()=>store.readImageRequest(ref,{width:1024,height:1024,maxBytes:1000000}));assert.equal(lease.exposure()[0]?.bytes,image.data.length);
    valid=false;assert.throws(()=>lease.exposure(),/SOURCE_STALE/);valid=true;lease.close();assert.throws(()=>store.run(lease.id,()=>{}),/LEASE_EXPIRED/);
  }finally{store.close();await ctx.fiber.dispose();}
});
