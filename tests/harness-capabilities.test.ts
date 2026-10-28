import test from 'node:test';
import assert from 'node:assert/strict';
import {DSH_TOOL_ACTIONS,orderedDshCatalog,stableJson} from '@dafeiyu/contracts';
import type {DshToolCatalog,Json} from '@dafeiyu/contracts';
import {bindDshTools} from '@dafeiyu/host';
import {join} from 'node:path';
import {qqCapabilityFixture,outcomes} from './qq-capabilities-fixture.js';
import {call,textReply} from './harness.js';
import {ContextCoordinator} from '../packages/core/lib/context.js';
import {Journal} from '@dafeiyu/journal';
import {mkdtemp} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {testTempDir} from './test-temp.js';
import {MessageSchema,conversationKey} from '@dafeiyu/contracts';
import type {PendingMessage} from '@dafeiyu/contracts';
import {z} from 'zod';
const tool={name:'fixture_lookup',description:'Read the fictional numbered result.',parameters:{type:'object',properties:{number:{type:'number'}},required:['number'],additionalProperties:false}};
const catalog=():DshToolCatalog=>({version:'a'.repeat(64),tools:[tool],skills:[{name:'fixture-guide',description:'DSH guide available for this task',load:{name:'skill',arguments:{name:'fixture-guide'}}}]});
const taskOptions={tasks:true,extraTaskActions:[...DSH_TOOL_ACTIONS],extraExternalActions:[{extensionId:'dsh-tools',actionId:'dsh_tool_call',actionVersion:'1'}]};

test('configured capabilities are visible and queryable in ordinary conversation without creating a task',async t=>{
  let dispatched=0,steps=0;
  const h=await qqCapabilityFixture({extraConversationActions:['dsh_tool_list'],beforeActivate:async(ctx,root)=>{
    const handle=bindDshTools(ctx,'dafeiyu',{catalog:async()=>catalog(),execute:async()=>{dispatched++;throw new Error('MUST_NOT_EXECUTE');}},join(root,'receipts'));ctx.effect(()=>()=>handle.dispose());
  }});t.after(h.close);
  h.setResponse(request=>{assert.ok(!String(request.sessionId).startsWith('dafeiyu-task-'));assert.ok(request.tools?.some(t=>t.name==='dsh_tool_list'));assert.ok(!request.tools?.some(t=>t.name==='fixture_lookup'));
    assert.match(JSON.stringify(request.messages),/fixture_lookup/);assert.match(JSON.stringify(request.messages),/requires-authorized-task/);
    if(++steps===1)return call('dsh_tool_list',{});assert.equal(outcomes(request).at(-1)?.status,'succeeded');return textReply('已配置查询工具，执行需另行核对任务权限。');});
  await h.message('你现在有哪些已配置能力？',{trigger:true});assert.equal(steps,2);assert.equal(dispatched,0);
});

test('the built-in catalog describes task-only plugin capabilities without granting them to a chat',async t=>{
  let calls=0,steps=0;
  const h=await qqCapabilityFixture({beforeActivate:async ctx=>{
    const handle=ctx.dafeiyu.registerExtensionV3({protocolVersion:3,id:'fixture-capabilities',version:'1',agentId:'dafeiyu',actions:[{
      id:'fixture_task_only',version:'1',description:'A configured task-only fixture.',requiresTask:true,effects:'read',inputSchema:z.strictObject({query:z.string()}),outputSchema:z.json(),
      execute:async()=>{calls++;return {status:'succeeded',effects:'none',completeness:'complete',data:null,sources:[],receipts:[]};}
    }]});ctx.effect(()=>()=>handle.dispose());
  }});t.after(h.close);
  h.setResponse(request=>{assert.ok(request.tools?.some(t=>t.name==='dafeiyu_capabilities'));assert.ok(!request.tools?.some(t=>t.name==='fixture_task_only'));assert.match(JSON.stringify(request.messages),/fixture_task_only/);
    if(++steps===1)return call('dafeiyu_capabilities',{tool:'fixture_task_only'});
    const data=z.object({actions:z.array(z.object({id:z.string(),requiresTask:z.boolean()})),details:z.object({id:z.literal('fixture_task_only'),parameters:z.unknown()})}).parse(outcomes(request).at(-1)?.data);
    assert.equal(data.actions.find(a=>a.id==='fixture_task_only')?.requiresTask,true);assert.match(JSON.stringify(data.details.parameters),/query/);return textReply('该能力已配置，需要在获准任务中使用。');
  });await h.message('查询已配置但当前不能直接使用的能力',{trigger:true});assert.equal(steps,2);assert.equal(calls,0);
});

