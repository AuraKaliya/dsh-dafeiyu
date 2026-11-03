import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import type {Context} from '@deepseek-ai/cordis';
import {ActivityStore,createActivityStorageSchema} from '../packages/activity/lib/store.js';
import {IdleActivity} from '../packages/activity/lib/idle.js';
import {inspectActivityMigration,migrateActivityStorage} from '../packages/activity/lib/migration.js';
import {testTempDir} from './test-temp.js';

test('unchanged exploration stays skipped across one hundred wakeups and a process restart',async()=>{
  const root=await mkdtemp(join(testTempDir(),'activity-admission-')),file=join(root,'activity.sqlite'),identity={agentId:'fish',profileId:'fixture'};
  let store=new ActivityStore(file,identity,{},true),submits=0,state='running';const runId=randomUUID();
  const ctx={dafeiyu:{explorationCandidates:async()=>[{key:'bili:one',revision:'content-v1',provider:'bilibili',reference:'one',title:'One',prior:'none'}],managementUsage:()=>({tokens:12,knownTokens:12,calls:1}),executionProducer:()=>({submitTask:()=>{submits++;return {run:{id:runId}};},restoreRun:()=>({id:runId}),status:()=>({state,error:null,version:1,checkpoints:[]})})}} as unknown as Context;
  try{let idle=new IdleActivity(ctx,store);assert.equal(await idle.start(0),true);idle.control(1,false);state='completed';idle.control(2,false);
    store.close();store=new ActivityStore(file,identity);idle=new IdleActivity(ctx,store);
    for(let n=1;n<=100;n++)assert.equal(await idle.start(n*1800000+2),false);
    assert.equal(submits,1);assert.equal(store.admission.list().length,1);assert.equal(store.admission.read('bili:one')?.state,'complete');
    const first=store.admission.block('idle.model','MODEL_HTTP_402',null,200000000);
    assert.equal(store.admission.allowed('idle.model',900000000),false);
    assert.equal(store.admission.restore('idle.model',first.generation-1,900000000),false);
    assert.equal(store.admission.restore('idle.model',first.generation,900000000),true);
  }finally{store.close();}
});

test('activity v2 migration backs up and preserves every existing table, and refuses a different identity',async()=>{
  const root=await mkdtemp(join(testTempDir(),'activity-migration-')),file=join(root,'activity.sqlite'),backup=join(root,'backup.sqlite'),identity={agentId:'fish',profileId:'fixture'};
  const old=new DatabaseSync(file);try{createActivityStorageSchema(old,false);old.prepare('INSERT INTO activity_metadata VALUES(1,?)').run(JSON.stringify(identity));
    old.prepare('INSERT INTO activity_rounds VALUES(?,?)').run('old-round',JSON.stringify({id:randomUUID(),startedAt:1,endedAt:2,budget:{roundTokens:100000,roundDurationMs:900000},reason:'rest',restRequested:true}));
  }finally{old.close();}
  assert.equal(inspectActivityMigration(file,identity).state,'upgradable');
  assert.throws(()=>migrateActivityStorage(file,{...identity,agentId:'other'},backup),/ACTIVITY_IDENTITY_MISMATCH/);
  const result=migrateActivityStorage(file,identity,backup);assert.equal(result.version,3);assert.equal(result.verified.length,15);
  assert.equal(inspectActivityMigration(backup,identity).version,2);assert.equal(inspectActivityMigration(file,identity).state,'current');
  assert.equal(migrateActivityStorage(file,identity,join(root,'unused-backup.sqlite')).migrated,false);
  const current=new ActivityStore(file,identity);try{assert.equal(current.rounds.list().length,1);assert.deepEqual(current.admission.list(),[]);}finally{current.close();}
});
