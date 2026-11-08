import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {FixtureAdapter,textResponse,toolResponse} from './sdk-fixture.js';
import {testTempDir} from './test-temp.js';

test('comment continuation accepts a redundant matching aid, rejects a different video, and actually reads page two',{timeout:30000},async t=>{
  const root=await mkdtemp(join(testTempDir(),'bili-cursor-recovery-'));process.env.DSH_HOME=join(root,'data/core/dsh-home');
  const {ManagedHost,loadHostConfig,initializeProfile}=await import('@dafeiyu/host');let step=0,cursor:string|undefined;const pages:number[]=[];
  const adapter=new FixtureAdapter(request=>{
    const prior=request.messages.findLast(m=>m.role==='tool');const text=prior?.content.filter(b=>b.type==='text').map(b=>b.text).join('');
    if(step===0){step++;return toolResponse('bili_comments',{requestId:'first',aid:'900',limit:2});}
    const outcome=JSON.parse(text!) as {status:string;errorCode?:string;data:{page:{data:{nextCursor:string;items:{id:string}[]}}}};
    if(step===1){assert.equal(outcome.status,'succeeded');cursor=outcome.data.page.data.nextCursor;assert.ok(cursor);step++;return toolResponse('bili_comments',{requestId:'wrong-video',aid:'901',cursor,limit:2});}
    if(step===2){assert.equal(outcome.errorCode,'BILI_COMMENT_CURSOR_MISMATCH');step++;return toolResponse('bili_comments',{requestId:'next',aid:'900',cursor,limit:2});}
    assert.equal(outcome.status,'succeeded');assert.deepEqual(outcome.data.page.data.items.map(x=>x.id),['3','4']);return textResponse('读到了下一页评论。');
  });
  await writeFile(join(root,'persona.md'),'隔离测试。');const file=join(root,'host.json');
  await writeFile(file,JSON.stringify({schemaVersion:1,profileId:'cursor-recovery',agent:{id:'fish'},paths:{core:'./data/core',memory:'./data/memory',sessions:'./data/sessions',query:'./data/query.sqlite'},modelRoutes:{chat:{provider:'local-test',model:'scripted'}},persona:{fixedFile:'./persona.md',kind:'test'},plugins:[{id:'model-scripted',required:true},{id:'timeline',required:true,config:{execution:true}},{id:'memory-growth',required:true},{id:'media',required:true,config:{ffmpeg:process.execPath,ffprobe:process.execPath}},{id:'bilibili',required:true,config:{capabilities:{minIntervalMs:100}}}],authorityPolicies:[{id:'reading',producers:['host-cli'],actions:['bili_comments'],allowLocalWrite:false,resources:[{channel:'bilibili',account:'public',kind:'local',id:'public'}]}]}));
  const config=loadHostConfig(file),coordination=join(root,'coordination.sqlite');initializeProfile(config,coordination);
  const host=await ManagedHost.start(config,{coordination,adapter,signal:t.signal,biliTransport:async url=>{
    const page=Number(url.searchParams.get('pn'));pages.push(page);assert.equal(url.searchParams.get('oid'),'900');
    const data={code:0,data:{page:{count:4},replies:[0,1].map(i=>({rpid:String((page-1)*2+i+1),content:{message:'fixture'},member:{uname:'fixture'}}))}};
    const bytes=Buffer.from(JSON.stringify(data));return {status:200,headers:{'content-length':String(bytes.length)},body:(async function*(){yield bytes;})(),close(){}};
  }});
  try{const result=await host.run({requestId:randomUUID(),title:'翻页测试',goal:'继续读取评论',policyId:'reading'});assert.equal(result.state,'completed',result.error??'');assert.deepEqual(pages,[1,2]);}finally{await host.close();}
});
