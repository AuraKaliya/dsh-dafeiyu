import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { MemoryStore } from '@dafeiyu/memory/store';
import { MemoryBoundarySchema,boundaryAllows,conversationKey } from '@dafeiyu/contracts';
import { legacyMemory,legacySnapshot,legacyHash } from './legacy-memory-fixture.js';
import { scope,content,retrievalFixture } from './retrieval-fixture.js';
import { memoryFixture } from './memory-fixture.js';
import { provenanceFixture } from './provenance-fixture.js';
import { fragmentFixture } from './fragment-fixture.js';
import { Worker } from 'node:worker_threads';

async function path(){return join(await mkdtemp(join(tmpdir(),'dafeiyu-boundary-')),'memory.sqlite');}
test('v1 migration adds conservative five-axis boundaries without changing any legacy row or hash',async t=>{
  const file=await path(),old=legacyMemory(file),before=legacySnapshot(old.db);old.db.close();
  const store=new MemoryStore(file);t.after(()=>store.close());const db=new DatabaseSync(file);t.after(()=>db.close());
  assert.deepEqual(legacySnapshot(db),before);assert.equal(db.prepare('PRAGMA user_version').get()?.user_version,2);
  assert.equal(db.prepare('SELECT count(*) AS n FROM memory_boundaries').get()?.n,6);
  const item=store.read(old.scope,old.active.id)!;
  assert.deepEqual(item.boundary.owner,{kind:'agent',agentId:'fish'});assert.equal(item.boundary.sourceScene.kind,'conversation');
  if(item.boundary.sourceScene.kind==='conversation')assert.equal(item.boundary.sourceScene.ingressPluginId,null);
  assert.deepEqual(item.boundary.task,{kind:'unassigned'});
  assert.deepEqual(item.boundary.internalUse,{kind:'conversation',route:old.scope.route});assert.deepEqual(item.boundary.externalExpression,item.boundary.internalUse);
  assert.equal(item.boundary.assignment,'legacy-migration');assert.equal(item.version,1);assert.equal(store.generation(old.scope),8);
  const opaque=store.read({...old.scope,route:'legacy-opaque'},old.opaque.id)!;assert.deepEqual(opaque.boundary.sourceScene,{kind:'legacy-route',route:'legacy-opaque'});
});
test('migration preserves receipts, old request fingerprints, source fences and logical deletion',async t=>{
  const file=await path(),old=legacyMemory(file);old.db.close();const store=new MemoryStore(file);t.after(()=>store.close());
  assert.deepEqual(store.receipt(old.scope,old.command),old.receipt);
  assert.equal(store.mutate(old.scope,old.command,{taskId:'not-the-historical-task'}).duplicate,true);
  assert.equal(store.read(old.scope,old.active.id)!.boundary.task.kind,'unassigned');
  assert.equal(store.read(old.scope,old.parent.id),null);assert.equal(store.read(old.scope,old.parent.id,'history'),null);
  assert.equal(store.read(old.scope,old.parent.id,'deleted')!.version,3);assert.equal(store.read(old.scope,old.child.id),null);
  const fence=store.sourceFence(old.scope,'a'.repeat(64));
  assert.equal(fence,legacyHash([[old.parent.id,3],[old.restored.id,3]].sort(([a],[b])=>String(a).localeCompare(String(b)))));
  store.mutate(old.scope,{action:'restore',id:old.parent.id,expectedVersion:3,requestId:'restore-after-migration',reason:'虚构恢复'});
  assert.equal(store.read(old.scope,old.parent.id)!.revision,2);assert.equal(store.read(old.scope,old.child.id),null);
  assert.notEqual(store.sourceFence(old.scope,'a'.repeat(64)),fence);
});
test('migration and repeated opens never grant another conversation, agent or matching task access',async()=>{
  const file=await path(),old=legacyMemory(file);old.db.close();let store=new MemoryStore(file);store.close();store=new MemoryStore(file);
  try{for(const s of [{...old.scope,route:'other'},{...old.scope,agentId:'another'}]){
    for(const mode of ['normal','history','deleted'] as const)for(const purpose of ['internal','expression'] as const)assert.equal(store.read(s,old.active.id,mode,undefined,purpose),null);
    assert.equal(store.search(s,'normal',{query:'',limit:50}).items.length,0);
  }
  const db=new DatabaseSync(file);try{assert.equal(db.prepare('SELECT count(*) AS n FROM memory_schema_migrations').get()?.n,1);}finally{db.close();}
  }finally{store.close();}
});
test('an interrupted invalid v1 migration rolls back the schema and never initializes over legacy data',async()=>{
  const file=await path(),old=legacyMemory(file);old.db.exec('DROP TRIGGER revisions_immutable_update');
  old.db.prepare('UPDATE memory_revisions SET body=? WHERE id=?').run('{"invalid":true}',old.opaque.id);const before=legacySnapshot(old.db);old.db.close();
  assert.throws(()=>new MemoryStore(file));const db=new DatabaseSync(file);
  try{assert.equal(db.prepare('PRAGMA user_version').get()?.user_version,1);assert.deepEqual(legacySnapshot(db),before);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='memory_boundaries'").get()?.n,0);
  }finally{db.close();}
});
test('future schema versions are rejected without touching the database',async()=>{
  const file=await path(),old=legacyMemory(file);old.db.exec('PRAGMA user_version=99');const before=legacySnapshot(old.db);old.db.close();
  assert.throws(()=>new MemoryStore(file),/Unsupported/);const db=new DatabaseSync(file);try{assert.deepEqual(legacySnapshot(db),before);assert.equal(db.prepare('PRAGMA user_version').get()?.user_version,99);}finally{db.close();}
});
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
test('migrating compatible v1 rows preserves existing DSH partial views, and restore never re-adds retired fragments',async()=>{
  const h=await fragmentFixture(),root=h.root,a=h.a;h.mutate(a,'delete',1);await h.run('迁移前删除A');const ref=h.ref;
  await h.close();
  // Reproduce the pre-boundary layout on this fictional DSH fixture; old rows stay intact.
  const db=new DatabaseSync(join(root,'memory.sqlite'));db.exec('DROP TRIGGER boundaries_no_update; DROP TRIGGER boundaries_no_delete; DROP TABLE memory_boundaries; DROP TABLE memory_schema_migrations; PRAGMA user_version=1;');db.close();
  const next=await provenanceFixture(root);try{await next.run('迁移后继续');assert.match(next.visible(),/B_FACT_KEEP/);assert.ok(!next.visible().includes('A_FACT_ONLY'));
    assert.equal((await next.probe('a',c=>next.timeline.open(c,{ref}))).status,'ok');
    next.mutate(a,'restore',2);await next.run('恢复A');assert.ok(!next.visible().includes('A_FACT_ONLY'));assert.match(next.visible(),/B_FACT_KEEP/);
  }finally{await next.close();}
});
test('concurrent v1 opens serialize migration and produce one complete boundary set',async()=>{
  const file=await path(),old=legacyMemory(file),before=legacySnapshot(old.db);old.db.close();
  const open=()=>new Promise<void>((resolve,reject)=>{
    const worker=new Worker(`const {parentPort,workerData}=require('node:worker_threads');
      import(workerData.module).then(({MemoryStore})=>{const store=new MemoryStore(workerData.file);store.close();parentPort.postMessage('ok');}).catch(error=>{throw error;});`,
      {eval:true,workerData:{file,module:new URL('../packages/memory/lib/store.js',import.meta.url).href}});
    worker.once('message',value=>{try{assert.equal(value,'ok');resolve();}catch(error){reject(error);}});worker.once('error',reject);
    worker.once('exit',code=>{if(code!==0)reject(new Error('Migration worker failed'));});
  });
  await Promise.all([open(),open()]);const db=new DatabaseSync(file);
  try{assert.deepEqual(legacySnapshot(db),before);assert.equal(db.prepare('SELECT count(*) AS n FROM memory_boundaries').get()?.n,6);
    assert.equal(db.prepare('SELECT count(*) AS n FROM memory_schema_migrations').get()?.n,1);
  }finally{db.close();}
});
