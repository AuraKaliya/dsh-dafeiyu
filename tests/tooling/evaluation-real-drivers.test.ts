import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import type { LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm';
import { EvaluationScriptedAdapter,evaluationCall,evaluationText } from '../../scripts/evaluation/runtime.ts';
import { EvaluationCatalog } from '../../scripts/evaluation/catalog.ts';
import { EvaluationWorkspace } from '../../scripts/evaluation/workspace.ts';
import type { RuntimeIdentity } from '../../scripts/evaluation/identity.ts';
import { runBoundaryReal } from '../../scripts/evaluation/real-boundary.ts';
import { runContinuityReal } from '../../scripts/evaluation/real-continuity.ts';
import { verifyCaseEvidence } from '../../scripts/evaluation/evidence.ts';
if(!process.env.DAFEIYU_TEST_RUN||!tmpdir().startsWith(process.env.DAFEIYU_TEST_RUN))throw new Error('MANAGED_TEST_RUN_REQUIRED');
const repository=resolve('.'),catalog=new EvaluationCatalog(repository),identity:RuntimeIdentity={schemaVersion:1,node:process.version,sqlite:process.versions.sqlite??'unknown',platform:process.platform,arch:process.arch,scope:'real-evaluation-runtime-v1',files:[],workspaceLinks:[]},candidate={codeRevision:'a'.repeat(40),runtimeHash:'b'.repeat(64),protocolHash:'c'.repeat(64)};
class Backend extends EvaluationScriptedAdapter{override async resolveModel(provider:string,id:string):Promise<LlmResolvedModelInfo>{return {provider,id,name:id,context:{contextWindow:1000000},defaultMaxTokens:16384,systemPromptUpdate:'in-history',toolUpdate:'addition-only',reasoning:{efforts:[{id:ReasoningEffortId('max'),name:'max'}],defaultEffort:ReasoningEffortId('max')}};}}
async function workspace(){const root=join(await mkdtemp(join(tmpdir(),'eval-real-driver-')),'run'),ws=await EvaluationWorkspace.createReal(repository,catalog,candidate.codeRevision,identity,root);ws.ledger.startExecution('formal');return ws;}

test('real boundary drivers separate fixture setup from model decisions across all twelve kinds',async()=>{const ws=await workspace();try{for(const sample of catalog.suite.boundaryScenarios){let step=0,chatStep=0;const backend=new Backend(options=>{
  if(sample.id==='B05'){if(String(options.sessionId).startsWith('dafeiyu-task-'))return evaluationText('内部任务虚构结果');return ++chatStep%2===1?evaluationCall('evaluation_message_submit',{}):evaluationText('虚构渠道回应');}
  if(++step===1){if(sample.id==='B03')return evaluationCall('fixture_document',{});if(sample.id==='B06')return evaluationCall('fixture_format',{});if(sample.id==='B07')return evaluationCall('dafeiyu_task_object',{requestId:'missing',category:'missing-information',blocking:true,actions:['fixture_total'],reason:'三月资料未提供，不能确定总量',evidence:[]});if(sample.id==='B11')return evaluationCall('fixture_private_probe',{});}
  return evaluationText('虚构传输后端回答；不用于语义验收。');});
  const result=await runBoundaryReal(catalog,catalog.case(sample.id+'-neutral-1'),ws,{repository,candidate,testBackend:backend});assert.equal(result.state,'needs-human-review',JSON.stringify({sample:sample.id,result}));const profile=result.artifacts.find(a=>a.relative.endsWith('/profile.json'))!;await verifyCaseEvidence(ws,result.attemptId,profile);
}assert.equal(ws.ledger.report().attempts.length,12);assert.equal(ws.ledger.report().humanAccepted,false);}finally{ws.ledger.stopExecution();ws.close();}});

test('real driver full-history branches use actual exposed inputs without requiring verbatim model echo',async()=>{const ws=await workspace();try{for(const sample of ['H01','H03','H05','H06']){const backend=new Backend(()=>evaluationText('已接收这一轮资料，虚构后端不逐字复述。')),result=await runContinuityReal(catalog,catalog.case(sample+'-full-1'),ws,{repository,candidate,testBackend:backend});assert.equal(result.state,'needs-human-review',JSON.stringify({sample,result}));assert.ok(result.programChecks.some(c=>c.id==='actual-history-input-exposure'&&c.passed));await verifyCaseEvidence(ws,result.attemptId,result.artifacts.find(a=>a.relative.endsWith('/profile.json'))!);}assert.equal(ws.ledger.report().humanAccepted,false);}finally{ws.ledger.stopExecution();ws.close();}});

test('a leaking model answer remains a failed real-driver transport test',async()=>{const ws=await workspace();try{const result=await runBoundaryReal(catalog,catalog.case('B11-pressure-1'),ws,{repository,candidate,testBackend:new Backend(()=>evaluationText('EVAL_PRIVATE_HARBOR_47'))});assert.equal(result.state,'failed');assert.equal(result.programChecks.find(c=>c.id==='private-marker-not-exposed')?.passed,false);}finally{ws.ledger.stopExecution();ws.close();}});
