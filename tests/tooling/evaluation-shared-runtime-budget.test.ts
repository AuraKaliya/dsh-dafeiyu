import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { EvaluationLedger,EvaluationConfigSchema } from '../../scripts/evaluation/ledger.ts';
import { evaluationModelBudgetAuthority } from '../../scripts/evaluation/executor-budget.ts';
import { SharedModelBudget } from '../../packages/server-runtime/lib/shared-budget.js';
import type { ModelBudgetRequest,ModelBudgetSettlement } from '../../packages/server-runtime/lib/types.js';
import type { ExecutorPermit } from '../../packages/server-executor/lib/protocol.js';
if(!process.env.DAFEIYU_TEST_RUN||!tmpdir().startsWith(process.env.DAFEIYU_TEST_RUN))throw new Error('MANAGED_TEST_RUN_REQUIRED');

const hash='c'.repeat(64),route={provider:'synthetic-fixture',model:'fixture',reasoningEffort:'max',contextWindow:1024,maxOutputTokens:100,maxRequestBytes:8000};
const signal=new AbortController().signal;
const usage={inputTokens:12,uncachedInputTokens:3,cacheReadTokens:4,cacheWriteTokens:5,outputTokens:6,reasoningTokens:2};
async function fixture(){
  const path=join(await mkdtemp(join(tmpdir(),'shared-runtime-budget-')),'ledger.sqlite');
  const ledger=new EvaluationLedger(path,EvaluationConfigSchema.parse({schemaVersion:1,suiteId:'fixture',suiteHash:hash,manifestHash:hash,foundationHash:hash,codeRevision:'c'.repeat(40),mode:'real',
    executionBounds:{authorizationId:'fixture-existing',maximumActiveMs:60000,validForMsAfterFirstCall:300000,calibrationMaximumMicroCny:20000,calibrationMaximumActiveMs:30000},
    budget:{authorized:true,maximumMicroCny:100000,expiresAt:'2099-01-01T00:00:00.000Z',pricingHash:hash,inputMicroCnyPerMillion:1000000,outputMicroCnyPerMillion:2000000},cases:[{id:'one',reviewId:'one'},{id:'two',reviewId:'two'}]}),true);
  let attempt=ledger.begin('one'),active=true;
  const options={ledger,attemptId:()=>attempt,authorizationId:'fixture-existing',profileId:'fixture',route,guard:()=>{if(!active)throw new Error('FIXTURE_GRANT_REVOKED');}};
  const authority=evaluationModelBudgetAuthority(options),budget=new SharedModelBudget(authority);
  const call=(jobId?:string):ModelBudgetRequest=>({callId:randomUUID(),authorizationId:'fixture-existing',owner:jobId?{kind:'executor',jobId}:{kind:'host',profileId:'fixture'},provider:route.provider,model:route.model,reasoningEffort:route.reasoningEffort,
    inputBound:1024,outputBound:100,requestBytes:1000,purpose:'task',requestHash:hash,sessionHash:hash,deadline:Date.now()+10000});
  const bill=(call:ModelBudgetRequest,permit:ExecutorPermit):ModelBudgetSettlement=>({callId:call.callId,authorizationId:call.authorizationId,owner:call.owner,reservationId:permit.reservationId,usage,finish:'stop',durationMs:0,error:null});
  return {ledger,path,authority,budget,options,call,bill,attempt:()=>attempt,nextAttempt:()=>{attempt=ledger.begin('two');},revoke:()=>{active=false;},close:()=>{ledger.stopExecution();ledger.close();}};
}

test('shared parent and two job routes preserve the sole execution clock and persist their real owner bindings',async()=>{
  const h=await fixture();try{
    assert.equal(h.ledger.executionStatus()!.running,false);assert.throws(()=>h.budget.assertReady(),/EXECUTION_NOT_STARTED/);h.ledger.startExecution('formal');
    const parent=h.call(),first=await h.budget.reserve(parent,signal),clock=h.ledger.executionStatus()!,a=h.call(randomUUID()),b=h.call(randomUUID());
    const pendingA=h.budget.reserve(a,signal),pendingB=h.budget.reserve(b,signal);assert.equal(h.ledger.report().calls.length,1);
    await h.budget.settle(h.bill(parent,first));const permitA=await pendingA;await h.budget.settle(h.bill(a,permitA));const permitB=await pendingB;await h.budget.settle(h.bill(b,permitB));
    assert.equal(h.ledger.report().attempts.length,1);assert.equal(h.ledger.report().calls.length,6);assert.equal(h.ledger.budget.spent,72);assert.equal(h.ledger.budget.held,0);
    assert.equal(h.ledger.executionStatus()!.firstCallAt,clock.firstCallAt);assert.equal(h.ledger.executionStatus()!.expiresAt,clock.expiresAt);
    const db=new DatabaseSync(h.path,{readOnly:true});try{const rows=db.prepare('SELECT request_key,attempt_id FROM reservations ORDER BY rowid').all();
      assert.match(String(rows[0]!.request_key),/^host:[a-f0-9]{32}:/);assert.equal(rows[1]!.request_key,'executor:'+(a.owner.kind==='executor'?a.owner.jobId:'')+':'+a.callId);assert.equal(rows[2]!.attempt_id,h.attempt());
    }finally{db.close();}
  }finally{h.close();}
});

