import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { auditPersonaChanges,capturePersonaBaseline } from '../../scripts/evaluation/persona-proof.ts';
import { personaProofFixture } from './persona-proof-fixture.ts';
import type { ProofFixtureOptions } from './persona-proof-fixture.ts';
if(!process.env.DAFEIYU_TEST_RUN||!tmpdir().startsWith(process.env.DAFEIYU_TEST_RUN))throw new Error('MANAGED_TEST_RUN_REQUIRED');

const audit=(fixture:Awaited<ReturnType<typeof personaProofFixture>>)=>auditPersonaChanges(fixture.root,fixture.baseline,fixture.scope,fixture.consumerRunId);
test('an explicitly synthetic complete qualification graph permits a tentative adopted change without claiming semantic acceptance',async()=>{
  const fixture=await personaProofFixture(),result=await audit(fixture);
  assert.equal(result.qualificationPassed,true,JSON.stringify(result.issues));assert.equal(result.currentProtectionPassed,true,JSON.stringify(result.current));
  assert.equal(result.qualified.length,1);assert.equal(result.qualified[0]?.maturity,'tentative');
  assert.equal(result.qualified[0]?.outcomes[0]?.visible?.textHash.length,64);assert.equal(result.semanticAssessment,'not-performed');
  assert.equal(result.changes.length,3);assert.equal(result.qualified[0]?.sourceEvidence[0]?.nature,'synthetic');
});
const rejected:ReadonlyArray<[string,ProofFixtureOptions]>=[
  ['held decision',{held:true}],['synthetic evidence claimed established',{established:true}],
  ['missing core completion receipt',{missingReceipt:true}],['trial omitted from manifest',{missingManifestEntry:true}],
  ['changed actual visible result',{changedVisibleResult:true}],['cross-scope review',{wrongScope:true}],
  ['old content hash',{wrongHash:true}],['old candidate version',{wrongCandidateVersion:true}],
  ['management receipt repeated as visible use',{managementReceipt:true}],['new legacy adoption',{newLegacy:true}],
  ['unsupported missing source',{sourceMissing:true}],['unknown effect without limitations',{unknownEffect:true,noLimitations:true}],
  ['held adoption hidden by later withdrawal',{held:true,candidateWithdrawn:true}],
];
for(const [name,options] of rejected)test('persona qualification rejects '+name,async()=>{
  const fixture=await personaProofFixture(options),result=await audit(fixture);
  assert.equal(result.qualificationPassed,false,JSON.stringify(result));assert.ok(result.issues.length>0);
});
test('later source withdrawal retains qualified history but cannot remain current adopted context',async()=>{
  const exposed=await personaProofFixture({sourceWithdrawn:true}),unsafe=await audit(exposed);
  assert.equal(unsafe.qualificationPassed,true,JSON.stringify(unsafe.issues));assert.equal(unsafe.currentProtectionPassed,false);
  assert.equal(unsafe.current[0]?.currentValid,false);assert.ok(unsafe.current[0]?.sources.some(source=>source.error==='EVALUATION_SOURCE_STALE'));
  const withdrawn=await personaProofFixture({sourceWithdrawn:true,candidateWithdrawn:true}),safe=await audit(withdrawn);
  assert.equal(safe.qualificationPassed,true,JSON.stringify(safe.issues));assert.equal(safe.currentProtectionPassed,true);
  assert.equal(safe.qualified.length,1);assert.equal(safe.changes.length,4);
});
test('withdrawal before adoption and metadata drift cannot reuse an old allowed decision',async()=>{
  const early=await personaProofFixture({sourceWithdrawn:true}),db=new DatabaseSync(join(early.root,'memory/memory.sqlite'));
  try{const row=db.prepare("SELECT ordinal,body FROM execution_memory_outbox WHERE json_extract(body,'$.type')='execution.source.deleted'").get();assert.ok(row);
    db.prepare('UPDATE execution_memory_outbox SET body=? WHERE ordinal=?').run(JSON.stringify({...JSON.parse(String(row.body)),at:'2026-10-26T01:04:00.000Z'}),row.ordinal!);
  }finally{db.close();}
  assert.equal((await audit(early)).qualificationPassed,false);
  const drift=await personaProofFixture(),changed=new DatabaseSync(join(drift.root,'memory/memory.sqlite'));
  try{const row=changed.prepare('SELECT body FROM execution_sources WHERE id=?').get(drift.sourceId);assert.ok(row);
    changed.prepare('UPDATE execution_sources SET body=? WHERE id=?').run(JSON.stringify({...JSON.parse(String(row.body)),nature:'observed'}),drift.sourceId);
  }finally{changed.close();}
  const result=await audit(drift);assert.equal(result.qualificationPassed,false);assert.ok(result.issues.some(issue=>issue.includes('SOURCE_DESCRIPTION_CHANGED')));
});
test('actual context item and immutable baseline are independently checked',async()=>{
  const omitted=await personaProofFixture(),runtime=new DatabaseSync(join(omitted.root,'core/runtime.sqlite'));
  try{runtime.prepare("DELETE FROM run_inputs WHERE run_id=? AND input_id LIKE 'context:%'").run(omitted.trialRun);}finally{runtime.close();}
  const result=await audit(omitted);assert.equal(result.qualificationPassed,false);assert.ok(result.issues.some(issue=>issue.includes('PROJECTION_MISSING')));
  const changed=await personaProofFixture(),baseline=capturePersonaBaseline(changed.root),memory=new DatabaseSync(join(changed.root,'memory/memory.sqlite'));
  try{memory.prepare('UPDATE persona_candidate_revisions SET body_hash=? WHERE id=? AND version=1').run('f'.repeat(64),changed.candidateId);}finally{memory.close();}
  await assert.rejects(auditPersonaChanges(changed.root,baseline,changed.scope,changed.consumerRunId),/REVISION_CHANGED/);
});
