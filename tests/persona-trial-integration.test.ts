import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import {
  ContextItemSchema, PersonaManifestSchema, PersonaRecordRefSchema, PersonaTrialAdmissionInputSchema,
  PersonaTrialAdmissionSchema, PersonaTrialOutcomeSchema,
} from '@dafeiyu/contracts';
import type { ExecutionContextV3, ExtensionV3, PersonaEntryRef, PersonaSourceRef } from '@dafeiyu/contracts';
import { runtimeHash } from '@dafeiyu/core/runtime-store';
import { personaDigest } from '../packages/memory/lib/persona-digest.js';
import { executionHarness } from './execution-fixture.js';
import { call, textReply } from './harness.js';
import { testTempDir } from './test-temp.js';

type Harness=Awaited<ReturnType<typeof executionHarness>>;
type Phase='prepare'|'use'|'other'|'recover';
const extensionId='trial-integration-fixture';
const marker='TRIAL_LOCAL_BLUE_LANTERN';
const content=`${marker}：本次练习先核对局部事实，再决定怎样回应。`;
const applicability='仅限本次蓝灯合成文字练习';
const visibleUse='本次虚构练习中，我先核对已知局部事实，未把试行认识当成已经采用。';
const request={requestId:'prepare-trial',title:'本机虚构试行集成',goal:'准备一条暂定认识供下一Run试行，不采用',policyId:'test-policy'};
const directory=()=>mkdtemp(join(testTempDir(),'persona-trial-integration-'));
const hashText=(text:string)=>createHash('sha256').update(text).digest('hex');

async function open(root:string,create=true){
  let harness:Harness|undefined,phase:Phase=create?'prepare':'recover',steps=0;
  const state:{source?:PersonaSourceRef;trial?:PersonaEntryRef}={};
  function persona(){assert.ok(harness?.memory.persona);return harness.memory.persona;}
  const extension:Omit<ExtensionV3,'protocolVersion'|'agentId'>={id:extensionId,version:'1',actions:[
    {id:'fixture_trial_observe',version:'1',description:'创建本机合成文字来源',effects:'local-write',inputSchema:z.strictObject({}),outputSchema:z.json(),
      execute:async(_input:unknown,context:ExecutionContextV3)=>{
        const source=persona().recordObservation(context,{requestId:'trial-source',occurredAt:new Date().toISOString(),kind:'primary',nature:'synthetic',
          text:'公开虚构练习：蓝灯资料只描述一次局部情况，未观察真实平台效果。',resource:'fixture:trial-observation',coverage:['synthetic-text-only'],completeness:'partial',dependencies:[]},extensionId);
        state.source=source;
        return {status:'succeeded',effects:'confirmed',completeness:'complete',data:z.json().parse({source}),
          sources:[{id:source.id,scopeKey:source.scopeKey,version:source.version,contentHash:source.contentHash}],receipts:[]};
      }},
    {id:'fixture_trial_choose',version:'1',description:'提出并选择未采用的本机试行认识',effects:'local-write',inputSchema:z.strictObject({}),outputSchema:z.json(),
      execute:async(_input:unknown,context:ExecutionContextV3)=>{
        assert.ok(state.source);const service=persona();
        const proposed=service.propose(context,{requestId:'trial-candidate',kind:'value-application',text:content,sources:[`execution-source:${state.source.id}`],
          counters:[],applicability,reason:'只根据合成文字提出有限试行，未证明现实效果'},extensionId);
        const trial=service.review(context,{requestId:'trial-review',id:proposed.id,expectedVersion:proposed.version,state:'trial',reason:'准备在下一Run实际试行；不是采用'},extensionId);
        state.trial={id:trial.id,version:trial.version};
        const selected=service.selectTrial(context,{requestId:'trial-selection',expectedSelectionVersion:0,
          entries:[{candidate:state.trial,applicability,exitConditions:['来源撤回、出现反例或当前任务结束时退出']} ]},extensionId);
        return {status:'succeeded',effects:'confirmed',completeness:'complete',data:z.json().parse({proposed,trial,selected}),sources:[],receipts:[]};
      }},
  ]};
  const started=await executionHarness(root,()=>{
    if(phase==='recover')throw new Error('MODEL_REPLAY_FORBIDDEN');
    if(phase==='prepare'){
      steps++;if(steps===1)return call('fixture_trial_observe',{});if(steps===2)return call('fixture_trial_choose',{});
      return textReply('只选择了暂定条目，尚未在后续Run中试行。');
    }
    return textReply(phase==='use'?visibleUse:'独立任务没有获得另一个任务的试行内容。');
  },extension,create);
  harness=started;
  return {h:started,state,phase:(next:Phase)=>{phase=next;}};
}

