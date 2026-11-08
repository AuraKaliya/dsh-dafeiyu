import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {API_VERSION,conversationKey,messageDisplayText} from '@dafeiyu/contracts';
import type {InboundMessage,ExtensionHandle} from '@dafeiyu/contracts';
import {QqStore,QqBatchConfigSchema} from '@dafeiyu/qq';
import type {QqMessageBatches} from '../packages/channel-qq/lib/batch.js';
import {FixtureAdapter,textResponse} from './sdk-fixture.js';
import {testTempDir} from './test-temp.js';

const scene={channel:'qq',account:'100001',kind:'private' as const,id:'200001'};
function message(id:string,text:string):InboundMessage{return {id,occurredAt:new Date().toISOString(),conversation:scene,sender:{id:scene.id,displayName:'fixture'},text,mainText:text};}

test('busy conversation batches survive restart, preserve ordered instructions and remove revoked inputs',async()=>{
  const file=join(await mkdtemp(join(testTempDir(),'qq-busy-batch-')),'qq.sqlite');let clock=100000,busy=true,store=new QqStore(file);const sent:InboundMessage[]=[],revoked=new Set<string>();
  const config=QqBatchConfigSchema.parse({enabled:true,quietMs:100,maxWaitMs:500}),host={current:(m:InboundMessage)=>!revoked.has(m.id),busy:()=>busy,submit:(m:InboundMessage)=>sent.push(m),failed:()=>assert.fail('batch submission failed')};
  let batches=store.batches(config,host,()=>clock);batches.start();
  try{
    batches.enqueue(message('a','收录表情'),true);clock+=2000;batches.drain();assert.equal(sent.length,0);
    batches.enqueue(message('b','先总结'),true);batches.enqueue(message('c','撤回这条'),true);revoked.add('c');clock+=2000;batches.drain();
    batches.pause();store.close();store=new QqStore(file);batches=store.batches(config,host,()=>clock);batches.start();assert.equal(sent.length,0);
    batches.enqueue(message('d','先等我调整'),true);clock+=1000;busy=false;batches.drain();assert.equal(sent.length,1);
    assert.deepEqual(sent[0]!.batch?.sources.map(x=>x.id),['a','b','d']);assert.match(messageDisplayText(sent[0]!),/后来的更正优先/);assert.equal(batches.count(),0);
  }finally{batches.pause();store.close();}
});

test('real conversation execution consumes follow-up requests in one batch after the current reply',{timeout:30000},async t=>{
  const root=await mkdtemp(join(testTempDir(),'qq-busy-host-'));process.env.DSH_HOME=join(root,'data/core/dsh-home');
  const {ManagedHost,loadHostConfig,initializeProfile}=await import('@dafeiyu/host');
  let release!:()=>void,started!:()=>void;const blocked=new Promise<void>(resolve=>{release=resolve;}),firstStarted=new Promise<void>(resolve=>{started=resolve;});let calls=0;
  const adapter=new FixtureAdapter(request=>(async function*(){calls++;if(calls===1){started();await blocked;}else{const text=JSON.stringify(request.messages);assert.match(text,/收录表情/);assert.match(text,/先总结/);assert.match(text,/先等我调整/);}yield* textResponse(calls===1?'第一轮完成。':'已收到连续补充，等待调整。');})());
  await writeFile(join(root,'persona.md'),'隔离测试人格。');const file=join(root,'host.json');
  await writeFile(file,JSON.stringify({schemaVersion:1,profileId:'busy-batch',agent:{id:'fish'},paths:{core:'./data/core',memory:'./data/memory',sessions:'./data/sessions',query:'./data/query.sqlite'},modelRoutes:{chat:{provider:'local-test',model:'scripted'}},persona:{fixedFile:'./persona.md',kind:'test'},plugins:[{id:'model-scripted',required:true},{id:'timeline',required:true,config:{execution:true}},{id:'memory-growth',required:true}],authorityPolicies:[]}));
  const config=loadHostConfig(file),coordination=join(root,'coordination.sqlite');initializeProfile(config,coordination);const store=new QqStore(join(root,'qq.sqlite'));
  let channel:ExtensionHandle|undefined,batches:QqMessageBatches|undefined,clock=100000;const delivered:string[]=[];
  const host=await ManagedHost.start(config,{coordination,adapter,signal:t.signal,installChannels:ctx=>{
    channel=ctx.dafeiyu.registerExtension({protocolVersion:API_VERSION,id:'fixture-channel',version:'1',agentId:'fish',channels:[{channel:'qq',account:scene.account,deliver:async reply=>{delivered.push(reply.text);return {status:'sent',receiptId:String(delivered.length)};}}]});
    batches=store.batches(QqBatchConfigSchema.parse({enabled:true,quietMs:10,maxWaitMs:100}),{current:()=>true,busy:m=>ctx.dafeiyu.journal.hasPendingConversation(conversationKey('fish',m.conversation)),submit:m=>{channel!.ingest(m);},failed:()=>assert.fail('batch failed')},()=>clock);batches.start();
  }});
  try{
    channel!.ingest(message('first','开始'));await firstStarted;
    for(const [id,text] of [['second','收录表情'],['third','先总结'],['fourth','先等我调整']]){batches!.enqueue(message(id!,text!),true);clock+=1000;batches!.drain();}
    assert.equal(host.core.journal.list().length,1);release();await host.core.whenIdle();
    clock+=1000;batches!.drain();await host.core.whenIdle();
    assert.equal(calls,2);assert.equal(delivered.length,2);assert.equal(host.core.journal.list(['delivered']).length,2);
    assert.deepEqual(host.core.journal.list().at(-1)?.message.batch?.sources.map(x=>x.id),['second','third','fourth']);
  }finally{release();batches?.pause();await host.close();store.close();}
});
