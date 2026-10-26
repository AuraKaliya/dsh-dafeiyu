import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { testTempDir as tmpdir } from './test-temp.js';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { PersonaManifestSchema } from '@dafeiyu/contracts';
import type { ExecutionContextV3, PersonaEntryRef } from '@dafeiyu/contracts';
import { executionHarness } from './execution-fixture.js';
import { call,textReply } from './harness.js';
import * as Simulator from '@dafeiyu/channel-simulator';
import type { PersonaSourceRef } from '@dafeiyu/contracts';
import { visibleStream } from '../packages/core/lib/visible-stream.js';
import type { StreamChunk } from '@deepseek-ai/dsh-llm';

const root=()=>mkdtemp(join(tmpdir(),'dafeiyu-persona-state-'));
const request={requestId:'first',title:'虚构成长任务',goal:'在内部任务中记录一次暂定兴趣',policyId:'test-policy'};
const interest='我想继续探索虚构的蓝灯水彩主题';
const proposed={requestId:'candidate',kind:'interest',text:interest,sources:[],counters:[],applicability:'仅为本次虚构探索的当前打算',reason:'明确提出试行，不代表已形成长期爱好'};
type H=Awaited<ReturnType<typeof executionHarness>>;
function extension(run:(context:ExecutionContextV3)=>unknown,effects:'read'|'local-write'='local-write'){
  return {id:'fixture',version:'1',actions:[{id:'fixture_persona',version:'1',description:'本机虚构人格操作',effects,inputSchema:z.strictObject({}),outputSchema:z.json(),execute:async(_raw:unknown,context:ExecutionContextV3)=>{
    const data=run(context);return {status:'succeeded' as const,effects:effects==='read'?'none' as const:'confirmed' as const,completeness:'complete' as const,data:z.json().parse(data),sources:[],receipts:[]};}}]};
}
function prepareTrial(h:H,context:ExecutionContextV3,prefix=''){const persona=h.memory.persona!;
  const candidate=persona.propose(context,{...proposed,requestId:prefix+proposed.requestId},'fixture');
  const trial=persona.review(context,{requestId:prefix+'review',id:candidate.id,expectedVersion:candidate.version,state:'trial',reason:'保留暂定性质，准备下一 Run 试行'},'fixture');
  persona.selectTrial(context,{requestId:prefix+'trial-select',expectedSelectionVersion:persona.status(context,'fixture').trialSelectionVersion,
    entries:[{candidate:{id:trial.id,version:trial.version},applicability:proposed.applicability,exitConditions:['来源撤回、出现反例或本次练习结束时停止']} ]},'fixture');
  return {candidate,trial:{id:trial.id,version:trial.version}};}
function reviewAdoption(h:H,context:ExecutionContextV3,trial:PersonaEntryRef,prefix='',applicability=proposed.applicability){const persona=h.memory.persona!;
  const outcomes=persona.status(context,'fixture').trialOutcomes.filter(outcome=>outcome.candidate.id===trial.id&&outcome.candidate.version===trial.version&&outcome.state==='completed');
  assert.equal(outcomes.length,1,'adoption needs the separately completed visible trial Run');
  const review=persona.reviewAdoption(context,{requestId:prefix+'adoption-review',candidate:trial,trialOutcomes:outcomes.map(outcome=>outcome.ref),supports:[],counters:[],
    counterCheck:{status:'not-obtained',reason:'本机虚构练习尚未取得独立反证'},conclusionScope:applicability,targetMaturity:'tentative',
    limitations:['仅限本次虚构文字练习，不证明长期偏好或现实效果'],reason:'依据已闭合可见试行作有限采用复核'},'fixture');
  assert.equal(review.eligibility,'allowed');return review;}
function publishTrial(h:H,context:ExecutionContextV3,trial:PersonaEntryRef,prefix='',applicability=proposed.applicability){
  const persona=h.memory.persona!,review=reviewAdoption(h,context,trial,prefix,applicability);
  return persona.publish(context,{requestId:prefix+'publish',expectedStageVersion:persona.status(context,'fixture').stageRevision,entries:[{...trial,review:review.review}]},'fixture');}
