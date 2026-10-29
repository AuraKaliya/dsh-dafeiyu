import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWorkingViewPlan} from '../packages/core/lib/working-view.js';
import type {ContextPacket,RequestCapacity} from '../packages/core/lib/context-plan.js';

test('working view plan accounts for controlled, capability, history, tools and retired snapshots in one view',()=>{
  const packet:ContextPacket={text:'controlled context',decisions:[],regions:[{owner:'memory',region:'working',kind:'working-state',items:[{id:'one',version:'1',text:'x',sources:[{ref:'fixture:one',version:'1',hash:'a'.repeat(64)}],expiresAt:'9999-12-31T23:59:59.999Z'}]}]};
  const capacity:RequestCapacity={bytes:1000,reserveBytes:100,maximumBytes:2000,categories:{messages:800,tools:100,toolHistory:0},withinBudget:true,measurement:'utf8-serialized-bytes',
    wire:{bytes:600,categories:{messages:500,tools:100,toolHistory:0},measurement:'wire-projection-source-sections-excluded'},auditBytes:1000,runtimeSnapshotCount:1,
    messageBreakdown:{system:100,currentInput:100,history:100,toolResults:100,runtimeContext:400,mediaBlocks:0},estimatedInputTokens:300,tokenMeasurement:'sdk-estimate-with-utf8-floor',
    modelContextWindow:100000,reservedOutputTokens:256000,estimateOnly:true,modelLimitsKnown:true};
  const plan=buildWorkingViewPlan({packet,capacity,retired:3,capabilityBytes:300});
  assert.equal(plan.regions.find(region=>region.kind==='controlled')?.items,1);
  assert.equal(plan.regions.find(region=>region.kind==='capability')?.bytes,300);
  assert.equal(plan.regions.find(region=>region.kind==='runtimeContext')?.items,1);
  assert.equal(plan.regions.find(region=>region.kind==='retired')?.items,3);
  assert.equal(plan.totals.wireBytes,600);
  assert.equal(plan.totals.runtimeSnapshots,1);
  assert.equal(plan.withinBudget,true);
  assert.equal(plan.wireWithinBudget,true);
});
