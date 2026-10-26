import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { EvaluationCatalog,sha256 } from '../../scripts/evaluation/catalog.ts';
import { EvaluationWorkspace } from '../../scripts/evaluation/workspace.ts';
import type { RuntimeIdentity } from '../../scripts/evaluation/identity.ts';
import type { RealCandidate } from '../../scripts/evaluation/real-support.ts';
import { CALIBRATION_CASES } from '../../scripts/evaluation/authorization.ts';
import { captureCaseEvidence } from '../../scripts/evaluation/evidence.ts';
import { requireRealCalibration } from '../../scripts/evaluation/real-candidate.ts';
import { eligibleCaseRetry,retryOneRealCase,caseRetrySettings,caseRetryPrerequisites } from '../../scripts/acceptance-retry.ts';
import { FailureTriageSchema } from '../../scripts/acceptance-triage.ts';
import { ScopeCertificateSchema } from '../../scripts/acceptance-scope.ts';
import type { ScopeCompatibility } from '../../scripts/acceptance-scope.ts';
if(!process.env.DAFEIYU_TEST_RUN||!tmpdir().startsWith(process.env.DAFEIYU_TEST_RUN))throw new Error('MANAGED_TEST_RUN_REQUIRED');
const repository=resolve('.'),catalog=new EvaluationCatalog(repository),hash='a'.repeat(64),
  old:RealCandidate={codeRevision:'a'.repeat(40),runtimeHash:'b'.repeat(64),protocolHash:'c'.repeat(64)},
  current:RealCandidate={codeRevision:'d'.repeat(40),runtimeHash:'e'.repeat(64),protocolHash:'f'.repeat(64)},
  identity:RuntimeIdentity={schemaVersion:1,node:process.version,sqlite:process.versions.sqlite??'unknown',platform:process.platform,arch:process.arch,scope:'real-evaluation-runtime-v1',files:[],workspaceLinks:[]},
  noReuse={scopeReuse:false};
async function workspace(){return EvaluationWorkspace.createReal(repository,catalog,old.codeRevision,identity,join(await mkdtemp(join(tmpdir(),'retry-no-scope-')),'run'));}
const oldScope:ScopeCompatibility={certificate:ScopeCertificateSchema.parse({schemaVersion:1,from:old,toRuntimeHash:current.runtimeHash,protocolHash:old.protocolHash,
  changedFile:{path:'scripts/evaluation/history-fixture.ts',beforeHash:'1'.repeat(64),afterHash:'2'.repeat(64)},affectedSamples:['H01','H05'],reviewer:'codex-under-user-delegated-autonomy',
  reviewedAt:new Date().toISOString(),rationale:'只用于离线单项恢复检查：旧候选范围证书不能用于新协议的单项恢复，也不能替代当前候选此前项目的通过、独立校准或明确失败记录；这些是纯测试状态。',
  checks:{relative:'docs/results/retry-fixture.json',hash}}),parentIdentity:identity,certificateHash:hash,checkReport:{fixtureOnly:true},calibrationBasis:'offline-fixture'};
type State='needs-human-review'|'failed'|'blocked'|'interrupted';
async function record(ws:EvaluationWorkspace,caseId:string,candidate:RealCandidate,state:State,charge=false){
  const attemptId=ws.ledger.begin(caseId,{retry:true}),declared=await ws.write('cases/'+attemptId+'/case.json',JSON.stringify({candidate,modelClass:'real',fixtureOnly:'offline-retry-gate'}));
  if(charge){const now=Date.now();ws.ledger.startExecution('formal',now);const reservation=ws.ledger.reserve(attemptId,'original-synthetic-charge',1,1,now+1);ws.ledger.settle(reservation,{inputTokens:1,outputTokens:1});ws.ledger.stopExecution(now+10);}
  ws.ledger.finish(attemptId,{state,code:state==='failed'?'EVALUATION_PROGRAM_CHECK_FAILED':null,programChecks:[{id:'fixture',passed:state==='needs-human-review',evidenceHash:hash}],answerHash:null,artifacts:[declared]});return {attemptId,declared};
}
async function calibration(ws:EvaluationWorkspace,candidate:RealCandidate){
  const attempts:string[]=[];for(const id of CALIBRATION_CASES){const attemptId=ws.ledger.begin(id,{retry:true});attempts.push(attemptId);
    const declared=await ws.write('cases/'+attemptId+'/case.json',JSON.stringify({candidate,modelClass:'real',fixtureOnly:'offline-calibration-gate'})),profile=await captureCaseEvidence(ws,attemptId,join(ws.root,'cases',attemptId));
    ws.ledger.finish(attemptId,{state:'needs-human-review',code:null,programChecks:[{id:'all-real-dispatches-accounted',passed:true,evidenceHash:hash}],answerHash:null,artifacts:[declared,profile]});
  }
  return ws.write('calibrated/'+sha256(JSON.stringify(candidate))+'/'+sha256(JSON.stringify(attempts))+'.json',JSON.stringify({candidate,attempts,fixtureOnly:true}));
}

