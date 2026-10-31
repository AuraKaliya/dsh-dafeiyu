import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { FixtureAdapter,textResponse,toolResponse } from './sdk-fixture.js';
import { testTempDir } from './test-temp.js';
import { BILI_ACTIONS } from '@dafeiyu/bilibili';

test('twenty readings use the real Host, tool loop, source ledger and seven bounded sessions',{timeout:45000},async t=>{
  const root=await mkdtemp(join(testTempDir(),'bili-long-host-')),file=join(root,'host.json');
  process.env.DSH_HOME=join(root,'data/core/dsh-home');
  const {ManagedHost,loadHostConfig,initializeProfile}=await import('@dafeiyu/host');
  const suffix='123456789ABCDEFGHJKLM',videos=Array.from({length:20},(_,i)=>'BV1xNpFedE1'+suffix[i]!);
  let step=0,platformCalls=0;
  const adapter=new FixtureAdapter(request=>{
    const previous=request.messages.findLast(message=>message.role==='tool');
    if(previous){const text=previous.content.filter(block=>block.type==='text').map(block=>block.text).join('');
      const outcome=JSON.parse(text) as {status:string;errorCode?:string};assert.equal(outcome.status,'succeeded',outcome.errorCode);}
    if(step>=40)return textResponse('已完成二十条视频的阅读记录。');
    const index=Math.floor(step/2),read=step++%2===0,bvid=videos[index]!;
    return read?toolResponse('bili_video',{requestId:'video-'+index,bvid}):toolResponse('bili_reading_save',{
      requestId:'record-'+index,bvid,status:'closed',conclusion:'该视频的具体观察 '+index,gaps:[],nextStep:index<19?'继续下一条':null});
  });
  await writeFile(join(root,'persona.md'),'本机虚构验收人格。');
  await writeFile(file,JSON.stringify({schemaVersion:1,profileId:'reading-integration',agent:{id:'fish'},
    paths:{core:'./data/core',memory:'./data/memory',sessions:'./data/sessions',query:'./data/query.sqlite'},
    modelRoutes:{chat:{provider:'local-test',model:'scripted'}},persona:{fixedFile:'./persona.md',kind:'test'},
    plugins:[{id:'model-scripted',required:true},{id:'timeline',required:true,config:{execution:true}},{id:'memory-growth',required:true},
      {id:'media',required:true,config:{ffmpeg:process.execPath,ffprobe:process.execPath}},
      {id:'bilibili',required:true,config:{capabilities:{minIntervalMs:100}}}],
    authorityPolicies:[{id:'reading',producers:['host-cli'],actions:BILI_ACTIONS,allowLocalWrite:true,
      resources:[{channel:'bilibili',account:'public',kind:'local',id:'public'}]}]}));
  const config=loadHostConfig(file),coordination=join(root,'coordination.sqlite');initializeProfile(config,coordination);
  const host=await ManagedHost.start(config,{coordination,adapter,signal:t.signal,biliTransport:async url=>{
    platformCalls++;const bvid=url.searchParams.get('bvid')!,i=videos.indexOf(bvid);assert.notEqual(i,-1);
    const bytes=Buffer.from(JSON.stringify({code:0,data:{bvid,aid:String(i+1),title:'视频'+i,desc:'虚构视频资料',duration:60,
      pages:[{cid:String(i+100),page:1,part:'第一部分',duration:60}],owner:{mid:42,name:'Fixture'}}}));
    return {status:200,headers:{'content-length':String(bytes.length)},body:(async function*(){yield bytes;})(),close(){}};
  }});
  try{
    const result=await host.run({requestId:randomUUID(),title:'B站阅读验收',goal:'读取二十条B站视频并保存结论',policyId:'reading'});
    assert.equal(result.state,'completed',result.error??'');assert.match(result.result??'',/二十/);assert.equal(platformCalls,20);
    assert.equal(adapter.requests.length,41);
    assert.equal(new Set(adapter.requests.map(request=>request.sessionId)).size,7);
    for(const request of adapter.requests)assert.ok(!request.tools?.some(tool=>tool.name==='dsh_tool_call'));
    const db=new DatabaseSync(join(root,'data/core/runtime.sqlite'),{readOnly:true});
    try{
      const runs=db.prepare('SELECT state,body FROM runs JOIN execution_requests ON request_key=execution_requests.id').all();
      assert.equal(runs.filter(row=>row.state==='continued').length,6);assert.equal(runs.filter(row=>row.state==='completed').length,1);
      const lineages=db.prepare("SELECT body FROM run_inputs WHERE input_id='segment-lineage'").all().map(row=>JSON.parse(String(row.body)) as {deadlineAt:number});
      assert.equal(new Set(lineages.map(value=>value.deadlineAt)).size,1);
      const audits=db.prepare("SELECT body FROM runtime_outbox WHERE json_extract(body,'$.type')='context.admitted'").all().map(row=>JSON.parse(String(row.body)));
      assert.ok(audits.length>=41);assert.ok(audits.every(value=>value.data.capacity.estimatedInputTokens<32000));
    }finally{db.close();}
    const tail=adapter.requests.at(-1)!;assert.match(JSON.stringify(tail.messages),/bilibili-reading-progress/);
    const snapshotSchema=z.object({source:z.object({kind:z.literal('runtime-context'),sections:z.array(z.object({name:z.string(),text:z.string()}))})});
    const snapshot=tail.messages.flatMap(message=>{const parsed=snapshotSchema.safeParse(message);return parsed.success?[parsed.data]:[];}).at(-1)!;
    const section=snapshot.source.sections.find(section=>section.name==='dafeiyu:persona-context:v1')!;
    const regions=z.object({regions:z.array(z.object({item:z.object({text:z.string()})}))}).parse(JSON.parse(section.text)).regions;
    const progress=regions.map(region=>JSON.parse(region.item.text) as {kind?:string;total?:number}).find(value=>value.kind==='bilibili-reading-progress');
    assert.equal(progress?.total,20);
    console.log('READING_INTEGRATION_METRICS '+JSON.stringify({videos:20,platformCalls,modelCalls:adapter.requests.length,sessions:7,
      requestBytes:adapter.requests.map(request=>Buffer.byteLength(JSON.stringify(request.messages))),realModel:false,realPlatform:false}));
  }finally{await host.close();}
});
