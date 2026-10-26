import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { EvaluationCatalog } from '../../scripts/evaluation/catalog.ts';
import { EvaluationWorkspace } from '../../scripts/evaluation/workspace.ts';
import type { RuntimeIdentity } from '../../scripts/evaluation/identity.ts';
import type { RealCandidate } from '../../scripts/evaluation/real-support.ts';
import { matrixContinuationPlan,matrixContinuationSettings,continueRealMatrix } from '../../scripts/acceptance-matrix.ts';
import { FailureTriageSchema } from '../../scripts/acceptance-triage.ts';
import { ScopeCertificateSchema } from '../../scripts/acceptance-scope.ts';
import type { ScopeCompatibility } from '../../scripts/acceptance-scope.ts';
if(!process.env.DAFEIYU_TEST_RUN||!tmpdir().startsWith(process.env.DAFEIYU_TEST_RUN))throw new Error('MANAGED_TEST_RUN_REQUIRED');
const repository=resolve('.'),catalog=new EvaluationCatalog(repository),hash='a'.repeat(64),
  previous:RealCandidate={codeRevision:'a'.repeat(40),runtimeHash:'b'.repeat(64),protocolHash:'c'.repeat(64)},
  current:RealCandidate={codeRevision:'d'.repeat(40),runtimeHash:'e'.repeat(64),protocolHash:'f'.repeat(64)},
  identity:RuntimeIdentity={schemaVersion:1,node:process.version,sqlite:process.versions.sqlite??'unknown',platform:process.platform,arch:process.arch,scope:'real-evaluation-runtime-v1',files:[],workspaceLinks:[]},
  noReuse={scopeReuse:false};
async function workspace(){return EvaluationWorkspace.createReal(repository,catalog,previous.codeRevision,identity,join(await mkdtemp(join(tmpdir(),'matrix-no-scope-')),'run'));}
const oldScope:ScopeCompatibility={certificate:ScopeCertificateSchema.parse({schemaVersion:1,from:previous,toRuntimeHash:current.runtimeHash,protocolHash:previous.protocolHash,
  changedFile:{path:'scripts/evaluation/history-fixture.ts',beforeHash:'1'.repeat(64),afterHash:'2'.repeat(64)},affectedSamples:['H01','H05'],reviewer:'codex-under-user-delegated-autonomy',
  reviewedAt:new Date().toISOString(),rationale:'只用于离线检查：这是原候选的旧范围兼容对象，新候选关闭复用后必须完全忽略它，不借用旧通过、旧基线或旧失败审阅来推进，也不代表新的真实模型验收。',
  checks:{relative:'docs/results/scope-fixture.json',hash}}),parentIdentity:identity,certificateHash:hash,checkReport:{fixtureOnly:true},calibrationBasis:'offline-fixture'};

async function save(ws:EvaluationWorkspace,caseId:string,candidate:RealCandidate,state:'needs-human-review'|'failed'='needs-human-review',charge=false){
  const attemptId=ws.ledger.begin(caseId,{retry:true}),artifact=await ws.write('cases/'+attemptId+'/case.json',JSON.stringify({candidate,modelClass:'real',fixtureOnly:'matrix-planning-unit-state'}));
  if(charge){const now=Date.now();ws.ledger.startExecution('formal',now);const reservation=ws.ledger.reserve(attemptId,'old-synthetic-'+attemptId,1,1,now+1);ws.ledger.settle(reservation,{inputTokens:1,outputTokens:1});ws.ledger.stopExecution(now+10);}
  ws.ledger.finish(attemptId,{state,code:state==='failed'?'EVALUATION_PROGRAM_CHECK_FAILED':null,programChecks:[{id:'fixture',passed:state==='needs-human-review',evidenceHash:hash}],answerHash:null,artifacts:[artifact]});
  return attemptId;
}

