import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SharedModelBudget,RuntimeResourceLifetime } from '@dafeiyu/server-runtime';
import { FictionalBudgetAuthority,liveSignal,runtimeCall,runtimeBill,deferred } from './server-runtime-fixture.js';

test('one FIFO call gate serializes parent and multiple real job identities without reserving queued money',async()=>{
  const authority=new FictionalBudgetAuthority(),budget=new SharedModelBudget(authority);
  const parent=runtimeCall(),first=await budget.reserve(parent,liveSignal());
  const child1=runtimeCall({kind:'executor',jobId:randomUUID()}),child2=runtimeCall({kind:'executor',jobId:randomUUID()});
  const one=budget.reserve(child1,liveSignal()),two=budget.reserve(child2,liveSignal());
  assert.equal(authority.admitted.length,1);assert.equal(authority.held,1);
  await budget.settle(runtimeBill(parent,first));const permit1=await one;assert.equal(authority.admitted.length,2);
  await budget.settle(runtimeBill(child1,permit1));const permit2=await two;await budget.settle(runtimeBill(child2,permit2));
  assert.deepEqual(authority.admitted.map(call=>call.callId),[parent.callId,child1.callId,child2.callId]);assert.equal(authority.held,0);assert.equal(budget.status.pending,0);
});

test('cancelled and expired waiters do not reserve, while the active call can still settle',async()=>{
  const authority=new FictionalBudgetAuthority(),budget=new SharedModelBudget(authority),call=runtimeCall(),permit=await budget.reserve(call,liveSignal());
  const abort=new AbortController(),waiting=assert.rejects(budget.reserve(runtimeCall(),abort.signal),/RUNTIME_CALL_CANCELLED/);abort.abort();await waiting;
  await assert.rejects(budget.reserve({...runtimeCall(),deadline:Date.now()+15},liveSignal()),/RUNTIME_CALL_DEADLINE/);
  assert.equal(authority.admitted.length,1);await budget.settle(runtimeBill(call,permit));assert.equal(authority.settled.length,1);
});

test('unknown closes all new parent/child admission, retains the original receipt, and permits its idempotent ACK',async()=>{
  const authority=new FictionalBudgetAuthority(),budget=new SharedModelBudget(authority),call=runtimeCall(),permit=await budget.reserve(call,liveSignal());
  const queued=assert.rejects(budget.reserve(runtimeCall({kind:'executor',jobId:randomUUID()}),liveSignal()),/RUNTIME_USAGE_UNKNOWN/);
  const bill={...runtimeBill(call,permit),usage:null};assert.deepEqual(await budget.settle(bill),{unknown:true});await queued;
  assert.deepEqual(await budget.settle(bill),{unknown:true});assert.equal(authority.settled.length,1);
  await assert.rejects(budget.reserve(runtimeCall(),liveSignal()),/RUNTIME_USAGE_UNKNOWN/);assert.equal(budget.snapshot()[0]!.state,'unknown');
});

test('lost settlement acknowledgement closes the gate without fabricating a zero charge or replay',async()=>{
  const authority=new FictionalBudgetAuthority(),budget=new SharedModelBudget(authority),call=runtimeCall(),permit=await budget.reserve(call,liveSignal());authority.failSettlement=true;
  const bill=runtimeBill(call,permit);await assert.rejects(budget.settle(bill),/FIXTURE_SETTLEMENT_LOST/);await assert.rejects(budget.settle(bill),/FIXTURE_SETTLEMENT_LOST/);
  assert.equal(authority.held,1);assert.equal(budget.snapshot()[0]!.state,'unknown');await assert.rejects(budget.reserve(runtimeCall(),liveSignal()),/RUNTIME_SETTLEMENT_UNCERTAIN/);
});

test('cross-job reservations, duplicate calls and changed receipts cannot rebind accounting',async()=>{
  const authority=new FictionalBudgetAuthority(),budget=new SharedModelBudget(authority),call=runtimeCall({kind:'executor',jobId:randomUUID()}),permit=await budget.reserve(call,liveSignal());
  await assert.rejects(budget.settle({...runtimeBill(call,permit),owner:{kind:'executor',jobId:randomUUID()}}),/RUNTIME_RESERVATION_MISMATCH/);
  await budget.settle(runtimeBill(call,permit));await assert.rejects(budget.settle({...runtimeBill(call,permit),usage:null}),/RUNTIME_SETTLEMENT_CONFLICT/);
  await assert.rejects(budget.reserve(call,liveSignal()),/RUNTIME_CALL_REPLAY/);
});

