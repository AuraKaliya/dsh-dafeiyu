import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {runtimeHash} from '../packages/core/lib/runtime-store.js';
import {toolReceiptView} from '../packages/core/lib/tool-receipt-view.js';
function fixture(effects:'confirmed'|'unknown'='confirmed'){
  const source={kind:'execution-source',id:randomUUID(),agentId:'fixture',scopeKey:'task',version:1,contentHash:'a'.repeat(64)},callId='fixture-call';
  const outcome={status:'succeeded',effects,completeness:'complete',data:{text:'fixture-long-output '.repeat(1000)},sources:[{id:source.id,scopeKey:source.scopeKey,version:source.version,contentHash:source.contentHash}],receipts:[]};
  return {outcome,callId,meta:{dafeiyuExecution:{schemaVersion:1,runId:randomUUID(),operationId:randomUUID(),callId,outcomeHash:runtimeHash(outcome),inputHash:'b'.repeat(64),sources:[source]}}};
}
test('confirmed native receipts keep exact status and reopen references without re-executing or summarizing',()=>{
  const f=fixture(),view=toolReceiptView(JSON.stringify(f.outcome),f.meta,f.callId);assert.ok(view);
  const parsed=JSON.parse(view);assert.equal(parsed.status,f.outcome.status);assert.equal(parsed.effects,f.outcome.effects);assert.deepEqual(parsed.sources,f.outcome.sources);
  assert.equal(parsed.data.bodyOmitted,true);assert.equal(parsed.data.reopen.action,'dafeiyu_execution_source_open');assert.ok(view.length<JSON.stringify(f.outcome).length);
});
test('unknown, forged, unbound and already reduced results cannot be shortened as confirmed facts',()=>{
  const unknown=fixture('unknown');assert.equal(toolReceiptView(JSON.stringify(unknown.outcome),unknown.meta,unknown.callId),null);
  const f=fixture();assert.equal(toolReceiptView(JSON.stringify({...f.outcome,data:{text:'forged'}}),f.meta,f.callId),null);
  assert.equal(toolReceiptView(JSON.stringify(f.outcome),{},f.callId),null);
  assert.equal(toolReceiptView(JSON.stringify(f.outcome),f.meta,'other-call'),null);
  const view=toolReceiptView(JSON.stringify(f.outcome),f.meta,f.callId)!;assert.equal(toolReceiptView(view,f.meta,f.callId),null);
});
