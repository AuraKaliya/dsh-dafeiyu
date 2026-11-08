import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {RuntimeStore,RUNTIME_APPLICATION_ID,RUNTIME_SCHEMA_VERSION} from '@dafeiyu/core/runtime-store';
import {inspectRuntimeMigration,migrateRuntimeStorage} from '@dafeiyu/core';
import {taskScopeKey} from '@dafeiyu/contracts';
import {createStorageSchemaV4} from '../packages/core/lib/storage-schema.js';
import {testTempDir} from './test-temp.js';

const identity={agentId:'fish',profileId:'usage-test'};
async function fixture(){const root=await mkdtemp(join(testTempDir(),'model-usage-')),file=join(root,'runtime.sqlite'),store=new RuntimeStore(file,identity,{create:true});
  const taskId=randomUUID(),request=store.prepareRequest('fixture','request',{});store.bindTask(request.id,taskId);
  const run=store.acceptRun(request.id,{taskId,origin:{kind:'native',producerId:'fixture',requestId:'request'},scope:{kind:'task',agentId:identity.agentId,taskId,scopeKey:taskScopeKey(identity.agentId,taskId)},intentVersion:1,policyId:'fixture'});
  return {root,file,store,run};
}
test('post-task usage can settle without reopening execution records and duplicate receipts never add cost',async()=>{
  const f=await fixture();try{const queued=f.store.transition(f.run.id,f.run.version,'queued');f.store.transition(queued.id,queued.version,'failed','FIXTURE_STOP');
    const id=randomUUID(),at=new Date().toISOString(),start={id,runId:f.run.id,phase:'verification' as const,startedAt:at,provider:'fixture',model:'test'};
    f.store.modelUsage.begin(start);f.store.modelUsage.begin(start);assert.equal(f.store.usage(f.run.id).pendingCalls,1);
    const result={state:'completed' as const,finishedAt:at,reason:null,receipt:{id,tokens:14,durationMs:2,breakdown:{inputTokens:2,cacheReadTokens:3,cacheWriteTokens:4,outputTokens:5,totalTokens:14}}};
    f.store.modelUsage.finish(id,result);f.store.modelUsage.finish(id,result);assert.equal(f.store.usage(f.run.id).calls,1);assert.equal(f.store.usage(f.run.id).tokens,14);
    assert.equal(f.store.get(f.run.id).state,'failed');assert.throws(()=>f.store.bindInput(f.run.id,'unrelated-late-write',{}),/RUN_NOT_RUNNING/);
    assert.throws(()=>f.store.modelUsage.finish(id,{...result,receipt:{id,tokens:15,durationMs:2}}),/USAGE_SETTLEMENT_CONFLICT/);
  }finally{f.store.close();}
});

test('a process interruption leaves a counted unknown request after restart',async()=>{
  const f=await fixture(),id=randomUUID();f.store.modelUsage.begin({id,runId:f.run.id,phase:'task',startedAt:new Date().toISOString(),provider:'fixture',model:'test'});f.store.close();
  const reopened=new RuntimeStore(f.file,identity);try{reopened.recover();const usage=reopened.usage(f.run.id);assert.equal(usage.calls,1);assert.equal(usage.pendingCalls,0);assert.equal(usage.unknownCalls,1);assert.equal(usage.tokens,null);
    assert.equal(reopened.modelUsage.rows(f.run.id)[0]?.settlement?.reason,'PROCESS_INTERRUPTED');reopened.recover();assert.equal(reopened.modelUsage.summary().calls,1);assert.equal(reopened.modelUsage.summary().unknownReasons.PROCESS_INTERRUPTED,1);
  }finally{reopened.close();}
});

test('unassigned requests remain visible and external duplicate settlements are idempotent',async()=>{
  const f=await fixture();try{const id=randomUUID(),at=new Date().toISOString();f.store.modelUsage.begin({id,startedAt:at,provider:'fixture',model:'test'});
    f.store.modelUsage.finish(id,{state:'failed',finishedAt:at,reason:'PROVIDER_USAGE_UNAVAILABLE',receipt:{id,tokens:null,durationMs:1}});
    const external={id:randomUUID(),tokens:12,durationMs:3};f.store.modelUsage.external(f.run.id,external);f.store.modelUsage.external(f.run.id,external);
    const overview=f.store.modelUsage.summary();assert.equal(overview.calls,2);assert.equal(overview.unassignedCalls,1);assert.equal(overview.unknownCalls,1);assert.equal(overview.tokens,null);assert.equal(overview.knownTokens,12);
  }finally{f.store.close();}
});

test('runtime v4 migration preserves existing rows and starts new accounting without fabricating old requests',async()=>{
  const root=await mkdtemp(join(testTempDir(),'usage-migration-')),file=join(root,'old.sqlite'),backup=join(root,'backup.sqlite'),db=new DatabaseSync(file);
  createStorageSchemaV4(db);db.exec(`PRAGMA application_id=${RUNTIME_APPLICATION_ID}; PRAGMA user_version=4`);
  db.prepare('INSERT INTO runtime_metadata VALUES(1,?)').run(JSON.stringify(identity));const intent=randomUUID();db.prepare('INSERT INTO message_intents VALUES(?,?,?,?,NULL)').run(intent,'route','{}','a'.repeat(64));db.close();
  const before=await readFile(file);assert.throws(()=>migrateRuntimeStorage(file,{...identity,agentId:'other'},backup),/IDENTITY_MISMATCH/);assert.deepEqual(await readFile(file),before);
  const result=migrateRuntimeStorage(file,identity,backup);assert.equal(result.version,RUNTIME_SCHEMA_VERSION);assert.equal(result.verified?.find(row=>row.table==='message_intents')?.count,1);assert.equal(inspectRuntimeMigration(backup,identity).version,4);
  assert.equal(migrateRuntimeStorage(file,identity,join(root,'unused.sqlite')).migrated,false);const current=new RuntimeStore(file,identity);try{assert.equal(current.modelUsage.summary().calls,0);assert.equal(current.modelUsage.summary().legacyHistory,'not-reconstructed');}finally{current.close();}
});
