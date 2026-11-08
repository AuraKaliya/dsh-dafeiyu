import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {RuntimeStore,RUNTIME_APPLICATION_ID} from '../packages/core/lib/runtime-store.js';
import {createStorageSchemaV6} from '../packages/core/lib/storage-schema.js';
import {migrateRuntimeStorage,inspectRuntimeMigration} from '../packages/core/lib/runtime-migration.js';
import {testTempDir} from './test-temp.js';

test('v6 requests migrate without fabricating old input measurements or overwriting usage',async()=>{
  const root=await mkdtemp(join(testTempDir(),'runtime-v7-')),file=join(root,'runtime.sqlite'),backup=join(root,'v6.sqlite'),identity={agentId:'fish',profileId:'v7-fixture'};
  const id=randomUUID(),at=new Date().toISOString(),start={id,runId:null,phase:'other',workType:'unassigned',startedAt:at,provider:'fixture',model:'scripted',sessionId:null};
  const db=new DatabaseSync(file);createStorageSchemaV6(db);db.exec(`PRAGMA application_id=${RUNTIME_APPLICATION_ID};PRAGMA user_version=6`);
  db.prepare('INSERT INTO runtime_metadata VALUES(1,?)').run(JSON.stringify(identity));db.prepare('INSERT INTO model_requests VALUES(?,NULL,?,NULL)').run(id,JSON.stringify(start));db.close();
  assert.throws(()=>new RuntimeStore(file,identity),/SCHEMA_UNSUPPORTED/);const result=migrateRuntimeStorage(file,identity,backup);assert.equal(result.version,7);assert.equal(inspectRuntimeMigration(backup,identity).version,6);
  const current=new RuntimeStore(file,identity);try{const summary=current.modelUsage.summary();assert.equal(summary.calls,1);assert.equal(summary.pending,1);assert.equal(summary.tokens,null);assert.equal(summary.inputContext?.measuredCalls,0);assert.equal(summary.inputContext?.unmeasuredCalls,1);assert.deepEqual(current.modelUsage.rows()[0]?.start,start);}finally{current.close();}
  assert.equal(migrateRuntimeStorage(file,identity,join(root,'unused.sqlite')).migrated,false);
});