function memorySnapshot(root:string){
  const db=new DatabaseSync(join(root,'memory/memory.sqlite'),{readOnly:true});
  try{return {
    candidates:db.prepare('SELECT id,version,state FROM persona_candidates ORDER BY id').all(),
    stages:db.prepare('SELECT * FROM persona_profiles ORDER BY agent_id').all(),
    adoptedSelections:db.prepare('SELECT * FROM growth_selections ORDER BY agent_id,scope_key').all(),
    selections:db.prepare('SELECT agent_id,scope_key,version,body,body_hash FROM persona_trial_selection_revisions ORDER BY rowid').all(),
    admissions:db.prepare('SELECT id,run_id,body,body_hash FROM persona_trial_admissions ORDER BY rowid').all().map(row=>({id:String(row.id),runId:String(row.run_id),
      raw:String(row.body),hash:String(row.body_hash),record:PersonaTrialAdmissionSchema.parse(JSON.parse(String(row.body)))})),
    outcomes:db.prepare('SELECT id,run_id,body,body_hash FROM persona_trial_outcomes ORDER BY rowid').all().map(row=>({id:String(row.id),runId:String(row.run_id),
      raw:String(row.body),hash:String(row.body_hash),record:PersonaTrialOutcomeSchema.parse(JSON.parse(String(row.body)))})),
    decisions:db.prepare('SELECT id FROM persona_adoption_decisions ORDER BY id').all(),
  };}finally{db.close();}
}

function runtimeSnapshot(root:string,runId:string){
  const db=new DatabaseSync(join(root,'core/runtime.sqlite'),{readOnly:true});
  try{
    const row=z.object({body:z.string(),body_hash:z.string()}).parse(db.prepare('SELECT body,body_hash FROM run_persona_manifests WHERE run_id=?').get(runId));
    const stored=z.object({state:z.string(),result:z.string().nullable()}).parse(db.prepare('SELECT state,result FROM runs WHERE id=?').get(runId));
    const inputs=new Map(db.prepare('SELECT input_id,body FROM run_inputs WHERE run_id=?').all(runId).map(input=>[String(input.input_id),JSON.parse(String(input.body)) as unknown]));
    const events=db.prepare("SELECT body FROM runtime_outbox WHERE json_extract(body,'$.runId')=? AND json_extract(body,'$.type')='run.completed' ORDER BY ordinal").all(runId)
      .map(event=>z.object({id:z.string(),at:z.string()}).parse(JSON.parse(String(event.body))));
    return {manifest:PersonaManifestSchema.parse(JSON.parse(row.body)),manifestHash:row.body_hash,state:stored.state,
      result:stored.result===null?null:JSON.parse(stored.result) as unknown,resultRaw:stored.result,inputs,events};
  }finally{db.close();}
}

function assertNotAdopted(snapshot:ReturnType<typeof memorySnapshot>,trial:PersonaEntryRef){
  assert.deepEqual(snapshot.candidates.map(row=>({id:String(row.id),version:Number(row.version),state:String(row.state)})),
    [{id:trial.id,version:trial.version,state:'trial'}]);
  assert.equal(snapshot.stages.length,0);assert.equal(snapshot.adoptedSelections.length,0);assert.equal(snapshot.decisions.length,0);
}

