import test from 'node:test';
import assert from 'node:assert/strict';
import {heavyTask} from './heavy-task-fixture.js';
test('a cancellation timer interrupts a loaded task and preserves its completed operations',{timeout:120000},async t=>{
  const report=await heavyTask(t.signal,{cancelAfter:48});assert.ok(report.cancelResponseMs!==null);assert.ok(report.cancelSettledMs!==null);assert.equal(report.sent,null);
  if(process.env.DAFEIYU_PERFORMANCE_SLO==='1'){assert.ok(report.cancelResponseMs<1000);assert.ok(report.cancelSettledMs<1500);}
});
