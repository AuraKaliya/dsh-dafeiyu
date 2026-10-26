import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { OperationsFundingStore,OperationsModelBudgetAuthority,SharedModelBudget,operatorInitializeFunding,inspectOperationsFunding,fundingUsageCost } from '@dafeiyu/server-runtime';
import { fundingFixture,synthetic,idleSignal,fundingUsage } from './server-operations-funding-fixture.js';

async function initialized(options:Parameters<typeof fundingFixture>[0]={}){const f=await fundingFixture(options);operatorInitializeFunding(f.binding,synthetic);f.clock.wall=Date.now();return f;}
async function active(options:Parameters<typeof fundingFixture>[0]={}){const f=await initialized(options),authority=OperationsModelBudgetAuthority.openExisting(f.binding,{...synthetic,clock:f.clock});authority.activate(f.proof());return {...f,authority};}

test('starting lease cannot reserve; actual proof fields must match before activation; production test hooks are forbidden',async()=>{
  const f=await initialized();assert.throws(()=>OperationsModelBudgetAuthority.openExisting(f.binding,{clock:f.clock}),/FUNDING_TEST_HOOK_FORBIDDEN/);
  const authority=OperationsModelBudgetAuthority.openExisting(f.binding,{...synthetic,clock:f.clock});
  try{assert.equal(authority.kind,'offline-test');assert.equal(authority.snapshot().lease.phase,'starting');await assert.rejects(authority.reserve(f.call(),idleSignal),/LEASE_NOT_ACTIVE/);assert.equal(authority.snapshot().balance.reservedCalls,0);
    assert.throws(()=>authority.activate({...f.proof(),parent:{...f.proof().parent,ownerSid:'S-1-5-21-1-2-3-4'}}),/PARENT_PROOF_MISMATCH/);
    assert.throws(()=>authority.activate({...f.proof(),parent:{...f.proof().parent,executableHash:'a'.repeat(64)}}),/PARENT_PROOF_MISMATCH/);
    assert.throws(()=>authority.activate({...f.proof(),observedAt:new Date(f.clock.wall-16000).toISOString()}),/PARENT_PROOF_STALE/);
    authority.activate(f.proof());assert.equal(authority.snapshot().lease.phase,'active');assert.throws(()=>authority.activate(f.proof()),/LEASE_ALREADY_ACTIVE/);
  }finally{authority.close();}
});

test('whole-call reservation is atomic at the cap and exact cache usage releases only the unused held amount',async()=>{
  const f=await active({maximum:1224});
  try{const call=f.call(),permit=await f.authority.reserve(call,idleSignal);assert.equal(f.authority.snapshot().balance.heldMicroCny,'1224');assert.equal(f.authority.snapshot().balance.remainingMicroCny,'0');
    await assert.rejects(f.authority.reserve(f.call(),idleSignal),/RESERVED_COST/);await f.authority.settle(f.bill(call,permit));
    assert.equal(f.authority.snapshot().balance.spentMicroCny,'24');assert.equal(f.authority.snapshot().balance.remainingMicroCny,'1200');
    await assert.rejects(f.authority.reserve({...f.call(),model:'other'},idleSignal),/ROUTE_CHANGED/);
    await assert.rejects(f.authority.reserve(f.call(),idleSignal),/FUNDING_EXHAUSTED/);assert.equal(f.authority.snapshot().balance.reservedCalls,0);await assert.rejects(f.authority.reserve(f.call(),AbortSignal.abort()),/abort/i);
  }finally{f.authority.close();}
  const discounted=await initialized({rates:{uncachedInput:3000000,cacheRead:1000000,cacheWrite:2000000,output:4000000}});assert.equal(fundingUsageCost(discounted.price,fundingUsage),47n);
});

test('shared parent and multiple executor jobs use one operations authority and cannot exchange reservations',async()=>{
  const f=await active(),budget=new SharedModelBudget(f.authority),parent=f.call(),one=f.call(randomUUID()),two=f.call(randomUUID());
  try{const permit=await budget.reserve(parent,idleSignal),pending1=budget.reserve(one,idleSignal),pending2=budget.reserve(two,idleSignal);
    assert.equal(f.authority.snapshot().balance.reservedCalls,1);await budget.settle(f.bill(parent,permit));const p1=await pending1;
    await assert.rejects(budget.settle({...f.bill(one,p1),owner:two.owner}),/RESERVATION_MISMATCH/);await budget.settle(f.bill(one,p1));const p2=await pending2;await budget.settle(f.bill(two,p2));
    assert.equal(f.authority.snapshot().balance.spentMicroCny,'72');assert.equal(f.authority.snapshot().balance.settledCalls,3);assert.equal(f.authority.snapshot().balance.reservedCalls,0);
  }finally{f.authority.close();}
});

