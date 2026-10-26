import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import {
  PersonaCandidateRevisionSchema, PersonaAdoptionReviewSchema, PersonaAdoptionDecisionSchema,
  PersonaEntryRefSchema, PersonaRecordRefSchema, PersonaManifestSchema, PersonaTrialOutcomeSchema,
} from '@dafeiyu/contracts';
import type { PersonaEntryRef, PersonaPublishInput } from '@dafeiyu/contracts';
import { executionHarness } from './execution-fixture.js';
import { call, textReply } from './harness.js';
import type { Response } from './harness.js';
import { testTempDir } from './test-temp.js';

const content='我想继续探索虚构的琥珀灯纸雕主题';
const applicability='仅限本次虚构纸雕练习的当前探索打算';
const visibleUse='这次纸雕练习中，我比较了两种虚构灯罩的层次，保留下一次继续探索的打算。';
const visiblePublication='这条认识已按有限试行采用，仍是暂定打算，不是长期偏好或真实经历。';
const request={requestId:'prepare',title:'虚构纸雕探索',goal:'提出有限的暂定兴趣，后续实际试行后再复核',policyId:'test-policy'};
const root=()=>mkdtemp(join(testTempDir(),'persona-adoption-integration-'));
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const deferred=()=>{let resolve=()=>{};const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};};
const reviewReceipt=z.object({review:PersonaRecordRefSchema,decision:PersonaRecordRefSchema,eligibility:z.enum(['allowed','held']),reasons:z.array(z.string()),published:z.literal(false)});
const candidateReceipt=z.object({id:z.uuid(),version:z.number().int().positive()});
const statusReceipt=z.object({stageRevision:z.number(),trialOutcomes:z.array(z.object({ref:PersonaRecordRefSchema,candidate:PersonaEntryRefSchema,runId:z.string(),state:z.string()}))});

function latestTool<T>(request:Parameters<Response>[0],schema:z.ZodType<T>):T {
  for(const message of [...request.messages].reverse())if(message.role==='tool')for(const block of [...message.content].reverse())if(block.type==='text'){
    let raw:unknown;try{raw=JSON.parse(block.text);}catch{continue;}
    const parsed=schema.safeParse(raw);if(parsed.success)return parsed.data;
  }
  throw new Error('Expected an actual visible tool receipt');
}
function data<T>(request:Parameters<Response>[0],schema:z.ZodType<T>):T{return latestTool(request,z.object({data:schema})).data;}
type Phase='prepare'|'use'|'publish'|'ordinary';

