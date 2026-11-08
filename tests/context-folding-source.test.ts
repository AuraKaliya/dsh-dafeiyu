import test from 'node:test';
import assert from 'node:assert/strict';
import {runContextFoldingFixture} from './context-folding-fixture.js';
test('a folded reference invokes its actual raw archive, not a metadata-only source',{timeout:60000},async t=>{
  const result=await runContextFoldingFixture(t.signal,'source');assert.equal(result.reads,12);assert.equal(result.reopens,1);assert.match(result.sent??'',/尾段仍待处理/);
});