test('invalid usage and late/error receipts stay unknown, settle idempotently and block new money even after a finite amendment',async()=>{
  const f=await active();const call=f.call(),permit=await f.authority.reserve(call,idleSignal),bill={...f.bill(call,permit),usage:{...fundingUsage,inputTokens:-1}};
  assert.deepEqual(await f.authority.settle(bill),{unknown:true});assert.deepEqual(await f.authority.settle(bill),{unknown:true});
  await assert.rejects(f.authority.settle(f.bill(call,permit)),/SETTLEMENT_CONFLICT/);await assert.rejects(f.authority.reserve(f.call(),idleSignal),/UNKNOWN_COST/);
  assert.equal(f.authority.snapshot().balance.unknownCalls,1);assert.equal(f.authority.snapshot().balance.heldMicroCny,'1224');f.authority.close();
  const store=OperationsFundingStore.openExisting(f.binding,synthetic);try{const before=store.snapshot(),increment=await f.amendment(before.authorizationHash);store.amend(increment);assert.equal(store.snapshot().balance.maximumMicroCny,'101000');assert.equal(store.snapshot().balance.unknownCalls,1);}finally{store.close();}
  assert.throws(()=>OperationsModelBudgetAuthority.openExisting(f.binding,synthetic),/UNKNOWN_COST/);assert.equal(inspectOperationsFunding(f.binding,synthetic).code,'FUNDING_UNKNOWN_COST');
});

test('oversized provider usage is retained as exact integer unknown cost, never wrapped or rounded into available funds',async()=>{
  const f=await active();try{const call=f.call(),permit=await f.authority.reserve(call,idleSignal),large=Number.MAX_SAFE_INTEGER;
    const bill={...f.bill(call,permit),usage:{inputTokens:large,uncachedInputTokens:large,cacheReadTokens:0,cacheWriteTokens:0,outputTokens:large,reasoningTokens:0}};
    assert.deepEqual(await f.authority.settle(bill),{unknown:true});const state=f.authority.snapshot().balance;assert.equal(state.heldMicroCny,String(BigInt(large)*3n));assert.equal(state.remainingMicroCny,'0');assert.equal(state.unknownCalls,1);
  }finally{f.authority.close();}
});

test('original absolute expiry and monotonic elapsed time reject new calls while already owed accounting survives expiry and UTC rollback',async()=>{
  const f=await active({lifetime:10000});try{const call=f.call(),permit=await f.authority.reserve(call,idleSignal);f.clock.wall+=11000;await f.authority.settle(f.bill(call,permit));await assert.rejects(f.authority.reserve(f.call(),idleSignal),/FUNDING_EXPIRED/);assert.equal(f.authority.snapshot().balance.spentMicroCny,'24');}
  finally{f.authority.close();}
  const g=await active();try{const call=g.call(),permit=await g.authority.reserve(call,idleSignal);g.clock.wall-=1000;await g.authority.settle(g.bill(call,permit));await assert.rejects(g.authority.reserve(g.call(),idleSignal),/CLOCK_MOVED_BACKWARDS/);}finally{g.authority.close();}
  const h=await active({lifetime:10000});try{h.clock.mono+=11000;assert.throws(()=>h.authority.remainingMs(),/FUNDING_EXPIRED/);}finally{h.authority.close();}
  const j=await active();try{j.clock.mono-=1;assert.throws(()=>j.authority.remainingMs(),/MONOTONIC_MOVED_BACKWARDS/);}finally{j.authority.close();}
});

test('a live or uncertain lease is never stolen; a simulated dead owner needs no held or unknown calls',async()=>{
  const f=await active();try{assert.throws(()=>OperationsModelBudgetAuthority.openExisting(f.binding,synthetic),/LEASE_OWNED/);
    assert.throws(()=>OperationsModelBudgetAuthority.openExisting(f.binding,{...synthetic,processState:()=> 'unknown'}),/LEASE_OWNED/);
    const store=OperationsFundingStore.openExisting(f.binding,synthetic);try{await assert.rejects(async()=>store.amend(await f.amendment(store.snapshot().authorizationHash)),/AMENDMENT_REQUIRES_IDLE/);}finally{store.close();}
  }finally{f.authority.close();}
  const g=await initialized(),crashed=OperationsFundingStore.openExisting(g.binding,synthetic),oldNonce=crashed.claimLease(g.clock.wall,()=> 'absent');crashed.close();
  const fresh=OperationsFundingStore.openExisting(g.binding,synthetic);try{const next=fresh.claimLease(g.clock.wall,()=> 'absent');assert.notEqual(next,oldNonce);fresh.releaseLease(next,g.clock.wall);}finally{fresh.close();}
});

test('a restart preserves an unacknowledged reservation and refuses recovery, release or replay',async()=>{
  const f=await initialized(),store=OperationsFundingStore.openExisting(f.binding,synthetic),nonce=store.claimLease(f.clock.wall,()=> 'absent');store.activateLease(nonce,f.proof(),f.clock.wall);
  const call=f.call();store.reserve(nonce,call,f.clock.wall);assert.throws(()=>store.releaseLease(nonce,f.clock.wall),/ACCOUNTING_PENDING/);store.close();
  const recovered=OperationsFundingStore.openExisting(f.binding,synthetic);try{const state=recovered.snapshot();assert.equal(state.balance.reservedCalls,1);assert.equal(state.balance.heldMicroCny,'1224');assert.throws(()=>recovered.claimLease(f.clock.wall,()=> 'absent'),/RESERVED_COST/);assert.equal(recovered.snapshot().authorizationCount,1);}finally{recovered.close();}
  assert.equal(inspectOperationsFunding(f.binding,synthetic).code,'FUNDING_RESERVED_COST');
});

