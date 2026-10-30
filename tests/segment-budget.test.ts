import assert from 'node:assert/strict';
import test from 'node:test';

import { BYTES_PER_TOKEN, assertSegmentBudget, bytesOverBudget, segmentBudgetDecision } from '../packages/core/lib/segment-budget.js';

test('a request below the soft threshold is sent as is', () => {
  const result = segmentBudgetDecision({ inputTokens: 10000, outputReserveTokens: 4000 });
  assert.equal(result.decision, 'send');
  assert.equal(result.reason, 'within-soft');
  assert.equal(result.softTokens, 24000);
});

test('between soft and hard the program compacts first', () => {
  const result = segmentBudgetDecision({ inputTokens: 26000, outputReserveTokens: 4000 });
  assert.equal(result.decision, 'compact-then-send');
  assert.equal(result.reason, 'above-soft');
});

test('at the hard limit the segment yields instead of sending an oversized request', () => {
  const result = segmentBudgetDecision({ inputTokens: 32000, outputReserveTokens: 4000 });
  assert.equal(result.decision, 'yield');
  assert.equal(result.reason, 'at-hard');
});

test('a smaller model window lowers the limits and can block entirely', () => {
  const smaller = segmentBudgetDecision({ inputTokens: 20000, outputReserveTokens: 4000, modelWindowTokens: 24000 });
  assert.equal(smaller.hardTokens, 20000);
  assert.equal(smaller.decision, 'yield');

  const impossible = segmentBudgetDecision({ inputTokens: 100, outputReserveTokens: 4000, modelWindowTokens: 2000 });
  assert.equal(impossible.decision, 'block');
  assert.equal(impossible.reason, 'output-reserve-exceeds-window');
});

test('invalid budgets are rejected instead of silently inverted', () => {
  assert.throws(() => segmentBudgetDecision({ inputTokens: 1, outputReserveTokens: 0, budget: { softTokens: 30000, hardTokens: 30000 } }));
});

test('measured request bytes are compared with the hard token budget at a fixed density', () => {
  assert.equal(BYTES_PER_TOKEN, 4);
  assert.equal(bytesOverBudget(32000 * 4, 32000), false);
  assert.equal(bytesOverBudget(32000 * 4 + 1, 32000), true);
  assert.equal(bytesOverBudget(24000 * 4, 32000), false);
});

test('an over-budget request is refused before it is sent', () => {
  assert.throws(() => assertSegmentBudget(32000 * 4 + 1, 32000), /SEGMENT_YIELD/);
  assert.doesNotThrow(() => assertSegmentBudget(32000 * 4, 32000));
});
