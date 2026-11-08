import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {Context} from '@deepseek-ai/cordis';
import {QqStore,GroupDirectory,GroupSyncConfigSchema} from '@dafeiyu/qq';
import type {Conversation,Extension,ExecutionContext} from '@dafeiyu/contracts';
import type {DafeiyuService} from '../packages/core/lib/index.js';
import {QqCapabilities,qqResourceRoute} from '../packages/channel-qq/lib/capabilities.js';
import {readRecentQqHistory} from '../packages/channel-qq/lib/history.js';
import type {QqHistoryMessage} from '../packages/channel-qq/lib/history.js';
import {readForwardNodes,QqForwardCache} from '../packages/channel-qq/lib/forward.js';
import {testTempDir} from './test-temp.js';

const scene:Conversation={channel:'qq',account:'100001',kind:'group',id:'300001'};
const route=JSON.stringify([scene.account,scene.kind,scene.id]);
const now=Date.parse('2026-11-08T13:00:00Z'),day=86400000;
const message=(id:number,at=now-2*day):QqHistoryMessage=>({message_id:String(id),message_type:'group',user_id:'200001',group_id:scene.id,self_id:scene.account,time:at/1000,message:[{type:'text',data:{text:'historical '+id}}]});

test('explicit latest history crosses the old 24-hour boundary while recent reads retain the configured window and account checks',async()=>{
  const items=Array.from({length:22},(_,i)=>message(100-i,now-2*day-i*1000));
  const read=async(mode:'latest'|'recent')=>{const appended:string[]=[],anchors:(string|null)[]=[];
    const result=await readRecentQqHistory({botId:scene.account,now:()=>now,allowed:()=>true,
      fetch:async(_scene,anchor)=>{anchors.push(anchor);return {messages:anchor===null?items.slice(0,20):items.slice(20)};},
      append:(_scene,item)=>{appended.push(item.message_id);return {added:true,media:0};}},scene,new AbortController().signal,{mode});
    return {result,appended,anchors};};
  const latest=await read('latest');assert.equal(latest.result.since,null);assert.equal(latest.result.excluded,0);assert.equal(latest.appended.length,22);assert.deepEqual(latest.anchors,[null,'81']);
  const recent=await read('recent');assert.equal(recent.appended.length,0);assert.equal(recent.result.excludedReasons.outsideWindow,20);
  const appended:string[]=[];
  const result=await readRecentQqHistory({botId:scene.account,now:()=>now,windowMs:3*day,allowed:()=>true,
    fetch:async()=>({messages:[message(1),{...message(2),self_id:'999999'},{...message(3),group_id:'999999'},message(4,now+1000)]}),
    append:(_scene,item)=>{appended.push(item.message_id);return {added:true,media:0};}},scene,new AbortController().signal,{mode:'recent'});
  assert.deepEqual(appended,['1']);assert.deepEqual(result.excludedReasons,{account:1,conversation:1,outsideWindow:0,futureTime:1});
});

test('history access revoked during a platform read cannot append any returned messages',async()=>{
  let authorized=true;
  await assert.rejects(readRecentQqHistory({botId:scene.account,now:()=>now,allowed:()=>authorized,fetch:async()=>{authorized=false;return {messages:[message(1)]};},append:()=>assert.fail('revoked read appended material')},scene,new AbortController().signal,{mode:'latest'}),/TARGET_NOT_ALLOWED/);
});

test('explicit cache pages use message time across historical backfills and keep cursor and source revocation semantics',async()=>{
  const file=join(await mkdtemp(join(testTempDir(),'qq-history-pages-')),'qq.sqlite'),store=new QqStore(file,{cache:{clock:()=>now}});
  try{
    for(const [id,hours] of [['new',1],['old',72],['middle',26]] as const)store.remember(route,id,'200001',id,{occurredAt:new Date(now-hours*3600000).toISOString(),unsupported:[]});
    const first=store.cache.browse(route,'reader',{requestId:'first',limit:1},false,true);assert.equal(first.page.messages[0]?.id,'new');
    const second=store.cache.browse(route,'reader',{requestId:'second',limit:1,cursor:first.id},false,true);assert.equal(second.page.messages[0]?.id,'middle');
    const third=store.cache.browse(route,'reader',{requestId:'third',limit:1,cursor:second.id},false,true);assert.equal(third.page.messages[0]?.id,'old');assert.equal(third.next,null);
    const configured=store.cache.browse(route,'reader',{requestId:'configured'},2*day,true);assert.deepEqual(configured.page.messages.map(x=>x.id),['new','middle']);
    store.cache.revoke(route,'middle');assert.throws(()=>store.cache.snapshot('reader',second.id),/SNAPSHOT_UNAVAILABLE|SOURCE_STALE/);
  }finally{store.close();}
});

test('a forwarded copy exposes all 22 old or undated nodes through stable pages without inventing timestamps',()=>{
  const raw={messages:Array.from({length:22},(_,i)=>({...(i%2===0?{time:(now-30*day)/1000}:{}),sender:{nickname:'unverified'},content:[{type:'text',data:{text:'node '+i}}]}))};
  const all=[];let offset=0;
  for(;;){const page=readForwardNodes(raw,now,{offset});assert.equal(page.excluded,0);assert.ok(page.messages.length<=8);all.push(...page.messages);if(page.nextOffset===null)break;offset=page.nextOffset;}
  assert.equal(all.length,22);assert.deepEqual(all.map(x=>x.index),Array.from({length:22},(_,i)=>i));
  assert.equal(all[1]!.occurredAt,null);assert.equal(all[1]!.timeStatus,'unknown');assert.equal(all[0]!.occurredAt,new Date(now-30*day).toISOString());
  const future=readForwardNodes({messages:[{time:(now+1000)/1000,content:[]}]},now);assert.equal(future.messages[0]?.timeStatus,'future');
  assert.throws(()=>readForwardNodes(raw,now,{offset:22}),/FORWARD_PAGE_UNAVAILABLE/);
});

