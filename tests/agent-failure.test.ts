import test from 'node:test';
import assert from 'node:assert/strict';
import {turnFailureCode,safeRunFailure} from '../packages/core/lib/agent-session.js';

test('model failure receipts preserve provider codes and status without exposing private messages',()=>{
  assert.equal(turnFailureCode({kind:'error',error:{message:'Model did not complete',code:'TRANSPORT'}}),'MODEL_TRANSPORT');
  assert.equal(turnFailureCode({kind:'error',error:{message:'credential-value-must-not-leak',code:'API_ERROR',status:429}}),'MODEL_HTTP_429');
  assert.equal(turnFailureCode({kind:'error',error:{message:'SOURCE_STALE',code:'HOOK_FAILED'}}),'SOURCE_STALE');
  assert.equal(turnFailureCode({kind:'error',error:{message:'private payload',code:'not a safe code'}}),'MODEL_INCOMPLETE');
  assert.equal(safeRunFailure('MODEL_HTTP_429'),'MODEL_HTTP_429');
  assert.equal(safeRunFailure('PRIVATE_INPUT_REJECTED'),'PRIVATE_INPUT_REJECTED');
});
