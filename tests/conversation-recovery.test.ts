import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRecoveryDecision} from '../packages/core/lib/conversation-recovery.js';

test('recovery accepts a valid decision object',()=>{
  assert.deepEqual(parseRecoveryDecision('{"next":"answer","message":"可以回答"}'),{next:'answer',message:'可以回答'});
});

test('recovery keeps usable prose instead of falling back to a fixed template',()=>{
  assert.deepEqual(parseRecoveryDecision('这次没跑完，卡在上下文容量；我可以按更小的范围重试。'),{next:'wait',message:'这次没跑完，卡在上下文容量；我可以按更小的范围重试。'});
  assert.deepEqual(parseRecoveryDecision('{"message":"只返回了正文"}'),{next:'wait',message:'只返回了正文'});
});

test('empty recovery output is rejected',()=>{
  assert.throws(()=>parseRecoveryDecision('   '),/RECOVERY_EMPTY/);
});
