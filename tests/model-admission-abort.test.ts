import test from 'node:test';
import assert from 'node:assert/strict';
import {raceCall} from '../packages/server-runtime/lib/model-admission.js';

test('a blocked model read is interrupted by the per-call signal instead of waiting for the stream',async()=>{
  const controller=new AbortController();
  const blocked=new Promise<string>(()=>{});
  const started=Date.now();
  const raced=raceCall(blocked,controller.signal);
  setTimeout(()=>controller.abort(new Error('RUNTIME_CALL_DEADLINE')),10);
  await assert.rejects(raced,/RUNTIME_CALL_CANCELLED/);
  assert.ok(Date.now()-started<100,'the read must be interrupted at the call boundary');
});

test('an already aborted call never enters the read',async()=>{
  const controller=new AbortController();
  controller.abort(new Error('RUNTIME_CALL_CANCELLED'));
  assert.throws(()=>raceCall(Promise.resolve('late'),controller.signal),/RUNTIME_CALL_CANCELLED/);
});
