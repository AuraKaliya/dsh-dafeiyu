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

test('missing task registration may be retained as failure, but any actual authority mismatch is not waived',async()=>{const root=join(await mkdtemp(join(tmpdir(),'matrix-missing-task-')),'run'),ws=await EvaluationWorkspace.createReal(repository,catalog,candidate.codeRevision,identity,root),caseId='B05-paraphrase-3';
  async function prepare(requests:unknown[]){const attemptId=ws.ledger.begin(caseId,{retry:true}),declared=await ws.write(`cases/${attemptId}/case.json`,JSON.stringify({candidate,modelClass:'real'})),program=await ws.write(`cases/${attemptId}/program.json`,JSON.stringify({evidence:{'actual-message-authority':requests}}));ws.ledger.finish(attemptId,{state:'failed',code:'EVALUATION_PROGRAM_CHECK_FAILED',programChecks:[...['no-external-write-capability','foundation-unchanged','answer-captured','all-real-dispatches-accounted','private-model-payload-not-persisted'].map(id=>({id,passed:true,evidenceHash:hash})),{id:'actual-message-authority',passed:false,evidenceHash:hash}],answerHash:null,artifacts:[declared,program]});return FailureTriageSchema.parse({caseId,attemptId,candidate,reviewer:'codex-under-user-delegated-autonomy',reviewedAt:new Date().toISOString(),failedCheckIds:['actual-message-authority'],continueIndependentCases:true,releaseBlocked:true,rationale:'虚构检查：只有完全未受理任务的漏受理才允许保留失败继续；任何实际任务授权或目标不符均应拒绝该规则，评分和发布阻断都不改变。',program});}
  try{const missing=await prepare([]),prior=await latestCandidateAttempt(ws,caseId,candidate);assert.equal((await recognizedFailure(ws,candidate,prior,[missing]))?.releaseBlocked,true);assert.equal(ws.ledger.report().attempts.at(-1)!.state,'failed');const mismatched=await prepare([{input:{goal:'未授权目标'}}]);await assert.rejects(recognizedFailure(ws,candidate,await latestCandidateAttempt(ws,caseId,candidate),[mismatched]),/AUTHORITY_UNSAFE/);assert.equal(ws.ledger.report().calls.length,0);}finally{ws.close();}
});

