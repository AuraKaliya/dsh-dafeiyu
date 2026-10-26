import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

const execute=promisify(execFile);
for(const [scenario,title] of [
  ['mounted','Host awaits the program model guard before Core activation and covers actual isolated memory analysis'],
  ['denied','Host model admission rejects both task and isolated memory dispatch before the adapter'],
  ['failed','failed asynchronous model guard installation closes the context and releases its profile lease'],
] as const)test(title,async()=>{
  const {stdout}=await execute(process.execPath,[resolve('build-tests/host-model-admission-fixture.js'),scenario],{cwd:resolve('.'),timeout:15000,maxBuffer:200000});
  const result=JSON.parse(stdout.trim().split('\n').at(-1)!);
  assert.equal(result.passed,true);assert.equal(result.realDsh,true);assert.equal(result.realModel,false);assert.equal(result.serverAccess,false);
});
