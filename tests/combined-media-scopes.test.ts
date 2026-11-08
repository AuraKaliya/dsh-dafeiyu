import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {MediaDiagnostics,createMediaDiagnosticSchema} from '../packages/media/lib/diagnostics.js';
import {createMediaRecoverySchema} from '../packages/media/lib/recovery.js';

test('restart, stale grants and cached stages never clear a different paused media scope',()=>{
  const db=new DatabaseSync(':memory:');try{createMediaDiagnosticSchema(db);createMediaRecoverySchema(db);const diagnostics=new MediaDiagnostics(db),context={runId:randomUUID(),operationId:randomUUID()},vision='capability:route:vision',speech='capability:route:transcription';
    diagnostics.record(context,new Error('MODEL_HTTP_402'),'vision',vision,100);diagnostics.record(context,new Error('MODEL_HTTP_403'),'audio',speech,100);
    diagnostics.recovery.arm(vision,diagnostics.health(vision)!.generation,randomUUID(),200);const old=diagnostics.recovery.begin([vision],201);diagnostics.record(context,new Error('MODEL_HTTP_403'),'vision',vision,202);
    diagnostics.recovery.finish(old,true,203,new Set(['vision']));assert.equal(diagnostics.health(vision)?.until,null);assert.equal(diagnostics.health(speech)?.until,null);
    diagnostics.recovery.arm(vision,diagnostics.health(vision)!.generation,randomUUID(),204);diagnostics.recovery.interrupt(205);assert.throws(()=>diagnostics.recovery.begin([vision],206),/MEDIA_DEPENDENCY_PAUSED/);
    diagnostics.recovery.arm(vision,diagnostics.health(vision)!.generation,randomUUID(),207);const cached=diagnostics.recovery.begin([vision],208);diagnostics.recovery.finish(cached,true,209,new Set(['download']));assert.equal(diagnostics.health(vision)?.until,null);
    const actual=diagnostics.recovery.begin([vision],210);diagnostics.recovery.finish(actual,true,211,new Set(['vision']));assert.equal(diagnostics.health(vision)?.until,0);assert.equal(diagnostics.health(speech)?.until,null);assert.throws(()=>diagnostics.recovery.begin([speech],212),/MEDIA_DEPENDENCY_PAUSED/);
  }finally{db.close();}
});
