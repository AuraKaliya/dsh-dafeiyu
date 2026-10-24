import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { testTempDir as tmpdir } from './test-temp.js';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { ExecutionContextV3 } from '@dafeiyu/contracts';
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
function adopt(h:H,context:ExecutionContextV3,prefix=''){const persona=h.memory.persona!;
  const candidate=persona.propose(context,{...proposed,requestId:prefix+proposed.requestId},'fixture'),reviewed=persona.review(context,{requestId:prefix+'review',id:candidate.id,expectedVersion:candidate.version,state:'trial',reason:'保留暂定性质，进入试行'},'fixture');
  const published=persona.publish(context,{requestId:prefix+'publish',expectedStageVersion:persona.status(context,'fixture').stageRevision,entries:[{id:reviewed.id,version:reviewed.version}]},'fixture');return {candidate,published};}
function manifests(root:string){const db=new DatabaseSync(join(root,'core/runtime.sqlite'),{readOnly:true});try{return db.prepare('SELECT body FROM run_persona_manifests ORDER BY rowid').all().map(row=>JSON.parse(String(row.body)));}finally{db.close();}}
const deferred=()=>{let resolve=()=>{};const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};};

test('model failure projection preserves bounded diagnostic codes and HTTP status without private provider text',async()=>{
  async function* input():AsyncIterable<StreamChunk>{yield {type:'finish',reason:{kind:'error',failure:{code:'PROVIDER_ERROR',status:503,message:'PRIVATE_PROVIDER_SENTINEL'}},replayState:{response:'PRIVATE_REPLAY_SENTINEL'}};}
  const chunks=[];for await(const chunk of visibleStream(input()))chunks.push(chunk);
  assert.deepEqual(chunks,[{type:'finish',reason:{kind:'error',failure:{code:'PROVIDER_ERROR',status:503,message:'Model did not complete'}}}]);assert.ok(!JSON.stringify(chunks).includes('PRIVATE_'));
});

test('an explicit candidate is trialled and adopted atomically, becomes context next Run and survives restart',async()=>{
  const directory=await root();let step=0,h:H;let taskId='',firstSession='';
  const spec=extension(context=>adopt(h,context));h=await executionHarness(directory,()=>++step===1?call('fixture_persona',{}):textReply('已采用虚构候选'),spec);
  try{const accepted=h.port.submitTask(request);await h.core.whenIdle();assert.equal(h.port.status(accepted.run).state,'completed');taskId=accepted.task.id;firstSession=h.port.status(accepted.run).result!.sessionId;
    const records=manifests(directory);assert.equal(records[0].stageStatus,'empty');assert.equal(records[0].entries.length,0);
    const next=h.port.submitTask({requestId:'continue',taskId,expectedVersion:1,policyId:'test-policy'},accepted.task);await h.core.whenIdle();assert.equal(h.port.status(next.run).state,'completed');
    assert.notEqual(h.port.status(next.run).result?.sessionId,firstSession);assert.ok(JSON.stringify(h.adapter.requests.at(-1)?.messages).includes(interest));
    const current=manifests(directory).at(-1);assert.equal(current.stageStatus,'selected');assert.equal(current.entries.length,1);assert.equal(current.entries[0].candidate.version,3);
  }finally{await h.close();}
  h=await executionHarness(directory,()=>textReply('重启续接'),spec,false);try{const task=h.port.openTask(taskId),next=h.port.submitTask({requestId:'restart',taskId,expectedVersion:1,policyId:'test-policy'},task);await h.core.whenIdle();assert.equal(h.port.status(next.run).state,'completed');assert.ok(JSON.stringify(h.adapter.requests[0]?.messages).includes(interest));}finally{await h.close();}
});

test('a different task cannot obtain another task persona through the shared stage profile',async()=>{
  let h:H,step=0;h=await executionHarness(await root(),()=>++step===1?call('fixture_persona',{}):textReply('内部完成'),extension(context=>adopt(h,context)));
  try{h.port.submitTask(request);await h.core.whenIdle();const other=h.port.submitTask({...request,requestId:'other',goal:'一个独立任务'});await h.core.whenIdle();assert.equal(h.port.status(other.run).state,'completed');assert.ok(!JSON.stringify(h.adapter.requests.at(-1)?.messages).includes(interest));}finally{await h.close();}
});

