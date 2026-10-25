import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { EvaluationCatalog } from '../../scripts/evaluation/catalog.ts';
import { EvaluationWorkspace } from '../../scripts/evaluation/workspace.ts';
import { captureRuntimeIdentity,cleanEvaluationRevision } from '../../scripts/evaluation/identity.ts';
import { z } from 'zod';
if(!process.env.DAFEIYU_TEST_RUN||!tmpdir().startsWith(process.env.DAFEIYU_TEST_RUN))throw new Error('MANAGED_TEST_RUN_REQUIRED');
const repository=resolve('.'),catalog=new EvaluationCatalog(repository);
function cli(root:string,args:string[]){return spawnSync(process.execPath,['scripts/run-integrated-offline.mjs','--workspace',root,...args],{cwd:repository,encoding:'utf8',timeout:90000,maxBuffer:1024**2});}

test('committed offline CLI runs one actual fixture, exports evidence, and skips it on the next invocation',async t=>{
  const revision=cleanEvaluationRevision(repository),identity=await captureRuntimeIdentity(repository),root=join(await mkdtemp(join(tmpdir(),'eval-cli-')),'run');
  const prepared=await EvaluationWorkspace.create(repository,root,catalog,revision,identity);prepared.close();
  const first=cli(root,['--case','B01-neutral-1']);assert.equal(first.status,0,first.stderr+'\n'+first.stdout);assert.ok(first.stdout.includes('"verifiedAttempts":1'));
  let opened=await EvaluationWorkspace.open(repository,root),calls:number;try{const report=opened.ledger.report();assert.equal(report.attempts.length,1);assert.equal(report.cases.filter(c=>c.state==='not-run').length,161);assert.equal(report.humanAccepted,false);calls=report.calls.length;assert.ok(calls>0);}finally{opened.close();}
  const second=cli(root,['--case','B01-neutral-1','--report']);assert.equal(second.status,0,second.stderr+'\n'+second.stdout);assert.ok(second.stdout.includes('"action":"skipped"'));
  const refused=cli(root,['--case','B01-neutral-1','--real']);assert.equal(refused.status,1);assert.ok(refused.stderr.includes('EVALUATION_ARGUMENT_INVALID'));
  opened=await EvaluationWorkspace.open(repository,root);try{assert.equal(opened.ledger.report().attempts.length,1);assert.equal(opened.ledger.report().calls.length,calls);assert.equal(opened.ledger.report().budget.spent,0);
    const outputs=second.stdout.trim().split('\n').map(line=>z.object({kind:z.string()}).passthrough().parse(JSON.parse(line))),evidence=z.object({index:z.object({relative:z.string(),hash:z.string()}),verifiedAttempts:z.literal(1),humanAccepted:z.literal(false)}).parse(outputs.find(value=>value.kind==='offline-evidence'));
    await opened.read(evidence.index.relative,evidence.index.hash);
    t.diagnostic(JSON.stringify({revision,offlineCases:1,attempts:1,syntheticCallAuditRecords:calls,secondInvocation:'skipped',realModel:false,realPlatform:false,serverAccess:false}));
  }finally{opened.close();}
});

test('CLI refuses to execute an older workspace without a frozen runtime identity',async()=>{
  const root=join(await mkdtemp(join(tmpdir(),'eval-old-cli-')),'run'),prepared=await EvaluationWorkspace.create(repository,root,catalog,'a'.repeat(40));prepared.close();
  const result=cli(root,['--case','B01-neutral-1']);assert.equal(result.status,1);assert.ok(result.stderr.includes('EVALUATION_RUNTIME_NOT_FROZEN'));
  const opened=await EvaluationWorkspace.open(repository,root);try{assert.equal(opened.ledger.report().attempts.length,0);assert.equal(opened.ledger.report().calls.length,0);}finally{opened.close();}
});
