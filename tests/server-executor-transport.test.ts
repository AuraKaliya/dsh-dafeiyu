import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime,{LlmAdapter,createUserMessage} from '@deepseek-ai/dsh-llm';
import type { GenerateOptions,StreamChunk,LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import { ExecutorBudgetBroker } from '../packages/server-executor/lib/budget.js';
import { ExecutorParentTransport } from '../packages/server-executor/lib/transport.js';
import { ExecutorChildBudgetClient,installExecutorChildBilling } from '../packages/server-executor/lib/child.js';
import { ChildMessageSchema,normalizeExecutorUsage } from '../packages/server-executor/lib/protocol.js';
import { ExecutorOutputCollector } from '../packages/server-executor/lib/output.js';
import { ScriptedExecutorBudget,executorCall,executorUsage,executorRoute,executorProfileHash,executorIpcPair } from './server-executor-fixture.js';

function broker(port=new ScriptedExecutorBudget(),guard=()=>{}){return new ExecutorBudgetBroker({port,route:executorRoute,guard,authorizationId:'fictional-original-budget',jobId:randomUUID(),deadline:Date.now()+30000});}
async function runtime(mode:'known'|'missing'|'error'='known',port=new ScriptedExecutorBudget()){
  const pair=executorIpcPair(),abort=new AbortController(),parent=new ExecutorParentTransport({endpoint:pair.parent,port,jobId:randomUUID(),nonce:'d'.repeat(64),profileHash:executorProfileHash,route:executorRoute,
    authorizationId:'fictional-original-budget',deadline:Date.now()+30000,guard:()=>{}}),client=new ExecutorChildBudgetClient(pair.child,executorProfileHash),ctx=new Context();let dispatched=0;
  class Backend extends LlmAdapter {
    override async resolveModel(provider:string,id:string):Promise<LlmResolvedModelInfo>{return {provider,id,name:id,context:{contextWindow:1024},defaultMaxTokens:100};}
    override async *stream():AsyncIterable<StreamChunk>{dispatched++;assert.equal(port.admitted.length,dispatched,'The adapter runs only after parent reserve');
      if(mode!=='missing')yield {type:'usage',usage:{inputTokens:3,cacheReadTokens:4,cacheWriteTokens:5,outputTokens:6,reasoningTokens:2,totalTokens:18}};
      yield {type:'finish',reason:mode==='error'?{kind:'error',failure:{code:'FIXTURE_ERROR',message:'SYNTHETIC_ERROR_NOT_TELEMETRY'}}:{kind:'stop'}};}
  }
  await ctx.plugin(LlmRuntime);ctx.llm.registerAdapter([executorRoute.provider],new Backend());const dispose=installExecutorChildBilling(ctx,client,()=>abort.abort());await Promise.all([client.ready(),parent.ready()]);
  const run=async(purpose:'task'|'compaction'|'session-title'='task')=>{for await(const _ of ctx.llm.stream({provider:executorRoute.provider,model:executorRoute.model,maxTokens:100,sessionId:SessionId('synthetic-'+purpose),signal:abort.signal,
    ...(purpose==='task'?{}:{purpose}),messages:[createUserMessage({source:{kind:'user'},content:[{type:'text',text:'PRIVATE_FIXTURE_PROMPT_NEVER_TELEMETRY'}]})]})){};};
  return {port,parent,client,run,calls:()=>dispatched,close:async()=>{dispose();client.close();await parent.close();await ctx.fiber.dispose();}};
}

test('strict IPC and usage reject extra private fields and inconsistent token buckets',()=>{
  assert.throws(()=>ChildMessageSchema.parse({version:1,type:'online',profileHash:executorProfileHash,thinking:'SENTINEL'}));
  assert.deepEqual(normalizeExecutorUsage({inputTokens:3,cacheReadTokens:4,cacheWriteTokens:5,outputTokens:6,reasoningTokens:2,totalTokens:18}),executorUsage);
  assert.throws(()=>normalizeExecutorUsage({inputTokens:3,outputTokens:6,totalTokens:20}));assert.throws(()=>normalizeExecutorUsage({inputTokens:1,outputTokens:2,reasoningTokens:3}));
});
test('actual DSH middleware meters 40 sequential calls including auxiliary sessions without a turn call-count cap',async()=>{
  const f=await runtime();try{for(let i=0;i<40;i++)await f.run(i%3===0?'compaction':i%3===1?'session-title':'task');
    assert.equal(f.calls(),40);assert.equal(f.port.settled.length,40);assert.deepEqual(f.port.settled[0]?.usage,executorUsage);
    assert.equal(new Set(f.port.admitted.map(call=>call.sessionHash)).size,3);assert.equal(new Set(f.port.admitted.map(call=>call.purpose)).size,3);
    assert.ok(!JSON.stringify(f.parent.budget.snapshot()).includes('PRIVATE_FIXTURE_PROMPT'));await f.client.finish();assert.equal(f.parent.finished,true);
  }finally{await f.close();}
});
test('budget denial happens before DSH adapter dispatch',async()=>{
  const port=new ScriptedExecutorBudget();port.deny='EVALUATION_BUDGET_EXHAUSTED';const f=await runtime('known',port);
  try{await assert.rejects(f.run(),/BUDGET_EXHAUSTED|BUDGET_CLOSED/);assert.equal(f.calls(),0);assert.equal(port.settled.length,0);}finally{await f.close();}
});
test('missing usage and partial error usage remain unknown and stop subsequent dispatch',async()=>{
  for(const mode of ['missing','error'] as const){const f=await runtime(mode);try{await f.run().catch(()=>{});await assert.rejects(f.run());assert.equal(f.calls(),1);assert.equal(f.port.settled.length,1);assert.equal(f.port.settled[0]?.usage,null);assert.equal(f.parent.budget.snapshot()[0]?.state,'unknown');}finally{await f.close();}}
});
test('ledger unknown with non-null usage is preserved and forbids another reservation',async()=>{
  const port=new ScriptedExecutorBudget();port.unknown=true;const b=broker(port),call=executorCall(),permit=await b.reserve(call);
  try{assert.deepEqual(await b.settle({callId:call.callId,reservationId:permit.reservationId,usage:executorUsage,finish:'stop',durationMs:1,error:null}),{unknown:true});assert.equal(b.snapshot()[0]?.state,'unknown');await assert.rejects(b.reserve(executorCall()),/BUDGET_CLOSED/);}finally{await b.close();}
});
test('settlement is idempotent, conflicts and replay are rejected, and revocation does not suppress incurred cost',async()=>{
  let live=true;const port=new ScriptedExecutorBudget(),b=broker(port,()=>{if(!live)throw new Error('EXECUTOR_AUTHORITY_REVOKED');}),call=executorCall(),permit=await b.reserve(call),settlement={callId:call.callId,reservationId:permit.reservationId,usage:executorUsage,finish:'stop' as const,durationMs:1,error:null};
  try{live=false;assert.deepEqual(await Promise.all([b.settle(settlement),b.settle(settlement)]),[{unknown:false},{unknown:false}]);assert.equal(port.settled.length,1);
    await assert.rejects(b.settle({...settlement,durationMs:2}),/CONFLICT/);await assert.rejects(b.reserve(executorCall()),/AUTHORITY_REVOKED/);live=true;await assert.rejects(b.reserve(call),/CALL_REPLAY/);
  }finally{await b.close();}
});
test('disconnect after a permit retains unknown cost and accounting failure never turns into a refund',async()=>{
  const port=new ScriptedExecutorBudget(),b=broker(port),call=executorCall();await b.reserve(call);await b.close();assert.equal(port.settled[0]?.usage,null);assert.equal(b.snapshot()[0]?.state,'unknown');
  class Failing extends ScriptedExecutorBudget {override async settle():Promise<{unknown:boolean}>{throw new Error('PRIVATE_ERROR_MUST_NOT_PERSIST');}}
  const failing=broker(new Failing()),next=executorCall(),permit=await failing.reserve(next);await assert.rejects(failing.settle({callId:next.callId,reservationId:permit.reservationId,usage:executorUsage,finish:'stop',durationMs:1,error:null}),/ACCOUNTING_UNCERTAIN/);
  await failing.close();assert.equal(failing.snapshot()[0]?.state,'unknown');assert.ok(!JSON.stringify(failing.snapshot()).includes('PRIVATE_ERROR_MUST_NOT_PERSIST'));
});
test('child activation waits for parent ready validation and wrong-profile handshake never reaches budget',async()=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),pair=executorIpcPair(),port=new ScriptedExecutorBudget(),parent=new ExecutorParentTransport({endpoint:pair.parent,port,jobId:randomUUID(),nonce:'d'.repeat(64),profileHash:executorProfileHash,route:executorRoute,
    authorizationId:'fixture',deadline:Date.now()+30000,guard:()=>{},onReady:()=>gate}),client=new ExecutorChildBudgetClient(pair.child,executorProfileHash);let activated=false;void client.ready().then(()=>{activated=true;});
  try{await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(activated,false);release();await client.ready();assert.equal(activated,true);await client.finish();}finally{client.close();await parent.close();}
  const other=executorIpcPair(),badParent=new ExecutorParentTransport({endpoint:other.parent,port,jobId:randomUUID(),nonce:'e'.repeat(64),profileHash:executorProfileHash,route:executorRoute,authorizationId:'fixture',deadline:Date.now()+30000,guard:()=>{}}),badClient=new ExecutorChildBudgetClient(other.child,'f'.repeat(64));
  try{await assert.rejects(badClient.ready(),/BINDING_MISMATCH|DISCONNECTED/);assert.equal(port.admitted.length,0);}finally{badClient.close();await badParent.close();}
});
test('a wrong launch nonce and an expired authorization cannot obtain a dispatch permit',async()=>{
  const pair=executorIpcPair(),port=new ScriptedExecutorBudget(),jobId=randomUUID(),parent=new ExecutorParentTransport({endpoint:pair.parent,port,jobId,nonce:'d'.repeat(64),profileHash:executorProfileHash,route:executorRoute,
    authorizationId:'fixture',deadline:Date.now()+30000,guard:()=>{}}),client=new ExecutorChildBudgetClient(pair.child,executorProfileHash);
  try{await client.ready();pair.injectParent({version:1,type:'reserve',jobId,nonce:'e'.repeat(64),call:executorCall()});await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(parent.signal.aborted,true);assert.equal(port.admitted.length,0);}
  finally{client.close();await parent.close();}
  const expired=new ExecutorBudgetBroker({port,route:executorRoute,guard:()=>{},authorizationId:'fixture',jobId:randomUUID(),deadline:Date.now()-1});
  try{await assert.rejects(expired.reserve(executorCall()),/DEADLINE/);assert.equal(port.admitted.length,0);}finally{await expired.close();}
});
test('stdout collector stores only bounded selected facts and final self-report, never thinking or raw stderr',()=>{
  const output=new ExecutorOutputCollector({maxEvents:3,maxLineBytes:1024,maxFinalBytes:100});
  const lines=[{type:'session',sessionId:'synthetic-session',cwd:'PRIVATE_PATH'},{type:'thinking',text:'PRIVATE_THOUGHT_SENTINEL'},{type:'text',text:'PRIVATE_INTERMEDIATE'},
    {type:'tool_call',callId:'call-1',tool:'fixture_write',input:{token:'PRIVATE_ARGUMENT'}},{type:'tool_result',callId:'call-1',status:'completed',result:'PRIVATE_RESULT'},
    {type:'status',phase:'step_end',usage:{inputTokens:999999}},{type:'final',text:'visible token=sk-fixture_secret123'}];
  for(const line of lines)output.stdout(Buffer.from(JSON.stringify(line)+'\n'));output.stderr(Buffer.from('PRIVATE_STDERR_SENTINEL'));const result=output.finish(),text=JSON.stringify(result);
  assert.equal(result.final?.kind,'executor-self-report');assert.equal(result.final?.redacted,true);assert.ok(result.gaps.includes('EXECUTOR_TRACE_TRUNCATED'));assert.equal(result.counts.stderrBytes,23);
  for(const value of ['PRIVATE_','sk-fixture_secret123','999999'])assert.ok(!text.includes(value),value);assert.equal(result.counts.toolCalls,1);assert.equal(result.counts.toolResults,1);
});
