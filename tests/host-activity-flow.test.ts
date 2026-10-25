import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

test('Host preserves a dormant single-run plan, wakes without QQ, retains chosen observations, maintains memory and restarts without replay',async()=>{
  const {stdout}=await promisify(execFile)(process.execPath,[resolve('build-tests/host-activity-flow-fixture.js')],{cwd:resolve('.'),timeout:60000,maxBuffer:200000,windowsHide:true});
  const result=JSON.parse(stdout.trim().split('\n').at(-1)!);assert.equal(result.passed,true);assert.equal(result.restartAdditionalModelCalls,0);assert.equal(result.singleRunBackgroundCalls,0);assert.equal(result.completedOccurrences,2);
  assert.equal(result.realModel,false);assert.equal(result.realPlatform,false);assert.equal(result.serverAccess,false);
});