test('forward copies reuse a bounded short-lived fetch, but recheck source authority even on cache hits',async()=>{
  let at=now,calls=0,current=true;const cache=new QqForwardCache(()=>at),guard=()=>{if(!current)throw new Error('SOURCE_STALE');},load=async()=>{calls++;return {messages:[]};};
  assert.equal((await cache.read('account/source/proof/generation',load,guard)).cacheHit,false);
  assert.equal((await cache.read('account/source/proof/generation',load,guard)).cacheHit,true);assert.equal(calls,1);
  current=false;await assert.rejects(cache.read('account/source/proof/generation',load,guard),/SOURCE_STALE/);assert.equal(calls,1);
  current=true;at+=60001;assert.equal((await cache.read('account/source/proof/generation',load,guard)).cacheHit,false);assert.equal(calls,2);
  await cache.read('another-group-generation',load,guard);assert.equal(calls,3);
});

test('forward pagination stops at the media budget without skipping nodes containing multiple images',()=>{
  const raw={messages:Array.from({length:12},()=>({content:[{type:'image',data:{file:'one'}},{type:'image',data:{file:'two'}}]}))};
  const first=readForwardNodes(raw,now,{limit:20});assert.equal(first.messages.length,4);assert.equal(first.nextOffset,4);
  const second=readForwardNodes(raw,now,{offset:first.nextOffset!,limit:20});assert.equal(second.messages[0]?.index,4);assert.equal(second.nextOffset,8);
  const last=readForwardNodes(raw,now,{offset:second.nextOffset!,limit:20});assert.deepEqual(last.messages.map(x=>x.index),[8,9,10,11]);assert.equal(last.nextOffset,null);
});

test('forward tools default to the actual conversation and locate a forwarded source inside a pending batch',async()=>{
  const file=join(await mkdtemp(join(testTempDir(),'qq-forward-target-')),'qq.sqlite'),store=new QqStore(file),ctx=new Context();
  const privateScene:Conversation={...scene,kind:'private',id:'200001'},read:string[]=[],authorized:Conversation[]=[];let extension!:Extension;
  const first={id:'forward',occurredAt:new Date(now-3*day).toISOString(),conversation:privateScene,sender:{id:'200001',displayName:'fixture'},text:'forwarded material'};
  const last={...first,id:'followup',text:'先总结这段材料'},inbound={...last,batch:{sources:[first,last]}};
  const groups=new GroupDirectory({account:scene.account,allowed:[scene.id],store,config:GroupSyncConfigSchema.parse({enabled:true}),fetchGroups:async()=>[{id:scene.id,name:'fixture',msgMask:1}],rejectIdentity:()=>{}});await groups.start();
  ctx.provide('dafeiyu',{registerExtension:(value:Extension)=>{extension=value;return {dispose(){}};},executionAuthority:()=>{},journal:{get:()=>({message:inbound})},capabilityResources:()=>[privateScene,scene],authorizeCapabilityResource:(_context:unknown,_owner:unknown,target:Conversation)=>{assert.ok([privateScene.id,scene.id].includes(target.id));authorized.push(target);},
    recordCapabilityObservation:()=>({source:{id:randomUUID(),agentId:'fish',scopeKey:'fixture',version:1,contentHash:createHash('sha256').update('fixture').digest('hex'),kind:'execution-source'}})} as unknown as DafeiyuService);
  store.remember(qqResourceRoute(privateScene),'forward','200001','forward',{occurredAt:first.occurredAt,unsupported:[],forwardIds:['fixture-copy']});
  const capabilities=new QqCapabilities(ctx,{agentId:'fish',botId:scene.account,ownerId:'200001',store,groups,allowed:()=>true,available:()=>true,readForward:async(target,id,index,_signal,options)=>{assert.deepEqual(target,privateScene);assert.equal(store.cache.forward(qqResourceRoute(target),id,index),'fixture-copy');read.push(id);return readForwardNodes({messages:[{content:[{type:'text',data:{text:'old text'}}]}]},now,options);}});
  try{
    const context={agentId:'fish',runId:randomUUID(),taskId:null,operationId:randomUUID(),scope:{kind:'conversation',agentId:'fish',route:'fixture'},origin:{kind:'message',inboundId:randomUUID(),conversation:privateScene},intentVersion:0,signal:new AbortController().signal} as unknown as ExecutionContext;
    const action=extension.actions!.find(x=>x.id==='qq_forward_read')!;const result=await action.execute({},context);assert.equal(result.status,'succeeded');assert.deepEqual(read,['forward']);assert.ok(authorized.every(x=>x.id===privateScene.id));
    const task={...context,origin:{kind:'native',producerId:'fixture',requestId:'task'}} as ExecutionContext;
    const missing=await action.execute({messageId:'forward'},task);assert.equal(missing.errorCode,'RESOURCE_TARGET_REQUIRED');assert.equal(read.length,1);
    const crossed=await action.execute({target:scene},context);assert.equal(crossed.errorCode,'MESSAGE_REQUIRED');assert.equal(read.length,1);
  }finally{capabilities.close();groups.pause();await groups.whenIdle();store.close();await ctx.fiber.dispose();}
});