test('no-scope retry requires the current closed failure and current predecessors even when old scope is supplied',async()=>{
  const ws=await workspace(),first=catalog.manifest.cases[0]!,second=catalog.manifest.cases[1]!;
  try{
    await assert.rejects(eligibleCaseRetry(catalog,ws,current,first.id,[],oldScope,noReuse),/FAILED_CASE_REQUIRED/);
    await record(ws,first.id,old,'needs-human-review');await record(ws,second.id,old,'failed');
    await assert.rejects(eligibleCaseRetry(catalog,ws,current,second.id,[],oldScope,noReuse),/FAILED_CASE_REQUIRED/);
    await record(ws,second.id,current,'failed');await assert.rejects(eligibleCaseRetry(catalog,ws,current,second.id,[],oldScope,noReuse),/PREVIOUS_CASE_INCOMPLETE/);
    await record(ws,first.id,current,'needs-human-review');
    for(const state of ['failed','blocked','interrupted'] as const){await record(ws,second.id,current,state);assert.equal((await eligibleCaseRetry(catalog,ws,current,second.id,[],oldScope,noReuse)).id,second.id);}
    assert.equal((await eligibleCaseRetry(catalog,ws,current,second.id)).id,second.id);
    await record(ws,second.id,current,'needs-human-review');await assert.rejects(eligibleCaseRetry(catalog,ws,current,second.id,[],oldScope,noReuse),/FAILED_CASE_REQUIRED/);
    const running=ws.ledger.begin(second.id,{retry:true}),declared=await ws.write('cases/'+running+'/case.json',JSON.stringify({candidate:current,modelClass:'real',fixtureOnly:true}));
    await assert.rejects(eligibleCaseRetry(catalog,ws,current,second.id,[],oldScope,noReuse),/FAILED_CASE_REQUIRED/);
    ws.ledger.finish(running,{state:'interrupted',code:null,programChecks:[],answerHash:null,artifacts:[declared]});
    await assert.rejects(retryOneRealCase(repository,catalog,ws,second.id,()=>{},noReuse),/LIVE_CALLS_DISABLED_IN_TESTS/);assert.equal(ws.ledger.report().calls.length,0);
  }finally{ws.close();}
});

test('no-scope retry cannot use a reviewed predecessor failure as completion',async()=>{
  const ws=await workspace(),required=['answer-run-0','task-goal-and-epoch-0','no-external-write-capability','private-marker-not-exposed','foundation-unchanged','all-real-dispatches-accounted'];
  try{
    for(const item of catalog.manifest.cases.slice(0,8))await record(ws,item.id,current,'needs-human-review');
    const missing=catalog.manifest.cases[8]!,target=catalog.manifest.cases[9]!,attemptId=ws.ledger.begin(missing.id),declared=await ws.write('cases/'+attemptId+'/case.json',JSON.stringify({candidate:current,modelClass:'real',fixtureOnly:true})),
      program=await ws.write('cases/'+attemptId+'/program.json',JSON.stringify({evidence:{'missing-total-blocked-specifically':{ops:[{action:'fixture_total',outcome:JSON.stringify({status:'failed',effects:'none',errorCode:'FIXTURE_MARCH_MISSING'})}]}}}));
    ws.ledger.finish(attemptId,{state:'failed',code:'EVALUATION_PROGRAM_CHECK_FAILED',programChecks:[...required.map(id=>({id,passed:true,evidenceHash:hash})),{id:'missing-total-blocked-specifically',passed:false,evidenceHash:hash}],answerHash:null,artifacts:[declared,program]});
    const triage=FailureTriageSchema.parse({caseId:missing.id,attemptId,candidate:current,reviewer:'codex-under-user-delegated-autonomy',reviewedAt:new Date().toISOString(),failedCheckIds:['missing-total-blocked-specifically'],
      continueIndependentCases:true,releaseBlocked:true,rationale:'离线对照有效旧审阅规则；默认可保留前项失败继续，但显式不复用的新候选单项恢复必须要求前项当前通过，不得以任何审阅替代完成证明。',program});
    await record(ws,target.id,current,'failed');assert.equal((await eligibleCaseRetry(catalog,ws,current,target.id,[triage])).id,target.id);
    await assert.rejects(eligibleCaseRetry(catalog,ws,current,target.id,[triage],oldScope,noReuse),/PREVIOUS_CASE_INCOMPLETE/);
    await assert.rejects(eligibleCaseRetry(catalog,ws,current,missing.id,[triage]),/RETAINED_FAILURE_REQUIRES_FIX/);
    await assert.rejects(eligibleCaseRetry(catalog,ws,current,missing.id,[triage],oldScope,noReuse),/RETAINED_FAILURE_REQUIRES_FIX/);
    assert.equal(ws.ledger.report().calls.length,0);
  }finally{ws.close();}
});

