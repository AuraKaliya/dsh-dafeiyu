import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import type { LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm';
import { EvaluationCatalog } from '../../scripts/evaluation/catalog.ts';
import { EvaluationWorkspace } from '../../scripts/evaluation/workspace.ts';
import type { RuntimeIdentity } from '../../scripts/evaluation/identity.ts';
import { runContinuityReal } from '../../scripts/evaluation/real-continuity.ts';
import { EvaluationScriptedAdapter,evaluationText } from '../../scripts/evaluation/runtime.ts';
if(!process.env.DAFEIYU_TEST_RUN||!tmpdir().startsWith(process.env.DAFEIYU_TEST_RUN))throw new Error('MANAGED_TEST_RUN_REQUIRED');

test('the real continuity driver stops after its first rejected summary instead of spending the remaining continuation rounds',async()=>{
  const repository=resolve('.'),catalog=new EvaluationCatalog(repository),identity:RuntimeIdentity={schemaVersion:1,node:process.version,sqlite:process.versions.sqlite??'unknown',platform:process.platform,arch:process.arch,scope:'real-evaluation-runtime-v1',files:[],workspaceLinks:[]},candidate={codeRevision:'a'.repeat(40),runtimeHash:'b'.repeat(64),protocolHash:'c'.repeat(64)},workspace=await EvaluationWorkspace.createReal(repository,catalog,candidate.codeRevision,identity,join(await mkdtemp(join(tmpdir(),'eval-summary-stop-')),'run'));
  class Backend extends EvaluationScriptedAdapter{override async resolveModel(provider:string,id:string):Promise<LlmResolvedModelInfo>{return {provider,id,name:id,context:{contextWindow:1000000},defaultMaxTokens:16384,systemPromptUpdate:'in-history',toolUpdate:'addition-only',reasoning:{efforts:[{id:ReasoningEffortId('max'),name:'max'}],defaultEffort:ReasoningEffortId('max')}};}}
  const backend=new Backend(request=>evaluationText(request.purpose==='compaction'?'{bad json':'收到当前的虚构记录。'));workspace.ledger.startExecution('formal');
  try{const result=await runContinuityReal(catalog,catalog.case('H06-compressed-1'),workspace,{repository,candidate,testBackend:backend});assert.equal(result.state,'failed');assert.equal(result.code,'EVALUATION_SUMMARY_REJECTED');assert.equal(backend.requests.filter(r=>r.purpose==='compaction').length,1);assert.ok(backend.requests.filter(r=>r.purpose!=='compaction'&&!String(r.sessionId).startsWith('dafeiyu-assessment-')).length<=catalog.history('H06').history.length+1);assert.equal(workspace.ledger.budget.unknown,0);}finally{workspace.ledger.stopExecution();workspace.close();}
});