test('DSH native tool parameters, recoverable errors and results stay in the same loop with stable prefixes',async t=>{
  let calls=0,step=0,chat=0;const schemas:string[]=[],prompts:string[]=[];
  const h=await qqCapabilityFixture({...taskOptions,context:{maxBytes:0},beforeActivate:async(ctx,root)=>{
    ctx.effect(()=>ctx.dafeiyu.registerHarnessSection('standard-harness-instructions'));
    ctx.systemPrompt.section({name:'standard-harness-instructions',order:5,text:'STANDARD_DSH_HARNESS_INSTRUCTIONS'});
    ctx.systemPrompt.context({name:'unrelated-room',order:1,text:'UNRELATED_RUNTIME_DATA'});
    const handle=bindDshTools(ctx,'dafeiyu',{catalog:async()=>catalog(),execute:async(input,authority)=>{authority.guard();calls++;assert.equal(input.name,'fixture_lookup');assert.deepEqual(JSON.parse(input.argumentsJson),{number:calls});
      return calls===1?{isError:true,effect:'none',value:{code:'TEMPORARY_READ_FAILURE',next:'choose-another-number'}}:{isError:false,effect:'none',value:{text:'VERIFIED_FIXTURE_RESULT'}};
    }},join(root,'receipts'));ctx.effect(()=>()=>handle.dispose());
  }});t.after(h.close);
  h.setResponse(request=>{if(!String(request.sessionId).startsWith('dafeiyu-task-'))return ++chat===1?call('qq_task_submit',{requestId:'native-loop'}):textReply('我来查询。');
    step++;const native=request.tools?.find(t=>t.name==='fixture_lookup');assert.ok(native);assert.deepEqual(native.parameters,tool.parameters);
    const prompt=request.messages.filter(m=>m.role==='system').at(-1);assert.ok(prompt);prompts.push(JSON.stringify(prompt.content));schemas.push(JSON.stringify(request.tools));
    assert.match(JSON.stringify(prompt),/STANDARD_DSH_HARNESS_INSTRUCTIONS/);assert.doesNotMatch(JSON.stringify(request.messages),/UNRELATED_RUNTIME_DATA/);assert.match(JSON.stringify(request.messages),/fixture-guide/);
    if(step===1)return call('fixture_lookup',{number:'invalid'});
    if(step===2){assert.equal(calls,0);return call('fixture_lookup',{number:1});}
    if(step===3){assert.equal(outcomes(request).at(-1)?.status,'failed');return call('fixture_lookup',{number:2});}
    assert.match(JSON.stringify(request.messages),/VERIFIED_FIXTURE_RESULT/);return textReply('已取得结果。');
  });
  await h.message('查询一项内容，遇到可恢复错误后调整参数继续',{trigger:true});
  assert.equal(step,4);assert.equal(calls,2);assert.equal(new Set(schemas).size,1);assert.equal(new Set(prompts).size,1);
});

test('catalog change refreshes original native parameters before the next model decision',async t=>{
  let version=0,step=0,chat=0,dispatched=0;
  const h=await qqCapabilityFixture({...taskOptions,beforeActivate:async(ctx,root)=>{
    const handle=bindDshTools(ctx,'dafeiyu',{catalog:async()=>({...catalog(),version:(version?'b':'a').repeat(64),tools:[version?{...tool,parameters:{type:'object',properties:{key:{type:'string'}},required:['key'],additionalProperties:false}}:tool]}),execute:async(input)=>{
      dispatched++;if(dispatched===1){version=1;throw new Error('DSH_CATALOG_CHANGED');}assert.equal(input.catalogVersion,'b'.repeat(64));assert.deepEqual(JSON.parse(input.argumentsJson),{key:'updated'});return {isError:false,effect:'none',value:{found:true}};
    }},join(root,'receipts'));ctx.effect(()=>()=>handle.dispose());
  }});t.after(h.close);
  h.setResponse(request=>{if(!String(request.sessionId).startsWith('dafeiyu-task-'))return ++chat===1?call('qq_task_submit',{requestId:'catalog-refresh'}):textReply('开始。');
    if(++step===1)return call('fixture_lookup',{number:1});
    if(step===2){assert.equal(outcomes(request).at(-1)?.errorCode,'DSH_CATALOG_CHANGED');assert.match(JSON.stringify(request.tools?.find(t=>t.name==='fixture_lookup')?.parameters),/key/);return call('fixture_lookup',{key:'updated'});}
    return textReply('能力更新后完成。');
  });await h.message('使用当前工具查询',{trigger:true});assert.equal(step,3);assert.equal(dispatched,2);
});

