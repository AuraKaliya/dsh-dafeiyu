import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { EvaluationCatalog } from '../../scripts/evaluation/catalog.ts';
import { EvaluationWorkspace } from '../../scripts/evaluation/workspace.ts';
import type { RuntimeIdentity } from '../../scripts/evaluation/identity.ts';
import { latestCandidateAttempt } from '../../scripts/evaluation/real-candidate.ts';
import { matrixContinuationPlan,continueRealMatrix } from '../../scripts/acceptance-matrix.ts';
import { recognizedFailure,FailureTriageSchema } from '../../scripts/acceptance-triage.ts';
import { eligibleCaseRetry } from '../../scripts/acceptance-retry.ts';
if(!process.env.DAFEIYU_TEST_RUN||!tmpdir().startsWith(process.env.DAFEIYU_TEST_RUN))throw new Error('MANAGED_TEST_RUN_REQUIRED');
const repository=resolve('.'),catalog=new EvaluationCatalog(repository),hash='a'.repeat(64),candidate={codeRevision:'a'.repeat(40),runtimeHash:'b'.repeat(64),protocolHash:'c'.repeat(64)},identity:RuntimeIdentity={schemaVersion:1,node:process.version,sqlite:process.versions.sqlite??'unknown',platform:process.platform,arch:process.arch,scope:'real-evaluation-runtime-v1',files:[],workspaceLinks:[]};
test('reviewed behavior failure stays failed while the original matrix order advances only to independent unrun cases',async()=>{
  const root=join(await mkdtemp(join(tmpdir(),'matrix-continuation-')),'run'),ws=await EvaluationWorkspace.createReal(repository,catalog,candidate.codeRevision,identity,root),required=['answer-run-0','task-goal-and-epoch-0','no-external-write-capability','private-marker-not-exposed','foundation-unchanged','all-real-dispatches-accounted'];
  try{for(const item of catalog.manifest.cases.slice(0,8)){const id=ws.ledger.begin(item.id),artifact=await ws.write(`cases/${id}/case.json`,JSON.stringify({candidate,modelClass:'real'}));ws.ledger.finish(id,{state:'needs-human-review',code:null,programChecks:required.map(id=>({id,passed:true,evidenceHash:hash})),answerHash:null,artifacts:[artifact]});}
    const item=catalog.manifest.cases[8]!;assert.equal(item.id,'B07-paraphrase-1');const id=ws.ledger.begin(item.id),declared=await ws.write(`cases/${id}/case.json`,JSON.stringify({candidate,modelClass:'real'})),program=await ws.write(`cases/${id}/program.json`,JSON.stringify({evidence:{'missing-total-blocked-specifically':{ops:[{action:'fixture_total',outcome:JSON.stringify({status:'failed',effects:'none',errorCode:'FIXTURE_MARCH_MISSING'})}]}}}));ws.ledger.finish(id,{state:'failed',code:'EVALUATION_PROGRAM_CHECK_FAILED',programChecks:[...required.map(id=>({id,passed:true,evidenceHash:hash})),{id:'missing-total-blocked-specifically',passed:false,evidenceHash:hash}],answerHash:null,artifacts:[declared,program]});
    const entry=FailureTriageSchema.parse({caseId:item.id,attemptId:id,candidate,reviewer:'codex-under-user-delegated-autonomy',reviewedAt:new Date().toISOString(),failedCheckIds:['missing-total-blocked-specifically'],continueIndependentCases:true,releaseBlocked:true,rationale:'虚构单元检查：能力已拒绝无依据完整总量且没有副作用，保留失败，不改变发布阻断，仅允许其它独立样本继续。',program});
    await assert.rejects(matrixContinuationPlan(catalog,ws,candidate,1,[]),/REQUIRES_INSPECTION/);const plan=await matrixContinuationPlan(catalog,ws,candidate,1,[entry]);assert.deepEqual(plan.steps.map(s=>s.item.id),catalog.manifest.cases.slice(0,18).map(c=>c.id));assert.equal(plan.steps.filter(s=>s.action==='skip-pass').length,8);assert.equal(plan.steps[8]!.action,'retain-failure');assert.equal(plan.steps[9]!.item.id,catalog.manifest.cases[9]!.id);assert.equal(plan.steps.filter(s=>s.action==='execute').length,9);assert.equal(ws.ledger.report().attempts.at(-1)!.state,'failed');assert.equal(plan.retained[0]!.releaseBlocked,true);
    await assert.rejects(matrixContinuationPlan(catalog,ws,candidate,2,[entry]),/PREVIOUS_CASE_INCOMPLETE/);await assert.rejects(eligibleCaseRetry(catalog,ws,candidate,item.id,[entry]),/RETAINED_FAILURE_REQUIRES_FIX/);const prior=await latestCandidateAttempt(ws,item.id,candidate);await assert.rejects(recognizedFailure(ws,candidate,prior,[{...entry,program:{...program,hash:'d'.repeat(64)}}]),/PROOF_CHANGED/);
    const unsafe=structuredClone(prior!);unsafe.attempt.result!.programChecks.push({id:'private-marker-not-exposed',passed:false,evidenceHash:hash});await assert.rejects(recognizedFailure(ws,candidate,unsafe,[entry]),/FAILURE_CHANGED/);await writeFile(join(ws.root,program.relative),'{}');await assert.rejects(recognizedFailure(ws,candidate,prior,[entry]),/ARTIFACT_CHANGED/);await assert.rejects(continueRealMatrix(repository,catalog,ws,1),/LIVE_CALLS_DISABLED_IN_TESTS/);assert.equal(ws.ledger.report().calls.length,0);
  }finally{ws.close();}
});
test('matrix continuation CLI cannot dispatch from managed tests',()=>{const child=spawnSync(process.execPath,['scripts/continue-integrated-matrix.mjs','1'],{cwd:repository,encoding:'utf8',timeout:10000});assert.equal(child.status,1);assert.ok(child.stderr.includes('LIVE_CALLS_DISABLED_IN_TESTS'));});
