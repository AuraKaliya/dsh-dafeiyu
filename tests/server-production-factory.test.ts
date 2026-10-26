import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { z } from 'zod';

const execute=promisify(execFile),windows={skip:process.platform!=='win32'};
const resultSchema=z.object({passed:z.literal(true),scenario:z.string(),outcome:z.enum(['assembled','expected-denial','admin-denied']),code:z.string().nullable(),
  realDsh:z.literal(true),realWindowsProof:z.literal(true),realModel:z.literal(false),actualHttp:z.literal(false),realPlatform:z.literal(false),serverAccess:z.literal(false),funding:z.literal('synthetic-deny-dispatch-not-7c'),
  fundingDatabaseInitialized:z.literal(false),credentials:z.literal('synthetic-only'),hostOpened:z.boolean(),installed:z.boolean(),modelStreams:z.literal(0),reserveAttempts:z.literal(0),settleAttempts:z.literal(0),fetchAttempts:z.literal(0),socketAttempts:z.literal(0),businessChildren:z.literal(0),proofHelpers:z.number().int().positive(),proofHelpersClosed:z.literal(true),
  parentProof:z.object({scope:z.literal('current-machine-only'),parent:z.object({ownerSid:z.string().regex(/^S-1-/),creationId:z.string().regex(/^\d+$/),elevated:z.boolean(),administratorsEnabled:z.boolean(),restricted:z.boolean()})})});
for(const [scenario,title]of [
  ['assembled','real Windows production factory opens official Host with zero model/network calls, or precisely rejects a non-admin token'],
  ['node-pin','real production factory rejects a changed Node fingerprint before opening a business runtime'],
  ['probe-pin','real production factory rejects a changed fixed Windows probe fingerprint'],
  ['owner-sid','real production factory rejects an owner SID different from the actual Windows token'],
  ['metadata','official provider default output is checked before Core activation through the actual production installer'],
  ['credential-pin','production factory release guard rejects rotation of the explicitly pinned synthetic credential store'],
]as const)test(title,windows,async context=>{
  // Preserve only the managed-test bootstrap and OS location fields, never model/platform credentials.
  const env:NodeJS.ProcessEnv={};for(const key of ['SystemRoot','WINDIR','NODE_OPTIONS','DAFEIYU_TEST_RUN','TEMP','TMP','TMPDIR'])if(process.env[key]!==undefined)env[key]=process.env[key];
  const {stdout}=await execute(process.execPath,[resolve('build-tests/server-production-factory-fixture.js'),scenario],{cwd:resolve('.'),env,windowsHide:true,timeout:60000,maxBuffer:500000});
  const result=resultSchema.parse(JSON.parse(stdout.trim().split('\n').at(-1)!));assert.equal(result.scenario,scenario);
  if(result.outcome==='admin-denied'){
    assert.equal(result.code,'EXECUTOR_ADMIN_TOKEN_REQUIRED');assert.equal(result.hostOpened,false);assert.equal(result.installed,false);
    assert.ok(!result.parentProof.parent.elevated||!result.parentProof.parent.administratorsEnabled||result.parentProof.parent.restricted);
    context.diagnostic('Actual local Windows token was refused; full Host construction was not certified.');if(scenario==='metadata')context.skip('Actual local admin token required to reach provider metadata installation');
  }else if(scenario==='assembled'){assert.equal(result.outcome,'assembled');assert.equal(result.hostOpened,true);assert.equal(result.installed,true);assert.equal(result.parentProof.parent.elevated,true);assert.equal(result.parentProof.parent.administratorsEnabled,true);assert.equal(result.parentProof.parent.restricted,false);}
  else{assert.equal(result.outcome,'expected-denial');assert.equal(result.hostOpened,false);}
});