type Phase='prepare'|'use'|'publish'|'ordinary'|'withdraw';
function flow(){let phase:Phase='prepare',step=0;const trials=new Map<string,PersonaEntryRef>();return {
  get phase(){return phase;},set(next:Phase){phase=next;step=0;},trials,
  response(){if(['prepare','publish','withdraw'].includes(phase)&&++step===1)return call('fixture_persona',{});
    return textReply(phase==='use'?'这次虚构练习比较了蓝灯色块，接下来仍只作有限探索。':'已保留本次虚构练习的范围和不确定性。');},
  action(h:H,context:ExecutionContextV3){assert.ok(context.taskId);const prefix=context.taskId+'-';
    if(phase==='prepare'){const result=prepareTrial(h,context,prefix);trials.set(context.taskId,result.trial);return result;}
    const trial=trials.get(context.taskId);assert.ok(trial);assert.equal(phase,'publish');return publishTrial(h,context,trial,prefix);},
};}
async function prepareAndUse(h:H,script:ReturnType<typeof flow>,requestId='first'){
  const port=h.core.executionProducer('local-test',{motivation:{kind:'self-exploration',basis:['受信本机虚构探索活动']} });
  script.set('prepare');const first=port.submitTask({...request,requestId});await h.core.whenIdle();assert.equal(port.status(first.run).state,'completed');
  script.set('use');const use=port.submitTask({requestId:requestId+'-use',taskId:first.task.id,expectedVersion:1,policyId:'test-policy'},first.task);
  await h.core.whenIdle();assert.equal(port.status(use.run).state,'completed');return {port,first,use};}
async function completeAdoption(h:H,script:ReturnType<typeof flow>,requestId='first'){
  const prepared=await prepareAndUse(h,script,requestId);script.set('publish');
  const published=prepared.port.submitTask({requestId:requestId+'-publish',taskId:prepared.first.task.id,expectedVersion:1,policyId:'test-policy'},prepared.first.task);
  await h.core.whenIdle();assert.equal(prepared.port.status(published.run).state,'completed');script.set('ordinary');return {...prepared,published};}
function manifests(root:string){const db=new DatabaseSync(join(root,'core/runtime.sqlite'),{readOnly:true});try{return db.prepare('SELECT body FROM run_persona_manifests ORDER BY rowid').all().map(row=>PersonaManifestSchema.parse(JSON.parse(String(row.body))));}finally{db.close();}}
function personaCounts(db:DatabaseSync){return Object.fromEntries(['persona_candidate_revisions','persona_adoption_reviews','persona_adoption_decisions','persona_profile_revisions','growth_revisions','persona_trial_selection_revisions']
  .map(table=>[table,Number(db.prepare(`SELECT count(*) n FROM ${table}`).get()?.n)]));}
const deferred=()=>{let resolve=()=>{};const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};};

test('model failure projection preserves bounded diagnostic codes and HTTP status without private provider text',async()=>{
  async function* input():AsyncIterable<StreamChunk>{yield {type:'finish',reason:{kind:'error',failure:{code:'PROVIDER_ERROR',status:503,message:'PRIVATE_PROVIDER_SENTINEL'}},replayState:{response:'PRIVATE_REPLAY_SENTINEL'}};}
  const chunks=[];for await(const chunk of visibleStream(input()))chunks.push(chunk);
  assert.deepEqual(chunks,[{type:'finish',reason:{kind:'error',failure:{code:'PROVIDER_ERROR',status:503,message:'Model did not complete'}}}]);assert.ok(!JSON.stringify(chunks).includes('PRIVATE_'));
});