/** Actual core/memory and public model actions; only model generation is scripted. */
async function open(directory:string,options:{motivation?:'explicit-task'|'self-exploration';shortcut?:boolean;replay?:boolean;beforePublish?:()=>Promise<void>}={}){
  let phase:Phase='prepare',step=0,trial:PersonaEntryRef|undefined;
  let review:z.infer<typeof reviewReceipt>|undefined,publication:PersonaPublishInput|undefined,shortcutError:string|undefined;
  const response:Response=async input=>{
    step++;
    if(phase==='prepare'){
      if(step===1)return call('dafeiyu_persona_propose',{requestId:'candidate',kind:'interest',text:content,sources:[],counters:[],applicability,reason:'本机虚构探索的当前打算'});
      if(step===2){const candidate=data(input,candidateReceipt);return call('dafeiyu_persona_review',{requestId:'trial',id:candidate.id,expectedVersion:candidate.version,state:'trial',reason:'准备在后续 Run 实际试行'});}
      if(step===3){trial=data(input,candidateReceipt);return call('dafeiyu_persona_trial_select',{requestId:'selection',expectedSelectionVersion:0,
        entries:[{candidate:trial,applicability,exitConditions:['出现反例、来源撤回或练习结束时退出']} ]});}
      if(options.shortcut&&step===4){assert.ok(trial);return call('dafeiyu_persona_publish',{requestId:'same-run-shortcut',expectedStageVersion:0,entries:[trial]});}
      if(options.shortcut)shortcutError=latestTool(input,z.object({status:z.literal('failed'),effects:z.literal('none'),errorCode:z.string()})).errorCode;
      return textReply('只选入下一轮试行，尚未采用。');
    }
    if(phase==='use')return textReply(visibleUse);
    if(phase==='ordinary')return textReply('沿用有范围限制的暂定认识。');
    assert.ok(trial);const currentTrial=trial;
    if(step===1)return call('dafeiyu_persona_status',{});
    if(step===2){const status=data(input,statusReceipt),outcomes=status.trialOutcomes.filter(value=>value.candidate.id===currentTrial.id&&value.candidate.version===currentTrial.version&&value.state==='completed');
      assert.equal(outcomes.length,1);return call('dafeiyu_persona_adoption_review',{requestId:'adoption-review',candidate:currentTrial,trialOutcomes:outcomes.map(value=>value.ref),supports:[],counters:[],
        counterCheck:{status:'not-obtained',reason:'虚构练习尚未取得独立反证'},conclusionScope:applicability,targetMaturity:'tentative',
        limitations:['仅为虚构文字练习中的当前打算，不证明真实经历或长期偏好'],reason:'根据已闭合可见试行作有限采用复核'});}
    if(step===3){review=data(input,reviewReceipt);publication={requestId:'publish',expectedStageVersion:0,entries:[{...currentTrial,review:review.review}]};
      await options.beforePublish?.();return call('dafeiyu_persona_publish',publication);}
    if(step===4&&options.replay){assert.ok(publication);return call('dafeiyu_persona_publish',publication);}
    return textReply(review?.eligibility==='held'?'原始动机不允许把受托任务转为个人兴趣，候选继续保留。':visiblePublication);
  };
  const h=await executionHarness(directory,response,undefined,true,{personaActions:true});
  const port=options.motivation==='explicit-task'?h.port:h.core.executionProducer('local-test',{motivation:{kind:'self-exploration',basis:['受信本机虚构探索活动']} });
  return {h,port,setPhase:(next:Phase)=>{phase=next;step=0;},get trial(){return trial;},get review(){return review;},get shortcutError(){return shortcutError;}};
}
type Opened=Awaited<ReturnType<typeof open>>;
async function prepareAndUse(opened:Opened){
  const first=opened.port.submitTask(request);await opened.h.core.whenIdle();assert.equal(opened.port.status(first.run).state,'completed');
  opened.setPhase('use');const use=opened.port.submitTask({requestId:'visible-use',taskId:first.task.id,expectedVersion:1,policyId:'test-policy'},first.task);
  await opened.h.core.whenIdle();assert.equal(opened.port.status(use.run).state,'completed');return {first,use};
}
function snapshot(directory:string){const db=new DatabaseSync(join(directory,'memory/memory.sqlite'),{readOnly:true});
  try{return {
    candidates:db.prepare('SELECT r.body FROM persona_candidates c JOIN persona_candidate_revisions r ON r.id=c.id AND r.version=c.version ORDER BY c.id').all().map(row=>PersonaCandidateRevisionSchema.parse(JSON.parse(String(row.body)))),
    reviews:db.prepare('SELECT body FROM persona_adoption_reviews ORDER BY rowid').all().map(row=>PersonaAdoptionReviewSchema.parse(JSON.parse(String(row.body)))),
    decisions:db.prepare('SELECT body FROM persona_adoption_decisions ORDER BY rowid').all().map(row=>PersonaAdoptionDecisionSchema.parse(JSON.parse(String(row.body)))),
    outcomes:db.prepare('SELECT body FROM persona_trial_outcomes ORDER BY rowid').all().map(row=>PersonaTrialOutcomeSchema.parse(JSON.parse(String(row.body)))),
    publications:Number(db.prepare("SELECT count(*) n FROM persona_outbox WHERE json_extract(body,'$.type')='persona.published'").get()?.n),
    profiles:Number(db.prepare('SELECT count(*) n FROM persona_profiles').get()?.n),
    revisions:Number(db.prepare('SELECT count(*) n FROM persona_candidate_revisions').get()?.n),
  };}finally{db.close();}}
function manifest(directory:string,runId:string){const db=new DatabaseSync(join(directory,'core/runtime.sqlite'),{readOnly:true});
  try{const row=z.object({body:z.string()}).parse(db.prepare('SELECT body FROM run_persona_manifests WHERE run_id=?').get(runId));return PersonaManifestSchema.parse(JSON.parse(row.body));}finally{db.close();}}

test('public propose-review-select-publish in the same Run cannot manufacture adoption evidence',async()=>{
  const directory=await root(),opened=await open(directory,{shortcut:true});try{
    const first=opened.port.submitTask(request);await opened.h.core.whenIdle();const status=opened.port.status(first.run);assert.equal(status.state,'completed');
    assert.equal(opened.shortcutError,'PERSONA_ADOPTION_REVIEW_REQUIRED');assert.deepEqual(status.operations.map(operation=>[operation.status,operation.effects]),
      [['succeeded','confirmed'],['succeeded','confirmed'],['succeeded','confirmed'],['failed','none']]);
    const records=snapshot(directory);assert.equal(records.candidates[0]?.state,'trial');assert.equal(records.revisions,2);assert.equal(records.outcomes.length,0);
    assert.equal(records.reviews.length,0);assert.equal(records.decisions.length,0);assert.equal(records.publications,0);assert.equal(records.profiles,0);
  }finally{await opened.h.close();}
});

