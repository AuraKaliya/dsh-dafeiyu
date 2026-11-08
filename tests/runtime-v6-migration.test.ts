import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {matchesSchema} from '@dafeiyu/journal';
import {RuntimeStore,RUNTIME_APPLICATION_ID,RUNTIME_SCHEMA_VERSION} from '../packages/core/lib/runtime-store.js';
import {createStorageSchemaV5,createStorageSchema} from '../packages/core/lib/storage-schema.js';
import {migrateRuntimeStorage,inspectRuntimeMigration} from '../packages/core/lib/runtime-migration.js';
import {taskScopeKey} from '@dafeiyu/contracts';
import {testTempDir} from './test-temp.js';

test('v5 migration preserves every old record, adds query indexes and provides a matching rollback snapshot',async()=>{
  const root=await mkdtemp(join(testTempDir(),'runtime-v6-')),file=join(root,'runtime.sqlite'),backup=join(root,'runtime-v5.sqlite'),identity={agentId:'fish',profileId:'fixture'};
  const taskId=randomUUID(),runId=randomUUID(),requestId=randomUUID(),deliveryId=randomUUID(),now=new Date().toISOString();
  const db=new DatabaseSync(file);createStorageSchemaV5(db);db.exec(`PRAGMA application_id=${RUNTIME_APPLICATION_ID};PRAGMA user_version=5`);
  db.prepare('INSERT INTO runtime_metadata VALUES(1,?)').run(JSON.stringify(identity));
  db.prepare('INSERT INTO execution_requests VALUES(?,?,?,?,?,?,?)').run(requestId,'fixture','fixture-request','a'.repeat(64),'{}',taskId,runId);
  const definition={taskId,scope:{kind:'task',agentId:'fish',taskId,scopeKey:taskScopeKey('fish',taskId)},origin:{kind:'native',producerId:'fixture',requestId:'fixture-request'},intentVersion:1,policyId:'fixture',parentRunId:null};
  db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,NULL,NULL,?,?,?)').run(runId,requestId,JSON.stringify(definition),'failed',3,'MODEL_HTTP_500',now,now);
  const anchor={kind:'task-result',schemaVersion:1,taskId,runId,inboundId:randomUUID(),target:{channel:'qq',account:'100001',kind:'private',id:'200001'},intentVersion:1,authorityVersion:'b'.repeat(64),expiresAt:'2030-01-01T00:00:00.000Z'};
  db.prepare('INSERT INTO native_deliveries VALUES(?,?,?,1,?,NULL,NULL,NULL,NULL,NULL,?)').run(deliveryId,runId,'rejected',JSON.stringify(anchor),'NATIVE_DELIVERY_FAILED');
  const event={id:randomUUID(),runId,type:'native.delivery.recovery.requested',at:now,data:{requestId:'old-recovery',expectedVersion:1,runId,deliveryId,phase:'rendering',requestedAt:now}};
  db.prepare('INSERT INTO runtime_outbox(id,body) VALUES(?,?)').run(event.id,JSON.stringify(event));db.close();
  const original=await readFile(file);assert.throws(()=>new RuntimeStore(file,identity),/SCHEMA_UNSUPPORTED/);
  assert.throws(()=>migrateRuntimeStorage(file,{...identity,agentId:'other'},backup),/IDENTITY_MISMATCH/);assert.deepEqual(await readFile(file),original);
  const migrated=migrateRuntimeStorage(file,identity,backup);assert.equal(migrated.version,RUNTIME_SCHEMA_VERSION);assert.equal(migrated.migrated,true);
  const after=new DatabaseSync(file,{readOnly:true}),before=new DatabaseSync(backup,{readOnly:true});
  try{for(const row of before.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()){
    const name=String(row.name).replaceAll('"','""');assert.deepEqual(after.prepare('SELECT * FROM "'+name+'"').all(),before.prepare('SELECT * FROM "'+name+'"').all(),name);
  }assert.equal(matchesSchema(after,createStorageSchema),true);assert.equal(matchesSchema(after,createStorageSchemaV5),false);assert.equal(before.prepare('PRAGMA user_version').get()?.user_version,5);
  }finally{after.close();before.close();}
  const opened=new RuntimeStore(file,identity);try{assert.equal(opened.get(runId).state,'failed');assert.equal(opened.nativeDeliveries.pendingRecovery(runId)?.requestId,'old-recovery');}finally{opened.close();}
  const rollback=join(root,'rollback.sqlite');await copyFile(backup,rollback);assert.equal(inspectRuntimeMigration(rollback,identity).version,5);assert.deepEqual(await readFile(rollback),await readFile(backup));
  assert.equal(migrateRuntimeStorage(file,identity,join(root,'unused-backup.sqlite')).migrated,false);
});
