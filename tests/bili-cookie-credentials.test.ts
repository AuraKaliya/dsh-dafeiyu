import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {BiliStore} from '@dafeiyu/bilibili';
import {BiliClient} from '../packages/bilibili/lib/client.js';
import {BiliConfigSchema} from '../packages/bilibili/lib/config.js';
import {BiliRetryPolicySchema} from '../packages/bilibili/lib/diagnostics.js';
import type {BiliAttempt} from '../packages/bilibili/lib/diagnostics.js';
import type {HttpResponse} from '../packages/bilibili/lib/http.js';
import {testTempDir} from './test-temp.js';

const identity={agentId:'fish',profileId:'test'},bvid='BV1xNpFedEwH',cookieMarker='SESSDATA-marker-never-leak-0123456789';
const response=(body:string,status=200):HttpResponse=>{const bytes=Buffer.from(body);return {status,headers:{'content-type':'application/json','content-length':String(bytes.length)},body:(async function*(){yield bytes;})(),close(){}};};
const nav=(mid='42')=>JSON.stringify({code:0,data:{isLogin:true,mid,wbi_img:{img_url:'https://i0.hdslb.com/bfs/wbi/'+'a'.repeat(32)+'.png',sub_url:'https://i0.hdslb.com/bfs/wbi/'+'b'.repeat(32)+'.png'}}});
const video=()=>JSON.stringify({code:0,data:{bvid,aid:'170001',title:'Fixture video',owner:{mid:999,name:'Up'},pages:[{cid:'9',page:1,part:'p1',duration:10}],stat:{view:1,like:0},pubdate:1700000000,duration:10}});
async function fixture(options:{session?:boolean;now?:()=>number;credentialTtlMs?:number;minIntervalMs?:number;mid?:string;failure?:'none'|'login'|'network';transportDelayMs?:number}={}){
  const root=await mkdtemp(join(testTempDir(),'bili-cookie-')),file=join(root,'bilibili.sqlite'),store=new BiliStore(file,identity,true);
  const sessionFile=join(root,'session.json');
  if(options.session!==false)await writeFile(sessionFile,JSON.stringify({uid:'42',SESSDATA:cookieMarker}));
  const calls:string[]=[],cookies:(string|undefined)[]=[];
  const transport=async(url:URL,headers:Readonly<Record<string,string>>,signal:AbortSignal)=>{
    calls.push(url.pathname);cookies.push(headers.Cookie);
    if(options.transportDelayMs)await new Promise<void>((resolve,reject)=>{const timer=setTimeout(resolve,options.transportDelayMs);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new Error('aborted'));},{once:true});});
    if(options.failure==='network'&&url.pathname.endsWith('/nav'))throw new Error('socket failure with secret');
    if(url.pathname.endsWith('/nav')){
      if(options.failure==='login')return response(JSON.stringify({code:-101,message:'not logged in',data:null}));
      return response(nav(options.mid));
    }
    return response(video());
  };
  const config=BiliConfigSchema.parse({minIntervalMs:options.minIntervalMs??100,...(options.session===false?{}:{session:{file:sessionFile,expectedUid:'42'}})});
  const client=new BiliClient(config,store,transport,{...(options.now?{now:options.now}:{}),...(options.credentialTtlMs?{credentialTtlMs:options.credentialTtlMs}:{})});
  return {root,file,store,client,calls,cookies,sessionFile,close(){client.dispose();store.close();}};
}
const signal=()=>new AbortController().signal;
const count=(calls:string[],path:string)=>calls.filter(call=>call===path).length;

test('twenty business reads with one credential use one login check and twenty-one HTTP requests',{timeout:9000},async()=>{
  const f=await fixture();try{
    for(let index=0;index<20;index++)await f.client.read('video',{bvid},signal(),()=>{});
    assert.equal(count(f.calls,'/x/web-interface/nav'),1);assert.equal(count(f.calls,'/x/web-interface/view'),20);
    assert.equal(f.calls.length,21);
    assert.equal(f.client.accountStatus().engine,'verified');assert.equal(f.client.accountStatus().verifiedUid,'42');
    assert.equal(f.cookies.filter(cookie=>cookie==='SESSDATA='+cookieMarker).length,21,'nav and business requests carry the local cookie');
  }finally{f.close();}
});

test('concurrent readers share one in-flight login check',async()=>{
  const f=await fixture({transportDelayMs:20});try{
    await Promise.all(Array.from({length:6},()=>f.client.read('video',{bvid},signal(),()=>{})));
    assert.equal(count(f.calls,'/x/web-interface/nav'),1);assert.equal(count(f.calls,'/x/web-interface/view'),6);
  }finally{f.close();}
});

