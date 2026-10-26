import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,writeFile,mkdir } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { PersonaCandidateRevisionV1Schema,PersonaManifestSchema } from '@dafeiyu/contracts';
import { runtimeHash } from '@dafeiyu/core/runtime-store';
import { EvaluationCatalog } from '../../scripts/evaluation/catalog.ts';
import { EvaluationWorkspace } from '../../scripts/evaluation/workspace.ts';
import { BoundaryFixture } from '../../scripts/evaluation/boundary-fixture.ts';
import { openEvaluationRuntime,evaluationCall,evaluationText } from '../../scripts/evaluation/runtime.ts';
import { seedLegacyPersonaFixture } from '../../scripts/evaluation/persona-seed.ts';
if(!process.env.DAFEIYU_TEST_RUN||!tmpdir().startsWith(process.env.DAFEIYU_TEST_RUN))throw new Error('MANAGED_TEST_RUN_REQUIRED');
const repository=resolve('.'),catalog=new EvaluationCatalog(repository);

async function prepare(sampleId:'B04'|'B08'){
  const workspace=await EvaluationWorkspace.create(repository,join(await mkdtemp(join(tmpdir(),'eval-legacy-seed-')),'run'),catalog,'a'.repeat(40)),
    item=catalog.case(sampleId+'-neutral-1'),attemptId=workspace.ledger.begin(item.id),root=join(workspace.root,'cases',attemptId);
  await workspace.write('cases/'+attemptId+'/case.json',JSON.stringify({case:item}));let world:BoundaryFixture|undefined,step=0;
  const h=await openEvaluationRuntime({root,foundationFile:join(workspace.root,'sources/persona.foundation.md'),ledger:workspace.ledger,attemptId,
    response:()=>++step===1?evaluationCall('evaluation_fixture_prepare',{}):evaluationText('仅完成公开虚构初始状态。'),
    extension:ctx=>{world=new BoundaryFixture(ctx,root,catalog.boundary(sampleId));return {id:'evaluation-fixture',version:'1',actions:world.actions()};}});
  await world!.initialize();const submitted=h.port.submitTask({requestId:'prepare',title:'公开虚构初始偏好',goal:'只准备初始状态',policyId:'case'});
  await h.core.whenIdle();assert.equal(h.port.status(submitted.run).state,'completed');
  return {workspace,root,attemptId,taskId:submitted.task.id,h,world:world!,async close(){world?.close();await h.close();}};
}
function records(root:string){
  const db=new DatabaseSync(join(root,'memory/memory.sqlite'),{readOnly:true});try{return {
    candidate:db.prepare('SELECT body,body_hash FROM persona_candidate_revisions').all(),
    stage:db.prepare('SELECT body,body_hash FROM persona_profile_revisions').all(),
    selection:db.prepare('SELECT version,body FROM growth_revisions').all(),
    proofs:['persona_trial_admissions','persona_trial_outcomes','persona_adoption_reviews','persona_adoption_decisions'].map(table=>Number(db.prepare('SELECT count(*) AS n FROM '+table).get()?.n)),
  };}finally{db.close();}
}
for(const sampleId of ['B04','B08'] as const)test(sampleId+' seeds only a closed synthetic legacy snapshot and reopens without adoption proof',async()=>{
  const prepared=await prepare(sampleId);
  try{
    await assert.rejects(seedLegacyPersonaFixture(prepared.workspace,prepared.root),/PROFILE_ACTIVE/);
    await prepared.close();const seeded=await seedLegacyPersonaFixture(prepared.workspace,prepared.root);assert.ok(seeded);
    assert.equal(seeded.marker.sourceNature,'synthetic');assert.equal(seeded.marker.realTrial,false);assert.equal(seeded.marker.paidCalls,0);assert.equal(seeded.marker.adoptionBasis,'legacy-unclassified');
    const before=records(prepared.root);assert.equal(before.candidate.length,1);assert.deepEqual(before.proofs,[0,0,0,0]);
    const candidate=PersonaCandidateRevisionV1Schema.parse(JSON.parse(String(before.candidate[0]!.body)));
    assert.equal(candidate.state,'adopted');assert.equal(candidate.version,1);assert.equal(candidate.producer,'evaluation-legacy-fixture');
    assert.equal(runtimeHash(candidate),before.candidate[0]!.body_hash);assert.equal(runtimeHash(candidate),seeded.marker.candidate.hash);
    assert.equal((await seedLegacyPersonaFixture(prepared.workspace,prepared.root))?.hash,seeded.hash);assert.deepEqual(records(prepared.root),before);
    let world:BoundaryFixture|undefined;const reopened=await openEvaluationRuntime({root:prepared.root,create:false,
      foundationFile:join(prepared.workspace.root,'sources/persona.foundation.md'),ledger:prepared.workspace.ledger,attemptId:prepared.attemptId,
      response:()=>evaluationText('仅识别虚构初始偏好；不声明发生过真实试行。'),
      extension:ctx=>{world=new BoundaryFixture(ctx,prepared.root,catalog.boundary(sampleId));return {id:'evaluation-fixture',version:'1',actions:world.actions()};}});
    try{
      await world!.initialize(false);const task=reopened.port.openTask(prepared.taskId),run=reopened.port.submitTask({requestId:'read-seed',taskId:task.id,expectedVersion:1,policyId:'case'},task);
      await reopened.core.whenIdle();assert.equal(reopened.port.status(run.run).state,'completed');
      const db=new DatabaseSync(join(prepared.root,'core/runtime.sqlite'),{readOnly:true});try{
        const manifest=PersonaManifestSchema.parse(JSON.parse(String(db.prepare('SELECT body FROM run_persona_manifests WHERE run_id=?').get(run.run.id)?.body)));
        assert.equal(manifest.entries.length,1);assert.equal(manifest.entries[0]?.candidate.id,candidate.id);
        if(manifest.schemaVersion===2)assert.equal(manifest.entries[0]?.adoption.basis,'legacy-unclassified');
      }finally{db.close();}
      assert.deepEqual(records(prepared.root).proofs,[0,0,0,0]);assert.equal(prepared.workspace.ledger.budget.spent,0);
    }finally{world?.close();await reopened.close();}
  }finally{await prepared.close();prepared.workspace.close();}
});
test('legacy seed rejects altered material, unrelated paths and a different reuse request',async()=>{
  const prepared=await prepare('B04');try{
    await prepared.close();const materialFile=join(prepared.root,'fixture/material.json'),material=await readFile(materialFile,'utf8');
    await writeFile(materialFile,JSON.stringify({entry:{content:'另一条未冻结的虚构偏好'}}));await assert.rejects(seedLegacyPersonaFixture(prepared.workspace,prepared.root),/MATERIAL_CHANGED/);
    await writeFile(materialFile,material);const requestFile=join(prepared.root,'fixture/legacy-persona-request.json'),request=await readFile(requestFile,'utf8');
    const unrelated=join(prepared.workspace.root,'unrelated');await mkdir(join(unrelated,'fixture'),{recursive:true});await writeFile(join(unrelated,'fixture/legacy-persona-request.json'),request);
    await assert.rejects(seedLegacyPersonaFixture(prepared.workspace,unrelated),/PATH_DENIED/);
    await seedLegacyPersonaFixture(prepared.workspace,prepared.root);
    await writeFile(requestFile,JSON.stringify({...JSON.parse(request),candidateId:randomUUID()}));await assert.rejects(seedLegacyPersonaFixture(prepared.workspace,prepared.root),/INITIAL_STATE_REQUIRED/);
  }finally{await prepared.close();prepared.workspace.close();}
});