test('capability ordering and object serialization are stable without altering semantic array order',()=>{
  const left=catalog(),right={...left,tools:[{parameters:{required:['number'],additionalProperties:false,properties:{number:{type:'number'}},type:'object'},description:tool.description,name:tool.name}]};
  assert.equal(stableJson(orderedDshCatalog(left) as Json),stableJson(orderedDshCatalog(right) as Json));
  assert.equal(stableJson({b:2,a:1}),'{"a":1,"b":2}');assert.equal(stableJson(['b','a']),'["b","a"]');
});

test('an unavailable catalog removes stale native tools and allows an honest answer',async t=>{
  let unavailable=false,step=0,chat=0;
  const h=await qqCapabilityFixture({...taskOptions,beforeActivate:async(ctx,root)=>{
    const handle=bindDshTools(ctx,'dafeiyu',{catalog:async()=>{if(unavailable)throw new Error('DSH_BRIDGE_UNAVAILABLE');return catalog();},execute:async()=>{unavailable=true;return {isError:false,effect:'none',value:{done:true}};}},join(root,'receipts'));ctx.effect(()=>()=>handle.dispose());
  }});t.after(h.close);
  h.setResponse(request=>{if(!String(request.sessionId).startsWith('dafeiyu-task-'))return ++chat===1?call('qq_task_submit',{requestId:'catalog-unavailable'}):textReply('开始。');
    if(++step===1)return call('fixture_lookup',{number:1});assert.ok(!request.tools?.some(t=>t.name==='fixture_lookup'));assert.match(JSON.stringify(request.messages),/DSH_BRIDGE_UNAVAILABLE/);return textReply('已取得第一步结果，执行环境暂时断开。');
  });await h.message('查询后检查后续能力',{trigger:true});assert.equal(step,2);
});

test('pinned personality is admitted before higher-priority optional context',async()=>{
  const root=await mkdtemp(join(testTempDir(),'pinned-context-')),journal=new Journal(join(root,'journal.sqlite'));
  const coordinator=new ContextCoordinator('fish',journal,{maxBytes:1050,regions:{'optional:facts':{priority:900,maxBytes:1000},'memory:growth':{priority:400,maxBytes:1000}}});
  const item=(id:string)=>({id,version:'1',text:id+'x'.repeat(450),expiresAt:'9999-12-31T23:59:59.999Z',sources:[{ref:'fixture:'+id,version:'1',hash:'fixture'}]});
  coordinator.register('optional','1',[{id:'facts',kind:'operational-fact',prepare:async()=>[item('optional')],validate:()=>true}]);
  coordinator.register('memory','1',[{id:'growth',kind:'working-state',prepare:async()=>[item('personality')],validate:()=>true}]);coordinator.pinRegion('memory:growth');
  const message=MessageSchema.parse({id:'1',occurredAt:new Date().toISOString(),conversation:{channel:'fixture',account:'account',kind:'private',id:'room'},sender:{id:'owner',displayName:'Fixture'},text:'hello'});
  const pending:PendingMessage={id:randomUUID(),route:conversationKey('fish',message.conversation),extensionId:'fixture',message,state:'accepted',sessionId:'fixture',reply:null};
  try{const prepared=await coordinator.prepare(pending,new AbortController().signal);try{const packet=coordinator.packet(prepared);assert.equal(packet.regions[0]?.region,'growth');assert.equal(packet.decisions.find(d=>d.region==='facts')?.overBudget,1);}finally{coordinator.release(prepared);}}finally{journal.close();}
});
