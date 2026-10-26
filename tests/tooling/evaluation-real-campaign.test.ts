import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import type { LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm';
import { EvaluationCatalog,sha256 } from '../../scripts/evaluation/catalog.ts';
import { EvaluationWorkspace } from '../../scripts/evaluation/workspace.ts';
import { captureRuntimeIdentity,runtimeIdentityHash } from '../../scripts/evaluation/identity.ts';
import type { RuntimeIdentity } from '../../scripts/evaluation/identity.ts';
import { freezeRealCandidate,requireRealCalibration,realProtocolDescriptor,realProtocolHash,latestCandidateAttempt } from '../../scripts/evaluation/real-candidate.ts';
import { REAL_COMPACTION,REAL_H06_COMPACTION,REAL_HISTORY_GOAL } from '../../scripts/evaluation/real-continuity.ts';
import { CALIBRATION_CASES } from '../../scripts/evaluation/authorization.ts';
import { captureCaseEvidence } from '../../scripts/evaluation/evidence.ts';
import { B05_PROTOCOL,B05_MATERIAL } from '../../scripts/evaluation/b05.ts';
import { PERSONA_ADOPTION_POLICY_VERSION } from '../../packages/memory/lib/persona-adoption-policy.js';
import { PERSONA_ADOPTION_POLICY } from '../../packages/memory/lib/persona-evidence.js';
import { selectedRealCases } from '../../scripts/evaluation/real-execution.ts';
import { exportRealEvidence } from '../../scripts/evaluation/real-export.ts';
import { runBoundaryReal } from '../../scripts/evaluation/real-boundary.ts';
import { EvaluationScriptedAdapter,evaluationText } from '../../scripts/evaluation/runtime.ts';
if(!process.env.DAFEIYU_TEST_RUN||!tmpdir().startsWith(process.env.DAFEIYU_TEST_RUN))throw new Error('MANAGED_TEST_RUN_REQUIRED');
const repository=resolve('.'),catalog=new EvaluationCatalog(repository),identity:RuntimeIdentity={schemaVersion:1,node:process.version,sqlite:process.versions.sqlite??'unknown',platform:process.platform,arch:process.arch,scope:'real-evaluation-runtime-v1',files:[],workspaceLinks:[]};
async function workspace(){const root=join(await mkdtemp(join(tmpdir(),'eval-campaign-')),'run');return EvaluationWorkspace.createReal(repository,catalog,'a'.repeat(40),identity,root);}
function legacyProtocol(ws:EvaluationWorkspace){return {version:'7c-real-1',suite:ws.config.suiteHash,manifest:ws.config.manifestHash,foundation:ws.config.foundationHash,authorization:ws.config.executionBounds?.authorizationHash,
  compaction:REAL_COMPACTION,h06:REAL_H06_COMPACTION,historyGoal:REAL_HISTORY_GOAL,continuations:8,restartAfter:4,scriptedDuplicates:false,preparation:'separate-epoch-fixture-ledger'};}

test('real protocol v2 explicitly binds persona qualification, legacy fixtures and B05 material without changing frozen matrix inputs',async()=>{const ws=await workspace();try{
  const expected={...legacyProtocol(ws),version:'7c-real-2',adoptionPolicy:PERSONA_ADOPTION_POLICY_VERSION,trialProtocol:PERSONA_ADOPTION_POLICY,
    personaProof:'closed-native-chain-v1',legacyFixture:'closed-profile-synthetic-legacy-v1',b07:'current-task-epoch-unresolved-target-v1',b05:{protocol:B05_PROTOCOL,materialHash:sha256(B05_MATERIAL)}};
  assert.deepEqual(realProtocolDescriptor(ws),expected);assert.equal(realProtocolDescriptor(ws).b05.protocol,'b05-message-v2');
  assert.equal(realProtocolHash(ws),sha256(JSON.stringify(expected)));assert.notEqual(realProtocolHash(ws),sha256(JSON.stringify(legacyProtocol(ws))));
  assert.equal(catalog.manifest.cases.length,162);assert.equal(ws.config.budget.maximumMicroCny,60000000);
  assert.equal(ws.config.executionBounds?.maximumActiveMs,21600000);assert.equal(ws.config.executionBounds?.validForMsAfterFirstCall,172800000);
}finally{ws.close();}});

test('same runtime bytes cannot reuse old-protocol candidates or calibration and cannot reset retained charges or clocks',async()=>{const ws=await workspace();try{
  const oldCandidate={codeRevision:'a'.repeat(40),runtimeHash:runtimeIdentityHash(identity),protocolHash:sha256(JSON.stringify(legacyProtocol(ws)))},oldBytes=JSON.stringify({schemaVersion:1,candidate:oldCandidate,identity,createdAt:new Date().toISOString()},null,2)+'\n',
    oldArtifact=await ws.write('candidates/'+sha256(JSON.stringify(oldCandidate))+'.json',oldBytes),attempts:string[]=[];
  // These ledger/profile rows are an offline protocol-gate fixture, not real model evidence.
  for(const id of CALIBRATION_CASES){const attempt=ws.ledger.begin(id);attempts.push(attempt);
    const declared=await ws.write('cases/'+attempt+'/case.json',JSON.stringify({candidate:oldCandidate,modelClass:'real',fixtureOnly:'offline-protocol-gate'}));
    if(id==='CAL-route'){const now=Date.now();ws.ledger.startExecution('calibration',now);const reserved=ws.ledger.reserve(attempt,'synthetic-old-charge',1,1,now+1);ws.ledger.settle(reserved,{inputTokens:1,outputTokens:1});ws.ledger.stopExecution(now+10);}
    const profile=await captureCaseEvidence(ws,attempt,join(ws.root,'cases',attempt));ws.ledger.finish(attempt,{state:'needs-human-review',code:null,programChecks:[{id:'all-real-dispatches-accounted',passed:true,evidenceHash:'a'.repeat(64)}],answerHash:null,artifacts:[declared,profile]});
  }
  const marker='calibrated/'+sha256(JSON.stringify(oldCandidate))+'/'+sha256(JSON.stringify(attempts))+'.json',markerBytes=JSON.stringify({candidate:oldCandidate,attempts,fixtureOnly:true}),oldMarker=await ws.write(marker,markerBytes);
  assert.equal(await requireRealCalibration(ws,oldCandidate),marker);
  const failure=ws.ledger.begin('B02-paraphrase-2'),failedCase=await ws.write('cases/'+failure+'/case.json',JSON.stringify({candidate:oldCandidate,modelClass:'real',fixtureOnly:'retained-old-failure'}));
  ws.ledger.finish(failure,{state:'failed',code:'EVALUATION_PROGRAM_CHECK_FAILED',programChecks:[{id:'no-unfounded-adopted-persona-change',passed:false,evidenceHash:'b'.repeat(64)}],answerHash:null,artifacts:[failedCase]});
  const before={budget:ws.ledger.budget,clock:ws.ledger.executionStatus()!,attempts:ws.ledger.report().attempts};assert.ok(before.budget.spent>0);assert.notEqual(before.clock.firstCallAt,null);
  const frozen=await freezeRealCandidate(ws,'b'.repeat(40),identity);assert.equal(frozen.candidate.runtimeHash,oldCandidate.runtimeHash);assert.notEqual(frozen.candidate.protocolHash,oldCandidate.protocolHash);assert.notEqual(frozen.artifact.relative,oldArtifact.relative);
  assert.equal((await ws.read(oldArtifact.relative,oldArtifact.hash)).toString(),oldBytes);assert.equal((await ws.read(oldMarker.relative,oldMarker.hash)).toString(),markerBytes);
  assert.equal(z.object({schemaVersion:z.literal(1)}).parse(JSON.parse((await ws.read(frozen.artifact.relative,frozen.artifact.hash)).toString())).schemaVersion,1);
  assert.deepEqual(await freezeRealCandidate(ws,'c'.repeat(40),identity),frozen);await assert.rejects(requireRealCalibration(ws,frozen.candidate),/CALIBRATION_REQUIRED/);
  assert.equal((await latestCandidateAttempt(ws,'B02-paraphrase-2',frozen.candidate))?.matches,false);assert.deepEqual(ws.ledger.report().attempts,before.attempts);assert.deepEqual(ws.ledger.budget,before.budget);
  const clock=ws.ledger.executionStatus()!;assert.equal(clock.firstCallAt,before.clock.firstCallAt);assert.equal(clock.expiresAt,before.clock.expiresAt);assert.equal(clock.activeMs,before.clock.activeMs);assert.equal(clock.calibrationMs,before.clock.calibrationMs);
  assert.equal(ws.ledger.report().calls.length,0);
}finally{ws.close();}});

test('nine batch selections preserve the frozen order and live CLI refuses managed-test dispatch',()=>{assert.deepEqual(Array.from({length:9},(_,index)=>selectedRealCases(catalog,{batch:index+1})).flat().map(c=>c.id),catalog.manifest.cases.map(c=>c.id));assert.equal(selectedRealCases(catalog,{calibrate:true}).length,5);assert.deepEqual(selectedRealCases(catalog,{calibrationCase:'CAL-history-compressed'}).map(c=>c.id),['CAL-history-compressed']);assert.throws(()=>selectedRealCases(catalog,{calibrationCase:'CAL-missing'}),/SELECTION_INVALID/);assert.throws(()=>selectedRealCases(catalog,{batch:10}),/SELECTION_INVALID/);assert.throws(()=>selectedRealCases(catalog,{calibrate:true,batch:1}),/SELECTION_INVALID/);const child=spawnSync(process.execPath,['scripts/run-integrated-real.mjs','--calibrate'],{cwd:repository,encoding:'utf8',timeout:10000});assert.equal(child.status,1);assert.ok(child.stderr.includes('LIVE_CALLS_DISABLED_IN_TESTS'));});

test('documentation-only revisions reuse a candidate; runtime changes create a new one without resetting budget',async()=>{const ws=await workspace();try{const first=await freezeRealCandidate(ws,'a'.repeat(40),identity),same=await freezeRealCandidate(ws,'b'.repeat(40),identity);assert.deepEqual(same,first);const changed=await freezeRealCandidate(ws,'b'.repeat(40),{...identity,node:'fixture-changed-node'});assert.notEqual(changed.artifact.relative,first.artifact.relative);assert.equal(ws.ledger.budget.maximum,60000000);assert.equal(ws.ledger.executionStatus()!.firstCallAt,null);await assert.rejects(requireRealCalibration(ws,first.candidate),/CALIBRATION_REQUIRED/);}finally{ws.close();}});

test('real evidence export keeps a transport fixture classified, verifies files, and never grants human acceptance',async()=>{const ws=await workspace();class Backend extends EvaluationScriptedAdapter{override async resolveModel(provider:string,id:string):Promise<LlmResolvedModelInfo>{return {provider,id,name:id,context:{contextWindow:1000000},defaultMaxTokens:16384,systemPromptUpdate:'in-history',toolUpdate:'addition-only',reasoning:{efforts:[{id:ReasoningEffortId('max'),name:'max'}],defaultEffort:ReasoningEffortId('max')}};}}
  try{const frozen=await freezeRealCandidate(ws,'a'.repeat(40),identity);ws.ledger.startExecution('formal');const result=await runBoundaryReal(catalog,catalog.case('B01-neutral-1'),ws,{repository,candidate:frozen.candidate,candidateArtifact:frozen.artifact,testBackend:new Backend(()=>evaluationText('虚构传输回答'))});assert.equal(result.state,'needs-human-review');ws.ledger.stopExecution();const output=await exportRealEvidence(catalog,ws),review=z.object({humanAccepted:z.literal(false),items:z.array(z.object({modelClass:z.literal('transport-test')}))}).parse(JSON.parse((await ws.read(output.review.relative,output.review.hash)).toString()));assert.equal(review.items.length,1);assert.equal(output.verifiedAttempts,1);await assert.rejects(requireRealCalibration(ws,frozen.candidate),/CALIBRATION_REQUIRED/);const answer=result.artifacts.find(a=>a.relative.endsWith('/answer.json'))!;await writeFile(join(ws.root,answer.relative),'{}');await assert.rejects(exportRealEvidence(catalog,ws),/ARTIFACT_CHANGED|EVIDENCE_CHANGED/);}finally{ws.close();}});

test('recovery accounts an abandoned executor interval and does not start the first-call window',async()=>{let ws=await workspace();const root=ws.root;ws.close();const module=pathToFileURL(resolve('scripts/evaluation/workspace.ts')).href,code=`import {EvaluationWorkspace} from ${JSON.stringify(module)};const w=await EvaluationWorkspace.open(process.argv[1],process.argv[2]);w.ledger.startExecution('calibration');w.ledger.begin('CAL-route');w.close();`,child=spawnSync(process.execPath,['--input-type=module','-e',code,repository,root],{encoding:'utf8',timeout:10000});assert.equal(child.status,0,child.stderr);ws=await EvaluationWorkspace.open(repository,root);try{assert.equal(ws.ledger.recover(),1);assert.equal(ws.ledger.executionStatus()!.running,false);assert.equal(ws.ledger.executionStatus()!.firstCallAt,null);assert.ok(ws.ledger.executionStatus()!.activeMs>=0);assert.equal(ws.ledger.report().calls.length,0);}finally{ws.close();}});

test('real runtime fingerprints cover source, built code, approved limits and the actual CLI',async()=>{const actual=await captureRuntimeIdentity(repository,{real:true});assert.equal(actual.scope,'real-evaluation-runtime-v1');for(const path of ['scripts/run-integrated-real.mjs','evaluation/phase7c/authorization.json','packages/core/src/index.ts','packages/core/lib/index.js'])assert.ok(actual.files.some(f=>f.path===path),path);});