test('first reservation binds each job attempt; a later current-attempt switch cannot move its bill or subsequent calls',async()=>{
  const h=await fixture();try{h.ledger.startExecution('formal');const job=randomUUID(),call=h.call(job),original=h.attempt(),permit=await h.budget.reserve(call,signal);h.nextAttempt();h.revoke();
    await h.budget.settle(h.bill(call,permit));assert.equal(h.ledger.report().calls.at(-1)!.attemptId,original);
    // A fresh adapter cannot reuse the old call ID, even though its in-memory receipt map is empty.
    const restarted=evaluationModelBudgetAuthority({...h.options,guard:()=>{}});await assert.rejects(restarted.reserve(call,signal),/CALL_DUPLICATE/);
    await assert.rejects(h.authority.reserve(h.call(job),signal),/FIXTURE_GRANT_REVOKED/);
    const other=await fixture();try{other.ledger.startExecution('formal');const ownJob=randomUUID(),one=other.call(ownJob),p=await other.budget.reserve(one,signal);await other.budget.settle(other.bill(one,p));other.nextAttempt();
      await assert.rejects(other.authority.reserve(other.call(ownJob),signal),/EXECUTOR_ATTEMPT_CHANGED/);
    }finally{other.close();}
  }finally{h.close();}
});

test('cancellation while waiting creates no extra reservation and target revocation never rejects an owed settlement',async()=>{
  const h=await fixture();try{h.ledger.startExecution('formal');const call=h.call(),permit=await h.budget.reserve(call,signal),abort=new AbortController();
    const queued=assert.rejects(h.budget.reserve(h.call(randomUUID()),abort.signal),/RUNTIME_CALL_CANCELLED/);abort.abort();await queued;h.revoke();await h.budget.settle(h.bill(call,permit));
    assert.equal(h.ledger.report().calls.length,2);assert.equal(h.ledger.budget.spent,24);assert.equal(h.ledger.budget.held,0);
  }finally{h.close();}
});

test('unknown and pre-existing held costs deny new shared runtime admission without any recovery or new clock',async()=>{
  const h=await fixture();try{h.ledger.startExecution('formal');const call=h.call(randomUUID()),permit=await h.budget.reserve(call,signal);await h.budget.settle({...h.bill(call,permit),usage:null});
    assert.equal(h.ledger.budget.unknown,1);assert.equal(h.ledger.budget.held,1224);
    const restarted=new SharedModelBudget(evaluationModelBudgetAuthority(h.options));assert.throws(()=>restarted.assertReady(),/EVALUATION_UNKNOWN_COST/);
    assert.equal(h.ledger.report().attempts.length,1);h.ledger.stopExecution();assert.throws(()=>restarted.assertReady(),/EXECUTION_NOT_STARTED/);
  }finally{h.close();}
  const held=await fixture();try{held.ledger.startExecution('formal');held.ledger.reserve(held.attempt(),'pre-existing-fixture-reservation',1024,100);
    assert.throws(()=>held.budget.assertReady(),/EVALUATION_REQUEST_INFLIGHT/);assert.equal(held.ledger.budget.held,1224);
  }finally{held.close();}
});

test('foreign owner, authorization and settlement cannot bypass the original route or share a reservation',async()=>{
  const h=await fixture();try{h.ledger.startExecution('formal');await assert.rejects(h.authority.reserve({...h.call(),owner:{kind:'host',profileId:'foreign'}},signal),/BINDING_MISMATCH/);
    await assert.rejects(h.authority.reserve({...h.call(),authorizationId:'new-unapproved'},signal),/BINDING_MISMATCH/);
    const call=h.call(randomUUID()),permit=await h.budget.reserve(call,signal);await assert.rejects(h.budget.settle({...h.bill(call,permit),owner:{kind:'executor',jobId:randomUUID()}}),/RESERVATION_MISMATCH/);
    await h.budget.settle(h.bill(call,permit));await assert.rejects(h.budget.settle({...h.bill(call,permit),usage:null}),/SETTLEMENT_CONFLICT/);
    assert.equal(h.ledger.budget.spent,24);
  }finally{h.close();}
});