test('no-scope planning ignores old passes and failures, skips only the current candidate and keeps batch prerequisites',async()=>{
  const ws=await workspace();try{
    for(const [index,item]of catalog.manifest.cases.slice(0,18).entries())await save(ws,item.id,previous,index===8?'failed':'needs-human-review');
    const oldAttempts=ws.ledger.report().attempts,first=await matrixContinuationPlan(catalog,ws,current,1,[],oldScope,noReuse);
    assert.deepEqual(first.steps.map(step=>step.item.id),catalog.manifest.cases.slice(0,18).map(item=>item.id));
    assert.ok(first.steps.every(step=>step.action==='execute'&&step.retry));assert.deepEqual(first.retained,[]);
    assert.equal(first.scopeReuse,false);assert.equal(first.executionPhase,'formal');
    await assert.rejects(matrixContinuationPlan(catalog,ws,current,2,[],oldScope,noReuse),/PREVIOUS_CASE_INCOMPLETE/);
    await save(ws,catalog.manifest.cases[0]!.id,current);const resumed=await matrixContinuationPlan(catalog,ws,current,1,[],oldScope,noReuse),skipped=resumed.steps[0]!;
    assert.equal(skipped.action,'skip-pass');if(skipped.action!=='skip-pass')throw new Error('Expected current candidate skip');
    assert.equal(skipped.scopeReused,false);assert.deepEqual(skipped.basisCandidate,current);assert.equal(resumed.steps.filter(step=>step.action==='execute').length,17);
    await assert.rejects(matrixContinuationPlan(catalog,ws,current,2,[],oldScope,noReuse),/PREVIOUS_CASE_INCOMPLETE/);
    for(const item of catalog.manifest.cases.slice(1,18))await save(ws,item.id,current);
    const second=await matrixContinuationPlan(catalog,ws,current,2,[],oldScope,noReuse);assert.deepEqual(second.steps.map(step=>step.item.id),catalog.manifest.cases.slice(18,36).map(item=>item.id));assert.ok(second.steps.every(step=>step.action==='execute'&&!step.retry));
    assert.deepEqual(ws.ledger.report().attempts.slice(0,18),oldAttempts);assert.equal(ws.ledger.report().calls.length,0);
    await assert.rejects(continueRealMatrix(repository,catalog,ws,1,()=>{},noReuse),/LIVE_CALLS_DISABLED_IN_TESTS/);
  }finally{ws.close();}
});

test('no-scope mode cannot use matching triage to bypass a current-candidate failure',async()=>{
  const ws=await workspace(),required=['answer-run-0','task-goal-and-epoch-0','no-external-write-capability','private-marker-not-exposed','foundation-unchanged','all-real-dispatches-accounted'];
  try{
    for(const item of catalog.manifest.cases.slice(0,8))await save(ws,item.id,current);
    const item=catalog.manifest.cases[8]!,attemptId=ws.ledger.begin(item.id),declared=await ws.write('cases/'+attemptId+'/case.json',JSON.stringify({candidate:current,modelClass:'real',fixtureOnly:'current-failure'})),
      program=await ws.write('cases/'+attemptId+'/program.json',JSON.stringify({evidence:{'missing-total-blocked-specifically':{ops:[{action:'fixture_total',outcome:JSON.stringify({status:'failed',effects:'none',errorCode:'FIXTURE_MARCH_MISSING'})}]}}}));
    ws.ledger.finish(attemptId,{state:'failed',code:'EVALUATION_PROGRAM_CHECK_FAILED',programChecks:[...required.map(id=>({id,passed:true,evidenceHash:hash})),{id:'missing-total-blocked-specifically',passed:false,evidenceHash:hash}],answerHash:null,artifacts:[declared,program]});
    const triage=FailureTriageSchema.parse({caseId:item.id,attemptId,candidate:current,reviewer:'codex-under-user-delegated-autonomy',reviewedAt:new Date().toISOString(),failedCheckIds:['missing-total-blocked-specifically'],
      continueIndependentCases:true,releaseBlocked:true,rationale:'离线检查有效的原审阅分支；默认模式可保留失败继续独立场景，但显式关闭范围复用的新矩阵必须停止，不能借任何审阅对象跳过当前候选失败。',program});
    const legacy=await matrixContinuationPlan(catalog,ws,current,1,[triage]);assert.equal(legacy.steps[8]?.action,'retain-failure');assert.equal(legacy.scopeReuse,true);
    await assert.rejects(matrixContinuationPlan(catalog,ws,current,1,[triage],oldScope,noReuse),/CASE_REQUIRES_INSPECTION/);
    await assert.rejects(matrixContinuationPlan(catalog,ws,current,1,[{...triage,candidate:previous}],oldScope,noReuse),/CASE_REQUIRES_INSPECTION/);
    assert.equal(ws.ledger.report().attempts.at(-1)?.state,'failed');assert.equal(ws.ledger.report().calls.length,0);
  }finally{ws.close();}
});

