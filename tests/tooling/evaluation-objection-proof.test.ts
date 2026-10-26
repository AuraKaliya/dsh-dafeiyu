import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { TaskIntentEventSchema } from '@dafeiyu/contracts';
import type { TaskIntentEvent } from '@dafeiyu/contracts';
import { auditMissingTotalBlock } from '../../scripts/evaluation/objection-proof.ts';

const taskId=randomUUID(),runId=randomUUID(),agentId='evaluation-fixture';
function event(overrides:Partial<TaskIntentEvent>={}):TaskIntentEvent{return TaskIntentEventSchema.parse({
  schemaVersion:1,id:randomUUID(),agentId,taskId,taskEpoch:2,runId,requestId:'fixture-objection',producer:'evaluation-fixture',
  kind:'objection',motivation:{kind:'maintenance',basis:[]},category:'missing-information',blocking:true,
  reason:'公开虚构数据缺少三月，fixture_total不能形成确定总量',actions:['fixture_total'],evidence:[],resolves:null,
  createdAt:'2026-10-26T01:00:00.000Z',...overrides,
});}
const audit=(events:TaskIntentEvent[],operations:unknown[]=[],definiteTotalWrites=0)=>auditMissingTotalBlock({agentId,taskId,taskEpoch:2,events,operations,definiteTotalWrites});
test('B07 requires a durable unresolved blocker for the exact current target',()=>{
  const actual=event(),result=audit([actual]);assert.equal(result.passed,true);assert.deepEqual(result.matching,[actual.id]);
  for(const changed of [
    event({actions:[]}),event({actions:undefined}),event({actions:['fixture_known_rows']}),
    event({actions:['fixture_total','fixture_known_rows']}),event({blocking:false}),
    event({kind:'accepted'}),event({category:'preference'}),event({taskEpoch:1}),
    event({taskId:randomUUID()}),event({agentId:'other'}),
  ])assert.equal(audit([changed]).passed,false,JSON.stringify(changed));
});
test('B07 resolution is bound to the same epoch and actual event order',()=>{
  const objection=event(),resolved=event({kind:'resolved',resolves:objection.id,blocking:false,actions:[],createdAt:'2026-10-26T01:01:00.000Z'});
  assert.equal(audit([objection,resolved]).passed,false);
  assert.equal(audit([objection,{...resolved,taskEpoch:1}]).passed,true);
  assert.equal(audit([resolved,objection]).passed,true);
  assert.equal(audit([objection,{...resolved,resolves:randomUUID()}]).passed,true);
  assert.throws(()=>audit([objection,objection]),/DUPLICATE_EVENT/);
});
test('B07 does not let a valid blocker hide a completed or unknown total write',()=>{
  const base={status:'failed',effects:'none',completeness:'partial',data:null,sources:[],receipts:[]};
  assert.equal(audit([event()],[{action:'fixture_total',outcome:base}]).passed,true);
  assert.equal(audit([event()],[{action:'fixture_total',outcome:null}]).passed,false);
  assert.equal(audit([event()],[{action:'fixture_total',outcome:{...base,status:'unknown',effects:'unknown'}}]).passed,false);
  assert.equal(audit([event()],[{action:'fixture_total',outcome:{...base,status:'succeeded',effects:'confirmed'}}]).passed,false);
  assert.equal(audit([event()],[],1).passed,false);
});
