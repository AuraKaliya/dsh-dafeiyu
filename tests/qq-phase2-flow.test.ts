import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
const execute=promisify(execFile);
test('one Host coordinates QQ observation, selective task memory, verified segmented result, restart and cancellation without scope leaks',async()=>{
  const {stdout}=await execute(process.execPath,[resolve('build-tests/qq-phase2-flow-fixture.js')],{cwd:resolve('.'),timeout:40000,maxBuffer:250000}),report=JSON.parse(stdout.trim().split('\n').at(-1)!);
  assert.equal(report.passed,true);assert.equal(report.realModel,false);assert.equal(report.realPlatform,false);assert.equal(report.serverAccess,false);assert.equal(report.restartAdditionalModelCalls,0);assert.equal(report.restartAdditionalSends,0);
});
