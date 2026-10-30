import assert from 'node:assert/strict';
import test from 'node:test';

import { readingSegmentDecision } from '../packages/core/lib/segment-policy.js';

const reading = (nextStep: string | null = '继续看评论区') => ({ kind: 'reading', nextStep });
const task = { status: 'active' as const, epoch: 2 };

test('three finished reading units with a next step continue the same task', () => {
  const decision = readingSegmentDecision({ checkpoints: [reading(), reading(), reading()], task, intentVersion: 2, segments: 0 });
  assert.equal(decision.next, 'continue');
  assert.equal(decision.reason, 'reading-work-left');
  assert.equal(decision.checkpointId, 2);
});

test('fewer units, no next step or non-reading checkpoints stop the chain', () => {
  assert.equal(readingSegmentDecision({ checkpoints: [reading(), reading()], task, intentVersion: 2, segments: 0 }).reason, 'no-reading-work');
  assert.equal(readingSegmentDecision({ checkpoints: [reading(), reading(), reading(null)], task, intentVersion: 2, segments: 0 }).reason, 'no-reading-work');
  const run = [{ kind: 'run-start', nextStep: null }, { kind: 'reading', nextStep: 'x' }, { kind: 'reading', nextStep: 'y' }, { kind: 'reading', nextStep: 'z' }];
  assert.equal(readingSegmentDecision({ checkpoints: run, task, intentVersion: 2, segments: 0 }).checkpointId, 3);
});

test('inactive tasks, stale epochs and the segment cap stop the chain', () => {
  const checkpoints = [reading(), reading(), reading()];
  assert.equal(readingSegmentDecision({ checkpoints, task: { status: 'paused', epoch: 2 }, intentVersion: 2, segments: 0 }).reason, 'task-inactive');
  assert.equal(readingSegmentDecision({ checkpoints, task, intentVersion: 1, segments: 0 }).reason, 'stale-epoch');
  assert.equal(readingSegmentDecision({ checkpoints, task, intentVersion: 2, segments: 8 }).reason, 'segment-cap');
  assert.equal(readingSegmentDecision({ checkpoints, task, intentVersion: 2, segments: 7, policy: { segmentsPerRun: 2, maxSegments: 8 } }).next, 'continue');
  assert.equal(readingSegmentDecision({ checkpoints, task, intentVersion: 2, segments: 0, policy: { segmentsPerRun: 4 } }).reason, 'no-reading-work');
});
