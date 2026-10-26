import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { EvaluationLedger,EvaluationConfigSchema } from '../../scripts/evaluation/ledger.ts';
import { evaluationExecutorBudget } from '../../scripts/evaluation/executor-budget.ts';
import type { ExecutorSettlement } from '../../packages/server-executor/lib/protocol.js';
if(!process.env.DAFEIYU_TEST_RUN||!tmpdir().startsWith(process.env.DAFEIYU_TEST_RUN))throw new Error('MANAGED_TEST_RUN_REQUIRED');

const hash='a'.repeat(64),route={provider:'synthetic-fixture',model:'fixture',reasoningEffort:'max',contextWindow:1024,maxOutputTokens:100,maxRequestBytes:8000};
const signal=new AbortController().signal;
async function fixture(){
  const ledger=new EvaluationLedger(join(await mkdtemp(join(tmpdir(),'executor-parent-bill-')),'ledger.sqlite'),EvaluationConfigSchema.parse({schemaVersion:1,suiteId:'fixture',suiteHash:hash,manifestHash:hash,foundationHash:hash,codeRevision:'a'.repeat(40),mode:'real',
    executionBounds:{authorizationId:'fixture-original',maximumActiveMs:60000,validForMsAfterFirstCall:300000,calibrationMaximumMicroCny:20000,calibrationMaximumActiveMs:30000},
    budget:{authorized:true,maximumMicroCny:100000,expiresAt:'2099-01-01T00:00:00.000Z',pricingHash:hash,inputMicroCnyPerMillion:1000000,outputMicroCnyPerMillion:2000000},cases:[{id:'one',reviewId:'one'}]}),true);
  const attempt=ledger.begin('one'),jobId=randomUUID(),authorizationId='fixture-original';let active=true;const guard=()=>{if(!active)throw new Error('EXECUTOR_GRANT_REVOKED');};
  const port=evaluationExecutorBudget({ledger,attemptId:()=>attempt,jobId,authorizationId,route,guard});
  ledger.startExecution('formal');
  const request=()=>({callId:randomUUID(),...route,inputBound:1024,outputBound:100,requestBytes:1000,purpose:'task' as const,requestHash:hash,sessionHash:hash,jobId,authorizationId,deadline:Date.now()+10000});
  const call=()=>{const {contextWindow:_context,maxOutputTokens:_output,maxRequestBytes:_bytes,...value}=request();return value;};
  const usage={inputTokens:12,uncachedInputTokens:3,cacheReadTokens:4,cacheWriteTokens:5,outputTokens:6,reasoningTokens:2};
  return {ledger,port,attempt,jobId,authorizationId,call,usage,revoke:()=>{active=false;},close:()=>{ledger.stopExecution();ledger.close();}};
}

test('parent and child charge the same ledger and original clock; child usage settles once with cache provenance',async()=>{
  const h=await fixture();try{
    const parent=h.ledger.reserve(h.attempt,'parent-fixture',1024,100);await assert.rejects(h.port.reserve(h.call(),signal),/EVALUATION_REQUEST_INFLIGHT/);
    h.ledger.settle(parent,{inputTokens:1,outputTokens:1});const original=h.ledger.executionStatus()!;
    const call=h.call(),permit=await h.port.reserve(call,signal),settlement={callId:call.callId,reservationId:permit.reservationId,usage:h.usage,finish:'stop' as const,durationMs:0,error:null,jobId:h.jobId,authorizationId:h.authorizationId};
    h.revoke();await h.port.settle(settlement,signal);await h.port.settle(settlement,signal);
    assert.equal(h.ledger.budget.spent,27);assert.equal(h.ledger.budget.held,0);assert.equal(h.ledger.executionStatus()!.firstCallAt,original.firstCallAt);assert.equal(h.ledger.executionStatus()!.expiresAt,original.expiresAt);
    const calls=h.ledger.report().calls;assert.equal(calls.length,2);assert.equal(calls[0]!.attemptId,h.attempt);assert.deepEqual(calls[1]!.usageBreakdown,{uncachedInputTokens:3,cacheReadTokens:4,cacheWriteTokens:5,outputTokens:6,reasoningTokens:2});
    await assert.rejects(h.port.reserve(h.call(),signal),/GRANT_REVOKED/);assert.equal(h.ledger.report().attempts.length,1);
  }finally{h.close();}
});