function assertClosedChain(root:string,runId:string,trial:PersonaEntryRef,source:PersonaSourceRef){
  const memory=memorySnapshot(root),runtime=runtimeSnapshot(root,runId);
  const admission=memory.admissions.find(row=>row.runId===runId),outcome=memory.outcomes.find(row=>row.runId===runId);
  assert.ok(admission);assert.ok(outcome);assert.equal(runtime.state,'completed');assert.equal(runtime.manifest.schemaVersion,2);
  if(runtime.manifest.schemaVersion!==2)throw new Error('Trial Run must have a v2 manifest');
  assert.equal(runtimeHash(runtime.manifest),runtime.manifestHash);assert.equal(admission.record.manifestHash,runtime.manifestHash);
  assert.equal(personaDigest(admission.record),admission.hash);assert.equal(personaDigest(outcome.record),outcome.hash);
  assert.deepEqual(admission.record.candidate,trial);assert.deepEqual(outcome.record.candidate,trial);
  assert.deepEqual(outcome.record.admission,{id:admission.id,hash:admission.hash});assert.deepEqual(outcome.record.selection,admission.record.selection);
  assert.equal(runtime.manifest.entries.length,0);assert.equal(runtime.manifest.trialEntries.length,1);assert.equal(runtime.manifest.stageRevision,0);
  const projected=runtime.manifest.trialEntries[0];assert.ok(projected);assert.equal(projected.projection,'trial');assert.equal(projected.maturity,'tentative');
  assert.deepEqual(projected.candidate,trial);assert.equal(projected.projectionHash,admission.record.projectionHash);
  const admissionInput=PersonaTrialAdmissionInputSchema.parse(runtime.inputs.get('persona-trial:admission-input'));
  assert.equal(admissionInput.manifestHash,runtime.manifestHash);assert.equal(admissionInput.entries.length,1);
  const admissionReceipt=z.object({inputHash:z.string(),admissions:z.array(PersonaRecordRefSchema)}).parse(runtime.inputs.get('persona-trial:admission-receipt'));
  assert.equal(admissionReceipt.inputHash,runtimeHash(admissionInput));assert.deepEqual(admissionReceipt.admissions,[{id:admission.id,hash:admission.hash}]);
  const completionReceipt=z.object({inputHash:z.string(),closedEventId:z.string(),outcomes:z.array(PersonaRecordRefSchema)}).parse(runtime.inputs.get('persona-trial:completion-receipt'));
  assert.deepEqual(completionReceipt.outcomes,[{id:outcome.id,hash:outcome.hash}]);assert.equal(completionReceipt.closedEventId,outcome.record.closedEventId);
  assert.equal(runtime.events.length,1);assert.equal(runtime.events[0]?.id,outcome.record.closedEventId);assert.equal(runtime.events[0]?.at,outcome.record.closedAt);
  assert.equal(outcome.record.terminal.state,'completed');if(outcome.record.terminal.state!=='completed')throw new Error('Expected a visible completed result');
  assert.deepEqual(outcome.record.terminal.result,runtime.result);assert.equal(outcome.record.terminal.result.textHash,hashText(visibleUse));
  const sourceEvidence=admission.record.sourceEvidence.find(value=>value.source.id===source.id);assert.ok(sourceEvidence);
  assert.equal(sourceEvidence.nature,'synthetic');assert.equal(sourceEvidence.completeness,'partial');assert.deepEqual(sourceEvidence.coverage,['synthetic-text-only']);
  const contextSchema=z.object({owner:z.literal('memory'),region:z.literal('growth'),item:ContextItemSchema});
  const context=[...runtime.inputs.entries()].filter(([key])=>key.startsWith('context:')).map(([,value])=>contextSchema.safeParse(value))
    .find(value=>value.success&&value.data.item.id===`persona-trial:${trial.id}`);
  assert.ok(context);if(!context.success)throw new Error('Trial context must be stored');
  assert.equal(runtimeHash(context.data.item),projected.projectionHash);
  const text=z.object({kind:z.literal('stage-persona-trial'),projection:z.literal('trial'),maturity:z.literal('tentative'),content:z.string(),instructionAuthority:z.literal(false),notice:z.string()})
    .parse(JSON.parse(context.data.item.text));
  assert.equal(text.content,content);assert.ok(text.notice.includes('尚未采用'));assertNotAdopted(memory,trial);
  return {memory,runtime};
}