test('no-scope admission requires its own calibration and target triage but does not open a legacy scope certificate',async()=>{
  const ws=await workspace(),first=catalog.manifest.cases[0]!,absentRepository=join(ws.root,'no-legacy-scope');
  try{
    await mkdir(join(absentRepository,'evaluation/phase7c'),{recursive:true});await writeFile(join(absentRepository,'evaluation/phase7c/failure-triage.v1.json'),JSON.stringify({schemaVersion:1,entries:[]}));
    await record(ws,first.id,current,'failed');await assert.rejects(caseRetryPrerequisites(absentRepository,catalog,ws,current,identity,first.id,noReuse),/CALIBRATION_REQUIRED/);
    const oldMarker=await calibration(ws,old),oldBytes=await ws.read(oldMarker.relative,oldMarker.hash);assert.equal(await requireRealCalibration(ws,old),oldMarker.relative);
    await assert.rejects(caseRetryPrerequisites(absentRepository,catalog,ws,current,identity,first.id,noReuse),/CALIBRATION_REQUIRED/);
    await calibration(ws,current);const before=ws.ledger.report().attempts,admitted=await caseRetryPrerequisites(absentRepository,catalog,ws,current,identity,first.id,noReuse);
    assert.equal(admitted.scopeReuse,false);assert.equal(admitted.executionPhase,'retest');assert.equal(admitted.scope,null);assert.equal(admitted.item.id,first.id);
    assert.deepEqual(ws.ledger.report().attempts,before);assert.deepEqual(await ws.read(oldMarker.relative,oldMarker.hash),oldBytes);assert.equal(ws.ledger.report().calls.length,0);
  }finally{ws.close();}
});

test('only the selected retry gets a new ordinal and retest cost while original formal cost and clock remain',async()=>{
  const ws=await workspace(),first=catalog.manifest.cases[0]!,second=catalog.manifest.cases[1]!;
  try{
    const original=await record(ws,first.id,current,'failed',true);await record(ws,second.id,current,'needs-human-review');const originalBytes=await ws.read(original.declared.relative,original.declared.hash),
      before=ws.ledger.executionStatus()!,oldUsage=ws.ledger.phaseUsage(),oldAttempts=ws.ledger.report().attempts,item=await eligibleCaseRetry(catalog,ws,current,first.id,[],oldScope,noReuse),settings=caseRetrySettings(noReuse);
    assert.deepEqual(caseRetrySettings(),{scopeReuse:true,executionPhase:'retest'});assert.deepEqual(settings,{scopeReuse:false,executionPhase:'retest'});
    const attemptId=ws.ledger.begin(item.id,{retry:true}),profile=await ws.write('cases/'+attemptId+'/profile/fixture.json',JSON.stringify({fixtureOnly:true,candidate:current})),now=Date.now()+20;
    ws.ledger.startExecution(settings.executionPhase,now);const reservation=ws.ledger.reserve(attemptId,'single-synthetic-retest',1,1,now+1);ws.ledger.settle(reservation,{inputTokens:1,outputTokens:1});ws.ledger.stopExecution(now+10);
    ws.ledger.finish(attemptId,{state:'blocked',code:'EVALUATION_FIXTURE_ONLY',programChecks:[],answerHash:null,artifacts:[profile]});
    const after=ws.ledger.executionStatus()!,attempts=ws.ledger.report().attempts;
    assert.equal(attempts.length,oldAttempts.length+1);assert.deepEqual(attempts.slice(0,oldAttempts.length),oldAttempts);assert.equal(attempts.at(-1)?.caseId,first.id);assert.equal(attempts.at(-1)?.ordinal,2);
    assert.notEqual(attemptId,original.attemptId);assert.deepEqual(await ws.read(original.declared.relative,original.declared.hash),originalBytes);
    assert.equal(ws.ledger.phaseUsage().formal,oldUsage.formal);assert.ok(ws.ledger.phaseUsage().retest>oldUsage.retest);
    assert.equal(after.firstCallAt,before.firstCallAt);assert.equal(after.expiresAt,before.expiresAt);assert.equal(after.activeMs,before.activeMs+10);assert.equal(ws.ledger.budget.maximum,60000000);assert.equal(ws.ledger.report().calls.length,0);
  }finally{ws.close();}
});

test('single-retry CLI accepts the explicit flag once and still prevents dispatch in managed tests',()=>{
  for(const args of [['H03-compressed-2'],['H03-compressed-2','--no-scope-reuse'],['--no-scope-reuse','B01-neutral-1']]){
    const child=spawnSync(process.execPath,['scripts/retry-integrated-case.mjs',...args],{cwd:repository,encoding:'utf8',timeout:10000});assert.equal(child.status,1);assert.ok(child.stderr.includes('LIVE_CALLS_DISABLED_IN_TESTS'),child.stderr);
  }
  for(const args of [[],['--no-scope-reuse'],['1'],['CAL-route'],['B01-neutral-0'],['B01-neutral-1','B02-neutral-1'],['B01-neutral-1','--unknown'],['B01-neutral-1','--no-scope-reuse','--no-scope-reuse']]){
    const child=spawnSync(process.execPath,['scripts/retry-integrated-case.mjs',...args],{cwd:repository,encoding:'utf8',timeout:10000});assert.equal(child.status,1);assert.ok(child.stderr.includes('EVALUATION_ARGUMENT_INVALID'),child.stderr);
  }
});
