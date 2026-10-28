import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { testTempDir as tmpdir } from './test-temp.js';
import { join } from 'node:path';
import { z } from 'zod';
import { MessageSchema } from '@dafeiyu/contracts';
import type { ExecutionContext,Extension } from '@dafeiyu/contracts';
import { SessionId } from '@deepseek-ai/dsh-session';
import { executionHarness } from './execution-fixture.js';
import { call,textReply } from './harness.js';
import { RuntimeStore } from '@dafeiyu/core/runtime-store';

const request={requestId:'fixture',title:'虚构任务',goal:'完成本机虚构操作',policyId:'test-policy'};
const deferred=()=>{let resolve=()=>{};const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};};
const root=()=>mkdtemp(join(tmpdir(),'dafeiyu-execution-boundary-'));
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
const success={status:'succeeded' as const,effects:'none' as const,completeness:'complete' as const,data:{value:1},sources:[],receipts:[]};

test('a native timeline action only observes its current task and ordinary timelines cannot read it',async()=>{
  let step=0;const h=await executionHarness(await root(),()=>++step===1?textReply('首任务完成'):step===2?call('dafeiyu_execution_events',{limit:30}):textReply('已读取当前任务事件'),undefined,true,{timelineExecution:true});
  try{const first=h.port.submitTask(request);await h.core.whenIdle();const second=h.port.submitTask({...request,requestId:'second'});await h.core.whenIdle();
    const status=h.port.status(second.run);assert.equal(status.state,'completed');assert.ok(status.result);assert.equal(status.operations[0]?.action,'dafeiyu_execution_events');
    const reader=await h.ctx.sessionPersistence.open(SessionId(status.result.sessionId),'read');try{const {events}=await reader.read();const output=events.find(event=>event.type==='tool/result');assert.ok(output);
      const text=JSON.stringify(output);assert.ok(text.includes('dafeiyu:execution-event:'));assert.ok(text.includes(second.task.id));assert.ok(!text.includes(first.task.id));
    }finally{await reader.close();}
    const scope=h.core.journal.executionEvents('dafeiyu',second.task.id)[0]!.route;assert.deepEqual(h.core.journal.events(scope),[]);
  }finally{await h.close();}
});

test('v3 channel-only extensions use the existing reply ledger and revoke their ingress handle',async()=>{
  const h=await executionHarness(await root(),undefined,undefined,true,{});const sent:string[]=[];
  try{const spec:Extension={protocolVersion:4,id:'v3-channel',version:'1',agentId:'dafeiyu',channels:[{channel:'fixture-v3',account:'local',deliveryValidation:'per-segment',deliver:async(reply,_signal,authority)=>{assert.equal(typeof authority,'function');authority!();sent.push(reply.text);return {status:'sent',receiptId:'fixture-receipt'};}}]};
    const handle=h.core.registerExtension(spec);assert.ok(handle.ingest);const input=MessageSchema.parse({id:'one',occurredAt:new Date().toISOString(),conversation:{channel:'fixture-v3',account:'local',kind:'local',id:'room'},sender:{id:'fictional-user',displayName:'虚构用户'},text:'执行普通聊天'});
    const accepted=handle.ingest(input);await h.core.whenIdle();assert.equal(h.core.journal.get(accepted.id).state,'delivered');assert.equal(sent.length,1);assert.equal(h.core.getStatus().extensions.filter(id=>id==='v3-channel').length,1);
    assert.throws(()=>handle.ingest!({...input,id:'two',conversation:{...input.conversation,account:'foreign'}}),/SCOPE_DENIED/);
    handle.dispose();const replacement=h.core.registerExtension(spec);assert.throws(()=>handle.ingest!({...input,id:'two'}),/CAPABILITY_UNAVAILABLE/);replacement.dispose();
  }finally{await h.close();}
});

