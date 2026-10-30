import test from 'node:test';
import assert from 'node:assert/strict';
import {raceCall,closeIterator,bindCallSignal} from '../packages/server-runtime/lib/model-admission.js';

test('a blocked model read is interrupted by the per-call signal instead of waiting for the stream',async()=>{
  const controller=new AbortController();
  const blocked=new Promise<string>(()=>{});
  const started=Date.now();
  const raced=raceCall(blocked,controller.signal);
  setTimeout(()=>controller.abort(new Error('RUNTIME_CALL_DEADLINE')),10);
  await assert.rejects(raced,/RUNTIME_CALL_CANCELLED/);
  assert.ok(Date.now()-started<100,'the read must be interrupted at the call boundary');
});

test('cleanup has a bounded wait even when the generator is blocked in next()',async()=>{
  async function* blocked(){await new Promise(()=>{});yield 'never';}
  const iterator=blocked();
  void iterator.next();
  const started=Date.now();
  await closeIterator(iterator,20);
  assert.ok(Date.now()-started<150,'iterator.return must not hold settlement indefinitely');
});

test('the local call signal is propagated into a mutable transport request',()=>{
  const original=new AbortController(),call=new AbortController();
  const request:{signal?:AbortSignal}={signal:original.signal};
  const combined=bindCallSignal(request,call.signal);
  assert.equal(request.signal,combined);
  call.abort(new Error('RUNTIME_CALL_DEADLINE'));
  assert.equal(request.signal?.aborted,true);
  const frozen=Object.freeze({signal:original.signal});
  assert.doesNotThrow(()=>bindCallSignal(frozen,call.signal));
});

test('an already aborted call never enters the read',async()=>{
  const controller=new AbortController();
  controller.abort(new Error('RUNTIME_CALL_CANCELLED'));
  assert.throws(()=>raceCall(Promise.resolve('late'),controller.signal),/RUNTIME_CALL_CANCELLED/);
});
