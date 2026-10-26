import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import type { LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm';
import { EvaluationCatalog } from '../../scripts/evaluation/catalog.ts';
import { EvaluationWorkspace } from '../../scripts/evaluation/workspace.ts';
import type { RuntimeIdentity } from '../../scripts/evaluation/identity.ts';
import { EvaluationScriptedAdapter,evaluationCall,evaluationText } from '../../scripts/evaluation/runtime.ts';
import { runContinuityReal } from '../../scripts/evaluation/real-continuity.ts';
if(!process.env.DAFEIYU_TEST_RUN||!tmpdir().startsWith(process.env.DAFEIYU_TEST_RUN))throw new Error('MANAGED_TEST_RUN_REQUIRED');
test('known unavailable history execution reports no effects, and an unwanted call still fails the original scorer',async()=>{const repository=resolve('.'),catalog=new EvaluationCatalog(repository),root=join(await mkdtemp(join(tmpdir(),'history-contract-')),'run'),identity:RuntimeIdentity={schemaVersion:1,node:process.version,sqlite:process.versions.sqlite??'unknown',platform:process.platform,arch:process.arch,scope:'real-evaluation-runtime-v1',files:[],workspaceLinks:[]},candidate={codeRevision:'a'.repeat(40),runtimeHash:'b'.repeat(64),protocolHash:'c'.repeat(64)},ws=await EvaluationWorkspace.createReal(repository,catalog,candidate.codeRevision,identity,root);let attempted=false;
  class Backend extends EvaluationScriptedAdapter{override async resolveModel(provider:string,id:string):Promise<LlmResolvedModelInfo>{return {provider,id,name:id,context:{contextWindow:1000000},defaultMaxTokens:16384,systemPromptUpdate:'in-history',toolUpdate:'addition-only',reasoning:{efforts:[{id:ReasoningEffortId('max'),name:'max'}],defaultEffort:ReasoningEffortId('max')}};}}
  const backend=new Backend(options=>{const message=options.messages.findLast(m=>m.role==='user'&&m.source?.kind==='dafeiyu-execution'),block=message?.content.find(b=>b.type==='text');let mode:string|undefined;if(block?.type==='text'){const body=z.object({providedData:z.object({content:z.object({mode:z.string()})}).optional()}).parse(JSON.parse(block.text));mode=body.providedData?.content.mode;}if(mode==='question'&&!attempted){attempted=true;return evaluationCall('history_remaining',{});}return evaluationText('虚构传输回答，不用于语义成绩。');});
  ws.ledger.startExecution('formal');try{const result=await runContinuityReal(catalog,catalog.case('H01-full-1'),ws,{repository,candidate,testBackend:backend});assert.equal(result.state,'failed');assert.equal(result.programChecks.find(c=>c.id==='no-operation-replay')?.passed,false);assert.equal(result.programChecks.find(c=>c.id==='all-real-dispatches-accounted')?.passed,true);const p=JSON.parse(await readFile(join(root,'cases',result.attemptId,'program.json'),'utf8')),operations=z.array(z.object({action:z.string(),outcome:z.string()})).parse(p.evidence['no-operation-replay'].after);const operation=operations.find(o=>o.action==='history_remaining');assert.ok(operation);assert.deepEqual(JSON.parse(operation.outcome),{status:'failed',effects:'none',completeness:'partial',data:null,sources:[],receipts:[],errorCode:'EVALUATION_REMAINING_NOT_DONE'});const tool=backend.requests.flatMap(r=>r.tools??[]).find(t=>t.name==='history_remaining');assert.ok(tool?.description.includes('不是查询'));assert.ok(backend.requests.flatMap(r=>r.tools??[]).find(t=>t.name==='history_unknown')?.description.includes('不是读取'));
  }finally{ws.ledger.stopExecution();ws.close();}
});