test('read actions and cloned contexts cannot publish persona state',async()=>{
  let h:H,count=0;h=await executionHarness(await root(),()=>++count===1?call('fixture_persona',{}):textReply('拒绝越权'),extension(context=>{
    assert.throws(()=>h.memory.persona!.propose(context,proposed,'fixture'),/SCOPE_DENIED/);
    assert.throws(()=>h.memory.persona!.status({...context},'fixture'),/SCOPE_DENIED/);return {checked:true};},'read'));
  try{const accepted=h.port.submitTask(request);await h.core.whenIdle();assert.equal(h.port.status(accepted.run).state,'completed');assert.equal(h.core.journal.executionEvents('dafeiyu',accepted.task.id).filter(event=>event.type==='persona.proposed').length,0);}finally{await h.close();}
});

test('publish failure rolls back candidate, stage and scene selection; retries preserve request identity',async()=>{
  const directory=await root();let h:H,step=0;h=await executionHarness(directory,()=>++step===1?call('fixture_persona',{}):textReply('事务检查结束'),extension(context=>{
    const persona=h.memory.persona!,candidate=persona.propose(context,proposed,'fixture');assert.equal(persona.propose(context,proposed,'fixture').id,candidate.id);
    assert.throws(()=>persona.propose(context,{...proposed,text:'同一请求改参数'},'fixture'),/IDEMPOTENCY_CONFLICT/);
    const reviewed=persona.review(context,{requestId:'review',id:candidate.id,expectedVersion:1,state:'trial',reason:'试行'},'fixture'),publish={requestId:'publish',expectedStageVersion:0,entries:[{id:reviewed.id,version:reviewed.version}]};
    const db=new DatabaseSync(join(directory,'memory/memory.sqlite'));try{db.exec("CREATE TRIGGER fixture_fail_publish BEFORE INSERT ON persona_outbox WHEN json_extract(NEW.body,'$.type')='persona.published' BEGIN SELECT RAISE(ABORT,'fixture');END;");
      assert.throws(()=>persona.publish(context,publish,'fixture'),/fixture/);assert.equal(persona.status(context,'fixture').stageRevision,0);assert.equal(persona.status(context,'fixture').selectionVersion,0);assert.equal(persona.status(context,'fixture').candidates[0]?.state,'trial');
      db.exec('DROP TRIGGER fixture_fail_publish');const first=persona.publish(context,publish,'fixture'),again=persona.publish(context,publish,'fixture');assert.deepEqual(again,first);return first;
    }finally{db.close();}}));
  try{const accepted=h.port.submitTask(request);await h.core.whenIdle();assert.equal(h.port.status(accepted.run).state,'completed');}finally{await h.close();}
});

test('withdrawal during a Run preserves the write receipt but prevents a result using the old persona',async()=>{
  let h:H,mode:'adopt'|'withdraw'='adopt',step=0,candidateId='';
  h=await executionHarness(await root(),()=>++step===1||mode==='withdraw'?call('fixture_persona',{}):textReply('采用结束'),extension(context=>{
    if(mode==='adopt'){const value=adopt(h,context);candidateId=value.candidate.id;return value;}
    return h.memory.persona!.withdraw(context,{requestId:'withdraw',id:candidateId,expectedVersion:3,reason:'撤下当前认识'},'fixture');}));
  try{const first=h.port.submitTask(request);await h.core.whenIdle();mode='withdraw';const next=h.port.submitTask({requestId:'next',taskId:first.task.id,expectedVersion:1,policyId:'test-policy'},first.task);await h.core.whenIdle();const status=h.port.status(next.run);
    assert.equal(status.state,'failed');assert.equal(status.result,null);assert.equal(status.operations[0]?.effects,'confirmed');assert.equal(status.operations[0]?.status,'succeeded');
  }finally{await h.close();}
});

test('deleting a source during generation blocks its result and restoring does not revive the old candidate',async()=>{
  const directory=await root(),entered=deferred(),release=deferred();let h:H,step=0,waiting=false;
  h=await executionHarness(directory,async()=>{if(waiting){entered.resolve();await release.promise;return textReply('不能提交的旧认识');}return ++step===1?call('fixture_persona',{}):textReply('已采用');},extension(context=>adopt(h,context)));
  try{const first=h.port.submitTask(request);await h.core.whenIdle();waiting=true;const next=h.port.submitTask({requestId:'next',taskId:first.task.id,expectedVersion:1,policyId:'test-policy'},first.task);await entered.promise;
    const db=new DatabaseSync(join(directory,'memory/memory.sqlite'));try{db.exec('UPDATE execution_sources SET deleted=1,state_version=state_version+1');}finally{db.close();}release.resolve();await h.core.whenIdle();assert.equal(h.port.status(next.run).state,'failed');assert.equal(h.port.status(next.run).result,null);
    const restore=new DatabaseSync(join(directory,'memory/memory.sqlite'));try{restore.exec('UPDATE execution_sources SET deleted=0,state_version=state_version+1');}finally{restore.close();}
    const after=h.port.submitTask({requestId:'after-restore',taskId:first.task.id,expectedVersion:1,policyId:'test-policy'},first.task);await h.core.whenIdle();assert.equal(h.port.status(after.run).state,'completed');assert.ok(!JSON.stringify(h.adapter.requests.at(-1)?.messages).includes(interest));assert.equal(manifests(directory).at(-1).entries.length,0);
  }finally{release.resolve();await h.close();}
});

