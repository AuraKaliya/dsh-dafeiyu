import {contextBytes} from './context-plan.js';
import type {ContextPacket,RequestCapacity} from './context-plan.js';

export type WorkingViewRegionKind='system'|'controlled'|'capability'|'runtimeContext'|'history'|'toolResults'|'currentInput'|'tools'|'toolHistory'|'retired';
export interface WorkingViewRegion {owner:string;region:string;kind:WorkingViewRegionKind;bytes:number;items?:number}
export interface WorkingViewPlan {
  schemaVersion:1;
  stage:'conversation';
  regions:WorkingViewRegion[];
  totals:{internalBytes:number;wireBytes:number;auditBytes:number;estimatedInputTokens:number;runtimeSnapshots:number;retired:number;mediaBlocks:number};
  budgets:{requestMaxBytes:number;reserveBytes:number;modelContextWindow:number|null;reservedOutputTokens:number|null};
  withinBudget:boolean;
  wireWithinBudget:boolean;
}
/** One serializable account of every material in this model request. It does not dispatch or mutate anything. */
export function buildWorkingViewPlan(input:{packet:ContextPacket;capacity:RequestCapacity;retired:number;capabilityBytes?:number}):WorkingViewPlan{
  const breakdown=input.capacity.messageBreakdown,regions:WorkingViewRegion[]=[
    {owner:'core',region:'system',kind:'system',bytes:breakdown.system},
    {owner:'core',region:'controlled-context',kind:'controlled',bytes:contextBytes(input.packet.text),items:input.packet.regions.reduce((sum,region)=>sum+region.items.length,0)},
    {owner:'core',region:'capability-index',kind:'capability',bytes:input.capabilityBytes??0},
    {owner:'dsh',region:'runtime-context',kind:'runtimeContext',bytes:breakdown.runtimeContext,items:input.capacity.runtimeSnapshotCount},
    {owner:'dsh',region:'history',kind:'history',bytes:breakdown.history},
    {owner:'dsh',region:'tool-results',kind:'toolResults',bytes:breakdown.toolResults},
    {owner:'dsh',region:'current-input',kind:'currentInput',bytes:breakdown.currentInput},
    {owner:'dsh',region:'tools',kind:'tools',bytes:input.capacity.categories.tools},
    {owner:'dsh',region:'tool-history',kind:'toolHistory',bytes:input.capacity.categories.toolHistory},
    {owner:'core',region:'retired-snapshots',kind:'retired',bytes:0,items:input.retired},
  ];
  return {schemaVersion:1,stage:'conversation',regions,
    totals:{internalBytes:input.capacity.bytes,wireBytes:input.capacity.wire.bytes,auditBytes:input.capacity.auditBytes,estimatedInputTokens:input.capacity.estimatedInputTokens,
      runtimeSnapshots:input.capacity.runtimeSnapshotCount,retired:input.retired,mediaBlocks:breakdown.mediaBlocks},
    budgets:{requestMaxBytes:input.capacity.maximumBytes,reserveBytes:input.capacity.reserveBytes,modelContextWindow:input.capacity.modelContextWindow,reservedOutputTokens:input.capacity.reservedOutputTokens},
    withinBudget:input.capacity.withinBudget,wireWithinBudget:input.capacity.wire.bytes+input.capacity.reserveBytes<=input.capacity.maximumBytes};
}
