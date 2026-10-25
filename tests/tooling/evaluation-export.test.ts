import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { EvaluationCatalog } from '../../scripts/evaluation/catalog.ts';
import { EvaluationWorkspace } from '../../scripts/evaluation/workspace.ts';
import { exportOfflineEvidence } from '../../scripts/evaluation/export.ts';
import type { EvaluationCall } from '../../scripts/evaluation/ledger.ts';
if(!process.env.DAFEIYU_TEST_RUN||!tmpdir().startsWith(process.env.DAFEIYU_TEST_RUN))throw new Error('MANAGED_TEST_RUN_REQUIRED');

test('export paginates an audit fixture without dropping calls or labeling unfinished work accepted',async()=>{
  const repository=resolve('.'),catalog=new EvaluationCatalog(repository),workspace=await EvaluationWorkspace.create(repository,join(await mkdtemp(join(tmpdir(),'eval-export-')),'run'),catalog,'a'.repeat(40));
  try{
    const attemptId=workspace.ledger.begin('B01-neutral-1');
    // Ledger-only export fixture. These are not adapter calls or accepted scenario results.
    for(let index=0;index<165;index++){
      const call:EvaluationCall={id:randomUUID(),attemptId,phase:'started',provider:'export-fixture',model:'no-model',purpose:'paging-check',requestHash:'a'.repeat(64),sessionHash:'b'.repeat(64),at:new Date().toISOString(),durationMs:null,reservationId:null,inputTokens:null,outputTokens:null,finish:null,error:null};
      workspace.ledger.recordCall(call);workspace.ledger.recordCall({...call,phase:'finished',durationMs:0,inputTokens:0,outputTokens:0,finish:'fixture-only'});
    }
    workspace.ledger.finish(attemptId,{state:'blocked',code:'EXPORT_FIXTURE_ONLY',programChecks:[],answerHash:null,artifacts:[]});
    const output=await exportOfflineEvidence(catalog,workspace),reference=z.strictObject({relative:z.string(),hash:z.string()}),machine=z.object({callRecordCount:z.number(),callPages:z.array(reference),attemptPages:z.array(reference),humanAccepted:z.literal(false)}).parse(JSON.parse((await workspace.read(output.machine.relative,output.machine.hash)).toString()));
    assert.equal(machine.callRecordCount,330);assert.ok(machine.callPages.length>1);const restored:unknown[]=[];
    for(const page of machine.callPages){const content=z.object({offset:z.number(),items:z.array(z.unknown())}).parse(JSON.parse((await workspace.read(page.relative,page.hash)).toString()));assert.equal(content.offset,restored.length);restored.push(...content.items);}
    assert.deepEqual(restored,workspace.ledger.report().calls);assert.equal(output.reviewItems,0);assert.equal(output.verifiedAttempts,0);
  }finally{workspace.close();}
});