test('conversation growth uses a real scoped memory reference and is excluded from a different room',async()=>{
  let h:H,step=0,reference:PersonaSourceRef|undefined;
  h=await executionHarness(await root(),()=>++step===1?call('fixture_seed',{}):step===2?call('fixture_persona',{}):textReply('已记录虚构材料'),extension(context=>{
    const persona=h.memory.persona!,candidate=persona.proposeReference(context,{requestId:'reference-candidate',kind:'view',contentRef:reference,supports:[reference],counters:[],applicability:'仅用于虚构材料的暂定判断',reason:'保留原始材料来源，尚未独立核实'},'fixture');
    const trial=persona.review(context,{requestId:'trial',id:candidate.id,expectedVersion:1,state:'trial',reason:'暂定采用'},'fixture');return persona.publish(context,{requestId:'adopt',expectedStageVersion:0,entries:[{id:trial.id,version:trial.version}]},'fixture');}),true,{compaction:{inputTokens:32768}});
  try{await h.ctx.plugin(Simulator,{agentId:'dafeiyu',account:'local'});h.core.registerExtension({id:'seed',version:'1',agentId:'dafeiyu',apiVersion:2,actions:[{name:'fixture_seed',description:'虚构材料入库',fields:{},execute:async(_raw,context)=>{
      const scope=h.core.scopeFor(context),accepted=h.core.journal.events(scope.route).find(event=>event.traceId===scope.traceId&&event.type==='message.accepted')!;
      const receipt=z.object({status:z.literal('ok'),id:z.string(),revision:z.number(),version:z.number()}).parse(await h.memory.create(context,{requestId:'source',kind:'knowledge',claimType:'reported_claim',content:'虚构材料声明青灯开关为蓝色',sourceRefs:[`dafeiyu:source:${accepted.id}:0`]}));
      const opened=z.object({status:z.literal('ok'),item:z.object({contentHash:z.string()})}).parse(h.memory.read(context,{id:receipt.id}));
      reference={kind:'memory',id:receipt.id,revision:receipt.revision,version:receipt.version,agentId:'dafeiyu',scopeKey:scope.route,contentHash:opened.item.contentHash};return {id:receipt.id};}}]});
    const first=h.ctx.dafeiyuSimulator.send('a','虚构材料声明青灯开关为蓝色',{id:'source-message'});await h.core.whenIdle();assert.equal(h.core.journal.get(first.id).state,'delivered');
    const next=h.ctx.dafeiyuSimulator.send('a','继续讨论虚构材料',{id:'next'});await h.core.whenIdle();assert.equal(h.core.journal.get(next.id).state,'delivered');
    assert.ok(h.adapter.requests.at(-1)?.messages.some(message=>message.content.some(block=>block.type==='text'&&block.text.includes('stage-persona'))));
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
  const entered=deferred(),release=deferred(),calls=new Map<string,number>();let h:H,waitingTask='';
  h=await executionHarness(await root(),async options=>{
    const current=options.messages.findLast(message=>message.source?.kind==='dafeiyu-execution');
    if(current?.source?.kind==='dafeiyu-execution'&&current.source.taskId===waitingTask){entered.resolve();await release.promise;return textReply('原任务正常完成');}
    const key=options.sessionId??'',count=(calls.get(key)??0)+1;calls.set(key,count);return count===1?call('fixture_persona',{}):textReply('独立采用完成');
  },extension(context=>adopt(h,context,`${context.taskId}-`)));
  try{const first=h.port.submitTask(request);await h.core.whenIdle();waitingTask=first.task.id;const running=h.port.submitTask({requestId:'waiting',taskId:first.task.id,expectedVersion:1,policyId:'test-policy'},first.task);await entered.promise;
    const other=h.port.submitTask({...request,requestId:'other'});const deadline=Date.now()+5000;while(!['completed','failed'].includes(h.port.status(other.run).state)&&Date.now()<deadline)await new Promise<void>(resolve=>setTimeout(resolve,5));
    assert.equal(h.port.status(other.run).state,'completed');release.resolve();await h.core.whenIdle();assert.equal(h.port.status(running.run).state,'completed');
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
