import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BiliStore } from '@dafeiyu/bilibili';
import { BiliClient } from '../packages/bilibili/lib/client.js';
import { BiliConfigSchema } from '../packages/bilibili/lib/config.js';
import { parseRetryAfter,BiliRetryPolicySchema } from '../packages/bilibili/lib/diagnostics.js';
import type { HttpResponse } from '../packages/bilibili/lib/http.js';
import { testTempDir } from './test-temp.js';
const identity={agentId:'fish',profileId:'test'};
async function fixture(){const root=await mkdtemp(join(testTempDir(),'bili-diagnostics-')),file=join(root,'bilibili.sqlite');return {file,store:new BiliStore(file,identity,true)};}
const response=(status:number,body:string,headers:Record<string,string>={}):HttpResponse=>({status,headers:{'content-type':'application/json',...headers},body:(async function*(){yield Buffer.from(body);})(),close(){}});
test('HTTP status, platform code and blocked attempts survive restart without secrets',async()=>{
  const f=await fixture();let store=f.store;try{let calls=0;const c=new BiliClient(BiliConfigSchema.parse({}),store,async()=>{calls++;return response(200,JSON.stringify({code:-352,message:'SESSDATA=secret-value',data:{private:'never-persist'}}));});
    await assert.rejects(c.read('video',{bvid:'BV1xx411c7mD'},new AbortController().signal,()=>{}),/BACKOFF/);
    await assert.rejects(c.read('video',{bvid:'BV1xx411c7mD'},new AbortController().signal,()=>{}),/BACKOFF/);
    assert.equal(calls,1);const logs=store.diagnostics.recent();assert.equal(logs[0]!.networkSent,false);assert.equal(logs[1]!.httpStatus,200);assert.equal(logs[1]!.platformCode,-352);assert.equal(logs[1]!.waitSource,'local-policy');assert.ok(logs[1]!.retryAt!-logs[1]!.endedAt<31000);assert.doesNotMatch(JSON.stringify(logs),/secret-value|never-persist|SESSDATA|BV1xx/);
    store.close();store=new BiliStore(f.file,identity);assert.equal(store.diagnostics.recent().length,2);assert.equal(store.diagnostics.state.failures,1);
  }finally{store.close();}
});
test('Retry-After supports seconds and dates without the previous 15 minute floor',async()=>{
  const now=Date.now();assert.equal(parseRetryAfter('5',now)?.at,now+5000);assert.equal(parseRetryAfter('Tue, 27 Oct 2026 16:00:00 GMT',0)?.at,1793116800000);assert.equal(parseRetryAfter('Cookie: secret',now),null);assert.equal(parseRetryAfter('-3',now),null);
  const f=await fixture();try{const c=new BiliClient(BiliConfigSchema.parse({}),f.store,async()=>response(429,'{}',{'retry-after':'5'}));await assert.rejects(c.read('discover',{pn:1,ps:1},new AbortController().signal,()=>{}),/BACKOFF/);const a=f.store.diagnostics.recent()[0]!;assert.equal(a.httpStatus,429);assert.equal(a.waitSource,'platform');assert.ok(a.retryAt!-a.endedAt<=5100);assert.ok(a.retryAt!-a.endedAt>=4500);}finally{f.store.close();}
});
test('HTTP rejection retains an available bounded JSON error code and actual dispatch time',async()=>{const f=await fixture();try{const c=new BiliClient(BiliConfigSchema.parse({}),f.store,async()=>response(412,'{"code":-412,"message":"secret body must not persist"}'));await assert.rejects(c.read('video',{bvid:'BV1xx411c7mD'},new AbortController().signal,()=>{}),/BACKOFF/);const a=f.store.diagnostics.recent()[0]!;assert.equal(a.httpStatus,412);assert.equal(a.platformCode,-412);assert.ok(a.sentAt!>=a.at);assert.doesNotMatch(JSON.stringify(a),/secret body/);}finally{f.store.close();}});
test('one persisted recovery probe and a diagnostic hold prevent retry storms',async()=>{
  const f=await fixture(),d=f.store.diagnostics,p=BiliRetryPolicySchema.parse({}),now=Date.now();try{const first=d.failure('video','risk',now,p,null);assert.equal(first.at,now+30000);assert.throws(()=>d.acquireProbe('early',now,1000),/BACKOFF/);d.acquireProbe('one',now+30001,1000);assert.throws(()=>d.acquireProbe('two',now+30002,1000),/PROBE_BUSY/);
    d.success('one','nav');assert.equal(d.state.failures,1);d.release('one');const second=d.failure('video','risk',now+30003,p,null);assert.equal(second.held,true);assert.throws(()=>d.acquireProbe('three',now+999999,1000),/DIAGNOSTIC_REQUIRED/);
  }finally{f.store.close();}
});
test('local policy uses short increasing rate waits and only a matching probe resets failures',async()=>{
  const f=await fixture(),d=f.store.diagnostics,p=BiliRetryPolicySchema.parse({}),now=Date.now();try{for(const [i,ms]of [10000,30000,60000].entries()){const at=now+i*100000;assert.equal(d.failure('video','rate-limit',at,p,null).at,at+ms);}assert.equal(d.state.held,false);d.acquireProbe('ok',now+300000,1000);d.success('ok','video');assert.equal(d.state.failures,0);}finally{f.store.close();}
});
test('non-JSON, server errors, transport failure and media headers retain truthful stages',async()=>{
  for(const kind of ['html','network','media'] as const){const f=await fixture();try{const c=new BiliClient(BiliConfigSchema.parse({}),f.store,async()=>{if(kind==='network')throw new Error('socket error with secret');return response(200,kind==='html'?'<html>not JSON</html>':'data',{'content-type':kind==='html'?'text/html':'video/mp4'});});
    if(kind==='media'){const opened=await c.external('https://cdn.bilivideo.com/a','media',null,new AbortController().signal,()=>{});opened.response.close();assert.equal(f.store.diagnostics.recent()[0]!.outcome,'headers-received');}
    else{await assert.rejects(c.read('discover',{pn:1,ps:1},new AbortController().signal,()=>{}));const a=f.store.diagnostics.recent()[0]!;assert.equal(a.kind,kind==='html'?'response':'network');assert.equal(a.httpStatus,kind==='html'?200:null);assert.doesNotMatch(JSON.stringify(a),/socket error|not JSON/);}
  }finally{f.store.close();}}
});
