import test from 'node:test';
import assert from 'node:assert/strict';
import {runContextFoldingFixture} from './context-folding-fixture.js';
test('the actual task can batch archived pages without another host execution',{timeout:60000},async t=>{
  const result=await runContextFoldingFixture(t.signal,'batch');assert.equal(result.reads,12);assert.equal(result.reopens,1);assert.equal(result.capacity.maxTokens,1000000);
});
