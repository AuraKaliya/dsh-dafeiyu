import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { testTempDir as tmpdir } from './test-temp.js';
import { join } from 'node:path';
import { z } from 'zod';
import { SessionId } from '@deepseek-ai/dsh-session';
import { executionHarness } from './execution-fixture.js';
import { call,textReply } from './harness.js';
import type { ExecutionContextV3 } from '@dafeiyu/contracts';

const request={requestId:'first',title:'虚构内部任务',goal:'读取测试数字并给出内部结果',policyId:'test-policy'};
const fixture=(execute:(context:ExecutionContextV3)=>void)=>({id:'fixture',version:'1',actions:[{id:'fixture_read',version:'1',description:'读虚构的测试数字',effects:'read' as const,
  inputSchema:z.strictObject({amount:z.number().int().min(1).max(5)}),outputSchema:z.strictObject({value:z.number()}),
  execute:async(_raw:unknown,context:ExecutionContextV3)=>{execute(context);return {status:'succeeded' as const,effects:'none' as const,completeness:'complete' as const,data:{value:7},sources:[],receipts:[]};}}]});
function deferred(){let resolve=()=>{};const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));

test('native Task runs through real DSH without a channel, inbox, fake user source or delivery',async()=>{
  const root=await mkdtemp(join(tmpdir(),'dafeiyu-execution-'));let count=0,step=0,captured:ExecutionContextV3|undefined;
  const h=await executionHarness(root,()=>++step===1?call('fixture_read',{amount:2}):textReply('数字是7'),fixture(context=>{count++;captured=context;assert.equal(context.scope.kind,'task');h.core.executionAuthority(context,'fixture');assert.throws(()=>h.core.executionAuthority({...context},'fixture'),/SCOPE_DENIED/);assert.throws(()=>h.core.executionAuthority(context,'another'),/SCOPE_DENIED/);}));
  try{
    const accepted=h.port.submitTask(request);await h.core.whenIdle();const status=h.port.status(accepted.run);
    assert.equal(status.state,'completed');assert.equal(count,1);assert.equal(status.operations[0]?.status,'succeeded');assert.equal(h.core.journal.list().length,0);
    assert.ok(status.result);const reader=await h.ctx.sessionPersistence.open(SessionId(status.result.sessionId),'read');
    try{const {events}=await reader.read();const inputs=events.filter(event=>event.type==='user/message'&&event.data.source.kind==='dafeiyu-execution');assert.equal(inputs.length,1);
      assert.equal(events.some(event=>event.type==='user/message'&&event.data.source.kind==='user'),false);
    }finally{await reader.close();}
    assert.throws(()=>h.core.executionAuthority(captured!,'fixture'),/SCOPE_DENIED/);
    assert.equal(h.core.journal.events(captured!.scope.kind==='task'?captured!.scope.scopeKey:'').length,0);
    const events=h.core.journal.executionEvents('dafeiyu',accepted.task.id);assert.ok(events.some(e=>e.type==='operation.succeeded'));assert.ok(events.every(e=>e.visibility.kind==='task'));
  }finally{await h.close();}
});
test('accepted request is idempotent across restart, while cloned run handles and parameter changes are denied',async()=>{
  const root=await mkdtemp(join(tmpdir(),'dafeiyu-execution-restart-'));let id='';
  let h=await executionHarness(root);try{const a=h.port.submitTask(request),b=h.port.submitTask(request);assert.equal(a.run.id,b.run.id);assert.equal(a.task.id,b.task.id);
    assert.throws(()=>h.port.submitTask({...request,goal:'changed'}),/IDEMPOTENCY_CONFLICT/);assert.throws(()=>h.port.status({...a.run}),/SCOPE_DENIED/);await h.core.whenIdle();id=a.run.id;
  }finally{await h.close();}
  h=await executionHarness(root,()=>{throw new Error('must not replay');},undefined,false);try{const a=h.port.submitTask(request);assert.equal(a.run.id,id);assert.equal(h.port.status(a.run).state,'completed');await h.core.whenIdle();assert.equal(h.adapter.requests.length,0);}finally{await h.close();}
});
test('invalid structured arguments cannot call a native capability and no v2 tools enter the task',async()=>{
  const root=await mkdtemp(join(tmpdir(),'dafeiyu-execution-input-'));let count=0,step=0;
  const h=await executionHarness(root,options=>{assert.equal(options.tools?.some(t=>t.name==='memory_create'),false);return ++step===1?call('fixture_read',{amount:3,scopeKey:'fake'}):textReply('输入被拒绝');},fixture(()=>{count++;}));
  try{const a=h.port.submitTask(request);await h.core.whenIdle();assert.equal(h.port.status(a.run).state,'completed');assert.equal(count,0);assert.equal(h.port.status(a.run).operations.length,0);}finally{await h.close();}
});
test('independent tasks overlap while repeated runs of one task remain serialized',async()=>{
  const root=await mkdtemp(join(tmpdir(),'dafeiyu-execution-concurrency-')),first=deferred(),second=deferred(),release=deferred();
  let entered=0;const h=await executionHarness(root,async options=>{entered++;if(entered===1){first.resolve();await release.promise;}else second.resolve();return textReply('完成');});
  try{const a=h.port.submitTask(request);await first.promise;
    const queued=h.port.submitTask({requestId:'same-task-next',taskId:a.task.id,expectedVersion:1,policyId:'test-policy'},a.task);
    const b=h.port.submitTask({...request,requestId:'independent'});await second.promise;
    assert.equal(h.port.status(queued.run).state,'accepted');assert.notEqual(a.task.id,b.task.id);release.resolve();await h.core.whenIdle();assert.equal(entered,3);
    assert.equal(h.port.status(queued.run).state,'completed');assert.equal(h.port.status(a.run).result?.sessionId,h.port.status(queued.run).result?.sessionId);
  }finally{release.resolve();await h.close();}
});
test('task epoch changes during generation prevent committing the previous goal',async()=>{
  const root=await mkdtemp(join(tmpdir(),'dafeiyu-execution-epoch-')),started=deferred(),release=deferred();
  const h=await executionHarness(root,async()=>{started.resolve();await release.promise;return textReply('旧目标答案');});
  try{const a=h.port.submitTask(request);await started.promise;h.port.updateTask(a.task,{requestId:'change',expectedVersion:1,goal:'新目标'});release.resolve();await h.core.whenIdle();assert.equal(h.port.status(a.run).state,'failed');assert.equal(h.port.status(a.run).result,null);}finally{release.resolve();await h.close();}
});
test('pause waits for a non-cooperating local action, keeps its receipt, and explicit resume cannot repeat it',async()=>{
  const root=await mkdtemp(join(tmpdir(),'dafeiyu-execution-pause-')),started=deferred(),release=deferred();let count=0,turn=0;
  const h=await executionHarness(root,()=>++turn===1||turn===2?call('fixture_write',{value:1}):textReply('已使用先前回执完成'),{id:'fixture',version:'1',actions:[{id:'fixture_write',version:'1',description:'虚构本地写入',effects:'local-write',
    inputSchema:z.strictObject({value:z.number()}),outputSchema:z.strictObject({receipt:z.string()}),execute:async()=>{count++;started.resolve();await release.promise;return {status:'succeeded',effects:'confirmed',completeness:'complete',data:{receipt:'actual-fixture-receipt'},sources:[],receipts:[{id:'actual-fixture-receipt',kind:'fixture'}]};}}]});
  try{const a=h.port.submitTask(request);await started.promise;const before=h.port.status(a.run);h.port.pause(a.run,{requestId:'pause',expectedVersion:before.version,reason:'测试暂停'});
    await tick();assert.equal(h.port.status(a.run).state,'cancelling');release.resolve();await h.core.whenIdle();const paused=h.port.status(a.run);
    assert.equal(paused.state,'waiting');assert.equal(paused.operations[0]?.effects,'confirmed');assert.equal(count,1);
    const resumed=h.port.resume(a.task,{requestId:'resume',taskId:a.task.id,expectedVersion:1,policyId:'test-policy',parentRunId:a.run.id,checkpointId:paused.checkpoints.at(-1)});
    await h.core.whenIdle();assert.equal(h.port.status(resumed.run).state,'completed');assert.equal(count,1);assert.equal(h.port.status(a.run).state,'waiting');
  }finally{release.resolve();await h.close();}
});
test('confirmed action survives model failure and restarting does not repeat the operation',async()=>{
  const root=await mkdtemp(join(tmpdir(),'dafeiyu-execution-effects-'));let count=0,step=0;
  const extension={id:'fixture',version:'1',actions:[{id:'fixture_write',version:'1',description:'虚构写入',effects:'local-write' as const,inputSchema:z.strictObject({}),outputSchema:z.strictObject({receipt:z.string()}),execute:async()=>{count++;return {status:'succeeded' as const,effects:'confirmed' as const,completeness:'complete' as const,data:{receipt:'retained'},sources:[],receipts:[{id:'retained',kind:'fixture'}]};}}]};
  let h=await executionHarness(root,()=>++step===1?call('fixture_write',{}):[{type:'finish',reason:{kind:'error',failure:{code:'FIXTURE_FAILURE',message:'fictional'}}}],extension);let id='';
  try{const a=h.port.submitTask(request);id=a.run.id;await h.core.whenIdle();const status=h.port.status(a.run);assert.equal(status.state,'failed');assert.equal(status.operations[0]?.effects,'confirmed');assert.equal(count,1);}finally{await h.close();}
  h=await executionHarness(root,()=>{throw new Error('must not replay');},extension,false);try{const ref=h.port.restoreRun(id);assert.equal(h.port.status(ref).operations[0]?.receipts[0]?.id,'retained');assert.equal(h.adapter.requests.length,0);assert.equal(count,1);}finally{await h.close();}
});
test('wake ingress rejects unbound producers and deduplicates only an unchanged current occurrence',async()=>{
  const root=await mkdtemp(join(tmpdir(),'dafeiyu-execution-wake-'));const h=await executionHarness(root);try{
    const task=h.port.submitTask(request);await h.core.whenIdle();const wake=h.core.executionProducer('wake-test');
    const input={requestId:'occurrence-1',taskId:task.task.id,expectedVersion:1,policyId:'test-policy',origin:{kind:'wake',producerId:'wake-test',scheduleId:'fixture-schedule',scheduleVersion:1,occurrenceId:'occurrence-1',dueAt:'2026-10-24T12:00:00Z'}};
    const reference=wake.openTask(task.task.id);assert.throws(()=>wake.acceptWake(input,reference),/WAKE_NOT_AUTHORIZED/);const unbind=h.core.bindWakeAuthority({producerId:'wake-test',validate:origin=>origin.scheduleVersion===1});
    const a=wake.acceptWake(input,reference),b=wake.acceptWake(input,reference);assert.equal(a.run.id,b.run.id);assert.throws(()=>wake.acceptWake({...input,origin:{...input.origin,scheduleVersion:2}},reference),/IDEMPOTENCY_CONFLICT/);
    unbind();await h.core.whenIdle();assert.equal(wake.status(a.run).state,'failed');assert.equal(wake.status(a.run).error,'WAKE_NOT_AUTHORIZED');
  }finally{await h.close();}
});
