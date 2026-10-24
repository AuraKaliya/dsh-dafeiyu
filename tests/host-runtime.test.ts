import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
const execute=promisify(execFile);
for(const [scenario,name] of [
  ['normal','Host assembles real DSH, tasks and chat; restart and duplicate requests do not replay the model'],
  ['single','single-run mode does not start required channels or copy their credentials'],
  ['backlog','single-run leaves accepted chat and task backlog for a later daemon start'],
  ['optional','a missing optional channel is degraded while valid native tasks remain available'],
  ['required','a missing required channel prevents admission and releases only acquired resources'],
  ['policy','unknown configured action policies fail before any model invocation'],
  ['fault','recovery failure is reported and partial runtime assembly is closed safely'],
  ['minimal','a minimal Host keeps chat available without claiming task or persona providers'],
  ['drain','graceful drain preserves providers until an already running result has been read'],
  ['cancel','drain timeout cooperatively cancels the model and preserves an interrupted Run'],
  ['qq','loopback QQ fixture buffers ingress until Host readiness and preserves a real simulated receipt'],
  ['qq-groups','failed group sync degrades Host diagnostics without granting groups or stopping valid private chat'],
] as const)test(name,async()=>{const {stdout}=await execute(process.execPath,[resolve('build-tests/host-runtime-fixture.js'),scenario],{cwd:resolve('.'),timeout:20000,maxBuffer:200000});const report=JSON.parse(stdout.trim().split('\n').at(-1)!);assert.equal(report.passed,true);assert.equal(report.serverAccess,false);});
