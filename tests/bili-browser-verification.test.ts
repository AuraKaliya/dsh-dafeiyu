import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {Context} from '@deepseek-ai/cordis';
import type {DafeiyuService} from '@dafeiyu/core';
import type {BiliBrowserPort,BiliBrowserRequest,BiliBrowserResult} from '@dafeiyu/contracts';
import {BiliService} from '@dafeiyu/bilibili';
import {readBiliBrowser} from '../packages/plugin/lib/bili-browser.js';
import {contentChallengeCheck} from '../packages/plugin/lib/bili-page-check.js';
import {testTempDir} from './test-temp.js';

const bvid='BV1xNpFedEwH',url=`https://www.bilibili.com/video/${bvid}/`,jpeg='data:image/jpeg;base64,/9j/2Q==';
const request=():BiliBrowserRequest=>({taskId:randomUUID(),runId:randomUUID(),operationId:randomUUID(),section:'frames',bvid,pointsMs:[0]});
const result=(r:BiliBrowserRequest):BiliBrowserResult=>({transport:'dsh-browser',accountUid:'42',section:r.section,bvid,url,title:'fixture',text:'decoded frame',truncated:true,observedAt:new Date().toISOString(),frames:[{dataUrl:jpeg,positionMs:0,requestedMs:0,durationMs:10000}],frameErrors:[]});
const hold=(service:BiliService,endpoint='video',scope:'browser'|'anonymous-http'='browser')=>service.store.diagnostics.failure(endpoint,scope==='browser'?'verification':'permission',Date.now()-60000,{rateDelaysMs:[1000],riskDelayMs:1000},null,scope,null);
async function fixture(read:BiliBrowserPort['read']){const root=await mkdtemp(join(testTempDir(),'browser-verification-')),ctx=new Context();ctx.provide('dafeiyu',{registerExtension:()=>({dispose(){}}),capabilityManifest:()=>({features:[]}),taskContextScope:()=>null,journal:{appendExecutionOnce(){}}} as unknown as DafeiyuService);
  const service=new BiliService(ctx,{agentId:'fish',profileId:'fixture',dataDir:root,createStore:true,settings:{browser:{expectedUid:'42'},minIntervalMs:100}},async()=>assert.fail('Browser verification must not use HTTP Cookie login'),{read});service.recover();service.activate();
  return {service,close:async()=>{await service.close();await ctx.fiber.dispose();}};
}