test('public tools adopt only after three Runs and replay preserves one publication while the promotion Run completes',async()=>{
  const directory=await root(),opened=await open(directory,{replay:true});try{
    const {first,use}=await prepareAndUse(opened);assert.equal(snapshot(directory).outcomes.length,1);opened.setPhase('publish');
    const published=opened.port.submitTask({requestId:'adopt',taskId:first.task.id,expectedVersion:1,policyId:'test-policy'},first.task);await opened.h.core.whenIdle();
    const status=opened.port.status(published.run);assert.equal(status.state,'completed');assert.ok(status.result);assert.equal(opened.review?.eligibility,'allowed');
    assert.deepEqual(status.operations.map(operation=>[operation.status,operation.effects]),[['succeeded','none'],['succeeded','confirmed'],['succeeded','confirmed'],['succeeded','confirmed']]);
    const records=snapshot(directory),candidate=records.candidates[0];assert.ok(candidate);assert.equal(candidate.schemaVersion,2);assert.equal(candidate.state,'adopted');assert.equal(candidate.version,3);
    assert.equal(candidate.motivation.kind,'self-exploration');assert.equal(candidate.applicability,applicability);if(candidate.schemaVersion===2)assert.equal(candidate.maturity,'tentative');
    assert.equal(records.publications,1);assert.equal(records.revisions,3);assert.equal(records.reviews.length,1);assert.equal(records.decisions.length,2);
    assert.equal(records.outcomes.length,2);const used=records.outcomes.find(value=>value.runId===use.run.id),promoted=records.outcomes.find(value=>value.runId===published.run.id);
    assert.ok(used);assert.ok(promoted);assert.equal(used.terminal.state,'completed');assert.equal(promoted.terminal.state,'completed');
    if(used.terminal.state==='completed')assert.equal(used.terminal.result.textHash,hash(visibleUse));
    if(promoted.terminal.state==='completed')assert.equal(promoted.terminal.result.textHash,hash(visiblePublication));
    const actual=manifest(directory,published.run.id);assert.equal(actual.entries.length,0);assert.equal(actual.schemaVersion,2);if(actual.schemaVersion===2)assert.equal(actual.trialEntries.length,1);
    opened.setPhase('ordinary');const next=opened.port.submitTask({requestId:'after-adoption',taskId:first.task.id,expectedVersion:1,policyId:'test-policy'},first.task);await opened.h.core.whenIdle();
    assert.equal(opened.port.status(next.run).state,'completed');const projected=manifest(directory,next.run.id);assert.equal(projected.entries.length,1);
    assert.equal(projected.schemaVersion,2);if(projected.schemaVersion===2)assert.equal(projected.trialEntries.length,0);
  }finally{await opened.h.close();}
});

test('a separately completed trial cannot turn explicit-task motivation into an adopted personal interest',async()=>{
  const directory=await root(),opened=await open(directory,{motivation:'explicit-task'});try{
    const {first}=await prepareAndUse(opened);opened.setPhase('publish');const reviewed=opened.port.submitTask({requestId:'attempt-adoption',taskId:first.task.id,expectedVersion:1,policyId:'test-policy'},first.task);
    await opened.h.core.whenIdle();const status=opened.port.status(reviewed.run);assert.equal(status.state,'completed');assert.equal(opened.review?.eligibility,'held');assert.ok(opened.review?.reasons.includes('motivation-mismatch'));
    assert.equal(status.operations.at(-1)?.status,'failed');assert.equal(status.operations.at(-1)?.effects,'none');
    const records=snapshot(directory);assert.equal(records.candidates[0]?.state,'trial');assert.equal(records.candidates[0]?.motivation.kind,'explicit-task');
    assert.equal(records.publications,0);assert.equal(records.profiles,0);assert.equal(records.decisions.length,1);assert.equal(records.decisions[0]?.eligibility,'held');
  }finally{await opened.h.close();}
});

test('source withdrawal after an allowed review prevents publication and cannot reuse that preview as authority',async()=>{
  const directory=await root(),entered=deferred(),release=deferred();
  const opened=await open(directory,{beforePublish:async()=>{entered.resolve();await release.promise;}});try{
    const {first}=await prepareAndUse(opened);opened.setPhase('publish');const pending=opened.port.submitTask({requestId:'withdraw-before-publication',taskId:first.task.id,expectedVersion:1,policyId:'test-policy'},first.task);
    await Promise.race([entered.promise,opened.h.core.whenIdle().then(()=>{throw new Error('Run closed before the allowed review was observed');})]);
    assert.equal(opened.review?.eligibility,'allowed');const before=snapshot(directory),candidate=before.candidates[0];assert.ok(candidate);assert.equal(candidate.contentRef.kind,'execution-source');
    // Simulate an external source withdrawal between two model turns, not a model-authored Outcome.
    const db=new DatabaseSync(join(directory,'memory/memory.sqlite'));try{
      const changed=db.prepare('UPDATE execution_sources SET deleted=1,state_version=state_version+1 WHERE id=? AND scope_key=?').run(candidate.contentRef.id,candidate.contentRef.scopeKey);assert.equal(Number(changed.changes),1);
    }finally{db.close();}
    release.resolve();await opened.h.core.whenIdle();const status=opened.port.status(pending.run);assert.equal(status.state,'failed');assert.equal(status.result,null);
    const after=snapshot(directory);assert.equal(after.candidates[0]?.state,'trial');assert.equal(after.revisions,before.revisions);assert.equal(after.decisions.length,before.decisions.length);
    assert.equal(after.publications,0);assert.equal(after.profiles,0);assert.equal(after.reviews.length,1);
  }finally{release.resolve();await opened.h.close();}
});
