import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';

import { ExecutionOutcomeSchema } from '../packages/contracts/lib/execution.js';

test('execution outcomes distinguish final, wait and internal segment yield', () => {
  assert.deepEqual(ExecutionOutcomeSchema.parse({ kind: 'final' }), { kind: 'final' });
  assert.deepEqual(ExecutionOutcomeSchema.parse({ kind: 'wait', reason: 'TASK_OBJECTION_UNRESOLVED' }), { kind: 'wait', reason: 'TASK_OBJECTION_UNRESOLVED' });
  const yieldOutcome = ExecutionOutcomeSchema.parse({ kind: 'segment-yield', checkpointId: randomUUID(), reason: '预算达到软阈值' });
  assert.equal(yieldOutcome.kind, 'segment-yield');
  assert.throws(() => ExecutionOutcomeSchema.parse({ kind: 'segment-yield', checkpointId: 'not-a-uuid', reason: 'x' }));
  assert.throws(() => ExecutionOutcomeSchema.parse({ kind: 'unknown' }));
  assert.throws(() => ExecutionOutcomeSchema.parse({ kind: 'final', extra: true }));
});
