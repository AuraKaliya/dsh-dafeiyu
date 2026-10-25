import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,readFile,symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { QqStore,inspectQqSchema } from '@dafeiyu/channel-qq';
import type { Conversation,MediaByteStream } from '@dafeiyu/contracts';
import { QqMediaReader,QqMediaConfigSchema,publicIpv4 } from '../packages/channel-qq/lib/media-reader.js';
import { testTempDir } from './test-temp.js';
import { OneBot } from '../packages/channel-qq/lib/onebot.js';
const scene:Conversation={channel:'qq',account:'100001',kind:'group',id:'200001'},route=JSON.stringify([scene.account,scene.kind,scene.id]);
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const metadata={occurredAt:'2026-10-25T00:00:00Z',unsupported:['image']};
async function bytes(stream:MediaByteStream){const chunks:Buffer[]=[];for await(const chunk of stream.stream)chunks.push(Buffer.from(chunk));return Buffer.concat(chunks);}

test('QQ media descriptors bind actual account, message and segment while keeping platform handles out of public data',async()=>{
  const root=await mkdtemp(join(testTempDir(),'qq-media-store-')),file=join(root,'qq.sqlite'),store=new QqStore(file);
  try{store.remember(route,'m1','sender','文字',metadata);const parts=[{type:'image',data:{file:'private-platform-handle',url:'https://fixture.invalid/private-url',name:'image.png',file_size:5}}];
    const ids=store.media.remember(scene,'m1','sender',hash(parts),parts),description=store.media.describe(ids[0]!);assert.equal(description.ref.provider,'qq-media');assert.deepEqual(description.origin.roots,['qq:100001:group:200001:message:m1']);
    assert.ok(!JSON.stringify(description).includes('private-platform'));assert.ok(!JSON.stringify(description).includes('private-url'));assert.equal(store.media.locator(description.ref.key).file,'private-platform-handle');
    assert.equal(store.media.current(description.origin),true);assert.deepEqual(store.media.list({...scene,id:'foreign'},'m1'),[]);assert.deepEqual(store.media.remember(scene,'m1','sender',hash(parts),parts),ids);
    const revised=[{type:'image',data:{file:'new-platform-handle'}}];store.media.remember(scene,'m1','sender',hash(revised),revised);assert.equal(store.media.current(description.origin),false);assert.throws(()=>store.media.reference(description.ref.key),/SOURCE_STALE/);
    const current=store.media.describe(ids[0]!);store.media.prune(0);assert.equal(store.media.current(current.origin),true);assert.throws(()=>store.media.locator(current.ref.key),/HANDLE_EXPIRED/);
    const epoch=store.media.epoch();store.cache.revoke(route,'m1');assert.notEqual(store.media.epoch(),epoch);assert.equal(store.media.current(current.origin),false);assert.deepEqual(store.media.remember(scene,'m1','sender',hash(parts),parts),[]);
  }finally{store.close();}
});

test('explicit QQ v4 migration preserves text hashes, receipts and ledger bodies without inventing media',async()=>{
  const root=await mkdtemp(join(testTempDir(),'qq-media-migration-')),file=join(root,'qq.sqlite');let store=new QqStore(file);store.remember(route,'old','sender','保留的旧文字',metadata);store.sent('reply','receipt');const page=store.cache.browse(route,'owner',{requestId:'before'});store.close();
  const db=new DatabaseSync(file);db.exec('DROP TABLE qq_media_sources;DROP TABLE qq_media_drafts;DROP TABLE qq_media_deliveries;DROP TABLE qq_media_parts;PRAGMA user_version=4;');const old=db.prepare('SELECT * FROM qq_message_meta').all();assert.equal(inspectQqSchema(db).supported,true);db.close();const before=await readFile(file);
  assert.throws(()=>new QqStore(file),/MIGRATION_REQUIRED/);assert.deepEqual(await readFile(file),before);store=new QqStore(file,{migrate:true});try{assert.equal(store.receipt('reply'),'receipt');assert.equal(store.cache.proofCurrent(page.proof),true);assert.deepEqual(store.media.list(scene,'old'),[]);}finally{store.close();}
  const migrated=new DatabaseSync(file);try{assert.equal(inspectQqSchema(migrated).version,5);assert.deepEqual(migrated.prepare('SELECT * FROM qq_message_meta').all(),old);}finally{migrated.close();}
});

