import assert from 'node:assert/strict';
import test from 'node:test';

import { segmentBudgetDecision } from '../packages/core/lib/segment-budget.js';

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
