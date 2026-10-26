import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

const execute=promisify(execFile);
for(const [scenario,name] of [
  ['chat','Host uses the independent Bili owner channel and restart does not replay its original chat or send'],
  ['task','Host Bili owner task reads the real public capability and delivers only the persona-reviewed result'],
  ['missing','a required Bili owner channel fails without trusted ports before any model or platform call'],
  ['optional','an optional Bili port factory failure degrades only its channel and leaves a shared conversation policy usable'],
  ['optional-recovery','optional Bili startup failures preserve an existing accepted Task until its actual source channel can recover'],
  ['single','single-run skips the Bili owner port factory and retains queued private messages'],
  ['drain','Host drain preserves a finished Bili reply and restart sends it without repeating its model turn'],
] as const)test(name,async()=>{
  const {stdout}=await execute(process.execPath,[resolve('build-tests/host-bili-owner-runtime-fixture.js'),scenario],{cwd:resolve('.'),timeout:30000,maxBuffer:300000});
  const result=JSON.parse(stdout.trim().split('\n').at(-1)!);assert.equal(result.passed,true);assert.equal(result.realHost,true);assert.equal(result.realModel,false);assert.equal(result.realPlatform,false);assert.equal(result.serverAccess,false);
});