test('unloading an action signals cancellation and a same-name replacement cannot revive the old context',async()=>{
  const entered=deferred();let captured:ExecutionContext|undefined;
  const spec={id:'fixture',version:'1',actions:[{id:'fixture_wait',version:'1',description:'等待取消',effects:'read' as const,inputSchema:z.strictObject({}),outputSchema:z.strictObject({value:z.number()}),
    execute:async(_input:unknown,context:ExecutionContext)=>{captured=context;entered.resolve();await new Promise<void>(resolve=>context.signal.addEventListener('abort',()=>resolve(),{once:true}));return success;}}]};
  const h=await executionHarness(await root(),()=>call('fixture_wait',{}),spec);
  try{const run=h.port.submitTask(request);await entered.promise;h.extensionHandle!.dispose();h.core.registerExtension({...spec,protocolVersion:4,agentId:'dafeiyu'});await h.core.whenIdle();
    assert.equal(captured?.signal.aborted,true);assert.throws(()=>h.core.executionAuthority(captured!,'fixture'),/SCOPE_DENIED/);assert.notEqual(h.port.status(run.run).state,'completed');assert.equal(h.port.status(run.run).operations[0]?.status,'succeeded');
  }finally{await h.close();}
});

test('cancellation with an unknown write outcome ends interrupted and cannot resume or replay it',async()=>{
  const entered=deferred(),release=deferred();let count=0;const h=await executionHarness(await root(),()=>call('fixture_write',{}),{id:'fixture',version:'1',actions:[{id:'fixture_write',version:'1',description:'虚构未知写入',effects:'local-write',inputSchema:z.strictObject({}),outputSchema:z.null(),
    execute:async()=>{count++;entered.resolve();await release.promise;return {status:'unknown',effects:'unknown',completeness:'unknown',data:null,sources:[],receipts:[]};}}]});
  try{const accepted=h.port.submitTask(request);await entered.promise;h.port.cancel(accepted.run,{requestId:'cancel',expectedVersion:h.port.status(accepted.run).version,reason:'取消演练'});await tick();assert.equal(h.port.status(accepted.run).state,'cancelling');
    release.resolve();await h.core.whenIdle();const status=h.port.status(accepted.run);assert.equal(status.state,'interrupted');assert.equal(status.operations[0]?.effects,'unknown');
    assert.throws(()=>h.port.resume(accepted.task,{requestId:'resume',taskId:accepted.task.id,expectedVersion:1,policyId:'test-policy',parentRunId:accepted.run.id,checkpointId:status.checkpoints[0]}),/OPERATION_UNCERTAIN/);assert.equal(count,1);
  }finally{release.resolve();await h.close();}
});

test('lost execution outbox acknowledgement is repaired with one event identity after restart',async()=>{
  const directory=await root();let h=await executionHarness(directory);const original=RuntimeStore.prototype.acknowledgeEvent;
  try{RuntimeStore.prototype.acknowledgeEvent=function(){throw new Error('FIXTURE_ACK_LOST');};assert.throws(()=>h.port.submitTask(request),/FIXTURE_ACK_LOST/);}
  finally{RuntimeStore.prototype.acknowledgeEvent=original;await h.close();}
  h=await executionHarness(directory,undefined,undefined,false);try{await h.core.whenIdle();const accepted=h.port.submitTask(request);const events=h.core.journal.executionEvents('dafeiyu',accepted.task.id);assert.equal(events.filter(event=>event.type==='run.accepted').length,1);assert.equal(h.port.status(accepted.run).state,'completed');assert.equal(h.adapter.requests.filter(value=>String(value.sessionId).startsWith('dafeiyu-task-')).length,1);assert.equal(h.adapter.requests.filter(value=>String(value.sessionId).startsWith('dafeiyu-assessment-')).length,1);}finally{await h.close();}
});

test('restored result content is verified and a later task epoch cannot read the old result as current',async()=>{
  const directory=await root();let h=await executionHarness(directory,()=>textReply('可核的内部结果'));let id='',taskId='';
  try{const accepted=h.port.submitTask(request);await h.core.whenIdle();id=accepted.run.id;taskId=accepted.task.id;assert.equal(await h.port.readResult(accepted.run),'可核的内部结果');}finally{await h.close();}
  h=await executionHarness(directory,undefined,undefined,false);try{const ref=h.port.restoreRun(id);assert.equal(await h.port.readResult(ref),'可核的内部结果');const task=h.port.openTask(taskId);h.port.updateTask(task,{requestId:'change',expectedVersion:1,goal:'另一个目标'});await assert.rejects(h.port.readResult(ref),/SOURCE_STALE/);}finally{await h.close();}
});