test('a new case ordinal in no-scope mode remains charged to formal and preserves the first-call clock',async()=>{
  const ws=await workspace();try{
    const caseId=catalog.manifest.cases[0]!.id;await save(ws,caseId,previous,'needs-human-review',true);
    const before=ws.ledger.executionStatus()!,usage=ws.ledger.phaseUsage(),maximum=ws.ledger.budget.maximum,
      plan=await matrixContinuationPlan(catalog,ws,current,1,[],oldScope,noReuse),step=plan.steps[0]!;
    assert.equal(step.action,'execute');if(step.action!=='execute')throw new Error('Expected new ordinal');
    assert.equal(step.retry,true);assert.deepEqual(matrixContinuationSettings(),{scopeReuse:true,executionPhase:'formal'});
    assert.deepEqual(matrixContinuationSettings(noReuse),{scopeReuse:false,executionPhase:'formal'});
    const attemptId=ws.ledger.begin(step.item.id,{retry:step.retry}),now=Date.now()+20;ws.ledger.startExecution(plan.executionPhase,now);
    const reservation=ws.ledger.reserve(attemptId,'new-synthetic-formal',1,1,now+1);ws.ledger.settle(reservation,{inputTokens:1,outputTokens:1});ws.ledger.stopExecution(now+10);
    const after=ws.ledger.executionStatus()!;assert.equal(after.firstCallAt,before.firstCallAt);assert.equal(after.expiresAt,before.expiresAt);assert.equal(after.activeMs,before.activeMs+10);assert.equal(ws.ledger.budget.maximum,maximum);
    assert.ok(ws.ledger.phaseUsage().formal>usage.formal);assert.equal(ws.ledger.phaseUsage().retest,0);
    ws.ledger.finish(attemptId,{state:'blocked',code:'EVALUATION_FIXTURE_ONLY',programChecks:[],answerHash:null,artifacts:[]});assert.equal(ws.ledger.report().calls.length,0);
  }finally{ws.close();}
});

test('CLI accepts explicit no-scope mode but rejects duplicate or malformed arguments before dispatch',()=>{
  for(const args of [['1','--no-scope-reuse'],['--no-scope-reuse','9']]){
    const child=spawnSync(process.execPath,['scripts/continue-integrated-matrix.mjs',...args],{cwd:repository,encoding:'utf8',timeout:10000});assert.equal(child.status,1);assert.ok(child.stderr.includes('LIVE_CALLS_DISABLED_IN_TESTS'),child.stderr);
  }
  for(const args of [[],['--no-scope-reuse'],['1','2'],['0'],['10'],['1','--unknown'],['1','--no-scope-reuse','--no-scope-reuse']]){
    const child=spawnSync(process.execPath,['scripts/continue-integrated-matrix.mjs',...args],{cwd:repository,encoding:'utf8',timeout:10000});assert.equal(child.status,1);assert.ok(child.stderr.includes('EVALUATION_ARGUMENT_INVALID'),child.stderr);assert.ok(!child.stderr.includes('LIVE_CALLS_DISABLED_IN_TESTS'));
  }
});
