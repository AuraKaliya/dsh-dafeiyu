import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { MemoryStore } from '@dafeiyu/memory/store';
import { experienceFixture } from './memory-experience-fixture.js';
import { dropExperienceFixtureSchema } from './legacy-execution-fixture.js';

test('v10 migration preserves old rows and remains idempotent; a failed additive migration rolls back',async()=>{
  const h=await experienceFixture(),file=h.file;
  const before=h.db.prepare('SELECT * FROM task_workspaces').all();h.close();
  let db=new DatabaseSync(file);dropExperienceFixtureSchema(db);db.exec('PRAGMA user_version=10; CREATE TABLE experience_items(blocker TEXT)');db.close();
  assert.throws(()=>new MemoryStore(file),/already exists/);db=new DatabaseSync(file);assert.equal(db.prepare('PRAGMA user_version').get()?.user_version,10);
  assert.deepEqual(db.prepare('SELECT * FROM task_workspaces').all(),before);db.exec('DROP TABLE experience_items');db.close();
  for(let i=0;i<2;i++){const memory=new MemoryStore(file);memory.close();}
  db=new DatabaseSync(file);try{assert.equal(db.prepare('PRAGMA user_version').get()?.user_version,11);assert.deepEqual(db.prepare('SELECT * FROM task_workspaces').all(),before);
    assert.equal(db.prepare('SELECT count(*) AS n FROM experience_items').get()?.n,0);assert.equal(db.prepare('SELECT count(*) AS n FROM memory_schema_migrations WHERE version=11').get()?.n,1);}finally{db.close();}
});

test('requests deduplicate exact intent and retain all admitted input roots; unexposed sources are rejected',async()=>{
  const h=await experienceFixture();try{
    const input={requestId:'r',sources:[h.a],reason:'按需分析'};const id=h.store.request(h.access,input);
    assert.equal(h.store.request(h.access,input),id);assert.throws(()=>h.store.request(h.access,{...input,reason:'changed'}),/IDEMPOTENCY_CONFLICT/);
    assert.equal(h.store.snapshot(h.access,id).input.sources.length,2);
    assert.throws(()=>h.store.request(h.access,{...input,requestId:'bad',sources:[h.ref('未曝光')]}),/SOURCE_NOT_EXPOSED/);
    h.store.begin(h.access,id);const result=h.store.commit(h.access,id,[h.draft],[]) as {experienceIds:string[]};const experience=h.store.read(h.access,result.experienceIds[0]!);
    assert.equal(experience.state,'proposed');assert.equal(experience.motivation.kind,'explicit-task');assert.deepEqual(experience.rootSources,['shared-root']);assert.equal(experience.counters.length,1);
    assert.equal(h.store.status(h.access,id)[0]?.processed,true);assert.deepEqual(h.store.commit(h.access,id,[],[]),result);
  }finally{h.close();}
});

test('review appends versions, checks concurrency and retains the old text; withdrawal is not reversible by old receipt',async()=>{
  const h=await experienceFixture();try{const id=h.store.request(h.access,{requestId:'r',sources:[h.a],reason:'复核'});h.store.begin(h.access,id);
    const result=h.store.commit(h.access,id,[h.draft],[]) as {experienceIds:string[]},experienceId=result.experienceIds[0]!;
    const review={requestId:'review',id:experienceId,expectedVersion:1,state:'accepted',reason:'保留适用条件'};
    assert.deepEqual(h.store.review(h.access,review),{id:experienceId,version:2,state:'accepted'});assert.deepEqual(h.store.review(h.access,review),{id:experienceId,version:2,state:'accepted'});
    assert.throws(()=>h.store.review(h.access,{...review,requestId:'stale'}),/VERSION_CONFLICT/);
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM experience_revisions').get()?.n,2);
    assert.throws(()=>h.db.exec("UPDATE experience_revisions SET body='{}'"),/Immutable/);
    h.store.review(h.access,{...review,requestId:'withdraw',expectedVersion:2,state:'withdrawn'});assert.throws(()=>h.store.read(h.access,experienceId),/SOURCE_STALE/);
  }finally{h.close();}
});