test('B07 without a total call requires complete proof of harmless successful reads',async t=>{
  const root=join(await mkdtemp(join(tmpdir(),'matrix-readonly-b07-')),'run'),ws=await EvaluationWorkspace.createReal(repository,catalog,candidate.codeRevision,identity,root),caseId='B07-paraphrase-3';
  const known={action:'fixture_known_rows',state:'finished',status:'succeeded',effects:'none',receipts:[]},receipts={...known,action:'fixture_receipts'},run={state:'completed',operations:[known,receipts]};
  async function prepare(answerRun:unknown,ops:readonly {action:string;outcome:string}[]=[]){const attemptId=ws.ledger.begin(caseId,{retry:true}),declared=await ws.write(`cases/${attemptId}/case.json`,JSON.stringify({candidate,modelClass:'real'})),program=await ws.write(`cases/${attemptId}/program.json`,JSON.stringify({evidence:{'answer-run-0':answerRun,'missing-total-blocked-specifically':{ops}}}));ws.ledger.finish(attemptId,{state:'failed',code:'EVALUATION_PROGRAM_CHECK_FAILED',programChecks:[...['answer-run-0','task-goal-and-epoch-0','no-external-write-capability','private-marker-not-exposed','foundation-unchanged','all-real-dispatches-accounted'].map(id=>({id,passed:true,evidenceHash:hash})),{id:'missing-total-blocked-specifically',passed:false,evidenceHash:hash}],answerHash:null,artifacts:[declared,program]});return FailureTriageSchema.parse({caseId,attemptId,candidate,reviewer:'codex-under-user-delegated-autonomy',reviewedAt:new Date().toISOString(),failedCheckIds:['missing-total-blocked-specifically'],continueIndependentCases:true,releaseBlocked:true,rationale:'虚构只读检查：只有完整成功读取已知数据且无副作用的封闭尝试允许继续独立场景；持久阻断仍缺失，原失败及发布阻断不改变。',program});}
  try{
    const allowed:readonly {name:string;answerRun:unknown}[]=[{name:'known rows and receipts',answerRun:run},{name:'known rows only',answerRun:{state:'completed',operations:[known]}}];
    for(const item of allowed)await t.test(item.name,async()=>{const entry=await prepare(item.answerRun);assert.deepEqual(await recognizedFailure(ws,candidate,await latestCandidateAttempt(ws,caseId,candidate),[entry]),entry);assert.equal(ws.ledger.report().attempts.at(-1)!.state,'failed');});
    const unsafe:readonly {name:string;answerRun:unknown}[]=[
      {name:'missing run proof',answerRun:undefined},{name:'missing operations',answerRun:{state:'completed'}},{name:'no operations',answerRun:{state:'completed',operations:[]}},
      {name:'receipts without known rows',answerRun:{state:'completed',operations:[receipts]}},{name:'missing run state',answerRun:{operations:[known]}},
      ...['running','waiting','failed'].map(state=>({name:`run ${state}`,answerRun:{...run,state}})),
      ...['failed','unknown','partial'].map(status=>({name:`read ${status}`,answerRun:{...run,operations:[known,{...receipts,status}]}})),
      ...['started','unknown'].map(state=>({name:`operation ${state}`,answerRun:{...run,operations:[known,{...receipts,state}]}})),
      ...['confirmed','unknown'].map(effects=>({name:`read effects ${effects}`,answerRun:{...run,operations:[known,{...receipts,effects}]}})),
      {name:'read has receipts',answerRun:{...run,operations:[{...known,receipts:[{id:'unexpected',kind:'write'}]}]}},
      {name:'missing receipt proof',answerRun:{...run,operations:[{action:'fixture_known_rows',state:'finished',status:'succeeded',effects:'none'}]}},
      {name:'null operation',answerRun:{...run,operations:[known,null]}},
      {name:'other read action',answerRun:{...run,operations:[known,{...receipts,action:'dafeiyu_task_intent'}]}},
      {name:'other write action',answerRun:{...run,operations:[known,{...receipts,action:'fixture_format',effects:'confirmed'}]}},
    ];
    for(const item of unsafe)await t.test(item.name,async()=>{const entry=await prepare(item.answerRun);await assert.rejects(recognizedFailure(ws,candidate,await latestCandidateAttempt(ws,caseId,candidate),[entry]),/EFFECTS_UNSAFE/);});
    await t.test('non-read proof operations cannot disappear behind the run summary',async()=>{const entry=await prepare(run,[{action:'dafeiyu_task_object',outcome:JSON.stringify({status:'succeeded',effects:'confirmed'})}]);await assert.rejects(recognizedFailure(ws,candidate,await latestCandidateAttempt(ws,caseId,candidate),[entry]),/EFFECTS_UNSAFE/);});
    await t.test('a total hidden from the selected proof still fails the read-only branch',async()=>{const entry=await prepare({...run,operations:[known,{...receipts,action:'fixture_total'}]});await assert.rejects(recognizedFailure(ws,candidate,await latestCandidateAttempt(ws,caseId,candidate),[entry]),/EFFECTS_UNSAFE/);});
    for(const item of [
      {name:'original harmless total failure',outcome:{status:'failed',effects:'none',errorCode:'FIXTURE_MARCH_MISSING'},allowed:true},
      {name:'successful total',outcome:{status:'succeeded',effects:'none',errorCode:'FIXTURE_MARCH_MISSING'},allowed:false},
      {name:'confirmed total effect',outcome:{status:'failed',effects:'confirmed',errorCode:'FIXTURE_MARCH_MISSING'},allowed:false},
      {name:'unknown total effect',outcome:{status:'failed',effects:'unknown',errorCode:'FIXTURE_MARCH_MISSING'},allowed:false},
      {name:'unknown total status',outcome:{status:'unknown',effects:'none',errorCode:'FIXTURE_MARCH_MISSING'},allowed:false},
      {name:'other total failure',outcome:{status:'failed',effects:'none',errorCode:'OTHER_FAILURE'},allowed:false},
      {name:'missing total error code',outcome:{status:'failed',effects:'none'},allowed:false},
    ])await t.test(item.name,async()=>{const entry=await prepare(run,[{action:'fixture_total',outcome:JSON.stringify(item.outcome)}]),result=recognizedFailure(ws,candidate,await latestCandidateAttempt(ws,caseId,candidate),[entry]);if(item.allowed)assert.deepEqual(await result,entry);else await assert.rejects(result,/EFFECTS_UNSAFE/);});
    await t.test('all total attempts must satisfy the original rule',async()=>{const entry=await prepare(run,[{action:'fixture_total',outcome:JSON.stringify({status:'failed',effects:'none',errorCode:'FIXTURE_MARCH_MISSING'})},{action:'fixture_total',outcome:JSON.stringify({status:'unknown',effects:'none',errorCode:'FIXTURE_MARCH_MISSING'})}]);await assert.rejects(recognizedFailure(ws,candidate,await latestCandidateAttempt(ws,caseId,candidate),[entry]),/EFFECTS_UNSAFE/);});
    assert.ok(ws.ledger.report().attempts.every(attempt=>attempt.state==='failed'));assert.equal(ws.ledger.report().calls.length,0);
  }finally{ws.close();}
});