test('controlled cache files support verified ranges and reject outside paths, aliases, mutation and revocation',async()=>{
  const root=await mkdtemp(join(testTempDir(),'qq-media-path-')),cache=join(root,'cache');await mkdir(cache);const file=join(cache,'audio.wav');await writeFile(file,'0123456789');const reader=new QqMediaReader(QqMediaConfigSchema.parse({cacheRoots:[cache]})),signal=new AbortController().signal;
  const range=await reader.local(file,{start:2,end:5},signal,()=>{});assert.equal(range.totalBytes,10);assert.deepEqual(range.range,{start:2,end:5});assert.equal((await bytes(range)).toString(),'2345');
  const outside=join(root,'private.txt');await writeFile(outside,'unrelated');await assert.rejects(reader.local(outside,null,signal,()=>{}),/PATH_DENIED/);
  await symlink(root,join(cache,'alias'),'junction');await assert.rejects(reader.local(join(cache,'alias/private.txt'),null,signal,()=>{}),/PATH_DENIED/);
  await assert.rejects(reader.local('\\\\server\\share\\private',null,signal,()=>{}),/PATH_DENIED/);await assert.rejects(reader.local(file+':stream',null,signal,()=>{}),/PATH_DENIED/);
  const changed=await reader.local(file,null,signal,()=>{});await writeFile(file,'changed!!!');await assert.rejects(bytes(changed),/FILE_CHANGED/);
  let valid=true;const revoked=await reader.local(file,null,signal,()=>{if(!valid)throw new Error('SOURCE_STALE');});valid=false;await assert.rejects(bytes(revoked),/SOURCE_STALE/);
});

test('platform audio handles request actual conversion and identity is checked around source reads',async()=>{
  const root=await mkdtemp(join(testTempDir(),'qq-media-api-')),file=join(root,'converted.wav');await writeFile(file,'converted PCM fixture');const reader=new QqMediaReader(QqMediaConfigSchema.parse({cacheRoots:[root]})),calls:unknown[]=[];let verified=0;
  const api={verify:async()=>{verified++;},call:async(action:string,params:object)=>{calls.push({action,params});return {file};}};
  const result=await reader.resolve(api,'audio',{file:'actual-silk-handle'},null,new AbortController().signal,()=>{});assert.equal((await bytes(result)).toString(),'converted PCM fixture');assert.deepEqual(calls,[{action:'get_record',params:{file:'actual-silk-handle',out_format:'wav'}}]);assert.equal(verified,3);
  await assert.rejects(reader.resolve(api,'audio',{url:'https://fixture.invalid/raw-silk'},null,new AbortController().signal,()=>{}),/CONVERSION_REQUIRED/);
});

test('media HTTPS rejects credentials, redirects to other protocols and non-public destinations before any download',async()=>{
  for(const address of ['127.0.0.1','10.1.2.3','169.254.169.254','100.64.0.1','172.31.1.1','192.168.1.1','198.18.0.1','203.0.113.1','224.1.1.1','::1'])assert.equal(publicIpv4(address),false,address);assert.equal(publicIpv4('8.8.8.8'),true);
  const reader=new QqMediaReader(QqMediaConfigSchema.parse({httpsHosts:['localhost','fixture.invalid']})),signal=new AbortController().signal;
  for(const url of ['https://user:pass@fixture.invalid/file','https://fixture.invalid:8443/file','https://unlisted.invalid/file','https://127.0.0.1/file'])await assert.rejects(reader.open(url,null,signal,()=>{}),/URL_DENIED/);
  await assert.rejects(reader.open('https://localhost/file',null,signal,()=>{}),/ADDRESS_DENIED/);
});

test('real loopback OneBot metadata requests use the declared file API and reject oversized responses',async()=>{
  let oversized=false;const server=createServer(async(req,res)=>{assert.equal(req.headers.authorization,'Bearer synthetic-metadata-token');assert.equal(req.url,'/get_file');let raw='';for await(const chunk of req)raw+=String(chunk);assert.deepEqual(JSON.parse(raw),{file_id:'fixture-handle'});
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:'ok',retcode:0,data:{file:oversized?'x'.repeat(3*1024**2):'synthetic-local-path'}}));});
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const address=server.address();assert.ok(address&&typeof address!=='string');
  try{const api=new OneBot(`http://127.0.0.1:${address.port}/`,'synthetic-metadata-token','100001',2000);assert.deepEqual(await api.call('get_file',{file_id:'fixture-handle'}),{file:'synthetic-local-path'});oversized=true;await assert.rejects(api.call('get_file',{file_id:'fixture-handle'}),/RESPONSE_LIMIT/);}
  finally{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
});