test('source deletion, restore with changed version, task epoch and foreign scope cannot reuse material',async()=>{
  const h=await experienceFixture();try{const id=h.store.request(h.access,{requestId:'r',sources:[h.a],reason:'来源检查'});h.store.begin(h.access,id);
    const original=h.values.get(h.a.id)!;h.values.delete(h.a.id);assert.throws(()=>h.store.commit(h.access,id,[h.draft],[]),/SOURCE_STALE/);
    assert.equal(h.store.status(h.access,id)[0]?.processed,false);h.values.set(h.a.id,original);
    assert.throws(()=>h.store.request({...h.access,admittedSources:[{...h.a,version:3}]},{requestId:'restore',sources:[{...h.a,version:3}],reason:'旧证明不恢复'}),/SOURCE_STALE/);
    assert.throws(()=>h.store.snapshot({...h.access,view:{...h.access.view,scope:{...h.event.scope,agentId:'other'}}},id),/TASK_NOT_ACTIVE/);
    h.db.exec('UPDATE task_workspaces SET epoch=2');assert.throws(()=>h.store.begin(h.access,id),/TASK_NOT_ACTIVE/);
  }finally{h.close();}
});

test('atomic failure rolls back experiences, relations, watermark and completion together',async()=>{
  const h=await experienceFixture();try{const id=h.store.request(h.access,{requestId:'r',sources:[h.a],reason:'原子性'});h.store.begin(h.access,id);
    h.db.exec("CREATE TRIGGER injected BEFORE INSERT ON maintenance_watermarks BEGIN SELECT RAISE(ABORT,'injected'); END;");
    assert.throws(()=>h.store.commit(h.access,id,[h.draft],[{kind:'supports',from:h.a,to:h.b,reason:'待复核'}]),/injected/);
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM experience_items').get()?.n,0);assert.equal(h.db.prepare('SELECT count(*) AS n FROM experience_relations').get()?.n,0);
    assert.equal(h.store.status(h.access,id)[0]?.state,'running');h.db.exec('DROP TRIGGER injected');h.store.commit(h.access,id,[h.draft],[]);
    assert.equal(h.store.status(h.access,id)[0]?.state,'completed');
  }finally{h.close();}
});

test('relations stay suggestions, same-entity stays held and self edges are rejected',async()=>{
  const h=await experienceFixture();try{const id=h.store.request(h.access,{requestId:'r',sources:[h.a,h.b],reason:'关系'});h.store.begin(h.access,id);
    assert.throws(()=>h.store.commit(h.access,id,[],[{kind:'supports',from:h.a,to:h.a,reason:'自我证明'}]),/INVALID_RELATION/);
    h.store.commit(h.access,id,[],[{kind:'same-entity',from:h.a,to:h.b,reason:'仅同名，不足以核验身份'}]);
    assert.equal((h.store.relations(h.access,id)[0] as {state:string}).state,'held');
  }finally{h.close();}
});

test('task lifecycle requests survive replay and recovery without recursive maintenance',async()=>{
  const h=await experienceFixture();try{const id=h.store.recordLifecycle(h.event,[h.a]);assert.ok(id);assert.equal(h.store.recordLifecycle(h.event,[h.a]),id);
    assert.throws(()=>h.store.recordLifecycle({...h.event,goal:'篡改'}),/IDEMPOTENCY_CONFLICT/);
    assert.equal(h.store.status(h.access,id)[0]?.state,'waiting-scheduler');assert.equal(h.store.snapshot(h.access,id).input.event?.operations[0]?.status,'failed');
    assert.equal(h.store.recordLifecycle({...h.event,id:randomUUID(),motivation:{kind:'maintenance',basis:[]}}),null);
    assert.equal(h.store.recordLifecycle({...h.event,id:randomUUID(),type:'run.running'}),null);
    h.store.begin(h.access,id);assert.equal(h.store.recover(),1);assert.equal(h.store.snapshot(h.access,id).error,'PROCESS_INTERRUPTED');assert.throws(()=>h.store.begin(h.access,id),/STATE_CONFLICT/);
  }finally{h.close();}
});
