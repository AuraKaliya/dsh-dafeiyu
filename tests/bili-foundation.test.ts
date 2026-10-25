import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer,request } from 'node:http';
import type { Server } from 'node:http';
import type { ExecutionContextV3,ExecutionGrant } from '@dafeiyu/contracts';
import { taskScopeKey } from '@dafeiyu/contracts';
import { BiliStore } from '@dafeiyu/bilibili';
import { BiliConfigSchema } from '../packages/bilibili/lib/config.js';
import { BiliClient } from '../packages/bilibili/lib/client.js';
import { biliUrl,publicAddress,boundedJson } from '../packages/bilibili/lib/http.js';
import type { HttpTransport,HttpResponse } from '../packages/bilibili/lib/http.js';
import { testTempDir } from './test-temp.js';

async function fixture(){const root=await mkdtemp(join(testTempDir(),'bili-')),file=join(root,'bilibili.sqlite'),identity={agentId:'fish',profileId:'test'},taskId=randomUUID(),context:ExecutionContextV3={agentId:'fish',taskId,scope:{kind:'task',agentId:'fish',taskId,scopeKey:taskScopeKey('fish',taskId)},runId:randomUUID(),operationId:randomUUID(),origin:{kind:'native',producerId:'fixture',requestId:'start'},intentVersion:1,grant:{} as ExecutionGrant,signal:new AbortController().signal};
  return {root,file,identity,context,store:new BiliStore(file,identity,true)};}
const response=(data:unknown,status=200):HttpResponse=>{const bytes=Buffer.from(JSON.stringify(data));return {status,headers:{'content-length':String(bytes.length)},body:(async function*(){yield bytes;})(),close(){}};};
const page={kind:'discover' as const,sourceKey:'popular:1',data:{titles:['虚构天文']},coverage:['本页'],fields:[{id:'title:0',text:'虚构天文'}]};

test('Bili v1 validates identity, preserves immutable observations and recovers without replaying requests',async()=>{const f=await fixture();let store=f.store;try{
  assert.equal(store.begin(f.context,'one',{page:1}),null);const saved=store.complete(f.context,'one',page);assert.deepEqual(store.begin(f.context,'one',{page:1}),saved);assert.throws(()=>store.begin(f.context,'one',{page:2}),/IDEMPOTENCY_CONFLICT/);
  assert.equal(store.current(store.proof(saved)),true);assert.throws(()=>store.page('b'.repeat(64),saved.id),/UNAVAILABLE/);store.begin(f.context,'pending',{});store.backoff(Date.now(),60000);store.close();
  const before=await readFile(f.file);assert.throws(()=>new BiliStore(f.file,{...f.identity,agentId:'other'}),/IDENTITY/);assert.deepEqual(await readFile(f.file),before);
  store=new BiliStore(f.file,f.identity);assert.equal(store.recover(),1);assert.throws(()=>store.begin(f.context,'pending',{}),/PROCESS_INTERRUPTED/);assert.equal(store.begin(f.context,'one',{page:1})?.id,saved.id);assert.throws(()=>store.reserveRequest(Date.now(),100,1000),/BACKOFF/);
  store.begin(f.context,'two',{});store.complete(f.context,'two',{...page,data:{titles:['内容改变']}});assert.equal(store.current(store.proof(saved)),false);
  const count=store.counts.pages;assert.throws(()=>store.complete(f.context,'missing',page),/STATE_CONFLICT/);assert.equal(store.counts.pages,count);
}finally{store.close();}});

test('Bili endpoints, signed parameters and account binding are program controlled',async()=>{const f=await fixture();try{const calls:{url:URL;headers:Readonly<Record<string,string>>}[]=[],transport:HttpTransport=async(url,headers)=>{calls.push({url,headers});return response(url.pathname.endsWith('/nav')?{code:0,data:{isLogin:true,mid:42,wbi_img:{img_url:'https://i0.hdslb.com/bfs/wbi/'+'a'.repeat(32)+'.png',sub_url:'https://i0.hdslb.com/bfs/wbi/'+'b'.repeat(32)+'.png'}}}:{code:0,data:{ok:true}});};
  const file=join(f.root,'session.json');await writeFile(file,JSON.stringify({uid:'42',SESSDATA:'fictional-only'}));const client=new BiliClient(BiliConfigSchema.parse({minIntervalMs:100,session:{file,expectedUid:'42'}}),f.store,transport),signal=new AbortController().signal;
  await assert.rejects(client.read('video',{bvid:'BV1xx411c7mD',url:'https://elsewhere'},signal,()=>{}));assert.equal(calls.length,0);
  assert.deepEqual(await client.read('player',{bvid:'BV1xx411c7mD',cid:'10'},signal,()=>{}),{ok:true});assert.equal(calls.length,2);assert.equal(calls[1]!.url.pathname,'/x/player/wbi/v2');assert.match(calls[1]!.url.searchParams.get('w_rid')!,/^[a-f0-9]{32}$/);assert.equal(calls[1]!.headers.Cookie,'SESSDATA=fictional-only');
  const external=await client.external('https://i0.hdslb.com/subtitle.json','subtitle',null,signal,()=>{});external.response.close();assert.equal(calls.at(-1)!.headers.Cookie,undefined);
  const bad=new BiliClient(BiliConfigSchema.parse({session:{file,expectedUid:'43'}}),f.store,transport);await assert.rejects(bad.read('video',{bvid:'BV1xx411c7mD'},signal,()=>{}),/ACCOUNT_MISMATCH/);assert.equal(calls.length,3);
}finally{f.store.close();}});

