import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
test('actual Host runs local and autonomous Bili Tasks, retains selected observations and never replays interrupted requests',async()=>{
  const result=await promisify(execFile)(process.execPath,[resolve('build-tests/host-bili-flow-fixture.js')],{cwd:resolve('.'),timeout:30000,maxBuffer:200000}),report=JSON.parse(result.stdout.trim().split('\n').at(-1)!);assert.equal(report.passed,true);assert.equal(report.requests,3);assert.equal(report.realPlatform,false);assert.equal(report.serverAccess,false);
});
