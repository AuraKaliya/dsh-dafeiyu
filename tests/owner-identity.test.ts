import test from 'node:test';
import assert from 'node:assert/strict';
import {nonceStart,ownerAlive,ownerNonce,processStartTime} from '../packages/journal/lib/owner-identity.js';

test('owner nonce carries PID and process start time',()=>{
  const nonce=ownerNonce(process.pid);
  const parsed=nonceStart(nonce);
  assert.equal(parsed?.pid,process.pid);
  assert.equal(parsed?.start,processStartTime(process.pid));
});

test('a PID reused by a later process is not the recorded owner',()=>{
  const start=processStartTime(process.pid);
  if(start===null)return;
  assert.equal(ownerAlive(process.pid,{processStartedAt:start}),true);
  assert.equal(ownerAlive(process.pid,{processStartedAt:start-60_000}),false);
  assert.equal(ownerAlive(process.pid,{claimedAt:new Date(start-60_000).toISOString()}),false);
  assert.equal(ownerAlive(process.pid,{nonce:`${process.pid}:${start-60_000}:fixture`}),false);
});
