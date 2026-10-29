import assert from 'node:assert/strict';
import test from 'node:test';
import { selectTests } from '../../scripts/testing/selection.ts';

const available = ['tests/memory-store.test.ts', 'tests/tooling/test-storage.test.ts', 'tests/smoke/host.test.ts'];
test('default checks run only units; smoke is explicit', () => {
  assert.deepEqual(selectTests(available, []).files, available.slice(0, 2));
  assert.deepEqual(selectTests(available, ['--smoke']).files, available.slice(2));
});
test('targeted checks compile only selected tests and deduplicate file names', () => {
  const selected = selectTests(available, [available[0]!, available[0]!]);
  assert.deepEqual(selected.files, [available[0]]);
  assert.deepEqual(selected.typecheck, selected.files);
});
test('completion checks typecheck all retained tests without implicitly running smoke', () => {
  const selected = selectTests(available, ['--check']);
  assert.deepEqual(selected.typecheck, available);
  assert.deepEqual(selected.files, available.slice(0, 2));
});
test('unknown files, generated paths and conflicting flags fail before a test run', () => {
  for (const args of [['../outside.test.ts'], ['build-tests/memory-store.test.js'], ['--unknown'], ['--smoke', '--check'], ['--smoke', available[0]!]]) {
    assert.throws(() => selectTests(available, args));
  }
  assert.throws(() => selectTests([], []), /TEST_SELECTION_EMPTY/);
});