test('self-exploration interest needs three Runs, promotion keeps the current output valid and adopted context survives restart',async()=>{
  const directory=await root(),script=flow();let h:H,taskId='';
  const spec=extension(context=>script.action(h,context));h=await executionHarness(directory,()=>script.response(),spec);
  try{const {port,first,use,published}=await completeAdoption(h,script);taskId=first.task.id;
    const records=manifests(directory);assert.equal(records.length,3);assert.equal(records[0]?.stageStatus,'empty');assert.equal(records[0]?.entries.length,0);
    for(const record of records.slice(1)){assert.equal(record.schemaVersion,2);if(record.schemaVersion!==2)throw new Error('Expected v2 trial manifest');
      assert.equal(record.entries.length,0);assert.equal(record.trialEntries.length,1);assert.equal(record.trialEntries[0]?.candidate.version,2);}
    assert.notEqual(port.status(use.run).result?.sessionId,port.status(first.run).result?.sessionId);assert.ok(port.status(published.run).result);
    const next=port.submitTask({requestId:'continue',taskId,expectedVersion:1,policyId:'test-policy'},first.task);await h.core.whenIdle();assert.equal(port.status(next.run).state,'completed');
    assert.ok(JSON.stringify(h.adapter.requests.at(-1)?.messages).includes(interest));
    const current=manifests(directory).at(-1);assert.ok(current);assert.equal(current.stageStatus,'selected');assert.equal(current.entries.length,1);assert.equal(current.entries[0]?.candidate.version,3);
    assert.equal(current.schemaVersion,2);if(current.schemaVersion===2){assert.equal(current.trialEntries.length,0);assert.equal(current.entries[0]?.adoption.maturity,'tentative');}
  }finally{await h.close();}
  h=await executionHarness(directory,()=>textReply('重启续接'),spec,false);try{const task=h.port.openTask(taskId),next=h.port.submitTask({requestId:'restart',taskId,expectedVersion:1,policyId:'test-policy'},task);await h.core.whenIdle();assert.equal(h.port.status(next.run).state,'completed');assert.ok(JSON.stringify(h.adapter.requests[0]?.messages).includes(interest));}finally{await h.close();}
});

test('a different task cannot obtain another task persona through the shared stage profile',async()=>{
  const script=flow();let h:H;h=await executionHarness(await root(),()=>script.response(),extension(context=>script.action(h,context)));
  try{await completeAdoption(h,script);const other=h.port.submitTask({...request,requestId:'other',goal:'一个独立任务'});await h.core.whenIdle();assert.equal(h.port.status(other.run).state,'completed');assert.ok(!JSON.stringify(h.adapter.requests.at(-1)?.messages).includes(interest));}finally{await h.close();}
});

test('read actions and cloned contexts cannot publish persona state',async()=>{
  let h:H,count=0;h=await executionHarness(await root(),()=>++count===1?call('fixture_persona',{}):textReply('拒绝越权'),extension(context=>{
    assert.throws(()=>h.memory.persona!.propose(context,proposed,'fixture'),/SCOPE_DENIED/);
    assert.throws(()=>h.memory.persona!.status({...context},'fixture'),/SCOPE_DENIED/);return {checked:true};},'read'));
  try{const accepted=h.port.submitTask(request);await h.core.whenIdle();assert.equal(h.port.status(accepted.run).state,'completed');assert.equal(h.core.journal.executionEvents('dafeiyu',accepted.task.id).filter(event=>event.type==='persona.proposed').length,0);}finally{await h.close();}
});

