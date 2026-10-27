import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {readBiliBrowser} from '../packages/plugin/lib/bili-browser.js';
import {BiliClient} from '../packages/bilibili/lib/client.js';
import {BiliStore} from '@dafeiyu/bilibili';
import {BiliConfigSchema} from '../packages/bilibili/lib/config.js';
import {testTempDir} from './test-temp.js';
import type {BiliBrowserRequest} from '@dafeiyu/contracts';
const input=():BiliBrowserRequest=>({taskId:randomUUID(),runId:randomUUID(),operationId:randomUUID(),bvid:'BV1xx411c7mD',section:'video'});
test('browser adapter uses only fixed reads, verifies both account checks and canonicalizes URL',async()=>{const i=input(),calls:string[]=[];let checks=0;
  const result=await readBiliBrowser(i,'42',async(name,args)=>{calls.push(name);if(name==='dsh_browser_open')return {url:String(args.url)+'?tracking=not-saved',challenge:{blocked:false}};
    assert.equal(name,'dsh_browser_execute');const script=String(args.script);assert.doesNotMatch(script,/cookie|localStorage|fetch\(|\.click\(/);if(script.startsWith('Array.from')){checks++;return {ok:true,value:'["42"]'};}return {ok:true,value:JSON.stringify({title:'公开标题',text:'已加载简介',truncated:false})};},new AbortController().signal);
  assert.equal(checks,2);assert.equal(result.url,`https://www.bilibili.com/video/${i.bvid}/`);assert.equal(result.accountUid,'42');assert.equal(calls.length,4);
});
test('wrong account, account switch and verification challenges stop before returning content',async()=>{for(const scenario of ['wrong','changed','challenge']){let checks=0;await assert.rejects(readBiliBrowser(input(),'42',async(name,args)=>{
  if(name==='dsh_browser_open')return {url:args.url,challenge:{blocked:scenario==='challenge'}};if(String(args.script).startsWith('Array.from'))return {ok:true,value:JSON.stringify([++checks===1&&scenario!=='wrong'?'42':'43'])};return {ok:true,value:JSON.stringify({title:'公开标题',text:'不得交付',truncated:false})};},new AbortController().signal),/BILI_BROWSER_(ACCOUNT_MISMATCH|CHALLENGE)/);}});
test('browser shares cooling gate, records its transport and does not clear HTTP risk by succeeding',async()=>{const root=await mkdtemp(join(testTempDir(),'bili-browser-')),store=new BiliStore(join(root,'b.sqlite'),{agentId:'fish',profileId:'test'},true),c=new BiliClient(BiliConfigSchema.parse({minIntervalMs:100,browser:{expectedUid:'42'}}),store);let calls=0;const port={read:async(i:BiliBrowserRequest)=>{calls++;return {transport:'dsh-browser' as const,accountUid:'42',bvid:i.bvid,section:i.section,url:`https://www.bilibili.com/video/${i.bvid}/`,title:'标题',text:'简介',truncated:false,observedAt:new Date().toISOString()};}};
  try{await c.browserRead(port,input(),new AbortController().signal,()=>{});assert.equal(store.diagnostics.recent()[0]!.transport,'dsh-browser');store.backoff(Date.now(),30000);await assert.rejects(c.browserRead(port,input(),new AbortController().signal,()=>{}),/BACKOFF/);assert.equal(calls,1);assert.equal(store.diagnostics.recent()[0]!.networkSent,false);}finally{store.close();}
});