test('one cancelled waiter does not cancel a shared check, but all waiters releasing it stops the probe',async()=>{
  const f=await fixture({transportDelayMs:60});try{
    const first=new AbortController(),second=new AbortController();
    const a=f.client.read('video',{bvid},first.signal,()=>{}),b=f.client.read('video',{bvid},second.signal,()=>{});
    first.abort();
    await assert.rejects(a,/BILI_CANCELLED/);
    await b;
    assert.equal(count(f.calls,'/x/web-interface/nav'),1);
    assert.equal(f.client.accountStatus().engine,'verified');

    const third=new AbortController(),fourth=new AbortController();
    const c=f.client.read('video',{bvid},third.signal,()=>{}),d=f.client.read('video',{bvid},fourth.signal,()=>{});
    await new Promise(done=>setTimeout(done,5));
    third.abort();fourth.abort();
    await assert.rejects(c,/aborted|BILI_CANCELLED/);await assert.rejects(d,/aborted|BILI_CANCELLED/);
  }finally{f.close();}
});

test('a cached check expires with its local TTL and a credential content change invalidates it immediately',async()=>{
  let now=1_000_000;const f=await fixture({now:()=>now,credentialTtlMs:50});try{
    await f.client.read('video',{bvid},signal(),()=>{});assert.equal(count(f.calls,'/x/web-interface/nav'),1);
    await f.client.read('video',{bvid},signal(),()=>{});assert.equal(count(f.calls,'/x/web-interface/nav'),1);
    now+=60;
    await f.client.read('video',{bvid},signal(),()=>{});assert.equal(count(f.calls,'/x/web-interface/nav'),2,'the local recheck interval expired');

    // Reformatting the JSON must not create a new identity.
    await writeFile(f.sessionFile,JSON.stringify({uid:'42',SESSDATA:cookieMarker},null,4));
    await f.client.read('video',{bvid},signal(),()=>{});assert.equal(count(f.calls,'/x/web-interface/nav'),2,'indentation is not a credential change');
    // A new value invalidates the cached verification and re-verifies.
    await writeFile(f.sessionFile,JSON.stringify({uid:'42',SESSDATA:cookieMarker+'-new'}));
    await f.client.read('video',{bvid},signal(),()=>{});assert.equal(count(f.calls,'/x/web-interface/nav'),3);
    assert.equal(f.cookies.filter(cookie=>cookie===('SESSDATA='+cookieMarker+'-new')).length,2);
  }finally{f.close();}
});

test('login failure, UID mismatch, local format errors and network errors are classified separately',async()=>{
  const login=await fixture({failure:'login'});try{
    await assert.rejects(login.client.read('video',{bvid},signal(),()=>{}),/BILI_LOGIN_REQUIRED/);
    assert.equal(login.client.accountStatus().engine,'expired');
  }finally{login.close();}
  const mismatch=await fixture({mid:'43'});try{
    await assert.rejects(mismatch.client.read('video',{bvid},signal(),()=>{}),/BILI_ACCOUNT_MISMATCH/);
    assert.equal(mismatch.client.accountStatus().engine,'mismatch');
  }finally{mismatch.close();}
  const network=await fixture({failure:'network'});try{
    await assert.rejects(network.client.read('video',{bvid},signal(),()=>{}),/BILI_HTTP_FAILED/);
    const state=network.client.accountStatus();
    assert.notEqual(state.engine,'expired');assert.equal(state.lastResult?.kind,'failure');
  }finally{network.close();}
  const invalid=await fixture({session:false});try{
    const localFile=join(invalid.root,'session.json');
    const client=new BiliClient(BiliConfigSchema.parse({session:{file:localFile,expectedUid:'42'}}),invalid.store,async(url)=>{invalid.calls.push(url.pathname);return response(video());});
    try{
      await writeFile(localFile,JSON.stringify({uid:'42',SESSDATA:'bad;value'}));
      await assert.rejects(client.read('video',{bvid},signal(),()=>{}),/BILI_SESSION_INVALID/);
      assert.equal(invalid.calls.length,0,'a local format error never sends a business request');
      await writeFile(localFile,JSON.stringify({uid:'43',SESSDATA:'fine'}));
      await assert.rejects(client.read('video',{bvid},signal(),()=>{}),/BILI_ACCOUNT_MISMATCH/);
      assert.equal(invalid.calls.length,0,'a configured UID mismatch never sends a business request');
    }finally{client.dispose();}
  }finally{invalid.close();}
});