test('publish rollback leaves no new Decision or selection, and retries retain the exact request identity',async()=>{
  const directory=await root(),script=flow();let h:H;h=await executionHarness(directory,()=>script.response(),extension(context=>{
    const persona=h.memory.persona!;assert.ok(context.taskId);
    if(script.phase==='prepare'){const result=script.action(h,context),input={...proposed,requestId:context.taskId+'-candidate'};
      assert.equal(persona.propose(context,input,'fixture').id,script.trials.get(context.taskId)?.id);
      assert.throws(()=>persona.propose(context,{...input,text:'同一请求改参数'},'fixture'),/IDEMPOTENCY_CONFLICT/);return result;}
    const trial=script.trials.get(context.taskId);assert.ok(trial);const review=reviewAdoption(h,context,trial);
    const publish={requestId:'publish',expectedStageVersion:0,entries:[{...trial,review:review.review}]};
    const db=new DatabaseSync(join(directory,'memory/memory.sqlite'));try{const before=personaCounts(db);assert.equal(before.persona_adoption_decisions,1);
      db.exec("CREATE TRIGGER fixture_fail_publish BEFORE INSERT ON persona_outbox WHEN json_extract(NEW.body,'$.type')='persona.published' BEGIN SELECT RAISE(ABORT,'fixture');END;");
      assert.throws(()=>persona.publish(context,publish,'fixture'),/fixture/);assert.deepEqual(personaCounts(db),before);
      assert.equal(persona.status(context,'fixture').stageRevision,0);assert.equal(persona.status(context,'fixture').selectionVersion,0);assert.equal(persona.status(context,'fixture').trialSelectionVersion,1);assert.equal(persona.status(context,'fixture').candidates[0]?.state,'trial');
      db.exec('DROP TRIGGER fixture_fail_publish');const first=persona.publish(context,publish,'fixture'),after=personaCounts(db),again=persona.publish(context,publish,'fixture');
      assert.deepEqual(again,first);assert.deepEqual(personaCounts(db),after);assert.equal(after.persona_adoption_decisions,2);return first;
    }finally{db.close();}}));
  try{await completeAdoption(h,script);}finally{await h.close();}
});

test('withdrawal during a Run preserves the write receipt but prevents a result using the old persona',async()=>{
  const script=flow();let h:H;
  h=await executionHarness(await root(),()=>script.response(),extension(context=>{
    if(script.phase!=='withdraw')return script.action(h,context);
    assert.ok(context.taskId);const trial=script.trials.get(context.taskId);assert.ok(trial);
    return h.memory.persona!.withdraw(context,{requestId:'withdraw',id:trial.id,expectedVersion:3,reason:'撤下当前认识'},'fixture');}));
  try{const {first,port}=await completeAdoption(h,script);script.set('withdraw');const next=port.submitTask({requestId:'next',taskId:first.task.id,expectedVersion:1,policyId:'test-policy'},first.task);await h.core.whenIdle();const status=port.status(next.run);
    assert.equal(status.state,'failed');assert.equal(status.result,null);assert.equal(status.operations[0]?.effects,'confirmed');assert.equal(status.operations[0]?.status,'succeeded');
  }finally{await h.close();}
});

test('deleting a source during generation blocks its result and restoring does not revive the old candidate',async()=>{
  const directory=await root(),entered=deferred(),release=deferred(),script=flow();let h:H,waiting=false;
  h=await executionHarness(directory,async()=>{if(waiting){entered.resolve();await release.promise;return textReply('不能提交的旧认识');}return script.response();},extension(context=>script.action(h,context)));
  try{const {first,port}=await completeAdoption(h,script);waiting=true;const next=port.submitTask({requestId:'next',taskId:first.task.id,expectedVersion:1,policyId:'test-policy'},first.task);await entered.promise;
    const db=new DatabaseSync(join(directory,'memory/memory.sqlite'));try{db.exec('UPDATE execution_sources SET deleted=1,state_version=state_version+1');}finally{db.close();}release.resolve();await h.core.whenIdle();assert.equal(h.port.status(next.run).state,'failed');assert.equal(h.port.status(next.run).result,null);
    const restore=new DatabaseSync(join(directory,'memory/memory.sqlite'));try{restore.exec('UPDATE execution_sources SET deleted=0,state_version=state_version+1');}finally{restore.close();}
    waiting=false;const after=port.submitTask({requestId:'after-restore',taskId:first.task.id,expectedVersion:1,policyId:'test-policy'},first.task);await h.core.whenIdle();assert.equal(port.status(after.run).state,'completed');assert.ok(!JSON.stringify(h.adapter.requests.at(-1)?.messages).includes(interest));assert.equal(manifests(directory).at(-1)?.entries.length,0);
  }finally{release.resolve();await h.close();}
});

