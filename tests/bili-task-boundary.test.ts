import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import type { ExecutionContext } from '@dafeiyu/contracts';
import { BILI_SCENE } from '@dafeiyu/bilibili';
import { qqCapabilityFixture,scene,otherGroup } from './qq-capabilities-fixture.js';
import { call,textReply } from './harness.js';

for(const interest of [false,true])test(`task boundary exposes ${interest?'configured exploration resources without owner authority':'only the real owner instruction'} to Bili`,async()=>{
  const h=await qqCapabilityFixture({tasks:true,extraTaskActions:['bili_boundary_probe'],extraTaskResources:[BILI_SCENE],explorationResources:[BILI_SCENE]});let captured:ExecutionContext|undefined,actual:unknown;const handle=h.core.registerExtension({protocolVersion:4,id:'bilibili',version:'test',agentId:'dafeiyu',actions:[{id:'bili_boundary_probe',version:'1',description:'fixture boundary',effects:'read',inputSchema:z.strictObject({}),outputSchema:z.json(),requiresTask:true,execute:async(_input,context)=>{
    captured=context;assert.throws(()=>h.core.explicitTaskInstruction({...context},'bilibili'),/SCOPE_DENIED/);const resources=h.core.capabilityResources(context,'bilibili');actual=h.core.explicitTaskInstruction(context,'bilibili');assert.ok(resources.some(r=>r.channel==='bilibili'));if(interest)assert.ok(!resources.some(r=>r.id===otherGroup));return {status:'succeeded',effects:'none',completeness:'complete',data:null,sources:[],receipts:[]};}}]});
  try{let chat=0,task=0;h.setResponse(request=>String(request.sessionId).startsWith('dafeiyu-task-')?++task===1?call('bili_boundary_probe',{}):textReply('本地检查完成'):++chat===1?call(interest?'qq_explore':'qq_task_submit',{requestId:'start',...(interest?{goal:'B站搜索：模型虚构的主人许可'}:{})}):textReply('已受理'));
    await h.message(interest?'这只是一个聊天话题':'任务：B站搜索：天文学',{trigger:true,...(interest?{sender:'99887766'}:{})});assert.ok(captured);if(interest)assert.equal(actual,null);else assert.equal(z.object({text:z.string()}).parse(actual).text,'B站搜索：天文学');
    assert.throws(()=>h.core.explicitTaskInstruction(captured!,'bilibili'),/SCOPE_DENIED/);
  }finally{handle.dispose();await h.close();}
});

test('a program binding cannot grant exploration resources outside the underlying task policy',async()=>{
  const h=await qqCapabilityFixture({tasks:true});try{assert.throws(()=>h.core.bindMessageTasks({id:'fixture-native',pluginId:'probe',channelExtensionId:'channel-qq',channel:'qq',account:scene.account,ownerId:'87654321',policyId:'native',version:'1',explorationResources:[BILI_SCENE],classify:()=>({kind:'none',text:''}),active:()=>true}),/EXPLORATION_RESOURCE_DENIED/);}finally{await h.close();}
});
