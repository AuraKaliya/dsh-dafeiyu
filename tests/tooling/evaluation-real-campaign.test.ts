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
import { EvaluationCatalog } from '../../scripts/evaluation/catalog.ts';
import { EvaluationWorkspace } from '../../scripts/evaluation/workspace.ts';
import { captureRuntimeIdentity } from '../../scripts/evaluation/identity.ts';
import type { RuntimeIdentity } from '../../scripts/evaluation/identity.ts';
import { freezeRealCandidate,requireRealCalibration } from '../../scripts/evaluation/real-candidate.ts';
import { selectedRealCases } from '../../scripts/evaluation/real-execution.ts';
import { exportRealEvidence } from '../../scripts/evaluation/real-export.ts';
import { runBoundaryReal } from '../../scripts/evaluation/real-boundary.ts';
import { EvaluationScriptedAdapter,evaluationText } from '../../scripts/evaluation/runtime.ts';
if(!process.env.DAFEIYU_TEST_RUN||!tmpdir().startsWith(process.env.DAFEIYU_TEST_RUN))throw new Error('MANAGED_TEST_RUN_REQUIRED');
const repository=resolve('.'),catalog=new EvaluationCatalog(repository),identity:RuntimeIdentity={schemaVersion:1,node:process.version,sqlite:process.versions.sqlite??'unknown',platform:process.platform,arch:process.arch,scope:'real-evaluation-runtime-v1',files:[],workspaceLinks:[]};
async function workspace(){const root=join(await mkdtemp(join(tmpdir(),'eval-campaign-')),'run');return EvaluationWorkspace.createReal(repository,catalog,'a'.repeat(40),identity,root);}

test('nine batch selections preserve the frozen order and live CLI refuses managed-test dispatch',()=>{assert.deepEqual(Array.from({length:9},(_,index)=>selectedRealCases(catalog,{batch:index+1})).flat().map(c=>c.id),catalog.manifest.cases.map(c=>c.id));assert.equal(selectedRealCases(catalog,{calibrate:true}).length,5);assert.throws(()=>selectedRealCases(catalog,{batch:10}),/SELECTION_INVALID/);assert.throws(()=>selectedRealCases(catalog,{calibrate:true,batch:1}),/SELECTION_INVALID/);const child=spawnSync(process.execPath,['scripts/run-integrated-real.mjs','--calibrate'],{cwd:repository,encoding:'utf8',timeout:10000});assert.equal(child.status,1);assert.ok(child.stderr.includes('LIVE_CALLS_DISABLED_IN_TESTS'));});

test('documentation-only revisions reuse a candidate; runtime changes create a new one without resetting budget',async()=>{const ws=await workspace();try{const first=await freezeRealCandidate(ws,'a'.repeat(40),identity),same=await freezeRealCandidate(ws,'b'.repeat(40),identity);assert.deepEqual(same,first);const changed=await freezeRealCandidate(ws,'b'.repeat(40),{...identity,node:'fixture-changed-node'});assert.notEqual(changed.artifact.relative,first.artifact.relative);assert.equal(ws.ledger.budget.maximum,60000000);assert.equal(ws.ledger.executionStatus()!.firstCallAt,null);await assert.rejects(requireRealCalibration(ws,first.candidate),/CALIBRATION_REQUIRED/);}finally{ws.close();}});

test('real evidence export keeps a transport fixture classified, verifies files, and never grants human acceptance',async()=>{const ws=await workspace();class Backend extends EvaluationScriptedAdapter{override async resolveModel(provider:string,id:string):Promise<LlmResolvedModelInfo>{return {provider,id,name:id,context:{contextWindow:1000000},defaultMaxTokens:16384,systemPromptUpdate:'in-history',toolUpdate:'addition-only',reasoning:{efforts:[{id:ReasoningEffortId('max'),name:'max'}],defaultEffort:ReasoningEffortId('max')}};}}
  try{const frozen=await freezeRealCandidate(ws,'a'.repeat(40),identity);ws.ledger.startExecution('formal');const result=await runBoundaryReal(catalog,catalog.case('B01-neutral-1'),ws,{repository,candidate:frozen.candidate,candidateArtifact:frozen.artifact,testBackend:new Backend(()=>evaluationText('虚构传输回答'))});assert.equal(result.state,'needs-human-review');ws.ledger.stopExecution();const output=await exportRealEvidence(catalog,ws),review=z.object({humanAccepted:z.literal(false),items:z.array(z.object({modelClass:z.literal('transport-test')}))}).parse(JSON.parse((await ws.read(output.review.relative,output.review.hash)).toString()));assert.equal(review.items.length,1);assert.equal(output.verifiedAttempts,1);await assert.rejects(requireRealCalibration(ws,frozen.candidate),/CALIBRATION_REQUIRED/);const answer=result.artifacts.find(a=>a.relative.endsWith('/answer.json'))!;await writeFile(join(ws.root,answer.relative),'{}');await assert.rejects(exportRealEvidence(catalog,ws),/ARTIFACT_CHANGED|EVIDENCE_CHANGED/);}finally{ws.close();}});

test('recovery accounts an abandoned executor interval and does not start the first-call window',async()=>{let ws=await workspace();const root=ws.root;ws.close();const module=pathToFileURL(resolve('scripts/evaluation/workspace.ts')).href,code=`import {EvaluationWorkspace} from ${JSON.stringify(module)};const w=await EvaluationWorkspace.open(process.argv[1],process.argv[2]);w.ledger.startExecution('calibration');w.ledger.begin('CAL-route');w.close();`,child=spawnSync(process.execPath,['--input-type=module','-e',code,repository,root],{encoding:'utf8',timeout:10000});assert.equal(child.status,0,child.stderr);ws=await EvaluationWorkspace.open(repository,root);try{assert.equal(ws.ledger.recover(),1);assert.equal(ws.ledger.executionStatus()!.running,false);assert.equal(ws.ledger.executionStatus()!.firstCallAt,null);assert.ok(ws.ledger.executionStatus()!.activeMs>=0);assert.equal(ws.ledger.report().calls.length,0);}finally{ws.close();}});

test('real runtime fingerprints cover source, built code, approved limits and the actual CLI',async()=>{const actual=await captureRuntimeIdentity(repository,{real:true});assert.equal(actual.scope,'real-evaluation-runtime-v1');for(const path of ['scripts/run-integrated-real.mjs','evaluation/phase7c/authorization.json','packages/core/src/index.ts','packages/core/lib/index.js'])assert.ok(actual.files.some(f=>f.path===path),path);});
