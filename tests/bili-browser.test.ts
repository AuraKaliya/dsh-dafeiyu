import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {readBiliBrowser} from '../packages/plugin/lib/bili-browser.js';
import type {BrowserReadinessClock,BrowserToolCall} from '../packages/plugin/lib/bili-browser.js';
import {BiliClient} from '../packages/bilibili/lib/client.js';
import {BiliConfigSchema} from '../packages/bilibili/lib/config.js';
import {BiliStore} from '@dafeiyu/bilibili';
import {BiliBrowserRequestSchema,taskScopeKey} from '@dafeiyu/contracts';
import type {BiliBrowserRequest,ExecutionContext,ExecutionGrant} from '@dafeiyu/contracts';
import {testTempDir} from './test-temp.js';

const identity={agentId:'fish',profileId:'test'};
const result=(value:unknown)=>({ok:true,value:JSON.stringify(value)});
const isIdentity=(args:Record<string,unknown>)=>String(args.script).includes('space.bilibili.com');
const request=(over:Partial<BiliBrowserRequest>={}):BiliBrowserRequest=>({taskId:randomUUID(),runId:randomUUID(),operationId:randomUUID(),section:'comments',aid:'117520925198159',...over});
const canonical='https://www.bilibili.com/video/BV1Eas967EY9/';
function clock():BrowserReadinessClock & {elapsed:number;waits:number}{return {elapsed:0,waits:0,now(){return this.elapsed;},async wait(ms,signal){signal.throwIfAborted();this.waits++;this.elapsed+=ms;}};}
function context():ExecutionContext{const taskId=randomUUID();return {agentId:identity.agentId,taskId,scope:{kind:'task',agentId:identity.agentId,taskId,scopeKey:taskScopeKey(identity.agentId,taskId)},runId:randomUUID(),operationId:randomUUID(),origin:{kind:'native',producerId:'fixture',requestId:'start'},intentVersion:1,grant:{} as ExecutionGrant,signal:new AbortController().signal};}

test('browser adapter opens a comment page from aid and resolves the canonical BVID',async()=>{
  const input=request(),calls:string[]=[];let checks=0;
  const call:BrowserToolCall=async(name,args)=>{
    calls.push(name);
    if(name==='dsh_browser_open'){assert.equal(args.url,'https://www.bilibili.com/video/av117520925198159/');return {url:canonical,challenge:{blocked:false}};}
    if(name==='dsh_browser_scroll')return {};
    if(isIdentity(args)){checks++;return result({url:canonical,ids:['42']});}
    return result({title:'公开视频',text:'已加载评论',truncated:false});
  };
  const value=await readBiliBrowser(input,'42',call,new AbortController().signal,clock());
  assert.equal(checks,2);
  assert.equal(value.bvid,'BV1Eas967EY9');
  assert.equal(value.url,'https://www.bilibili.com/video/av117520925198159/');
  assert.equal(value.text,'已加载评论');
  assert.equal(calls.filter(name=>name==='dsh_browser_open').length,1);
  assert.equal(calls.filter(name=>name==='dsh_browser_scroll').length,1);
});

test('browser adapter rejects a non-video redirect when it was asked for an aid',async()=>{
  await assert.rejects(readBiliBrowser(request(),'42',async name=>name==='dsh_browser_open'?{url:'https://www.bilibili.com/bangumi/play/ep1'}:result({url:'https://www.bilibili.com/bangumi/play/ep1',ids:['42']}),new AbortController().signal,clock()),/BILI_BROWSER_REDIRECT/);
});

test('browser request contract accepts exactly one of bvid and aid and no identifier for discovery',()=>{
  const base={taskId:randomUUID(),runId:randomUUID(),operationId:randomUUID()};
  assert.doesNotThrow(()=>BiliBrowserRequestSchema.parse({...base,section:'comments',aid:'117520925198159'}));
  assert.doesNotThrow(()=>BiliBrowserRequestSchema.parse({...base,section:'video',bvid:'BV1xx411c7mD'}));
  assert.throws(()=>BiliBrowserRequestSchema.parse({...base,section:'comments'}));
  assert.throws(()=>BiliBrowserRequestSchema.parse({...base,section:'comments',aid:'1',bvid:'BV1xx411c7mD'}));
  assert.throws(()=>BiliBrowserRequestSchema.parse({...base,section:'discover',aid:'1'}));
  assert.doesNotThrow(()=>BiliBrowserRequestSchema.parse({...base,section:'discover',feed:'home'}));
});

test('browser client accepts an aid request when the adapter resolves the canonical BVID',async()=>{
  const root=await mkdtemp(join(testTempDir(),'bili-browser-aid-')),store=new BiliStore(join(root,'b.sqlite'),identity,true),client=new BiliClient(BiliConfigSchema.parse({minIntervalMs:100,browser:{expectedUid:'42'}}),store);
  const input=request(),requested='https://www.bilibili.com/video/av117520925198159/',value={transport:'dsh-browser' as const,accountUid:'42',bvid:'BV1Eas967EY9',section:'comments' as const,url:requested,title:'标题',text:'评论',truncated:false,observedAt:new Date().toISOString()};
  try{
    assert.equal((await client.browserRead({read:async()=>value},input,new AbortController().signal,()=>{})).bvid,'BV1Eas967EY9');
    await assert.rejects(client.browserRead({read:async()=>({...value,url:canonical})},input,new AbortController().signal,()=>{}),/BILI_BROWSER_BINDING_MISMATCH/);
  }finally{store.close();}
});

test('browser client still accepts discovery with a null bvid',async()=>{
  const root=await mkdtemp(join(testTempDir(),'bili-browser-discover-')),store=new BiliStore(join(root,'b.sqlite'),identity,true),client=new BiliClient(BiliConfigSchema.parse({minIntervalMs:100,browser:{expectedUid:'42'}}),store);
  const input:BiliBrowserRequest={taskId:randomUUID(),runId:randomUUID(),operationId:randomUUID(),section:'discover',feed:'home'},url='https://www.bilibili.com/';
  const value={transport:'dsh-browser' as const,accountUid:'42',bvid:null,section:'discover' as const,feed:'home' as const,url,title:'首页',text:'公开推荐',truncated:false,observedAt:new Date().toISOString()};
  try{assert.equal((await client.browserRead({read:async()=>value},input,new AbortController().signal,()=>{})).bvid,null);}finally{store.close();}
});

test('a newer page revision does not invalidate the earlier observation',async()=>{
  const root=await mkdtemp(join(testTempDir(),'bili-source-revision-')),store=new BiliStore(join(root,'b.sqlite'),identity,true),ctx=context();
  const page={kind:'comments' as const,sourceKey:'comments:test',data:{aid:'1',items:[{id:'1'}]},coverage:['仅本页评论'],fields:[{id:'comment:1',text:'第一条'}]};
  try{
    store.begin(ctx,'first',{});const first=store.complete(ctx,'first',page),firstProof=store.proof(first);
    store.begin(ctx,'second',{});const second=store.complete(ctx,'second',{...page,data:{aid:'1',items:[{id:'2'}]},fields:[{id:'comment:2',text:'第二条'}]}),secondProof=store.proof(second);
    assert.equal(first.sourceVersion,1);assert.equal(second.sourceVersion,2);
    assert.equal(store.page(first.owner,first.id).id,first.id);
    assert.equal(store.page(second.owner,second.id).id,second.id);
    assert.equal(store.valid(firstProof),true);
    assert.equal(store.current(firstProof),false);
    assert.equal(store.valid(secondProof),true);
    assert.equal(store.current(secondProof),true);
  }finally{store.close();}
});
