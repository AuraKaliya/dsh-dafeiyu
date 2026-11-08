import test from 'node:test';
import assert from 'node:assert/strict';
import {heavyTask} from './heavy-task-fixture.js';
test('a historical-size task retains all work without multi-second local stalls',{timeout:120000},async t=>{
  const report=await heavyTask(t.signal);assert.equal(report.capacity,1000000);
  if(process.env.DAFEIYU_PERFORMANCE_SLO!=='1')return;
  assert.ok(report.maxLoopDelayMs<1000,`event loop delayed ${report.maxLoopDelayMs} ms`);
});