test('anonymous holds never block a verified account while shared holds do',async()=>{
  const anonymous=await fixture({session:false});try{
    const sessionFile=join(anonymous.root,'session.json');
    await writeFile(sessionFile,JSON.stringify({uid:'42',SESSDATA:cookieMarker}));
    let failures=0;const failing=new BiliClient(BiliConfigSchema.parse({minIntervalMs:100}),anonymous.store,async()=>{failures++;return response(JSON.stringify({code:-352,data:null}));});
    await assert.rejects(failing.read('video',{bvid},signal(),()=>{}),/BACKOFF/);
    await assert.rejects(failing.read('video',{bvid},signal(),()=>{}),/BACKOFF/);
    assert.equal(failures,1);failing.dispose();
    // A scoped anonymous pause exists; a verified client on the same store still reads over HTTP.
    const verified=new BiliClient(BiliConfigSchema.parse({minIntervalMs:100,session:{file:sessionFile,expectedUid:'42'}}),anonymous.store,async(url)=>url.pathname.endsWith('/nav')?response(nav()):response(video()));
    try{
      await verified.read('video',{bvid},signal(),()=>{});
      assert.equal(verified.accountStatus().engine,'verified');
      assert.equal(verified.status().pauses.some(pause=>pause.scope==='anonymous-http'),true,'anonymous pause history is preserved');
      // A shared pause applies to every route.
      anonymous.store.diagnostics.failure('video','login',Date.now(),BiliRetryPolicySchema.parse({}),null,'shared',null);
      await assert.rejects(verified.read('video',{bvid},signal(),()=>{}),/BILI_DIAGNOSTIC_REQUIRED/);
    }finally{verified.dispose();}
  }finally{anonymous.close();}
});

test('a bounded management permit bypasses only evidence-backed anonymous pauses',async()=>{
  const f=await fixture({session:false});try{
    const policy=BiliRetryPolicySchema.parse({}),now=Date.now(),endpoint='video';
    // Evidence recorded by an actual anonymous attempt, then two failures so the pause is held with a past cooldown.
    const attempt:BiliAttempt={id:randomUUID(),at:now-120000,sentAt:now-120000,endedAt:now-120000,transport:'http',auth:'anonymous',origin:'maintenance',taskId:null,runId:null,operationId:null,
      networkSent:true,httpStatus:200,platformCode:-352,endpoint,contentType:'application/json',retryAfter:null,retryAt:null,waitSource:null,outcome:'failed',errorCode:'BILI_BACKOFF',kind:'risk'};
    f.store.diagnostics.record(attempt);
    f.store.diagnostics.failure(endpoint,'risk',now-120000,policy,now-30000,'anonymous-http',null);
    f.store.diagnostics.failure(endpoint,'risk',now-60000,policy,now-30000,'anonymous-http',null);
    const pause=f.store.diagnostics.pauses[0]!;
    assert.equal(pause.held,true);assert.equal(pause.until<now,true);
    const permit=f.store.diagnostics.authorizeProbe({scope:'anonymous-http',uid:null,endpoint,credentialGeneration:1,instanceGeneration:1,now});
    assert.throws(()=>f.store.diagnostics.acquireProbe('no-permit',now,1000,undefined,{scope:'anonymous-http',uid:null,endpoint}),/DIAGNOSTIC_REQUIRED/);
    f.store.diagnostics.acquireProbe('probe',now,1000,permit.id,{scope:'anonymous-http',uid:null,endpoint});
    f.store.diagnostics.assertAvailable({scope:'anonymous-http',uid:null,endpoint},now);
    f.store.diagnostics.release('probe');
    // A shared hold cannot be released through a management permit.
    f.store.diagnostics.failure('video','login',now,policy,null,'shared',null);
    assert.throws(()=>f.store.diagnostics.authorizeProbe({scope:'anonymous-http',uid:null,endpoint,credentialGeneration:1,instanceGeneration:1,now}),/BILI_PROBE_NOT_PERMITTED/);
  }finally{f.close();}
});

test('management status and diagnostics never contain the credential, path or fingerprint',async()=>{
  const f=await fixture();try{
    await f.client.read('video',{bvid},signal(),()=>{});
    const payload=JSON.stringify({status:f.client.status(),account:f.client.accountStatus(),attempts:f.store.diagnostics.recent(10)});
    assert.equal(payload.includes(cookieMarker),false);assert.equal(payload.includes('SESSDATA='),false);assert.equal(payload.includes(f.sessionFile),false);
    assert.doesNotMatch(payload,/fingerprint/i);
  }finally{f.close();}
});
