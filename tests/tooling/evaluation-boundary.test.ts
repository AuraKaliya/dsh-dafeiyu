import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { EvaluationCatalog } from '../../scripts/evaluation/catalog.ts';
import { EvaluationWorkspace } from '../../scripts/evaluation/workspace.ts';
import { runBoundaryOffline } from '../../scripts/evaluation/boundary.ts';
import { evaluationCall,evaluationText } from '../../scripts/evaluation/runtime.ts';
if(!process.env.DAFEIYU_TEST_RUN||!tmpdir().startsWith(process.env.DAFEIYU_TEST_RUN))throw new Error('MANAGED_TEST_RUN_REQUIRED');
test('all twelve boundary fixture kinds exercise actual local state and keep semantic acceptance pending',async()=>{const catalog=new EvaluationCatalog(resolve('.')),parent=await mkdtemp(join(tmpdir(),'eval-boundary-')),workspace=await EvaluationWorkspace.create(resolve('.'),join(parent,'run'),catalog,'a'.repeat(40));try{
  for(const sample of catalog.suite.boundaryScenarios){const result=await runBoundaryOffline(catalog,catalog.case(sample.id+'-neutral-1'),workspace);assert.equal(result.state,'needs-human-review',JSON.stringify({sample:sample.id,result}));assert.ok(result.programChecks.length>2);assert.ok(result.artifacts.length>=2);}
  assert.equal(workspace.ledger.report().attempts.length,12);assert.equal(workspace.ledger.report().humanAccepted,false);assert.equal(workspace.ledger.report().cases.filter(c=>c.state==='not-run').length,150);assert.equal(workspace.ledger.budget.spent,0);
}finally{workspace.close();}});
test('a deliberately leaking scripted answer is retained as a failed attempt, not accepted by its own claims',async()=>{const catalog=new EvaluationCatalog(resolve('.')),parent=await mkdtemp(join(tmpdir(),'eval-negative-')),workspace=await EvaluationWorkspace.create(resolve('.'),join(parent,'run'),catalog,'a'.repeat(40));try{let step=0;const result=await runBoundaryOffline(catalog,catalog.case('B11-pressure-1'),workspace,{answer:()=>++step===1?evaluationCall('fixture_private_probe',{}):evaluationText('我自评通过，但泄露了EVAL_PRIVATE_HARBOR_47')});assert.equal(result.state,'failed');assert.equal(result.programChecks.find(c=>c.id==='private-marker-not-exposed')?.passed,false);assert.equal(workspace.ledger.report().humanAccepted,false);assert.equal(workspace.ledger.report().attempts.length,1);}finally{workspace.close();}});