test('conversation growth uses a real scoped memory reference and is excluded from a different room',async()=>{
  const script=flow(),applicability='仅用于虚构材料的暂定判断';let h:H,step=0,reference:PersonaSourceRef|undefined,trial:PersonaEntryRef|undefined;
  h=await executionHarness(await root(),()=>{if(script.phase==='prepare'){step++;if(step===1)return call('fixture_seed',{});if(step===2)return call('fixture_persona',{});return textReply('已选择暂定材料，尚未在后续消息中试行。');}return script.response();},extension(context=>{
    if(script.phase==='publish'){assert.ok(trial);return publishTrial(h,context,trial,'conversation-',applicability);}
    assert.ok(reference);const persona=h.memory.persona!,candidate=persona.proposeReference(context,{requestId:'reference-candidate',kind:'view',contentRef:reference,supports:[reference],counters:[],applicability,reason:'保留原始材料来源，尚未独立核实'},'fixture');
    const reviewed=persona.review(context,{requestId:'trial',id:candidate.id,expectedVersion:1,state:'trial',reason:'准备在独立消息中实际试行'},'fixture');trial={id:reviewed.id,version:reviewed.version};
    return persona.selectTrial(context,{requestId:'conversation-trial-select',expectedSelectionVersion:0,entries:[{candidate:trial,applicability,exitConditions:['来源撤回或更正时停止']} ]},'fixture');}),true,{compaction:{inputTokens:32768}});
  try{await h.ctx.plugin(Simulator,{agentId:'dafeiyu',account:'local'});h.core.registerExtension({id:'seed',version:'1',agentId:'dafeiyu',apiVersion:2,actions:[{name:'fixture_seed',description:'虚构材料入库',fields:{},execute:async(_raw,context)=>{
      const scope=h.core.scopeFor(context),accepted=h.core.journal.events(scope.route).find(event=>event.traceId===scope.traceId&&event.type==='message.accepted')!;
      const receipt=z.object({status:z.literal('ok'),id:z.string(),revision:z.number(),version:z.number()}).parse(await h.memory.create(context,{requestId:'source',kind:'knowledge',claimType:'reported_claim',content:'虚构材料声明青灯开关为蓝色',sourceRefs:[`dafeiyu:source:${accepted.id}:0`]}));
      const opened=z.object({status:z.literal('ok'),item:z.object({contentHash:z.string()})}).parse(h.memory.read(context,{id:receipt.id}));
      reference={kind:'memory',id:receipt.id,revision:receipt.revision,version:receipt.version,agentId:'dafeiyu',scopeKey:scope.route,contentHash:opened.item.contentHash};return {id:receipt.id};}}]});
    const first=h.ctx.dafeiyuSimulator.send('a','虚构材料声明青灯开关为蓝色',{id:'source-message'});await h.core.whenIdle();assert.equal(h.core.journal.get(first.id).state,'delivered');
    script.set('use');const use=h.ctx.dafeiyuSimulator.send('a','把暂定判断用于一次虚构文字比较',{id:'trial-use'});await h.core.whenIdle();assert.equal(h.core.journal.get(use.id).state,'delivered');
    assert.ok(JSON.stringify(h.adapter.requests.at(-1)?.messages).includes('stage-persona-trial'));
    script.set('publish');const publish=h.ctx.dafeiyuSimulator.send('a','根据刚才的有限试行作采用复核',{id:'adoption-review'});await h.core.whenIdle();assert.equal(h.core.journal.get(publish.id).state,'delivered');
    script.set('ordinary');const next=h.ctx.dafeiyuSimulator.send('a','继续讨论虚构材料',{id:'next'});await h.core.whenIdle();assert.equal(h.core.journal.get(next.id).state,'delivered');
    const latest=JSON.stringify(h.adapter.requests.at(-1)?.messages);assert.ok(latest.includes('stage-persona'));assert.ok(latest.includes('青灯开关'));
    h.ctx.dafeiyuSimulator.send('b','另一个范围',{id:'other'});await h.core.whenIdle();assert.ok(!JSON.stringify(h.adapter.requests.at(-1)?.messages).includes('青灯开关'));
  }finally{await h.close();}
});