test('recommendation wording is content; a visible verification control still blocks',()=>{
  const check=(widget:boolean)=>{const el={tagName:'A',href:url,innerText:'AI早报：已验证账户',shadowRoot:null,getBoundingClientRect:()=>({width:100,height:20,top:10,left:10,right:110,bottom:30}),closest:(selector:string)=>selector==='a[href]'?el:null,matches:(selector:string)=>widget&&selector.includes('captcha')};let read=false;
    return runInNewContext(contentChallengeCheck,{URL,innerWidth:1920,innerHeight:1080,NodeFilter:{SHOW_TEXT:4},getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'}),document:{body:{},querySelectorAll:()=>[el],querySelector:(selector:string)=>selector==='h1'?{innerText:'Video'}:{readyState:4,videoWidth:1920,duration:10},createTreeWalker:()=>({nextNode:()=>{if(read)return null;read=true;return {parentElement:el,textContent:el.innerText};}})}}) as {widget:boolean;outsideVerificationText:boolean;contentVerificationText:boolean};};
  assert.equal(check(false).outsideVerificationText,false);assert.equal(check(false).contentVerificationText,true);assert.equal(check(true).widget,true);
});

test('an unfinished generic page check is not reported as a confirmed verification challenge',async()=>{
  let elapsed=0;await assert.rejects(readBiliBrowser(request(),'42',async name=>name==='dsh_browser_open'?{url,challenge:{blocked:true,kind:'generic'}}:{ok:true,value:JSON.stringify({normalVideo:false,widget:false,outsideVerificationText:false,contentVerificationText:false})},new AbortController().signal,{now:()=>elapsed,wait:async()=>{elapsed+=250;}}),/BILI_BROWSER_STATE_UNAVAILABLE/);
});

test('an owner browser read validates one real frame and clears only the matching browser hold',async()=>{
  let calls=0;const f=await fixture(async r=>{calls++;return result(r);});try{hold(f.service);hold(f.service,'comments');hold(f.service,'video','anonymous-http');
    await assert.rejects(f.service.client.browserRead({read:async r=>{calls++;return result(r);}},request(),new AbortController().signal,()=>{}),/DIAGNOSTIC_REQUIRED/);assert.equal(calls,0);
    const accepted=f.service.management('verify.read',{transport:'browser',endpoint:'video',bvid}) as {operationId:string};await f.service.whenIdle();const record=f.service.store.verification(accepted.operationId)!;
    assert.equal(record.state,'completed',record.errorCode??'');assert.equal(calls,1);assert.equal(f.service.client.accountStatus().credentialState,'not-configured');
    assert.equal(f.service.store.diagnostics.route({scope:'browser',endpoint:'video',uid:'42'}).held,false);
    assert.equal(f.service.store.diagnostics.route({scope:'browser',endpoint:'comments',uid:'42'}).held,true);
    assert.equal(f.service.store.diagnostics.route({scope:'anonymous-http',endpoint:'video'}).held,true);
    const attempts=f.service.store.diagnostics.recent(10);assert.ok(attempts.every(a=>a.origin==='maintenance'&&a.taskId===null&&a.runId===null||a.outcome==='blocked'));
  }finally{await f.close();}
});

test('failed identity, missing frames and cancellation cannot clear a browser hold',async()=>{
  for(const variant of ['identity','empty'] as const){const f=await fixture(async r=>variant==='identity'?{...result(r),accountUid:'99'}:{...result(r),frames:[],frameErrors:[{positionMs:0,errorCode:'BILI_BROWSER_POINT_TIMEOUT'}]});try{hold(f.service);const accepted=f.service.management('verify.read',{transport:'browser',endpoint:'video',bvid}) as {operationId:string};await f.service.whenIdle();assert.equal(f.service.store.verification(accepted.operationId)?.state,'failed');assert.equal(f.service.store.diagnostics.route({scope:'browser',endpoint:'video',uid:'42'}).held,true);}finally{await f.close();}}
  let release=()=>{};const pending=new Promise<void>(resolve=>{release=resolve;}),f=await fixture(async r=>{await pending;return result(r);});try{hold(f.service);const accepted=f.service.management('verify.read',{transport:'browser',endpoint:'video',bvid}) as {operationId:string};await new Promise(resolve=>setTimeout(resolve,20));f.service.management('verify.cancel',{id:accepted.operationId});release();await f.service.whenIdle();assert.equal(f.service.store.verification(accepted.operationId)?.state,'interrupted');assert.equal(f.service.store.diagnostics.route({scope:'browser',endpoint:'video',uid:'42'}).held,true);}finally{release();await f.close();}
});

test('browser permits are bound to UID, endpoint, instance and one attempt',async()=>{
  const f=await fixture(async r=>result(r));try{hold(f.service);const d=f.service.store.diagnostics,now=Date.now(),permit=d.authorizeBrowserProbe({uid:'42',endpoint:'video',instanceGeneration:7,now});
    for(const query of [{scope:'browser' as const,uid:'99',endpoint:'video'},{scope:'browser' as const,uid:'42',endpoint:'comments'}])assert.throws(()=>d.acquireProbe('wrong',now,1000,permit.id,query,{credentialGeneration:0,instanceGeneration:7}),/NOT_PERMITTED/);
    assert.throws(()=>d.acquireProbe('wrong-instance',now,1000,permit.id,{scope:'browser',uid:'42',endpoint:'video'},{credentialGeneration:0,instanceGeneration:8}),/NOT_PERMITTED/);
    d.acquireProbe('one',now,1000,permit.id,{scope:'browser',uid:'42',endpoint:'video'},{credentialGeneration:0,instanceGeneration:7});d.assertAvailable({scope:'browser',uid:'42',endpoint:'video'},now);
    assert.throws(()=>d.acquireProbe('two',now,1000,permit.id,{scope:'browser',uid:'42',endpoint:'video'},{credentialGeneration:0,instanceGeneration:7}),/EXPIRED/);d.release('one');d.dropPermit(permit.id);
    assert.equal(d.route({scope:'browser',uid:'42',endpoint:'video'}).held,true);
  }finally{await f.close();}
});

test('an older browser success does not erase a newer verification failure',async()=>{
  let service:BiliService;const f=await fixture(async r=>{hold(service);service.store.diagnostics.failure('video','verification',Date.now()+1,{rateDelaysMs:[1000],riskDelayMs:1000},null,'browser','42');return result(r);});service=f.service;
  try{hold(service);const accepted=service.management('verify.read',{transport:'browser',endpoint:'video',bvid}) as {operationId:string};await service.whenIdle();assert.equal(service.store.verification(accepted.operationId)?.state,'completed');assert.equal(service.store.diagnostics.route({scope:'browser',uid:'42',endpoint:'video'}).held,true);}finally{await f.close();}
});
