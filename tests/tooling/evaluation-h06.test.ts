import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { EvaluationCatalog } from '../../scripts/evaluation/catalog.ts';
import { EvaluationWorkspace } from '../../scripts/evaluation/workspace.ts';
import { runContinuityOffline } from '../../scripts/evaluation/continuity.ts';
import { summarizeActualFixtureSources,HISTORY_BEGIN,HISTORY_END } from '../../scripts/evaluation/scripted-summary.ts';
import { createSystemMessage,createUserMessage } from '@deepseek-ai/dsh-llm';
if(!process.env.DAFEIYU_TEST_RUN||!tmpdir().startsWith(process.env.DAFEIYU_TEST_RUN))throw new Error('MANAGED_TEST_RUN_REQUIRED');
test('offline lineage adapter honors the current hard character and fragment budgets from the actual request',()=>{
  const fact='本组只说明一次有界观察，原文中的限制仍然有效。'.repeat(2);
  const output=summarizeActualFixtureSources({messages:[createSystemMessage('最多2片，全部text合计尽量控制在700字内；不可超过的硬上限为1400字。'),
    createUserMessage({source:{kind:'user'},content:[{type:'text',text:JSON.stringify({sources:[{seq:1,role:'assistant',text:HISTORY_BEGIN+'\n'+fact+'\n'+HISTORY_END}]})}]})]},true);
  const data=JSON.parse(output.flatMap(chunk=>chunk.type==='text-delta'?[chunk.text]:[]).join('')) as {fragments:{text:string}[]};
  assert.equal(data.fragments.length,2);const characters=data.fragments.reduce((sum,value)=>sum+Array.from(value.text).length,0);assert.ok(characters>400&&characters<=1400);assert.ok(data.fragments.every(value=>value.text.includes(fact)));
});
test('H06 preserves two real summary generations and exposes verified current views after actual restart',async t=>{const catalog=new EvaluationCatalog(resolve('.')),parent=await mkdtemp(join(tmpdir(),'eval-h06-')),workspace=await EvaluationWorkspace.create(resolve('.'),join(parent,'run'),catalog,'a'.repeat(40));try{const measurements:unknown[]=[];for(const condition of ['full','compressed','compressed-restarted']){const result=await runContinuityOffline(catalog,catalog.case('H06-'+condition+'-1'),workspace);assert.equal(result.state,'needs-human-review',JSON.stringify({condition,result}));const artifact=result.artifacts.find(a=>a.relative.endsWith('program.json'))!,program=JSON.parse((await workspace.read(artifact.relative,artifact.hash)).toString());measurements.push({condition,...program.evidence['actual-compaction-condition']});}t.diagnostic(JSON.stringify({sample:'H06',measurements}));assert.equal(workspace.ledger.report().humanAccepted,false);}finally{workspace.close();}});
