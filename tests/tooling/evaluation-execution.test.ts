import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,writeFile,mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { EvaluationCatalog } from '../../scripts/evaluation/catalog.ts';
import { EvaluationWorkspace } from '../../scripts/evaluation/workspace.ts';
import { runOfflineBatch,selectEvaluationCases,recoverOfflineWorkspace } from '../../scripts/evaluation/execution.ts';
import { exportOfflineEvidence } from '../../scripts/evaluation/export.ts';
import { acquireEvaluationLease } from '../../scripts/evaluation/lease.ts';
import { parseOfflineArguments } from '../../scripts/evaluation/arguments.ts';

if(!process.env.DAFEIYU_TEST_RUN||!tmpdir().startsWith(process.env.DAFEIYU_TEST_RUN))throw new Error('MANAGED_TEST_RUN_REQUIRED');
const repository=resolve('.'),catalog=new EvaluationCatalog(repository);
async function workspace(){return EvaluationWorkspace.create(repository,join(await mkdtemp(join(tmpdir(),'eval-batch-')),'run'),catalog,'a'.repeat(40));}
const reviewSchema=z.strictObject({schemaVersion:z.literal(1),mode:z.literal('offline'),humanAccepted:z.literal(false),semanticAssessment:z.literal('not-performed'),items:z.array(z.strictObject({reviewId:z.string(),answer:z.string(),turns:z.array(z.strictObject({prompt:z.string(),answer:z.string()})),criteria:z.strictObject({semantic:z.array(z.string()),blockers:z.array(z.string())}),assessment:z.literal('not-performed'),modelClass:z.literal('scripted')}))});

test('selection follows the frozen order and the CLI cannot enable real mode or an implicit run',()=>{
  const ids=['B03-pressure-1','B01-neutral-1'];assert.deepEqual(selectEvaluationCases(catalog,{cases:ids}).map(c=>c.id),catalog.manifest.cases.filter(c=>ids.includes(c.id)).map(c=>c.id));
  assert.equal(selectEvaluationCases(catalog,{all:true}).length,162);
  assert.throws(()=>selectEvaluationCases(catalog,{cases:[ids[0]!,ids[0]!]}),/DUPLICATE/);
  assert.throws(()=>selectEvaluationCases(catalog,{cases:['missing']}),/CASE_UNKNOWN/);
  assert.throws(()=>parseOfflineArguments(['--workspace','fixture','--real']),/ARGUMENT_INVALID/);
  assert.throws(()=>parseOfflineArguments(['--workspace','fixture']),/ARGUMENT_INVALID/);
  assert.throws(()=>parseOfflineArguments(['--workspace','fixture','--all','--case',ids[0]!]),/ARGUMENT_INVALID/);
  assert.equal(parseOfflineArguments(['--workspace','fixture','--report']).report,true);
});

test('actual boundary batches retain all turns, skip without replay, and export verifiable review packets',async()=>{
  const ws=await workspace();try{
    const ids=['B03-pressure-1','B01-neutral-1'],batch=await runOfflineBatch(catalog,ws,{cases:ids});
    assert.deepEqual(batch.dispositions.map(d=>d.caseId),selectEvaluationCases(catalog,{cases:ids}).map(c=>c.id));
    assert.ok(batch.dispositions.every(d=>d.state==='needs-human-review'));
    const calls=ws.ledger.report().calls.length,again=await runOfflineBatch(catalog,ws,{cases:ids});
    assert.ok(again.dispositions.every(d=>d.action==='skipped'));assert.equal(ws.ledger.report().calls.length,calls);
    const exported=await exportOfflineEvidence(catalog,ws),review=reviewSchema.parse(JSON.parse((await ws.read(exported.review.relative,exported.review.hash)).toString()));
    assert.equal(exported.verifiedAttempts,2);assert.equal(review.items.length,2);
    const item=review.items.find(i=>i.reviewId===catalog.case(ids[0]!).reviewId)!;
    assert.deepEqual(item.turns.map(t=>t.prompt),catalog.boundary('B03').prompts.pressure);
    assert.ok(ws.ledger.report().attempts.every(a=>!!a.startedAt&&!!a.finishedAt));
    assert.equal(ws.ledger.report().batches.length,2);assert.equal(ws.ledger.report().budget.spent,0);
    const attempt=ws.ledger.report().attempts[0]!,index=attempt.result!.artifacts.find(a=>a.relative.endsWith('/profile.json'))!;
    const profile=z.object({root:z.string(),files:z.array(z.object({relative:z.string()}))}).parse(JSON.parse((await ws.read(index.relative,index.hash)).toString()));
    const journal=profile.files.find(f=>f.relative.endsWith('.jsonl'))!;assert.ok(journal);
    await writeFile(join(ws.root,profile.root,journal.relative),'changed session evidence');
    await assert.rejects(exportOfflineEvidence(catalog,ws),/EVIDENCE_CHANGED/);
  }finally{ws.close();}
});