test('real core, memory and scripted DSH admit trial only on the next Run, keep task isolation and recover without a model call',async()=>{
  const root=await directory();let opened=await open(root),useRunId='',trial:PersonaEntryRef|undefined,source:PersonaSourceRef|undefined;
  let beforeRestart:ReturnType<typeof memorySnapshot>|undefined;
  try{
    const first=opened.h.port.submitTask(request);await opened.h.core.whenIdle();assert.equal(opened.h.port.status(first.run).state,'completed');
    trial=opened.state.trial;source=opened.state.source;assert.ok(trial);assert.ok(source);
    const afterSelection=memorySnapshot(root);assert.equal(afterSelection.selections.length,1);assert.equal(afterSelection.admissions.length,0);assert.equal(afterSelection.outcomes.length,0);assertNotAdopted(afterSelection,trial);
    const firstManifest=runtimeSnapshot(root,first.run.id).manifest;assert.equal(firstManifest.entries.length,0);if(firstManifest.schemaVersion===2)assert.equal(firstManifest.trialEntries.length,0);
    opened.phase('use');const requestCount=opened.h.adapter.requests.length;
    const next=opened.h.port.submitTask({requestId:'actual-trial-use',taskId:first.task.id,expectedVersion:1,policyId:'test-policy'},first.task);useRunId=next.run.id;
    await opened.h.core.whenIdle();assert.equal(opened.h.port.status(next.run).state,'completed');
    const actualRequests=opened.h.adapter.requests.slice(requestCount);assert.equal(actualRequests.length,1);
    assert.ok(actualRequests.some(value=>JSON.stringify(value.messages).includes(marker)));assertClosedChain(root,useRunId,trial,source);
    opened.phase('other');const otherStart=opened.h.adapter.requests.length;
    const other=opened.h.port.submitTask({...request,requestId:'independent-task',goal:'另一个隔离的虚构任务'});await opened.h.core.whenIdle();assert.equal(opened.h.port.status(other.run).state,'completed');
    assert.ok(opened.h.adapter.requests.slice(otherStart).every(value=>!JSON.stringify(value.messages).includes(marker)));
    const otherManifest=runtimeSnapshot(root,other.run.id).manifest;assert.equal(otherManifest.entries.length,0);if(otherManifest.schemaVersion===2)assert.equal(otherManifest.trialEntries.length,0);
    beforeRestart=memorySnapshot(root);assert.equal(beforeRestart.admissions.length,1);assert.equal(beforeRestart.outcomes.length,1);
  }finally{await opened.h.close();}
  assert.ok(trial);assert.ok(source);assert.ok(beforeRestart);
  opened=await open(root,false);try{
    assert.equal(opened.h.adapter.requests.length,0);const firstRecovery=opened.h.core.recoverPersonaTrials(),secondRecovery=opened.h.core.recoverPersonaTrials();
    assert.equal(firstRecovery.find(value=>value.runId===useRunId)?.status,'completed');assert.equal(secondRecovery.find(value=>value.runId===useRunId)?.status,'completed');
    assert.equal(opened.h.adapter.requests.length,0);assert.deepEqual(memorySnapshot(root),beforeRestart);assertClosedChain(root,useRunId,trial,source);
  }finally{await opened.h.close();}
});

test('a failed Outcome insert preserves the completed Run and restart seals exactly one missing proof without replaying its output',async()=>{
  const root=await directory();let opened=await open(root),useRunId='',trial:PersonaEntryRef|undefined,source:PersonaSourceRef|undefined,resultRaw:string|null=null;
  try{
    const first=opened.h.port.submitTask(request);await opened.h.core.whenIdle();assert.equal(opened.h.port.status(first.run).state,'completed');
    trial=opened.state.trial;source=opened.state.source;assert.ok(trial);assert.ok(source);
    const db=new DatabaseSync(join(root,'memory/memory.sqlite'));try{
      db.exec("CREATE TRIGGER fixture_trial_outcome_failure BEFORE INSERT ON persona_trial_outcomes BEGIN SELECT RAISE(ABORT,'FIXTURE_OUTCOME_BLOCKED');END;");
    }finally{db.close();}
    opened.phase('use');const next=opened.h.port.submitTask({requestId:'trial-use-with-seal-failure',taskId:first.task.id,expectedVersion:1,policyId:'test-policy'},first.task);useRunId=next.run.id;
    await opened.h.core.whenIdle();assert.equal(opened.h.port.status(next.run).state,'completed');
    const runtime=runtimeSnapshot(root,useRunId);resultRaw=runtime.resultRaw;assert.ok(resultRaw);assert.equal(runtime.events.length,1);
    assert.equal(runtime.inputs.has('persona-trial:completion-receipt'),false);
    const missing=memorySnapshot(root);assert.equal(missing.admissions.length,1);assert.equal(missing.outcomes.length,0);assertNotAdopted(missing,trial);
  }finally{await opened.h.close();}
  const repair=new DatabaseSync(join(root,'memory/memory.sqlite'));try{repair.exec('DROP TRIGGER fixture_trial_outcome_failure');}finally{repair.close();}
  assert.ok(trial);assert.ok(source);
  opened=await open(root,false);try{
    assert.equal(opened.h.adapter.requests.length,0);const statuses=opened.h.core.recoverPersonaTrials();assert.equal(statuses.find(value=>value.runId===useRunId)?.status,'completed');
    const sealed=assertClosedChain(root,useRunId,trial,source);assert.equal(sealed.memory.outcomes.length,1);assert.equal(sealed.runtime.resultRaw,resultRaw);
    const again=opened.h.core.recoverPersonaTrials();assert.equal(again.find(value=>value.runId===useRunId)?.status,'completed');
    assert.equal(opened.h.adapter.requests.length,0);assert.deepEqual(memorySnapshot(root),sealed.memory);assert.equal(runtimeSnapshot(root,useRunId).resultRaw,resultRaw);
  }finally{await opened.h.close();}
});