test('distinct original invalid/error receipts conflict even when both normalize to unknown usage',async()=>{
  for(const finish of ['stop','error','aborted','interrupted'] as const){const f=await active();try{
    const call=f.call(),permit=await f.authority.reserve(call,idleSignal),one={...f.bill(call,permit),finish,usage:finish==='stop'?{...fundingUsage,inputTokens:-1}:fundingUsage};
    await f.authority.settle(one);await f.authority.settle(one);
    const different={...one,usage:finish==='stop'?{...fundingUsage,inputTokens:-2}:{...fundingUsage,inputTokens:13,uncachedInputTokens:4}};
    await assert.rejects(f.authority.settle(different),/SETTLEMENT_CONFLICT/);
    await assert.rejects(f.authority.settle({...one,error:'DISTINCT_ERROR'}),/SETTLEMENT_CONFLICT/);
    assert.equal(f.authority.snapshot().balance.unknownCalls,1);assert.equal(f.authority.snapshot().balance.heldMicroCny,'1224');
  }finally{f.authority.close();}}
});

test('idle UTC observations and rollback stops persist through close and reopening',async()=>{
  const f=await active();const initial=f.clock.wall;f.clock.wall+=60000;f.clock.mono+=60000;f.authority.guard();
  assert.equal(f.authority.snapshot().clock.highestObservedUtcMs,initial+60000);f.clock.wall-=30000;
  assert.throws(()=>f.authority.guard(),/CLOCK_MOVED_BACKWARDS/);f.authority.close();
  const inspect=inspectOperationsFunding(f.binding,synthetic);assert.equal(inspect.snapshot!.clock.highestObservedUtcMs,initial+60000);assert.equal(inspect.snapshot!.clock.stopCode,'FUNDING_CLOCK_MOVED_BACKWARDS');
  assert.throws(()=>OperationsModelBudgetAuthority.openExisting(f.binding,{...synthetic,clock:f.clock}),/CLOCK_MOVED_BACKWARDS/);
});

test('monotonic elapsed time is a separate durable ceiling and cannot be reset by restarting with a stalled UTC clock',async()=>{
  const f=await active(),initial=f.authority.remainingMs(),observedUtc=f.clock.wall;f.clock.mono+=10000;f.authority.guard();f.authority.close();
  const state=inspectOperationsFunding(f.binding,synthetic).snapshot!;assert.equal(state.clock.highestObservedUtcMs,observedUtc);assert.ok(state.clock.remainingCeilingMs<=initial-10000);
  const resumed=OperationsModelBudgetAuthority.openExisting(f.binding,{...synthetic,clock:f.clock});try{assert.ok(resumed.remainingMs()<=initial-10000);f.clock.mono+=200000;assert.throws(()=>resumed.remainingMs(),/FUNDING_EXPIRED/);}finally{resumed.close();}
  assert.equal(inspectOperationsFunding(f.binding,synthetic).snapshot!.clock.stopCode,'FUNDING_EXPIRED');
  assert.throws(()=>OperationsModelBudgetAuthority.openExisting(f.binding,{...synthetic,clock:f.clock}),/FUNDING_EXPIRED/);
});

test('actual operations stop notifications cover pre-admission expiry and final zero balance without stopping a queued hold',async()=>{
  const f=await active({maximum:1224}),budget=new SharedModelBudget(f.authority);let stops=0;budget.onInterrupt(()=>{stops++;});
  try{const call=f.call(),permit=await budget.reserve(call,idleSignal);assert.equal(stops,0);assert.equal(budget.status.stopped,null);assert.equal(f.authority.snapshot().balance.remainingMicroCny,'0');
    const waiting=assert.rejects(budget.reserve(f.call(randomUUID()),idleSignal),/FUNDING_EXHAUSTED/);
    await budget.settle({...f.bill(call,permit),usage:{inputTokens:1024,uncachedInputTokens:1024,cacheReadTokens:0,cacheWriteTokens:0,outputTokens:100,reasoningTokens:0}});await waiting;
    assert.equal(stops,1);assert.equal(budget.status.interrupted,'FUNDING_EXHAUSTED');assert.equal(f.authority.snapshot().balance.unknownCalls,0);
  }finally{f.authority.close();}
  const g=await active(),expired=new SharedModelBudget(g.authority);let expiryStops=0;expired.onInterrupt(()=>{expiryStops++;});
  try{g.clock.wall+=200000;g.clock.mono+=200000;await assert.rejects(expired.reserve(g.call(),idleSignal),/FUNDING_EXPIRED/);assert.equal(expiryStops,1);assert.equal(expired.status.interrupted,'FUNDING_EXPIRED');assert.equal(g.authority.snapshot().balance.reservedCalls,0);}finally{g.authority.close();}
});