test('wrong authorization, job, route, cancelled admission and conflicting settlement cannot mint or move a reservation',async()=>{
  const h=await fixture();try{
    assert.throws(()=>evaluationExecutorBudget({ledger:h.ledger,attemptId:()=>h.attempt,authorizationId:'other',jobId:h.jobId,route,guard:()=>{}}),/AUTHORIZATION_MISMATCH/);
    await assert.rejects(h.port.reserve({...h.call(),jobId:randomUUID()},signal),/BINDING_MISMATCH/);
    await assert.rejects(h.port.reserve({...h.call(),model:'other'},signal),/ROUTE_CHANGED/);
    await assert.rejects(h.port.reserve(h.call(),AbortSignal.abort()),/abort/i);assert.equal(h.ledger.budget.held,0);
    const call=h.call(),permit=await h.port.reserve(call,signal),settlement={callId:call.callId,reservationId:permit.reservationId,usage:h.usage,finish:'stop' as const,durationMs:0,error:null,jobId:h.jobId,authorizationId:h.authorizationId};
    await assert.rejects(h.port.settle({...settlement,reservationId:randomUUID()},signal),/RESERVATION_MISMATCH/);
    await h.port.settle(settlement,signal);await assert.rejects(h.port.settle({...settlement,usage:null},signal),/COST_CONFLICT/);
    await assert.rejects(h.port.reserve(call,signal),/CALL_DUPLICATE/);assert.equal(h.ledger.report().calls.length,2);
  }finally{h.close();}
});

test('a missing or interrupted child bill remains unknown and blocks the next dispatch in the original ledger',async()=>{
  for(const finish of ['stop','interrupted'] as const){const h=await fixture();try{
    const call=h.call(),permit=await h.port.reserve(call,signal),settlement:ExecutorSettlement&{jobId:string;authorizationId:string}={callId:call.callId,reservationId:permit.reservationId,usage:finish==='interrupted'?h.usage:null,finish,durationMs:0,error:null,jobId:h.jobId,authorizationId:h.authorizationId};
    await h.port.settle(settlement,signal);assert.equal(h.ledger.budget.unknown,1);assert.equal(h.ledger.budget.held,1224);assert.equal(h.ledger.report().calls.at(-1)!.inputTokens,null);
    await assert.rejects(h.port.reserve(h.call(),signal),/EVALUATION_UNKNOWN_COST/);
  }finally{h.close();}}
});

test('new child ports cannot restart a stopped execution interval or conceal usage beyond the reserved bound',async()=>{
  const h=await fixture();try{
    await assert.rejects(h.port.reserve({...h.call(),deadline:Date.now()-1},signal),/EXECUTOR_DEADLINE/);assert.equal(h.ledger.executionStatus()!.firstCallAt,null);
    const call=h.call(),permit=await h.port.reserve(call,signal);const excessive={...h.usage,inputTokens:1030,uncachedInputTokens:1021};
    assert.deepEqual(await h.port.settle({callId:call.callId,reservationId:permit.reservationId,usage:excessive,finish:'stop',durationMs:0,error:null,jobId:h.jobId,authorizationId:h.authorizationId},signal),{unknown:true});
    assert.equal(h.ledger.budget.unknown,1);assert.equal(h.ledger.report().calls.at(-1)!.inputTokens,1030);
    h.ledger.stopExecution();const reopened=evaluationExecutorBudget({ledger:h.ledger,attemptId:()=>h.attempt,authorizationId:h.authorizationId,jobId:randomUUID(),route,guard:()=>{}});
    await assert.rejects(reopened.reserve({...h.call(),jobId:randomUUID()},signal),/BINDING_MISMATCH/);
    await assert.rejects(h.port.reserve(h.call(),signal),/EXECUTION_NOT_STARTED/);
  }finally{h.close();}
});
