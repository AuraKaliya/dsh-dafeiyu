import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {MediaDiagnostics,createMediaDiagnosticSchema,mediaFailure} from '../packages/media/lib/diagnostics.js';
import {createMediaRecoverySchema} from '../packages/media/lib/recovery.js';
import {createMediaStorageSchema,MediaStore} from '../packages/media/lib/store.js';
import {migrateMediaStorage,inspectMediaMigration} from '../packages/media/lib/migration.js';
import {testTempDir} from './test-temp.js';

test('media permits cover one scope, are single-use and cannot let a stale success clear a new failure',()=>{
  const db=new DatabaseSync(':memory:');try{createMediaDiagnosticSchema(db);createMediaRecoverySchema(db);const d=new MediaDiagnostics(db),context={runId:randomUUID(),operationId:randomUUID()},key='capability:route:vision';
    assert.equal(mediaFailure(new Error('MODEL_HTTP_402'),'vision').scope,'capability');
    d.record(context,new Error('MODEL_HTTP_402'),'vision',key,100);const first=d.health(key)!;
    assert.throws(()=>d.recovery.begin([key],200),/MEDIA_DEPENDENCY_PAUSED/);assert.deepEqual(d.recovery.begin(['resource:unrelated'],200),[]);
    const id=randomUUID();assert.equal(d.recovery.arm(key,first.generation,id,200).state,'armed');assert.equal(d.health(key)?.until,null,'allowing a read does not certify recovery');
    assert.equal(d.recovery.arm(key,first.generation,id,201).requestId,id);
    const lease=d.recovery.begin([key],202);assert.throws(()=>d.recovery.begin([key],203),/MEDIA_DEPENDENCY_PAUSED/);
    d.record(context,new Error('MODEL_HTTP_403'),'vision',key,204);d.recovery.finish(lease,true,205,new Set(['vision']));assert.equal(d.health(key)?.until,null);assert.equal(d.recovery.permit(key)?.state,'stale');
    assert.equal(d.restore(key,first.generation,206),false);const next=d.health(key)!;
    d.recovery.arm(key,next.generation,randomUUID(),207);const second=d.recovery.begin([key],208);
    d.recovery.finish(second,true,209,new Set(['download']));assert.equal(d.health(key)?.until,null,'a cache hit or download cannot verify the vision stage');assert.equal(d.recovery.permit(key)?.state,'armed');
    const actual=d.recovery.begin([key],210);d.recovery.finish(actual,true,211,new Set(['vision']));assert.equal(d.health(key)?.until,0);assert.equal(d.health(key)?.generation,next.generation+1);
    assert.deepEqual(d.recovery.dependencies(context.runId),[]);
  }finally{db.close();}
});

test('media multi-scope acquisition rolls back and restart revokes unconsumed probe permits',()=>{
  const db=new DatabaseSync(':memory:');try{createMediaDiagnosticSchema(db);createMediaRecoverySchema(db);const d=new MediaDiagnostics(db),c={runId:randomUUID(),operationId:randomUUID()};
    d.record(c,new Error('MEDIA_WORKER_START_FAILED'),'decode','first',100);d.record(c,new Error('MEDIA_VISION_NOT_CONFIGURED'),'vision','second',100);
    d.recovery.arm('first',1,randomUUID(),200);assert.throws(()=>d.recovery.begin(['first','second'],201),/MEDIA_DEPENDENCY_PAUSED/);assert.equal(d.recovery.permit('first')?.state,'armed');
    d.recovery.interrupt(202);assert.equal(d.recovery.permit('first')?.state,'interrupted');assert.throws(()=>d.recovery.begin(['first'],203),/MEDIA_DEPENDENCY_PAUSED/);
  }finally{db.close();}
});

test('media v3 migration preserves diagnostics and maps existing holds without resetting them',async()=>{
  const root=await mkdtemp(join(testTempDir(),'media-v4-')),file=join(root,'media.sqlite'),backup=join(root,'before.sqlite'),identity={agentId:'fish',profileId:'media-upgrade'},id=randomUUID(),run=randomUUID();
  const db=new DatabaseSync(file);try{createMediaStorageSchema(db,true,false);db.prepare('INSERT INTO media_metadata VALUES(1,?)').run(JSON.stringify(identity));
    db.prepare('INSERT INTO media_diagnostics VALUES(?,?,?,?,?)').run(id,run,'op',100,JSON.stringify(mediaFailure(new Error('MODEL_HTTP_402'),'vision')));
    db.prepare('INSERT INTO media_health VALUES(?,?,?)').run('capability:old:vision',3,JSON.stringify({key:'capability:old:vision',generation:3,diagnosticId:id,until:null,code:'MODEL_HTTP_402',stage:'vision'}));
  }finally{db.close();}
  assert.equal(inspectMediaMigration(file,identity).state,'upgradable');assert.throws(()=>new MediaStore(file,identity),/MEDIA_SCHEMA_UNSUPPORTED/);
  const result=migrateMediaStorage(file,identity,backup);assert.equal(result.version,4);assert.equal(inspectMediaMigration(backup,identity).version,3);
  const store=new MediaStore(file,identity);try{assert.equal(store.diagnostics.recovery.dependencies(run)[0]?.state,'blocked');assert.equal(store.diagnostics.health('capability:old:vision')?.generation,3);}finally{store.close();}
});