test('HTTP and platform risk responses persist backoff and never retry automatically',async()=>{for(const failure of [response({},412),response({code:-352,data:null})]){const f=await fixture();try{let calls=0;const client=new BiliClient(BiliConfigSchema.parse({}),f.store,async()=>{calls++;return failure;}),signal=new AbortController().signal;
  await assert.rejects(client.read('discover',{pn:1,ps:2},signal,()=>{}),/BACKOFF/);await assert.rejects(client.read('discover',{pn:2,ps:2},signal,()=>{}),/BACKOFF/);await assert.rejects(client.external('https://cdn.bilivideo.com/video','media',null,signal,()=>{}),/BACKOFF/);assert.equal(calls,1);assert.ok(f.store.clock.blockedUntil>Date.now());
}finally{f.store.close();}}});

test('response budgets and origin restrictions reject malformed or excessive input',async()=>{const f=await fixture();try{let closed=false;const client=new BiliClient(BiliConfigSchema.parse({maxResponseBytes:1024}),f.store,async()=>({status:200,headers:{'content-length':'1025'},body:(async function*(){throw new Error('MUST_NOT_READ');})(),close(){closed=true;}}));
  await assert.rejects(client.read('discover',{pn:1,ps:1},new AbortController().signal,()=>{}),/RESPONSE_LIMIT/);assert.equal(closed,true);
  assert.throws(()=>boundedJson(Buffer.from('['.repeat(34)+'0'+']'.repeat(34))),/COMPLEXITY/);assert.throws(()=>boundedJson(Buffer.from('{bad')),/INVALID_JSON/);
  for(const url of ['http://api.bilibili.com/a','https://api.bilibili.com.evil.test/a','https://x.bilivideo.com@evil.test/a','https://127.0.0.1/a','https://x.bilivideo.com:444/a'])assert.throws(()=>biliUrl(url,'media'));
  assert.equal(biliUrl('https://cdn.bilivideo.com/a','media').hostname,'cdn.bilivideo.com');for(const ip of ['127.0.0.1','10.0.0.1','192.168.1.1','100.64.1.2','169.254.1.1','::1'])assert.equal(publicAddress(ip),false);assert.equal(publicAddress('8.8.8.8'),true);
}finally{f.store.close();}});

test('actual loopback HTTP fixture observes cancellation and does not follow redirects',async()=>{const f=await fixture();let server:Server|undefined;try{let requests=0;server=createServer((req,res)=>{requests++;if(req.url?.includes('pn=2')){res.writeHead(302,{Location:'https://example.invalid/'}).end();return;}if(req.url?.includes('pn=3'))return;res.end(JSON.stringify({code:0,data:{list:[]}}));});await new Promise<void>(done=>server!.listen(0,'127.0.0.1',done));const address=server.address();assert.ok(address&&typeof address!=='string');
  const transport:HttpTransport=(url,_headers,signal)=>new Promise((done,reject)=>{const req=request({hostname:'127.0.0.1',port:address.port,path:url.pathname+url.search,signal},res=>done({status:res.statusCode!,headers:{},body:res,close:()=>res.destroy()}));req.on('error',reject);req.end();});
  const client=new BiliClient(BiliConfigSchema.parse({minIntervalMs:100}),f.store,transport);assert.deepEqual(await client.read('discover',{pn:1,ps:1},new AbortController().signal,()=>{}),{list:[]});await assert.rejects(client.read('discover',{pn:2,ps:1},new AbortController().signal,()=>{}),/REDIRECT/);
  const controller=new AbortController(),timer=globalThis.setTimeout(()=>controller.abort(),250);await assert.rejects(client.read('discover',{pn:3,ps:1},controller.signal,()=>{}));clearTimeout(timer);assert.equal(requests,3);
}finally{server?.closeAllConnections();if(server)await new Promise<void>(done=>server!.close(()=>done()));f.store.close();}});
