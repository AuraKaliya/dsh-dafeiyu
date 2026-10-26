import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

const execute=promisify(execFile);
for(const [scenario,name] of [
  ['media','actual Host and isolated MediaAnalysis send the original two PNGs in one official inline request with no Files API'],
  ['stale','a stale file-id HTTP error cannot cause a second dispatch in the fixed inline route'],
  ['denied','model admission denial prevents both image byte access and any provider HTTP dispatch'],
  ['oversize','inline byte overflow fails before HTTP without silently using Files or dropping images'],
  ['truncated','an incomplete actual SDK stream stays uncertain and never retries the inline request'],
  ['credential','a changed selected credential file prevents inline model dispatch'],
] as const)test(name,async()=>{
  const {stdout}=await execute(process.execPath,[resolve('build-tests/host-inline-model-fixture.js'),scenario],{cwd:resolve('.'),timeout:20000,maxBuffer:200000});
  const result=JSON.parse(stdout.trim().split('\n').at(-1)!);assert.equal(result.passed,true);assert.equal(result.realDsh,true);assert.equal(result.realModel,false);assert.equal(result.actualHttp,false);assert.equal(result.serverAccess,false);
});
