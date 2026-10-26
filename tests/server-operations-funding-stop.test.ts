import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import * as Simulator from '@dafeiyu/channel-simulator';
import { cancelManagedModelWork,SharedModelBudget,operatorInitializeFunding,OperationsModelBudgetAuthority } from '@dafeiyu/server-runtime';
import { executionHarness } from './execution-fixture.js';
import { testTempDir } from './test-temp.js';
import { FictionalBudgetAuthority,runtimeCall,runtimeBill,liveSignal } from './server-runtime-fixture.js';
import { fundingFixture,synthetic,idleSignal } from './server-operations-funding-fixture.js';

test('budget interruption quiesces actual Core task/chat admission while an already held model bill still settles',async()=>{
  const root=await mkdtemp(join(testTempDir(),'funding-stop-')),h=await executionHarness(root),authority=new FictionalBudgetAuthority(),budget=new SharedModelBudget(authority);
  try{await h.ctx.plugin(Simulator,{agentId:'dafeiyu',account:'fixture'});const initial=h.port.submitTask({requestId:'before',title:'虚构检查',goal:'证明受理入口原本可用',policyId:'test-policy'});await h.core.whenIdle();assert.equal(h.port.status(initial.run).state,'completed');
    const priorCalls=h.adapter.requests.length,call=runtimeCall(),permit=await budget.reserve(call,liveSignal());budget.onInterrupt(code=>cancelManagedModelWork(h.ctx,code));budget.cancel('FUNDING_UNKNOWN_COST');
    assert.equal(h.core.lifecycleState,'quiescing');
    // cancelRunning aborts Core's controller; assertOpen rejects before the lifecycle gate.
    assert.throws(()=>h.port.submitTask({requestId:'after',title:'不能再受理',goal:'预算关闭后不得入队',policyId:'test-policy'}),{message:'Dafeiyu is closing'});
    assert.throws(()=>h.ctx.dafeiyuSimulator.send('room','预算关闭后不得受理新聊天',{id:'late-chat'}),{message:'Dafeiyu is closing'});assert.equal(h.adapter.requests.length,priorCalls);
    assert.deepEqual(await budget.settle(runtimeBill(call,permit)),{unknown:true});assert.equal(authority.settled.length,1);await budget.whenIdle(1000);
  }finally{await h.close();}
});

test('an actual operations idle deadline automatically quiesces real Core without a model request or manual cancel',async()=>{
  const root=await mkdtemp(join(testTempDir(),'funding-idle-stop-')),h=await executionHarness(root);
  const f=await fundingFixture({lifetime:1200});operatorInitializeFunding(f.binding,synthetic);f.clock.wall=Date.now();
  const authority=OperationsModelBudgetAuthority.openExisting(f.binding,synthetic);authority.activate(f.proof());const budget=new SharedModelBudget(authority);
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{await h.ctx.plugin(Simulator,{agentId:'dafeiyu',account:'fixture'});
    const stopped=new Promise<void>((resolve,reject)=>{timer=setTimeout(()=>reject(new Error('FIXTURE_IDLE_STOP_MISSING')),5000);budget.onInterrupt(code=>{cancelManagedModelWork(h.ctx,code);resolve();});});
    await stopped;assert.equal(budget.status.interrupted,'FUNDING_EXPIRED');assert.equal(authority.snapshot().balance.reservedCalls,0);assert.equal(h.adapter.requests.length,0);
    assert.equal(h.core.lifecycleState,'quiescing');
    assert.throws(()=>h.port.submitTask({requestId:'expired-task',title:'不能受理',goal:'窗口到期',policyId:'test-policy'}),{message:'Dafeiyu is closing'});
    assert.throws(()=>h.ctx.dafeiyuSimulator.send('room','到期后新消息',{id:'expired-chat'}),{message:'Dafeiyu is closing'});assert.equal(h.adapter.requests.length,0);
  }finally{if(timer)clearTimeout(timer);await h.close();authority.close();}
});

test('actual operations final zero balance stops real task/chat ingress but preserves the already known bill',async()=>{
  const root=await mkdtemp(join(testTempDir(),'funding-zero-stop-')),h=await executionHarness(root),f=await fundingFixture({maximum:1224});operatorInitializeFunding(f.binding,synthetic);f.clock.wall=Date.now();
  const authority=OperationsModelBudgetAuthority.openExisting(f.binding,{...synthetic,clock:f.clock});authority.activate(f.proof());const budget=new SharedModelBudget(authority);
  try{await h.ctx.plugin(Simulator,{agentId:'dafeiyu',account:'fixture'});budget.onInterrupt(code=>cancelManagedModelWork(h.ctx,code));
    const call=f.call(),permit=await budget.reserve(call,idleSignal);assert.equal(h.core.lifecycleState,'active');
    await budget.settle({...f.bill(call,permit),usage:{inputTokens:1024,uncachedInputTokens:1024,cacheReadTokens:0,cacheWriteTokens:0,outputTokens:100,reasoningTokens:0}});
    assert.equal(budget.status.interrupted,'FUNDING_EXHAUSTED');assert.equal(authority.snapshot().balance.spentMicroCny,'1224');assert.equal(authority.snapshot().balance.unknownCalls,0);
    assert.equal(h.core.lifecycleState,'quiescing');
    assert.throws(()=>h.port.submitTask({requestId:'zero-task',title:'不能受理',goal:'资金耗尽',policyId:'test-policy'}),{message:'Dafeiyu is closing'});
    assert.throws(()=>h.ctx.dafeiyuSimulator.send('room','耗尽后新消息',{id:'zero-chat'}),{message:'Dafeiyu is closing'});assert.equal(h.adapter.requests.length,0);
    await budget.whenIdle(1000);
  }finally{await h.close();authority.close();}
});
