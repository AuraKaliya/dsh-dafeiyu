import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { ReasoningEffortId,LlmAdapter } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions,LlmResolvedModelInfo,StreamChunk } from '@deepseek-ai/dsh-llm';
import { EvaluationCatalog } from '../../scripts/evaluation/catalog.ts';
import { EvaluationWorkspace } from '../../scripts/evaluation/workspace.ts';
import type { RuntimeIdentity } from '../../scripts/evaluation/identity.ts';
import { openRealEvaluationRuntime,DeadlineAdapter } from '../../scripts/evaluation/real-runtime.ts';
import { EvaluationScriptedAdapter,evaluationText,PRIVATE_STREAM_SENTINEL } from '../../scripts/evaluation/runtime.ts';
import { nativeAnswer,sessionArchive } from '../../scripts/evaluation/boundary.ts';
if(!process.env.DAFEIYU_TEST_RUN||!tmpdir().startsWith(process.env.DAFEIYU_TEST_RUN))throw new Error('MANAGED_TEST_RUN_REQUIRED');
const identity:RuntimeIdentity={schemaVersion:1,node:process.version,sqlite:process.versions.sqlite??'unknown',platform:process.platform,arch:process.arch,scope:'real-evaluation-runtime-v1',files:[],workspaceLinks:[]};
class Backend extends EvaluationScriptedAdapter{override async resolveModel(provider:string,id:string):Promise<LlmResolvedModelInfo>{return {provider,id,name:id,context:{contextWindow:1000000},defaultMaxTokens:16384,systemPromptUpdate:'in-history',toolUpdate:'addition-only',reasoning:{efforts:[{id:ReasoningEffortId('max'),name:'max'}],defaultEffort:ReasoningEffortId('max')}};}}

test('real wiring uses actual DSH tasks with a local transport fixture and reopens one durable budget',async()=>{
  const repository=resolve('.'),root=join(await mkdtemp(join(tmpdir(),'eval-real-run-')),'run'),catalog=new EvaluationCatalog(repository);let workspace=await EvaluationWorkspace.createReal(repository,catalog,'a'.repeat(40),identity,root);workspace.ledger.startExecution('calibration');const attemptId=workspace.ledger.begin('CAL-route'),profile=join(root,'cases',attemptId,'profile'),backend=new Backend(()=>evaluationText('RUNTIME_READY'));
  try{const runtime=await openRealEvaluationRuntime({repository,campaignRoot:root,root:profile,foundationFile:join(root,'sources/persona.foundation.md'),ledger:workspace.ledger,attemptId,testBackend:backend});
    try{assert.equal(runtime.modelClass,'transport-test');const task=runtime.port.submitTask({requestId:'one',title:'虚构传输检查',goal:'只回答RUNTIME_READY。',policyId:'case'});await runtime.core.whenIdle();assert.equal(runtime.port.status(task.run).state,'completed');assert.equal(nativeAnswer(runtime,profile,task.run.id),'RUNTIME_READY');assert.equal(runtime.requests.length,1);assert.equal(runtime.requests[0]!.reasoningEffort,'max');assert.ok(runtime.core.capabilityManifest().actions.every(a=>a.effects!=='external-write'));}finally{await runtime.close();}
    assert.ok(!(await sessionArchive(join(profile,'sessions'))).includes(PRIVATE_STREAM_SENTINEL));const spent=workspace.ledger.budget.spent;assert.ok(spent>0);workspace.ledger.stopExecution();workspace.close();workspace=await EvaluationWorkspace.open(repository,root);assert.equal(workspace.ledger.budget.spent,spent);assert.notEqual(workspace.ledger.executionStatus()!.firstCallAt,null);await assert.rejects(EvaluationWorkspace.createReal(repository,catalog,'b'.repeat(40),identity,root),/WORKSPACE_EXISTS/);
  }finally{workspace.close();}
});

test('transport timeout cancels the delegate while leaving the frozen semantic request unchanged',async()=>{
  let calls=0;const options:GenerateOptions=Object.freeze({provider:'fixture',model:'fixture',messages:[],system:'fixed-system',maxTokens:100});const before=JSON.stringify(options);
  class Waiting extends LlmAdapter{override async *stream(input:GenerateOptions):AsyncIterable<StreamChunk>{calls++;assert.equal(input.system,'fixed-system');assert.equal(input.maxTokens,100);await new Promise<void>((done,reject)=>{const timer=setTimeout(done,100);input.signal!.addEventListener('abort',()=>{clearTimeout(timer);reject(new Error('MOCK_ABORT'));},{once:true});});yield {type:'finish',reason:{kind:'stop'}};}}
  const adapter=new DeadlineAdapter(new Waiting(),()=>1000,5,observed=>assert.equal(observed,options)),prepared=await adapter.prepareCall('fixture','fixture');await assert.rejects(async()=>{for await(const _ of prepared.stream(options)){};},/MOCK_ABORT/);assert.equal(calls,1);assert.equal(JSON.stringify(options),before);
  const blocked=new DeadlineAdapter(new Waiting(),()=>0,5,()=>{});await assert.rejects(async()=>{for await(const _ of blocked.stream(options)){};},/TIME_EXHAUSTED/);assert.equal(calls,1);
});
