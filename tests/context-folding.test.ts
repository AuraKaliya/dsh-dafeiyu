import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runContextFoldingFixture,saveContextBaseline} from './context-folding-fixture.js';
import {captureAcceptance} from './acceptance-evidence.js';

test('fixed twelve-result task preserves evidence and delivery while reducing repeated input',{timeout:60000},async t=>{
  const result=await runContextFoldingFixture(t.signal);
  if(process.env.DAFEIYU_CAPTURE_CONTEXT_BASELINE==='1'){assert.equal(result.foldedRequests,0);await saveContextBaseline(result);return;}
  const baseline=JSON.parse(await readFile('tests/fixtures/acceptance/context-baseline.json','utf8'));
  assert.deepEqual(result.sample,baseline.sample);assert.equal(result.taskRequests,baseline.taskRequests);assert.equal(result.reads,baseline.reads);assert.equal(result.sent,baseline.sent);
  assert.ok(result.foldedRequests>0);assert.ok(result.repeatedBodies<baseline.repeatedBodies);assert.ok(result.totalInputBytes<baseline.totalInputBytes);
  assert.equal(result.capacity.maxTokens,1000000);assert.equal(result.inputUsage?.inputContext?.measuredCalls,result.allRequests);assert.equal(result.inputUsage?.inputContext?.byEnvironment['deterministic-test']?.calls,result.allRequests);
  console.log(JSON.stringify({kind:'context-byte-comparison',baseline:baseline.totalInputBytes,current:result.totalInputBytes,repeatedBodies:result.repeatedBodies,paidCalls:false}));
  if(process.env.DAFEIYU_ACCEPTANCE_DIR)captureAcceptance('context-folding',result);
});

