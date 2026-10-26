import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { EvaluationCatalog } from '../../scripts/evaluation/catalog.ts';
import { EvaluationWorkspace } from '../../scripts/evaluation/workspace.ts';
import type { RuntimeIdentity } from '../../scripts/evaluation/identity.ts';
import { eligibleCaseRetry,retryOneRealCase } from '../../scripts/acceptance-retry.ts';
if(!process.env.DAFEIYU_TEST_RUN||!tmpdir().startsWith(process.env.DAFEIYU_TEST_RUN))throw new Error('MANAGED_TEST_RUN_REQUIRED');
const repository=resolve('.'),catalog=new EvaluationCatalog(repository),candidate={codeRevision:'a'.repeat(40),runtimeHash:'b'.repeat(64),protocolHash:'c'.repeat(64)},identity:RuntimeIdentity={schemaVersion:1,node:process.version,sqlite:process.versions.sqlite??'unknown',platform:process.platform,arch:process.arch,scope:'real-evaluation-runtime-v1',files:[],workspaceLinks:[]};
test('case recovery requires a failed matching candidate and never skips an incomplete predecessor',async()=>{const root=join(await mkdtemp(join(tmpdir(),'eval-case-retry-')),'run'),ws=await EvaluationWorkspace.createReal(repository,catalog,candidate.codeRevision,identity,root),first=catalog.manifest.cases[0]!,second=catalog.manifest.cases[1]!;
  async function record(caseId:string,state:'failed'|'needs-human-review',runtimeHash=candidate.runtimeHash){const attemptId=ws.ledger.begin(caseId,{retry:true}),artifact=await ws.write(`cases/${attemptId}/case.json`,JSON.stringify({candidate:{...candidate,runtimeHash},modelClass:'real'}));ws.ledger.finish(attemptId,{state,code:null,programChecks:[{id:'fixture',passed:state==='needs-human-review',evidenceHash:'a'.repeat(64)}],answerHash:null,artifacts:[artifact]});}
  try{await assert.rejects(eligibleCaseRetry(catalog,ws,candidate,first.id),/FAILED_CASE_REQUIRED/);await record(second.id,'failed');await assert.rejects(eligibleCaseRetry(catalog,ws,candidate,second.id),/PREVIOUS_CASE_INCOMPLETE/);await record(first.id,'needs-human-review');assert.equal((await eligibleCaseRetry(catalog,ws,candidate,second.id)).id,second.id);await assert.rejects(eligibleCaseRetry(catalog,ws,candidate,first.id),/FAILED_CASE_REQUIRED/);await record(second.id,'failed','d'.repeat(64));await assert.rejects(eligibleCaseRetry(catalog,ws,candidate,second.id),/FAILED_CASE_REQUIRED/);await assert.rejects(retryOneRealCase(repository,catalog,ws,second.id),/LIVE_CALLS_DISABLED_IN_TESTS/);assert.equal(ws.ledger.report().calls.length,0);assert.equal(ws.ledger.executionStatus()!.firstCallAt,null);}finally{ws.close();}});
test('recovery CLI refuses live requests from the managed-test environment',()=>{const child=spawnSync(process.execPath,['scripts/retry-integrated-case.mjs','H03-compressed-2'],{cwd:repository,encoding:'utf8',timeout:10000});assert.equal(child.status,1);assert.ok(child.stderr.includes('LIVE_CALLS_DISABLED_IN_TESTS'));});
