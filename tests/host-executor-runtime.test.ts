import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

const execute=promisify(execFile);
for(const [scenario,name] of [
  ['owner','Host explicitly initializes executor storage and delivers a real loopback owner task through its persona session'],
  ['missing-ports','missing trusted executor ports fail Host startup and release the acquired profile lease'],
  ['authority','non-owner QQ and a Host CLI task cannot impersonate a genuine owner execution source'],
  ['unknown','an uncertain executor job degrades Host health and restart never redispatches it'],
  ['drain','Host drain preserves live executor authority through completion and result observation'],
  ['cancel','Host drain timeout cancels the executor and retains the actual uncertain receipt'],
] as const)test(name,async()=>{
  const {stdout}=await execute(process.execPath,[resolve('build-tests/host-executor-runtime-fixture.js'),scenario],{cwd:resolve('.'),timeout:30000,maxBuffer:300000});
  const report=JSON.parse(stdout.trim().split('\n').at(-1)!);
  assert.equal(report.passed,true);assert.equal(report.realDsh,true);assert.equal(report.realCoreMemory,true);assert.equal(report.realExecutorProcess,false);assert.equal(report.realAdministratorProof,false);assert.equal(report.realPlatform,false);assert.equal(report.realModel,false);assert.equal(report.serverAccess,false);
});