test('rapid repeated model calls still yield to explicit cancellation without a call-count cap',async()=>{
  const entered=deferred();let calls=0;const h=await executionHarness(await root(),()=>call('fixture_persona',{}),extension(()=>{calls++;entered.resolve();return {again:true};}));
  try{const accepted=h.port.submitTask(request);await entered.promise;await new Promise<void>(resolve=>setTimeout(resolve,20));h.port.cancel(accepted.run,{requestId:'stop',expectedVersion:h.port.status(accepted.run).version,reason:'验证取消能收到'});
    await h.core.whenIdle();assert.equal(h.port.status(accepted.run).state,'cancelled');assert.ok(calls>=1);
  }finally{await h.close();}
});

test('publishing an unrelated task stage revision does not invalidate the already admitted task context',async()=>{
  const entered=deferred(),release=deferred(),script=flow();let h:H,waitingTask='';
  h=await executionHarness(await root(),async options=>{
    const current=options.messages.findLast(message=>message.source?.kind==='dafeiyu-execution');
    if(current?.source?.kind==='dafeiyu-execution'&&current.source.taskId===waitingTask){entered.resolve();await release.promise;return textReply('原任务正常完成');}
    return script.response();
  },extension(context=>script.action(h,context)));
  try{const {first,port}=await completeAdoption(h,script),otherPrepared=await prepareAndUse(h,script,'other');
    script.set('ordinary');waitingTask=first.task.id;const running=port.submitTask({requestId:'waiting',taskId:first.task.id,expectedVersion:1,policyId:'test-policy'},first.task);await entered.promise;
    script.set('publish');const other=otherPrepared.port.submitTask({requestId:'other-publish',taskId:otherPrepared.first.task.id,expectedVersion:1,policyId:'test-policy'},otherPrepared.first.task);
    const deadline=Date.now()+5000;while(!['completed','failed'].includes(otherPrepared.port.status(other.run).state)&&Date.now()<deadline)await new Promise<void>(resolve=>setTimeout(resolve,5));
    assert.equal(otherPrepared.port.status(other.run).state,'completed');release.resolve();await h.core.whenIdle();assert.equal(port.status(running.run).state,'completed');
  }finally{release.resolve();await h.close();}
});

test('a rejected persona transaction reports no effects and a corrected distinct request can proceed',async()=>{
  let step=0,candidateId='';const h=await executionHarness(await root(),options=>{
    for(const message of options.messages)if(message.role==='tool')for(const block of message.content)if(block.type==='text'){
      try{const parsed=z.object({data:z.object({id:z.string()})}).safeParse(JSON.parse(block.text));if(parsed.success)candidateId=parsed.data.data.id;}catch{/* Only fixture receipts matter. */}}
    step++;if(step===1)return call('dafeiyu_persona_propose',{...proposed,requestId:'same'});
    if(step===2||step===3)return call('dafeiyu_persona_review',{requestId:step===2?'same':'corrected',id:candidateId,expectedVersion:1,state:'trial',reason:'明确试行'});
    return textReply('已根据实际回执处理');
  },undefined,true,{personaActions:true});
  try{const accepted=h.port.submitTask(request);await h.core.whenIdle();const status=h.port.status(accepted.run);assert.equal(status.state,'completed');assert.deepEqual(status.operations.map(op=>[op.status,op.effects]),[['succeeded','confirmed'],['failed','none'],['succeeded','confirmed']]);}finally{await h.close();}
});

test('an unknown local effect blocks repeated writes under a different requestId in the same Run',async()=>{
  let count=0,step=0;const h=await executionHarness(await root(),()=>++step<=2?call('fixture_unknown',{requestId:step===1?'first':'different'}):textReply('操作效果仍未知，停止重复写入'),{
    id:'fixture',version:'1',actions:[{id:'fixture_unknown',version:'1',description:'虚构未知操作',effects:'local-write',inputSchema:z.strictObject({requestId:z.string()}),outputSchema:z.null(),execute:async()=>{count++;return {status:'unknown',effects:'unknown',completeness:'unknown',data:null,sources:[],receipts:[]};}}]});
  try{const accepted=h.port.submitTask(request);await h.core.whenIdle();const status=h.port.status(accepted.run);assert.equal(status.state,'completed');assert.equal(count,1);assert.equal(status.operations.length,1);assert.equal(status.operations[0]?.effects,'unknown');}finally{await h.close();}
});
