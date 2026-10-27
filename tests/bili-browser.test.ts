import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {readBiliBrowser} from '../packages/plugin/lib/bili-browser.js';
import type {BrowserToolCall,BrowserReadinessClock} from '../packages/plugin/lib/bili-browser.js';
import {BiliClient} from '../packages/bilibili/lib/client.js';
import {BiliStore} from '@dafeiyu/bilibili';
import {BiliConfigSchema} from '../packages/bilibili/lib/config.js';
import {testTempDir} from './test-temp.js';
import type {BiliBrowserRequest} from '@dafeiyu/contracts';
const input=():BiliBrowserRequest=>({taskId:randomUUID(),runId:randomUUID(),operationId:randomUUID(),bvid:'BV1xx411c7mD',section:'video'});
const result=(value:unknown)=>({ok:true,value:JSON.stringify(value)});
const content={title:'公开标题',text:'已加载简介',truncated:false};
const isIdentity=(args:Record<string,unknown>)=>String(args.script).includes('space.bilibili.com');
const identity=(i:BiliBrowserRequest,ids:string[])=>result({url:`https://www.bilibili.com/video/${i.bvid}/`,ids});
function clock():BrowserReadinessClock & {elapsed:number;waits:number}{return {elapsed:0,waits:0,now(){return this.elapsed;},async wait(ms,signal){signal.throwIfAborted();this.waits++;this.elapsed+=ms;}};}
test('browser adapter uses only fixed reads, verifies both account checks and canonicalizes URL',async()=>{const i=input(),calls:string[]=[];let checks=0;
  const result=await readBiliBrowser(i,'42',async(name,args)=>{calls.push(name);if(name==='dsh_browser_open')return {url:String(args.url)+'?tracking=not-saved',challenge:{blocked:false}};
    assert.equal(name,'dsh_browser_execute');const script=String(args.script);assert.doesNotMatch(script,/cookie|localStorage|fetch\(|\.click\(/);if(isIdentity(args)){checks++;return identity(i,['42']);}return {ok:true,value:JSON.stringify({title:'公开标题',text:'已加载简介',truncated:false})};},new AbortController().signal);
  assert.equal(checks,2);assert.equal(result.url,`https://www.bilibili.com/video/${i.bvid}/`);assert.equal(result.accountUid,'42');assert.equal(calls.length,4);
});
test('wrong account, account switch and verification challenges stop before returning content',async()=>{for(const scenario of ['wrong','changed','challenge']){const i=input(),time=clock();let checks=0;await assert.rejects(readBiliBrowser(i,'42',async(name,args)=>{
  if(name==='dsh_browser_open')return {url:args.url,challenge:{blocked:scenario==='challenge'}};if(isIdentity(args))return identity(i,[++checks===1&&scenario!=='wrong'?'42':'43']);return result(content);},new AbortController().signal,time),/BILI_BROWSER_(ACCOUNT_MISMATCH|CHALLENGE)/);assert.equal(time.waits,0);}});

test('delayed identity, comments and final identity settle without reopening or scrolling again',async()=>{
  const i={...input(),section:'comments' as const},time=clock(),calls:string[]=[];
  const identities=[[],[],['42'],[],['42']],contents=[null,{...content,text:''},content];
  const call:BrowserToolCall=async(name,args)=>{calls.push(name);
    if(name==='dsh_browser_open')return {url:args.url};if(name==='dsh_browser_scroll')return {};
    return isIdentity(args)?identity(i,identities.shift()??[]):result(contents.shift()??null);
  };
  const value=await readBiliBrowser(i,'42',call,new AbortController().signal,time);
  assert.equal(value.text,content.text);assert.equal(time.waits,5);
  assert.equal(calls.filter(name=>name==='dsh_browser_open').length,1);assert.equal(calls.filter(name=>name==='dsh_browser_scroll').length,1);
});

test('missing identity exhausts one bounded wait and never reads content or reports mismatch',async()=>{
  const i=input(),time=clock();let reads=0,opens=0;
  await assert.rejects(readBiliBrowser(i,'42',async(name,args)=>{
    if(name==='dsh_browser_open'){opens++;return {url:args.url};}assert.ok(isIdentity(args));reads++;return identity(i,[]);
  },new AbortController().signal,time),/^Error: BILI_BROWSER_IDENTITY_UNAVAILABLE$/);
  assert.equal(time.elapsed,10000);assert.equal(reads,40);assert.equal(opens,1);
});

test('identity and content share the deadline instead of extending each other',async()=>{
  const i=input(),time=clock();let checks=0;
  await assert.rejects(readBiliBrowser(i,'42',async(name,args)=>{
    if(name==='dsh_browser_open')return {url:args.url};
    return isIdentity(args)?identity(i,++checks<=38?[]:['42']):result(null);
  },new AbortController().signal,time),/BILI_BROWSER_CONTENT_UNAVAILABLE/);
  assert.equal(time.elapsed,10000);assert.equal(checks,39);
});

test('cancellation interrupts readiness before another DOM read',async()=>{
  const i=input(),controller=new AbortController();let reads=0;
  const time:BrowserReadinessClock={now:()=>0,wait:async(_ms,signal)=>{controller.abort(new Error('OWNER_CANCELLED'));signal.throwIfAborted();}};
  await assert.rejects(readBiliBrowser(i,'42',async(name,args)=>{
    if(name==='dsh_browser_open')return {url:args.url};reads++;return identity(i,[]);
  },controller.signal,time),/OWNER_CANCELLED/);assert.equal(reads,1);
});

test('post-navigation redirect is rejected even if the expected avatar is present',async()=>{
  const i=input(),time=clock();
  await assert.rejects(readBiliBrowser(i,'42',async(name,args)=>name==='dsh_browser_open'?{url:args.url}:result({url:'https://www.bilibili.com/video/BV1yy411c7mD/',ids:['42']}),new AbortController().signal,time),/BILI_BROWSER_REDIRECT/);
  assert.equal(time.waits,0);
});

test('mixed accounts are rejected immediately and duplicate links to the same account are accepted',async()=>{
  for(const ids of [['42','43'],['42','42']]){const i=input(),time=clock();
    const read=readBiliBrowser(i,'42',async(name,args)=>name==='dsh_browser_open'?{url:args.url}:isIdentity(args)?identity(i,ids):result(content),new AbortController().signal,time);
    if(ids[1]==='43')await assert.rejects(read,/ACCOUNT_MISMATCH/);else assert.equal((await read).accountUid,'42');assert.equal(time.waits,0);
  }
});
test('browser shares cooling gate, records its transport and does not clear HTTP risk by succeeding',async()=>{const root=await mkdtemp(join(testTempDir(),'bili-browser-')),store=new BiliStore(join(root,'b.sqlite'),{agentId:'fish',profileId:'test'},true),c=new BiliClient(BiliConfigSchema.parse({minIntervalMs:100,browser:{expectedUid:'42'}}),store);let calls=0;const port={read:async(i:BiliBrowserRequest)=>{calls++;return {transport:'dsh-browser' as const,accountUid:'42',bvid:i.bvid,section:i.section,url:`https://www.bilibili.com/video/${i.bvid}/`,title:'标题',text:'简介',truncated:false,observedAt:new Date().toISOString()};}};
  try{await c.browserRead(port,input(),new AbortController().signal,()=>{});assert.equal(store.diagnostics.recent()[0]!.transport,'dsh-browser');store.backoff(Date.now(),30000);await assert.rejects(c.browserRead(port,input(),new AbortController().signal,()=>{}),/BACKOFF/);assert.equal(calls,1);assert.equal(store.diagnostics.recent()[0]!.networkSent,false);}finally{store.close();}
});

test('browser identity mismatch enters a persistent condition wait instead of repeated page reads',async()=>{const root=await mkdtemp(join(testTempDir(),'bili-browser-hold-')),store=new BiliStore(join(root,'b.sqlite'),{agentId:'fish',profileId:'test'},true),c=new BiliClient(BiliConfigSchema.parse({browser:{expectedUid:'42'}}),store);let calls=0;const port={read:async()=>{calls++;throw new Error('BILI_BROWSER_ACCOUNT_MISMATCH');}};try{await assert.rejects(c.browserRead(port,input(),new AbortController().signal,()=>{}),/ACCOUNT_MISMATCH/);assert.equal(store.diagnostics.state.held,true);assert.equal(store.diagnostics.recent()[0]!.kind,'login');assert.equal(store.diagnostics.recent()[0]!.networkSent,null);await assert.rejects(c.browserRead(port,input(),new AbortController().signal,()=>{}),/DIAGNOSTIC_REQUIRED/);assert.equal(calls,1);}finally{store.close();}});

test('identity loading timeout records its actual error without creating a login hold or automatic retry',async()=>{
  const root=await mkdtemp(join(testTempDir(),'bili-browser-loading-')),store=new BiliStore(join(root,'b.sqlite'),{agentId:'fish',profileId:'test'},true),client=new BiliClient(BiliConfigSchema.parse({browser:{expectedUid:'42'}}),store);let calls=0;
  try{await assert.rejects(client.browserRead({read:async()=>{calls++;throw new Error('BILI_BROWSER_IDENTITY_UNAVAILABLE');}},input(),new AbortController().signal,()=>{}),/IDENTITY_UNAVAILABLE/);
    assert.equal(calls,1);assert.equal(store.diagnostics.state.held,false);const attempt=store.diagnostics.recent()[0]!;
    assert.equal(attempt.errorCode,'BILI_BROWSER_IDENTITY_UNAVAILABLE');assert.equal(attempt.kind,'response');assert.equal(attempt.networkSent,null);assert.equal(attempt.retryAt,null);
  }finally{store.close();}
});
