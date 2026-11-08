import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeCpuProfile} from '../../scripts/acceptance/performance-profile.mjs';
test('CPU windows clip sample intervals and do not add recursive parent time twice',()=>{
  const frame={functionName:'validate',url:'file:///private/root/packages/core/lib/example.js',lineNumber:4};
  const result=summarizeCpuProfile({nodes:[{id:1,callFrame:frame,children:[2]},{id:2,callFrame:frame}],samples:[2,2],timeDeltas:[1000,1000]},0.5,1.5);
  assert.equal(result.sampledMs,1);assert.equal(result.inclusive[0]?.ms,1);assert.equal(result.self[0]?.file,'packages/core/lib/example.js');assert.equal(result.self[0]?.line,5);
});
