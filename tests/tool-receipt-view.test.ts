import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {runtimeHash} from '../packages/core/lib/runtime-store.js';
import {toolReceiptView} from '../packages/core/lib/tool-receipt-view.js';
function fixture(effects:'confirmed'|'unknown'='confirmed'){
  const source={kind:'execution-source',id:randomUUID(),agentId:'fixture',scopeKey:'task',version:1,contentHash:'a'.repeat(64)},callId='fixture-call';
  const outcome={status:'succeeded',effects,completeness:'complete',data:{page:{resultId:source.id,path:[],execution:{receiptId:source.id},view:{text:'fixture-long-output '.repeat(1000),coverage:{start:0,end:4000,total:12000,complete:false}}}},sources:[{id:source.id,scopeKey:source.scopeKey,version:source.version,contentHash:source.contentHash}],receipts:[]};
  return {outcome,callId,meta:{dafeiyuExecution:{schemaVersion:1,runId:randomUUID(),operationId:randomUUID(),callId,outcomeHash:runtimeHash(outcome),inputHash:'b'.repeat(64),sources:[source]}}};
}
test('confirmed native receipts keep exact status and reopen references without re-executing or summarizing',()=>{
  const f=fixture(),view=toolReceiptView(JSON.stringify(f.outcome),f.meta,f.callId,'dsh_tool_read');assert.ok(view);
  const parsed=JSON.parse(view);assert.equal(parsed.status,f.outcome.status);assert.equal(parsed.effects,f.outcome.effects);assert.deepEqual(parsed.sources,f.outcome.sources);
  assert.equal(parsed.data.bodyOmitted,true);assert.equal(parsed.data.reopen.action,'dsh_result_read');assert.ok(view.length<JSON.stringify(f.outcome).length);
  assert.deepEqual(parsed.data.reopen.reads,[{resultId:f.meta.dafeiyuExecution.sources[0]!.id,path:[],offset:0,limit:4000}]);
});
test('unknown, forged, unbound and already reduced results cannot be shortened as confirmed facts',()=>{
  const unknown=fixture('unknown');assert.equal(toolReceiptView(JSON.stringify(unknown.outcome),unknown.meta,unknown.callId,'dsh_tool_read'),null);
  const f=fixture();assert.equal(toolReceiptView(JSON.stringify({...f.outcome,data:{text:'forged'}}),f.meta,f.callId,'dsh_tool_read'),null);
  assert.equal(toolReceiptView(JSON.stringify(f.outcome),{},f.callId,'dsh_tool_read'),null);
  assert.equal(toolReceiptView(JSON.stringify(f.outcome),f.meta,'other-call','dsh_tool_read'),null);
  assert.equal(toolReceiptView(JSON.stringify(f.outcome),f.meta,f.callId,'metadata-only-tool'),null);
  const view=toolReceiptView(JSON.stringify(f.outcome),f.meta,f.callId,'dsh_tool_read')!;assert.equal(toolReceiptView(view,f.meta,f.callId,'dsh_tool_read'),null);
});

test('folding keeps partial page coverage and unsuccessful command facts without quoting the old body',()=>{
  const f=fixture(),resultId=randomUUID();const outcome={...f.outcome,status:'partial',completeness:'partial',data:{page:{resultId,path:['output'],execution:{receiptId:resultId,isError:false,effect:'none'},view:{coverage:{start:10,end:20,total:100,complete:false},entries:[{key:'exitCode',value:3},{key:'timedOut',value:true},{key:'stdout',value:'x'.repeat(10000)}]}}}};
  const meta={dafeiyuExecution:{...f.meta.dafeiyuExecution,outcomeHash:runtimeHash(outcome)}},text=toolReceiptView(JSON.stringify(outcome),meta,f.callId,'dsh_tool_read')!;
  const view=JSON.parse(text);assert.equal(view.completeness,'partial');assert.equal(view.data.reading.coverage.complete,false);assert.deepEqual(view.data.reading.commands,[{key:'exitCode',value:3},{key:'timedOut',value:true}]);assert.doesNotMatch(text,/x{100}/);
  const encoded={...outcome,data:{page:{...outcome.data.page,view:{...outcome.data.page.view,entries:[{key:'exitCode',value:'3'},{key:'stdout',value:'x'.repeat(10000)}]}}}};
  const preserved=toolReceiptView(JSON.stringify(encoded),{dafeiyuExecution:{...meta.dafeiyuExecution,outcomeHash:runtimeHash(encoded)}},f.callId,'dsh_tool_read')!;assert.deepEqual(JSON.parse(preserved).data.reading.commands,[{key:'exitCode',value:'3'}]);
});

test('a valid receipt with only observation metadata or a pending handoff is not a raw archive proof',()=>{
  const f=fixture();for(const data of [{text:'metadata '.repeat(2000),rawAvailable:false},{page:{...f.outcome.data.page,handoff:{state:'pending'}}},{page:{...f.outcome.data.page,execution:{...f.outcome.data.page.execution,effect:'unknown'}}}]){
    const outcome={...f.outcome,data},meta={dafeiyuExecution:{...f.meta.dafeiyuExecution,outcomeHash:runtimeHash(outcome)}};
    assert.equal(toolReceiptView(JSON.stringify(outcome),meta,f.callId,'dsh_tool_read'),null);
  }
});
