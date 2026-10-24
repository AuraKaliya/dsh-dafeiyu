import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { testTempDir as tmpdir } from './test-temp.js';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SessionId } from '@deepseek-ai/dsh-session';
import * as Simulator from '@dafeiyu/channel-simulator';
import { Journal } from '@dafeiyu/journal';
import { RuntimeStore } from '@dafeiyu/core/runtime-store';
import { executionHarness } from './execution-fixture.js';
import { textReply,call } from './harness.js';
import { z } from 'zod';
import type { ExecutionContextV3 } from '@dafeiyu/contracts';

const request={requestId:'first',title:'虚构任务',goal:'内部测试目标',policyId:'test-policy'};
test('a crash boundary after Task create but before Run binding resumes the same durable request',async()=>{
  const root=await mkdtemp(join(tmpdir(),'dafeiyu-task-bind-recovery-'));let h=await executionHarness(root),original=RuntimeStore.prototype.bindTask;
  try{RuntimeStore.prototype.bindTask=function(){throw new Error('INJECTED_BIND_FAILURE');};assert.throws(()=>h.port.submitTask(request),/INJECTED_BIND_FAILURE/);}
  finally{RuntimeStore.prototype.bindTask=original;await h.close();}
  h=await executionHarness(root,()=>textReply('恢复完成'),undefined,false);
  try{await h.core.whenIdle();const accepted=h.port.submitTask(request);assert.equal(h.port.status(accepted.run).state,'completed');
    const db=new DatabaseSync(join(root,'memory','memory.sqlite'),{readOnly:true});try{assert.equal(db.prepare('SELECT count(*) AS n FROM task_workspaces').get()?.n,1);}finally{db.close();}
    assert.equal(h.adapter.requests.length,1);
  }finally{await h.close();}
});
test('DSH flush without a committed Run result is not inferred as permission to rerun on restart',async()=>{
  const root=await mkdtemp(join(tmpdir(),'dafeiyu-flush-recovery-'));let h=await executionHarness(root),id='';const original=RuntimeStore.prototype.complete;
  try{RuntimeStore.prototype.complete=function(){throw new Error('INJECTED_COMMIT_FAILURE');};const accepted=h.port.submitTask(request);id=accepted.run.id;await h.core.whenIdle();assert.equal(h.port.status(accepted.run).state,'failed');assert.equal(h.port.status(accepted.run).result,null);}
  finally{RuntimeStore.prototype.complete=original;await h.close();}
  h=await executionHarness(root,()=>{throw new Error('must not rerun');},undefined,false);try{await h.core.whenIdle();assert.equal(h.port.status(h.port.restoreRun(id)).state,'failed');assert.equal(h.adapter.requests.length,0);}finally{await h.close();}
});
test('a committed chat Run repairs a lost journal projection before old uncertain recovery without regenerating',async()=>{
  const root=await mkdtemp(join(tmpdir(),'dafeiyu-chat-projection-'));let h=await executionHarness(root,()=>textReply('已落盘的虚构回复'));
  await h.ctx.plugin(Simulator,{agentId:'dafeiyu',account:'local'});const original=Journal.prototype.transition;let id='';
  try{Journal.prototype.transition=function(...args){if(args[1]==='processing'&&args[2]==='reply-ready')throw new Error('INJECTED_PROJECTION_FAILURE');return original.apply(this,args);};
    const accepted=h.ctx.dafeiyuSimulator.send('fixture','测试恢复',{id:'fixture-message'});id=accepted.id;await assert.rejects(h.core.whenIdle());assert.equal(h.ctx.dafeiyuSimulator.deliveries.length,0);assert.equal(h.core.journal.get(id).state,'processing');
  }finally{Journal.prototype.transition=original;await h.close().catch(()=>{});}
  h=await executionHarness(root,()=>{throw new Error('must not regenerate');},undefined,false);try{
    assert.equal(h.core.journal.get(id).state,'reply-ready');await h.ctx.plugin(Simulator,{agentId:'dafeiyu',account:'local'});await h.core.whenIdle();
    assert.equal(h.core.journal.get(id).state,'delivered');assert.equal(h.ctx.dafeiyuSimulator.deliveries[0]?.text,'已落盘的虚构回复');assert.equal(h.adapter.requests.length,0);
  }finally{await h.close();}
});
test('managed chat allows an explicitly authorized task-free v3 action and strips reasoning/replay before persistence',async()=>{
  const root=await mkdtemp(join(tmpdir(),'dafeiyu-managed-chat-v3-'));let step=0,count=0;
  const h=await executionHarness(root,()=>++step===1?call('chat_fixture',{}):[
    {type:'block-start',index:0,blockType:'reasoning'},{type:'reasoning-delta',index:0,text:'PRIVATE_THOUGHT_SENTINEL'},
    {type:'block-end',index:0,block:{type:'reasoning',text:'PRIVATE_THOUGHT_SENTINEL'}},...textReply('合法回复').map(chunk=>
      'index'in chunk?{...chunk,index:chunk.index+1}:chunk.type==='finish'?{...chunk,replayState:{response:{value:'OPAQUE_SENTINEL'}}}:chunk)],
    {id:'fixture',version:'1',actions:[{id:'chat_fixture',version:'1',description:'虚构聊天能力',effects:'read',inputSchema:z.strictObject({}),outputSchema:z.strictObject({value:z.number()}),
      execute:async(_raw,context:ExecutionContextV3)=>{count++;assert.equal(context.taskId,null);assert.equal(context.scope.kind,'conversation');h.core.executionAuthority(context,'fixture');return {status:'succeeded',effects:'none',completeness:'complete',data:{value:4},sources:[],receipts:[]};}}]});
  try{await h.ctx.plugin(Simulator,{agentId:'dafeiyu',account:'local'});const accepted=h.ctx.dafeiyuSimulator.send('fixture','调用虚构能力',{id:'fixture-message'});await h.core.whenIdle();
    const item=h.core.journal.get(accepted.id);assert.equal(item.state,'delivered');assert.equal(count,1);const reader=await h.ctx.sessionPersistence.open(SessionId(item.sessionId),'read');
    try{const json=JSON.stringify(await reader.read());assert.ok(!json.includes('PRIVATE_THOUGHT_SENTINEL'));assert.ok(!json.includes('OPAQUE_SENTINEL'));assert.ok(json.includes('合法回复'));}finally{await reader.close();}
    const db=new DatabaseSync(join(root,'memory','memory.sqlite'),{readOnly:true});try{assert.equal(db.prepare('SELECT count(*) AS n FROM task_workspaces').get()?.n,0);}finally{db.close();}
    assert.ok(h.core.journal.events(item.route).some(event=>event.type==='operation.succeeded'&&event.plugin==='fixture'));
  }finally{await h.close();}
});
