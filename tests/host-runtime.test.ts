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
  ['minimal','a minimal Host retains memory while denying unconfigured task authority'],
  ['drain','graceful drain preserves providers until an already running result has been read'],
  ['cancel','drain timeout cooperatively cancels the model and preserves an interrupted Run'],
  ['qq','loopback QQ fixture buffers ingress until Host readiness and preserves a real simulated receipt'],
  ['qq-groups','failed group sync degrades Host diagnostics without granting groups or stopping valid private chat'],
  ['qq-capabilities','Host assembles QQ observations, tracked selection and accurate diagnostics'],
  ['single-capabilities','single-run skips QQ conversation-only policies and does not require channel credentials'],
  ['optional-capabilities','an absent optional QQ observation channel does not block unrelated native tasks'],
  ['qq-segments','Host records complete segmented QQ delivery without exposing body in status'],
  ['qq-partial','Host preserves unknown QQ segment counters through orderly shutdown'],
  ['qq-tasks','Host assembles automatic native QQ task delivery and persists truthful counts'],
  ['qq-tasks-wait','Host sends a verified discussion message for a blocked task without completing its Run'],
  ['single-tasks','single-run mode leaves the configured QQ task pipeline dormant'],
] as const)test(name,async()=>{const {stdout}=await execute(process.execPath,[resolve('build-tests/host-runtime-fixture.js'),scenario],{cwd:resolve('.'),timeout:20000,maxBuffer:200000});const report=JSON.parse(stdout.trim().split('\n').at(-1)!);assert.equal(report.passed,true);assert.equal(report.serverAccess,false);});