test('an active lease blocks recovery; explicit recovery never replays and explicit retry appends',async()=>{
  const ws=await workspace();try{
    const id='B02-neutral-1',original=ws.ledger.begin(id),lease=acquireEvaluationLease(ws);
    assert.throws(()=>recoverOfflineWorkspace(ws),/WORKSPACE_BUSY/);lease.release();
    await assert.rejects(runOfflineBatch(catalog,ws,{cases:[id]}),/EXPLICIT_RECOVERY_REQUIRED/);
    assert.equal(recoverOfflineWorkspace(ws),1);assert.equal(ws.ledger.report().calls.length,0);
    const skipped=await runOfflineBatch(catalog,ws,{cases:[id]});assert.equal(skipped.dispositions[0]!.state,'interrupted');assert.equal(skipped.dispositions[0]!.action,'skipped');
    const retry=await runOfflineBatch(catalog,ws,{cases:[id],retry:true});assert.equal(retry.dispositions[0]!.state,'needs-human-review');
    const attempts=ws.ledger.report().attempts;assert.equal(attempts.length,2);assert.equal(attempts[0]!.attemptId,original);assert.equal(attempts[0]!.state,'interrupted');assert.equal(attempts[1]!.ordinal,2);
    await exportOfflineEvidence(catalog,ws);
    const recorded=ws.ledger.report().batches[0]!;await writeFile(join(ws.root,recorded.relative),'{}');
    await assert.rejects(exportOfflineEvidence(catalog,ws),/ARTIFACT_CHANGED/);
  }finally{ws.close();}
});

test('a terminated local executor leaves a recoverable lease without process killing or silent replay',async()=>{
  const ws=await workspace(),root=ws.root;ws.close();
  const modules={workspace:pathToFileURL(resolve('scripts/evaluation/workspace.ts')).href,lease:pathToFileURL(resolve('scripts/evaluation/lease.ts')).href};
  const code=`import { EvaluationWorkspace } from ${JSON.stringify(modules.workspace)};import { acquireEvaluationLease } from ${JSON.stringify(modules.lease)};const w=await EvaluationWorkspace.open(process.argv[1],process.argv[2]);acquireEvaluationLease(w);w.ledger.begin('B01-neutral-1');w.close();`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',code,repository,root],{encoding:'utf8',timeout:20000});assert.equal(child.status,0,child.stderr);
  const reopened=await EvaluationWorkspace.open(repository,root);try{assert.equal(recoverOfflineWorkspace(reopened),1);assert.equal(reopened.ledger.report().calls.length,0);}finally{reopened.close();}
});

test('incomplete preparation is preserved while a fresh history attempt produces a verified closed profile',async()=>{
  const ws=await workspace();try{
    const old=join(ws.root,'p/abandoned');await mkdir(old,{recursive:true});await writeFile(join(old,'source.json'),'incomplete fixture');
    const batch=await runOfflineBatch(catalog,ws,{cases:['H01-full-1']});assert.equal(batch.dispositions[0]!.state,'needs-human-review',JSON.stringify(batch));
    assert.equal(await readFile(join(old,'source.json'),'utf8'),'incomplete fixture');
    const exported=await exportOfflineEvidence(catalog,ws);assert.equal(exported.verifiedAttempts,1);
    const attempt=batch.dispositions[0]!.attemptId!;
    await writeFile(join(ws.root,'cases',attempt,'profile','program.json'),'unexpected nested output');
    await assert.rejects(exportOfflineEvidence(catalog,ws),/EVIDENCE_FILES_CHANGED/);
  }finally{ws.close();}
});
