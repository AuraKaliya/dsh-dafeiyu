import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { testTempDir } from './test-temp.js';
const execute=promisify(execFile);
for(const [point,exitCode,state,sends] of [['ready',73,'sent',1],['sending',74,'uncertain',0],['rendering',75,'interrupted',0]] as const)test(`native delivery process exit at ${point} preserves its recovery boundary without rerunning a model`,async()=>{
  const root=await mkdtemp(join(testTempDir(),'dafeiyu-native-recovery-')),fixture=resolve('build-tests/qq-task-recovery-fixture.js');
  await assert.rejects(()=>execute(process.execPath,[fixture,root,point],{cwd:resolve('.'),timeout:20000,maxBuffer:200000}),error=>error instanceof Error&&'code'in error&&error.code===exitCode);
  const resumed=await execute(process.execPath,[fixture,root,'resume'],{cwd:resolve('.'),timeout:20000,maxBuffer:200000}),report=JSON.parse(resumed.stdout.trim().split('\n').at(-1)!);
  assert.equal(report.state,state);assert.equal(report.modelCalls,0,JSON.stringify(report));assert.equal(report.sends,sends);assert.ok(report.otherSends<=1);assert.equal(report.serverAccess,false);
});
