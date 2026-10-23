import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { LoopbackEmbedder } from '@dafeiyu/memory/retrieval-clients';
import { loadProfile } from '@dafeiyu/memory/retrieval-profile';
import { memoryFixture } from './memory-fixture.js';
import { config, fakeDependencies } from './retrieval-fixture.js';
import { call, textReply } from './harness.js';

function okay<T extends {status:string}>(value:T):Extract<T,{status:'ok'}>{assert.equal(value.status,'ok');return value as Extract<T,{status:'ok'}>;}

test('registered recall tool uses real DSH scope and returns source-bearing snippets',async t=>{
  const fake=fakeDependencies();const h=await memoryFixture(undefined,{retrieval:config},fake.dependency);t.after(h.close);
  const source=await h.evidence('a','虚构记录：月舟处理日志缺失。');
  const saved=okay(await h.probe('a',c=>h.memory.create(c,{requestId:randomUUID(),kind:'knowledge',claimType:'self_report',content:'月舟处理日志缺失。',sourceRefs:[source.ref]})));
  let step=0;h.setResponse(()=>++step===1?call('dafeiyu_memory_recall',{query:'月舟',strategy:'hybrid',limit:'5'}):textReply('检索完成'));
  h.simulator.send('a','查询月舟负责的事情',{id:randomUUID()});await h.core.whenIdle();
  const request=h.adapter.requests.at(-1)!;assert.match(JSON.stringify(request),/unicode-codepoint/);assert.match(JSON.stringify(request),new RegExp(saved.id));
  assert.equal(request.tools?.filter(tool=>tool.name.startsWith('dafeiyu_memory_')).length,9);
  const other=okay(await h.probe('b',c=>h.memory.recall(c,{query:'月舟'})));assert.equal(other.items.length,0);
  const events=h.core.journal.events(source.message.route).filter(e=>e.type==='memory.recalled');assert.equal(events.length,1);assert.ok(!JSON.stringify(events).includes('月舟'));
});

test('model recall cannot choose another profile or use an expired authority',async t=>{
  const fake=fakeDependencies();const h=await memoryFixture(undefined,{retrieval:config},fake.dependency);t.after(h.close);
  assert.deepEqual(await h.probe('a',c=>h.memory.recall(c,{query:'测试',profile:'another'})),{status:'invalid_input'});
  await h.probe('a',async c=>{await assert.rejects(h.memory.recall({...c},{query:'测试'}),/core-issued/);return null;});
});

test('unload while semantic inference is pending revokes reads and prevents cache writes',async t=>{
  const fake=fakeDependencies();const h=await memoryFixture(undefined,{retrieval:config},fake.dependency);t.after(h.close);
  const source=await h.evidence();okay(await h.probe('a',c=>h.memory.create(c,{requestId:randomUUID(),kind:'knowledge',claimType:'self_report',content:'注销期间的虚构内容',sourceRefs:[source.ref]})));
  const original=fake.dependency.embedder.embed;
  fake.dependency.embedder.embed=async(...args)=>{const value=await original(...args);await h.memoryFiber.dispose();return value;};
  await assert.rejects(h.probe('a',c=>h.memory.recall(c,{query:'虚构'})),/unregistered/);
  const db=new DatabaseSync(join(h.root,'retrieval.sqlite'));try{assert.equal(db.prepare('SELECT count(*) AS n FROM vector_cache').get()?.n,0);}finally{db.close();}
});

test('authorized deletion during tokenization returns stale state and leaves no indexed text',async t=>{
  const fake=fakeDependencies();const h=await memoryFixture(undefined,{retrieval:config},fake.dependency);t.after(h.close);
  const source=await h.evidence();const item=okay(await h.probe('a',c=>h.memory.create(c,{requestId:randomUUID(),kind:'knowledge',claimType:'self_report',content:'TOKEN_PENDING_SENTINEL',sourceRefs:[source.ref]})));
  const result=await h.probe('a',c=>{
    const original=fake.dependency.tokenizer.chunks;
    fake.dependency.tokenizer.chunks=async(...args)=>{const value=await original(...args);h.memory.delete(c,{requestId:randomUUID(),id:item.id,expectedVersion:1,reason:'读取期间删除'});return value;};
    return h.memory.recall(c,{query:'PENDING'});
  });assert.deepEqual(result,{status:'stale_state'});
  const db=new DatabaseSync(join(h.root,'retrieval.sqlite'));try{assert.equal(db.prepare('SELECT count(*) AS n FROM chunks').get()?.n,0);}finally{db.close();}
});

test('loopback HTTP adapter validates model identity, dimensions, response order and redirects',async t=>{
  let mode='good',postCalls=0;
  const server=createServer((req,res)=>{
    res.setHeader('content-type','application/json');
    if(mode==='unavailable'){res.writeHead(503);res.end(JSON.stringify({error:'fixture unavailable'}));return;}
    if(req.url==='/health'){res.end(JSON.stringify({model:mode==='wrong-model'?'different':'BAAI/bge-small-zh-v1.5',dimension:512,model_loaded:true}));return;}
    if(mode==='redirect'){res.writeHead(302,{location:'http://127.0.0.1:1/forbidden'});res.end();return;}
    let body='';req.on('data',part=>{body+=part;});req.on('end',()=>{postCalls++;const request=JSON.parse(body);const vector=Array<number>(512).fill(0);vector[0]=1;
      res.end(JSON.stringify({model:'BAAI/bge-small-zh-v1.5',data:request.input.map((_text:string,index:number)=>({index:mode==='wrong-order'?index+1:index,embedding:mode==='wrong-dimension'?[1]:vector}))}));});
  });server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())));
  const address=server.address();assert.ok(address&&typeof address!=='string');
  const client=new LoopbackEmbedder({...config,endpoint:`http://127.0.0.1:${address.port}/v1/embeddings`},loadProfile().profile);t.after(()=>client.close());
  assert.equal((await client.embed(['虚构请求'],AbortSignal.timeout(3000)))[0]?.length,512);
  mode='unavailable';await assert.rejects(client.embed(['虚构请求'],AbortSignal.timeout(3000)),/embedding_unavailable/);
  mode='wrong-model';await assert.rejects(client.embed(['虚构请求'],AbortSignal.timeout(3000)),/profile_mismatch/);assert.equal(postCalls,1);
  mode='wrong-order';await assert.rejects(client.embed(['虚构请求'],AbortSignal.timeout(3000)),/invalid_vector/);
  mode='wrong-dimension';await assert.rejects(client.embed(['虚构请求'],AbortSignal.timeout(3000)),/invalid_vector/);
  mode='redirect';await assert.rejects(client.embed(['虚构请求'],AbortSignal.timeout(3000)),/embedding_unavailable/);
});