test('a nested model dispatch fails instead of waiting on its own held call; a subsequent tool round is allowed',async()=>{
  const authority=new FictionalBudgetAuthority(),budget=new SharedModelBudget(authority),call=runtimeCall(),permit=await budget.reserve(call,liveSignal());
  await budget.dispatchStep(call.callId,()=>assert.rejects(budget.reserve(runtimeCall(),liveSignal()),/RUNTIME_NESTED_MODEL_CALL/));
  await budget.settle(runtimeBill(call,permit));const next=runtimeCall({kind:'executor',jobId:randomUUID()}),second=await budget.reserve(next,liveSignal());await budget.settle(runtimeBill(next,second));
  assert.equal(authority.admitted.length,2);
});

test('actual active deadline invokes cancellation and preserves unknown even if a late success arrives',async()=>{
  const authority=new FictionalBudgetAuthority(),budget=new SharedModelBudget(authority),cancelled=deferred();budget.onInterrupt(()=>cancelled.resolve());
  const call={...runtimeCall(),deadline:Date.now()+20},permit=await budget.reserve(call,liveSignal());await cancelled.promise;
  assert.deepEqual(await budget.settle(runtimeBill(call,permit)),{unknown:true});assert.equal(authority.settled[0]!.usage,null);assert.equal(authority.settled[0]!.finish,'interrupted');
});

test('an asynchronous continuation inherited from a completed call can acquire its next call',async()=>{
  const authority=new FictionalBudgetAuthority(),budget=new SharedModelBudget(authority),first=runtimeCall(),permit=await budget.reserve(first,liveSignal()),ready=deferred(),next=runtimeCall();
  const later=budget.dispatchStep(first.callId,async()=>{await ready.promise;const granted=await budget.reserve(next,liveSignal());await budget.settle(runtimeBill(next,granted));});
  await budget.settle(runtimeBill(first,permit));ready.resolve();await later;assert.equal(authority.admitted.length,2);
});

test('a terminal bill may settle after its dispatch deadline without cancellation discarding known usage',async()=>{
  const authority=new FictionalBudgetAuthority(),ready=deferred(),original=authority.settle.bind(authority);authority.settle=async input=>{await ready.promise;return original(input);};
  const budget=new SharedModelBudget(authority),call={...runtimeCall(),deadline:Date.now()+20},permit=await budget.reserve(call,liveSignal());
  const pending=budget.settle(runtimeBill(call,permit));await new Promise<void>(resolve=>setTimeout(resolve,30));assert.equal(budget.status.interrupted,null);
  ready.resolve();assert.deepEqual(await pending,{unknown:false});assert.equal(authority.settled[0]!.usage!.inputTokens,12);
});

test('production resource ownership closes Host and accounting before the proof helper, never the borrowed authority',async()=>{
  const authority=new FictionalBudgetAuthority(),budget=new SharedModelBudget(authority),call=runtimeCall(),permit=await budget.reserve(call,liveSignal()),hostReady=deferred(),order:string[]=[];let disposed=false;
  const lifetime=new RuntimeResourceLifetime({budget,isHostDisposed:()=>disposed,timeoutMs:1000,closeProof:async()=>{assert.equal(authority.held,0);order.push('proof');}});
  const close=lifetime.close({close:async()=>{order.push('host');await hostReady.promise;disposed=true;}});
  assert.deepEqual(order,['host']);await budget.settle(runtimeBill(call,permit));order.push('settled');hostReady.resolve();await close;await lifetime.close();
  assert.deepEqual(order,['host','settled','proof']);assert.equal(authority.settled.length,1);
});

test('unconfirmed Host or accounting drain retains the proof helper for a later safe close',async()=>{
  const authority=new FictionalBudgetAuthority(),budget=new SharedModelBudget(authority);let disposed=false,closed=0;
  const lifetime=new RuntimeResourceLifetime({budget,isHostDisposed:()=>disposed,timeoutMs:20,closeProof:async()=>{closed++;}});
  await assert.rejects(lifetime.close(),/RUNTIME_HOST_NOT_DISPOSED/);assert.equal(closed,0);disposed=true;await lifetime.close();assert.equal(closed,1);
  const other=new SharedModelBudget(new FictionalBudgetAuthority()),call=runtimeCall(),permit=await other.reserve(call,liveSignal());let proof=0;
  const pending=new RuntimeResourceLifetime({budget:other,isHostDisposed:()=>true,timeoutMs:10,closeProof:async()=>{proof++;}});
  await assert.rejects(pending.close(),/RUNTIME_ACCOUNTING_NOT_DRAINED/);assert.equal(proof,0);await other.settle(runtimeBill(call,permit));await pending.close();assert.equal(proof,1);
});
