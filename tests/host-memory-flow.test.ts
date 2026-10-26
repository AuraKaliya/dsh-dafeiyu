import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { MEMORY_SCHEMA_VERSION } from '@dafeiyu/memory/store';

test('actual Host collects selected evidence, maintains a native task, reports counts, restarts and blocks revoked experience',async()=>{
  const {stdout}=await promisify(execFile)(process.execPath,[resolve('build-tests/host-memory-flow-fixture.js')],{cwd:resolve('.'),timeout:60000,maxBuffer:150000});
  const report=JSON.parse(stdout.trim().split('\n').at(-1)!);assert.equal(report.passed,true);assert.equal(report.schema,MEMORY_SCHEMA_VERSION);assert.equal(report.restartAdditionalModelCalls,0);
  assert.equal(report.realModel,false);assert.equal(report.realPlatform,false);assert.equal(report.serverAccess,false);
});
