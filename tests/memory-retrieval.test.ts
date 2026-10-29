import { RetrievalError,retrievalConfigSchema } from '@dafeiyu/memory/retrieval-profile';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { config,content,retrievalFixture,scope } from './retrieval-fixture.js';

test('FTS5 finds Chinese two-character names, complete body tails and exact Latin identifiers',async t=>{
  const h=await retrievalFixture();t.after(h.close);
  const first=h.seed('月舟负责检查日志缺失；错误代号 E_CONN_214。');h.seed('岳舟负责修改界面颜色；错误代号 E_AUTH_214。');
  assert.equal((await h.recall('月舟','lexical')).items[0]?.id,first.id);
  assert.equal((await h.recall('E_CONN_214','lexical')).items[0]?.id,first.id);
  const long=h.seed('普通背景。'.repeat(350)+'最后确认尾部暗号是琉璃923。');
  const result=await h.recall('琉璃923','lexical');assert.equal(result.items[0]?.id,long.id);
  assert.ok(result.items[0]!.chunk.start>512);assert.match(result.items[0]!.chunk.text,/琉璃923/);
  assert.equal(h.calls.length,0);
  const uncommon=h.seed('𠮷野负责校验编号 ＢＧＥ＿７３１。');
  assert.equal((await h.recall('𠮷野','lexical')).items[0]?.id,uncommon.id);
  assert.equal((await h.recall('BGE_731','lexical')).items[0]?.id,uncommon.id);
});

test('semantic and hybrid retrieval return evidence with stable source offsets and normalized vectors',async t=>{
  const h=await retrievalFixture();t.after(h.close);const first=h.seed('明天出门应携带雨伞。');h.seed('红豆汤已经售完。');
  const result=await h.recall('明天会有降水，出门准备什么？','semantic');
  assert.equal(result.items[0]?.id,first.id);assert.equal(result.strategyUsed,'semantic');assert.equal(result.scoreKind,'cosine');
  assert.ok(result.items[0]?.sources.length);assert.equal(result.items[0]?.chunk.offsetUnit,'unicode-codepoint');
  assert.equal(result.profile.length,64);assert.equal(result.untrustedEvidence,true);
});

test('query/document cache roles and conversation identity prevent cross-scope reuse',async t=>{
  const h=await retrievalFixture();t.after(h.close);h.seed('缓存测试');h.seed('缓存测试','b');
  await h.recall('缓存测试');const count=h.calls.length;
  const repeat=await h.recall('缓存测试');assert.equal(h.calls.length,count);assert.equal(repeat.vectorsComputed,0);
  await h.recall('缓存测试','hybrid','b');assert.ok(h.calls.length>count);
  const db=new DatabaseSync(join(h.root,'retrieval.sqlite'));t.after(()=>db.close());
  assert.equal(db.prepare("SELECT count(DISTINCT route) AS n FROM vector_cache").get()?.n,2);
  assert.equal(db.prepare("SELECT count(DISTINCT role) AS n FROM vector_cache").get()?.n,2);
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM vector_cache').all()).includes('缓存测试'));
});

test('deleted, superseded and transitively invalid memories never enter normal retrieval or embeddings',async t=>{
  const h=await retrievalFixture();t.after(h.close);const first=h.seed('删除专属内容_SENTINEL');
  const parent=h.store.read(scope(),first.id)!;
  const child=h.store.mutate(scope(),{action:'create',requestId:'child',value:{...content('派生内容_SENTINEL'),sources:[{kind:'memory',id:first.id,revision:1,contentHash:parent.contentHash}]}});
  await h.recall('内容');
  h.store.mutate(scope(),{action:'delete',requestId:'delete',id:first.id,expectedVersion:1,reason:'忘记'});
  const calls=h.calls.length;
  for(const strategy of ['lexical','semantic','hybrid'] as const)assert.equal((await h.recall('内容',strategy)).items.length,0);
  assert.equal(h.calls.length,calls);
  assert.equal((await h.recall('内容','hybrid','a',true)).items.length,0);
  assert.equal(h.store.read(scope(),child.id,'deleted')?.effectivelyDeleted,true);
  h.store.mutate(scope(),{action:'restore',requestId:'restore',id:first.id,expectedVersion:2,reason:'恢复'});
  assert.ok((await h.recall('删除专属')).items.some(item=>item.id===first.id));
  h.store.mutate(scope(),{action:'revise',requestId:'revision',id:first.id,expectedVersion:3,value:content('新的有效约定')});
  assert.ok(!(await h.recall('派生内容')).items.some(item=>item.id===child.id));
});

test('foreign scope documents do not affect candidates, lexical scores or backend inputs',async t=>{
  const h=await retrievalFixture();t.after(h.close);const own=h.seed('本群项目代号翠竹。');
  const before=await h.recall('翠竹','lexical');
  for(let i=0;i<20;i++)h.seed(`外群_PRIVATE_${i} 翠竹翠竹翠竹`,'private');
  const after=await h.recall('翠竹','lexical');assert.deepEqual(after.items,before.items);
  const semantic=await h.recall('翠竹');assert.equal(semantic.items[0]?.id,own.id);
  assert.ok(!h.calls.flat().some(text=>text.includes('PRIVATE')));
});

test('hybrid explicitly degrades when embedding is unavailable; semantic-only does not pretend success',async t=>{
  const h=await retrievalFixture();t.after(h.close);h.seed('中文全文仍可查询');
  h.dependency.embedder.embed=async()=>{throw new RetrievalError('embedding_unavailable');};
  const result=await h.recall('全文');assert.equal(result.degraded,true);assert.equal(result.strategyUsed,'lexical');assert.equal(result.items.length,1);
  await assert.rejects(h.recall('全文','semantic'),/embedding_unavailable/);
});

test('invalid vector dimensions and non-finite values are not persisted',async t=>{
  const h=await retrievalFixture();t.after(h.close);h.seed('向量校验');
  h.dependency.embedder.embed=async()=>[[NaN]];
  const result=await h.recall('校验');assert.equal(result.degradationReason,'invalid_vector');
  const db=new DatabaseSync(join(h.root,'retrieval.sqlite'));t.after(()=>db.close());assert.equal(db.prepare('SELECT count(*) AS n FROM vector_cache').get()?.n,0);
});

test('overlong queries are rejected without truncating or calling embeddings',async t=>{
  const h=await retrievalFixture();t.after(h.close);h.seed('测试文档');
  await assert.rejects(h.recall('很'.repeat(600),'semantic'),/query_too_long/);assert.equal(h.calls.length,0);
});

test('FTS query operators are treated as text and unsupported arguments cannot select a route',async t=>{
  const h=await retrievalFixture();t.after(h.close);h.seed('普通中文');
  assert.equal((await h.recall('" OR * - NEAR()','lexical')).items.length,0);
  await assert.rejects(h.retrieval.recall(scope(),{query:'中文',route:'private'},AbortSignal.timeout(5000),()=>{}));
});

test('loopback endpoint restrictions reject remote services, credentials and redirects in configuration',()=>{
  for(const endpoint of ['https://example.com/v1/embeddings','http://example.com/v1/embeddings','http://user:pass@127.0.0.1/v1/embeddings','http://127.0.0.1/v1/embeddings?next=private']){
    assert.equal(retrievalConfigSchema.safeParse({...config,endpoint}).success,false);
  }
});
