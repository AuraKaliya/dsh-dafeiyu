import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { testTempDir as tmpdir } from './test-temp.js';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { MemoryStore, MEMORY_SCHEMA_VERSION } from '@dafeiyu/memory/store';
import { MemoryBoundarySchema,boundaryAllows,conversationKey } from '@dafeiyu/contracts';
import { scope,content,retrievalFixture } from './retrieval-fixture.js';
import { memoryFixture } from './memory-fixture.js';
import { provenanceFixture } from './provenance-fixture.js';
import { fragmentFixture } from './fragment-fixture.js';
import { Worker } from 'node:worker_threads';

async function path(){return join(await mkdtemp(join(tmpdir(),'dafeiyu-boundary-')),'memory.sqlite');}
test('new records independently bind owner, verified source scene, namespaced task and two ranges',async t=>{
  const file=await path(),store=new MemoryStore(file);t.after(()=>store.close());const conversation={channel:'qq',account:'fictional-bot',kind:'group' as const,id:'group-a'};
  const s=scope(conversationKey('fish',conversation)),item=store.mutate(s,{action:'create',requestId:'new',value:content('虚构任务资料')},
    {conversation,ingressPluginId:'channel-qq',taskId:'investigate'});
  const boundary=store.read(s,item.id)!.boundary;
  assert.equal(boundary.owner.agentId,'fish');assert.deepEqual(boundary.task,{kind:'conversation-task',route:s.route,id:'investigate'});
  assert.deepEqual(boundary.sourceScene,{kind:'conversation',route:s.route,conversation,ingressPluginId:'channel-qq'});
  assert.equal(boundaryAllows(boundary,{...s,route:'different'},'internal'),false);
  assert.equal(boundaryAllows(boundary,{...s,agentId:'different'},'expression'),false);
  assert.throws(()=>store.mutate(s,{action:'create',requestId:'forged-scene',value:content('不得提交')},{conversation:{...conversation,id:'other'}}),/scene/);
  assert.equal(store.search(s,'normal',{query:'不得提交',limit:10}).items.length,0);
});
test('internal use does not grant expression and source restrictions propagate through multiple generations',async t=>{
  const store=new MemoryStore(await path());t.after(()=>store.close());const s=scope();
  const parent=store.mutate(s,{action:'create',requestId:'private',value:content('INTERNAL_ONLY'),boundaryPolicy:{externalExpression:'none'}});
  assert.equal(store.read(s,parent.id),null);const p=store.read(s,parent.id,'normal',undefined,'internal')!;assert.equal(p.content,'INTERNAL_ONLY');
  const child=store.mutate(s,{action:'create',requestId:'child',value:{...content('DERIVED_PRIVATE'),sources:[{kind:'memory',id:p.id,revision:p.revision,contentHash:p.contentHash}]}});
  const c=store.read(s,child.id,'normal',undefined,'internal')!;assert.equal(c.boundary.externalExpression.kind,'none');assert.equal(store.read(s,child.id),null);
  const grandchild=store.mutate(s,{action:'create',requestId:'grandchild',value:{...content('SECOND_DERIVATION'),sources:[{kind:'memory',id:c.id,revision:c.revision,contentHash:c.contentHash}]}});
  assert.equal(store.read(s,grandchild.id),null);assert.equal(store.read(s,grandchild.id,'normal',undefined,'internal')!.boundary.externalExpression.kind,'none');
  assert.equal(store.search(s,'normal',{query:'',limit:50}).items.length,0);assert.equal([...store.current(s)].length,0);
});
test('narrowing expression cannot be bypassed by history, revised sources, restoration or an explicit widening request',async t=>{
  const store=new MemoryStore(await path());t.after(()=>store.close());const s=scope(),value=content('原文保持');
  const first=store.mutate(s,{action:'create',requestId:'first',value});const hash=store.read(s,first.id)!.contentHash;
  store.mutate(s,{action:'revise',requestId:'narrow',id:first.id,expectedVersion:1,value,boundaryPolicy:{externalExpression:'none'}});
  assert.equal(store.read(s,first.id,'history',1),null);assert.equal(store.read(s,first.id,'normal',undefined,'internal')!.contentHash,hash);
  const old=store.read(s,first.id,'history',1,'internal')!;assert.equal(old.boundary.externalExpression.kind,'conversation');assert.equal(old.effectiveAccess.externalExpression.kind,'none');
  assert.throws(()=>store.mutate(s,{action:'revise',requestId:'expand',id:first.id,expectedVersion:2,value,boundaryPolicy:{externalExpression:'conversation'}}),/scope_expansion/);
  assert.equal(store.read(s,first.id,'normal',undefined,'internal')!.version,2);
  store.mutate(s,{action:'delete',requestId:'delete',id:first.id,expectedVersion:2,reason:'虚构删除'});
  assert.equal(store.read(s,first.id,'deleted'),null);assert.ok(store.read(s,first.id,'deleted',undefined,'internal'));
  store.mutate(s,{action:'restore',requestId:'restore',id:first.id,expectedVersion:3,reason:'虚构恢复'});
  assert.equal(store.read(s,first.id),null);assert.equal(store.read(s,first.id,'normal',undefined,'internal')!.version,4);
});
test('missing or corrupted boundary records fail closed; immutable boundaries cannot be edited in place',async t=>{
  const file=await path(),store=new MemoryStore(file);t.after(()=>store.close());const s=scope(),one=store.mutate(s,{action:'create',requestId:'one',value:content('SECRET')});
  const db=new DatabaseSync(file);t.after(()=>db.close());assert.throws(()=>db.exec('UPDATE memory_boundaries SET body=body'),/Immutable/);assert.throws(()=>db.exec('DELETE FROM memory_boundaries'),/Retain/);
  db.exec('DROP TRIGGER boundaries_no_update');db.prepare('UPDATE memory_boundaries SET boundary_hash=? WHERE id=?').run('corrupt',one.id);
  assert.equal(store.read(s,one.id),null);assert.equal(store.read(s,one.id,'normal',undefined,'internal'),null);assert.equal([...store.current(s)].length,0);
});
test('invalid owner-wide/public policies are not representable in the stage-A authority model',()=>{
  const boundary={schemaVersion:1,policyVersion:1,owner:{kind:'agent',agentId:'fish'},sourceScene:{kind:'legacy-route',route:'a'},task:{kind:'unassigned'},
    internalUse:{kind:'agent'},externalExpression:{kind:'public'},assignment:'conservative-create'};
  assert.equal(MemoryBoundarySchema.safeParse(boundary).success,false);
});
test('policy mutation and sidecar insertion roll back with a failed event write',async t=>{
  const file=await path(),store=new MemoryStore(file);t.after(()=>store.close());const db=new DatabaseSync(file);t.after(()=>db.close());
  db.exec("CREATE TRIGGER fail_bound_event BEFORE INSERT ON memory_events BEGIN SELECT RAISE(ABORT,'fixture event failure'); END;");
  assert.throws(()=>store.mutate(scope(),{action:'create',requestId:'fail',value:content('不得留下'),boundaryPolicy:{externalExpression:'none'}}),/event failure/);
  for(const table of ['memory_boundaries','memory_items','memory_revisions','requests','outbox'])assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n,0);
});
test('retrieval filters newly restricted records even when their content hash and cached vectors are unchanged',async t=>{
  const h=await retrievalFixture();t.after(h.close);const one=h.seed('雨天记得带伞');assert.equal((await h.recall('下雨','hybrid')).items.length,1);
  const s=scope(),before=h.store.read(s,one.id)!;
  h.store.mutate(s,{action:'revise',requestId:'hide',id:one.id,expectedVersion:1,value:{kind:before.kind,claimType:before.claimType,content:before.content,sources:before.sources},boundaryPolicy:{externalExpression:'none'}});
  assert.equal(h.store.read(s,one.id,'normal',undefined,'internal')!.contentHash,before.contentHash);
  for(const strategy of ['lexical','semantic','hybrid'] as const)assert.equal((await h.recall('下雨',strategy)).items.length,0);
});
test('model-facing tools cannot override ownership, scene, task or either access range',async t=>{
  const h=await memoryFixture();t.after(h.close);const source=await h.evidence();
  for(const field of ['owner','sourceScene','task','boundaryPolicy','internalUse','externalExpression']){
    const result=await h.probe('a',c=>h.memory.create(c,{requestId:randomUUID(),kind:'knowledge',claimType:'self_report',content:'拒绝范围伪造',sourceRefs:[source.ref],[field]:{kind:'public'}}));
    assert.equal(result.status,'invalid_input');
  }
});
test('normal plugin writes capture core-bound ingress and current conversation task without accepting them from model arguments',async t=>{
  const h=await provenanceFixture();t.after(h.close);const source=await h.remember('虚构原始材料');
  await h.invoke('dafeiyu_memory_working_set',{requestId:randomUUID(),expectedVersion:'0',taskId:'local-task',expiresAt:new Date(Date.now()+600000).toISOString(),
    items:JSON.stringify([{id:'goal',category:'goal',text:'本机任务',sourceRefs:[source.evidence.ref]}])});
  const result=await h.probe('a',c=>h.memory.create(c,{requestId:randomUUID(),kind:'knowledge',claimType:'self_report',content:'任务关联记录',sourceRefs:[source.evidence.ref]}));
  assert.equal(result.status,'ok');if(result.status!=='ok')return;const item=h.store.read(source.scope,result.id)!;
  assert.deepEqual(item.boundary.task,{kind:'conversation-task',route:source.scope.route,id:'local-task'});
  assert.equal(item.boundary.sourceScene.kind,'conversation');if(item.boundary.sourceScene.kind==='conversation')assert.equal(item.boundary.sourceScene.ingressPluginId,'channel-simulator');
});
test('a range-narrowing revision retires dependent summary fragments and never broadens unrelated history',async t=>{
  const h=await fragmentFixture();t.after(h.close);const a=h.a.memory;
  h.store.mutate(h.a.scope,{action:'revise',requestId:'narrow-a',id:a.id,expectedVersion:1,value:{kind:a.kind,claimType:a.claimType,content:a.content,sources:a.sources},boundaryPolicy:{externalExpression:'none'}});
  await h.run('范围收紧后继续');assert.ok(!h.view().text.includes('A_FACT_ONLY'));assert.match(h.view().text,/B_FACT_KEEP/);
});
test('internal-only data cannot enter the public read tool through a model-supplied purpose',async t=>{
  const h=await provenanceFixture();t.after(h.close);const original=await h.remember('PRIVATE_SCOPE_SENTINEL');
  h.store.mutate(original.scope,{action:'revise',requestId:'private',id:original.memory.id,expectedVersion:1,
    value:{kind:original.memory.kind,claimType:original.memory.claimType,content:original.memory.content,sources:original.memory.sources},boundaryPolicy:{externalExpression:'none'}});
  assert.equal((await h.probe('a',c=>h.memory.read(c,{id:original.memory.id,purpose:'internal'}))).status,'invalid_input');
  assert.equal((await h.probe('a',c=>h.memory.read(c,{id:original.memory.id}))).status,'not_found');
});
