import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import { DSH_TOOL_ACTIONS,TaskReviewSchema } from '@dafeiyu/contracts';
import type { ExternalTaskAuthorization } from '@dafeiyu/contracts';
import { bindDshTools } from '@dafeiyu/host';
import { qqCapabilityFixture,outcomes,scene,otherGroup } from './qq-capabilities-fixture.js';
import { call,textReply } from './harness.js';

test('a loaded capability resumes the same Task once, without replaying the plugin change',async t=>{
  let authorization:ExternalTaskAuthorization|undefined,dispatches=0,newToolLoaded=false,actualToolCalls=0;
  const catalog=()=>({version:(newToolLoaded?'b':'a').repeat(64),tools:[{name:'plugin_manager',description:'本机模拟安装交接',parameters:{type:'object',properties:{},additionalProperties:false}},...(newToolLoaded?[{name:'fixture_new_tool',description:'新注册的真实DSH工具',parameters:{type:'object',properties:{},additionalProperties:false}}]:[])]});
  const h=await qqCapabilityFixture({tasks:true,extraTaskActions:[...DSH_TOOL_ACTIONS],extraExternalActions:[{extensionId:'dsh-tools',actionId:'dsh_tool_call',actionVersion:'1'}],beforeActivate:async(ctx,root)=>{const agent=await ctx.agents.create({sessionId:SessionId('loaded-tool-'+crypto.randomUUID()),meta:{cwd:root}});ctx.effect(()=>()=>agent.dispose());const handle=bindDshTools(ctx,'dafeiyu',{catalog:async()=>catalog(),execute:async(input,authority,signal)=>{authority.guard();dispatches++;authorization=authority.authorization;
    if(input.name==='plugin_manager')return {isError:false,effect:'confirmed',handoff:{kind:'plugin-change',id:authority.authorization.operationId,taskId:authority.authorization.taskId,runId:authority.authorization.runId,catalogVersion:'a'.repeat(64)},value:{queued:true}};
    assert.equal(newToolLoaded,true);const result=await ctx.tools.execute({callId:ToolCallId(authority.authorization.operationId),name:input.name,arguments:{},agent:agent.agent,signal});return {isError:result.isError,effect:'none',value:z.json().parse(result.value)};}},join(root,'results'));ctx.effect(()=>()=>handle.dispose());}});t.after(h.close);
  let chat=0,work=0;
  h.setResponse(request=>{if(String(request.sessionId).startsWith('dafeiyu-task-')){work++;if(work===1)return call('dsh_tool_call',{catalogVersion:'a'.repeat(64),name:'plugin_manager',argumentsJson:'{}'});if(work===2)return call('dafeiyu_task_outcome',{next:'wait',reason:'等待新工具加载',requiredCapabilities:['fixture_new_tool']});if(work===4)return call('dsh_tool_call',{catalogVersion:'b'.repeat(64),name:'fixture_new_tool',argumentsJson:'{}'});return textReply('阶段工作已保存');}return ++chat===1?call('qq_task_submit',{requestId:'capability'}):textReply('');});
  await h.message('开发并验证一个可复用工具',{trigger:true});assert.ok(authorization);const original={...authorization};
  const change={id:original.operationId,state:'applied',authorization:original,catalogVersion:'b'.repeat(64),toolNames:['plugin_manager'],runtimeReloaded:false};
  assert.equal(h.core.reconcileCapabilityChange(change).resumedRunId,null);
  assert.equal(h.core.reconcileCapabilityChange({...change,state:'restart-required',toolNames:['fixture_new_tool'],runtimeReloaded:false}).resumedRunId,null);
  assert.equal(h.core.reconcileCapabilityChange({...change,id:crypto.randomUUID()}).accepted,false);
  newToolLoaded=true;h.ctx.tools.register({name:'fixture_new_tool',description:'真实本机注册',parameters:{type:'object',properties:{}},output:{schema:{},render:()=>[]},execute:async()=>{actualToolCalls++;return {answer:42};}});
  const result=h.core.reconcileCapabilityChange({...change,toolNames:catalog().tools.map(tool=>tool.name)});assert.ok(result.resumedRunId);await h.core.whenIdle();
  assert.equal(h.core.reconcileCapabilityChange({...change,toolNames:catalog().tools.map(tool=>tool.name)}).resumedRunId,null);assert.equal(dispatches,2);assert.equal(actualToolCalls,1);
  const db=new DatabaseSync(join(h.root,'core/runtime.sqlite'),{readOnly:true});try{const rows=db.prepare("SELECT definition,state FROM runs WHERE json_extract(definition,'$.scope.kind')='task'").all();assert.equal(rows.length,2);const ids=rows.map(row=>z.object({taskId:z.string()}).parse(JSON.parse(String(row.definition))).taskId);assert.equal(ids[0],ids[1]);assert.equal(rows[1]?.state,'completed');}finally{db.close();}
});

test('postprocessing failure retains a confirmed operation receipt and never repeats the write',async t=>{
  let executions=0;
  const h=await qqCapabilityFixture({tasks:true,extraTaskActions:['fixture_projection'],beforeActivate:async(ctx)=>{const handle=ctx.dafeiyu.registerExtension({protocolVersion:4,id:'fixture-projection',version:'1',agentId:'dafeiyu',actions:[{id:'fixture_projection',version:'1',description:'已执行后输出需脱敏',inputSchema:z.strictObject({}),outputSchema:z.json(),effects:'local-write',scope:'task',execute:async()=>{executions++;return {status:'succeeded',effects:'confirmed',completeness:'complete',data:{token:'fictional-private-value'},sources:[],receipts:[{kind:'fixture',id:'confirmed-receipt'}]};}}]});ctx.effect(()=>()=>handle.dispose());}});t.after(h.close);
  let chat=0,work=0;h.setResponse(request=>{if(String(request.sessionId).startsWith('dafeiyu-task-')){if(++work===1)return call('fixture_projection',{});const result=outcomes(request).at(-1)!;assert.equal(result.effects,'confirmed');assert.equal(result.status,'partial');assert.equal(result.receipts[0]?.id,'confirmed-receipt');assert.equal(result.data,null);return textReply('执行已确认，内容处理存在限制。');}return ++chat===1?call('qq_task_submit',{requestId:'projection'}):textReply('');});
  await h.message('执行一次并核对结果',{trigger:true});assert.equal(executions,1);
});

test('automatic final rejection sends only a persona status and exposes failure to the following conversation',async t=>{
  const h=await qqCapabilityFixture({tasks:true,deliverResults:true});t.after(h.close);let chat=0,work=0;
  h.setResponse(request=>{const id=String(request.sessionId);
    if(id.startsWith('dafeiyu-task-'))return ++work===1?call('qq_browse',{requestId:'public',target:scene}):work===2?call('qq_browse',{requestId:'private',target:{...scene,id:otherGroup}}):textReply('任务内部草稿');
    if(id.startsWith('dafeiyu-delivery-v3-'))return textReply('REJECTED_BODY_SENTINEL');
    if(id.startsWith('memory-expression-verify-delivery-'))return textReply('{"faithful":false,"issues":["脚本拒绝此草稿"]}');
    if(id.startsWith('dafeiyu-progress-v1-')){assert.match(JSON.stringify(request.messages),/DELIVERY_UNFAITHFUL/);assert.doesNotMatch(JSON.stringify(request.messages),/REJECTED_BODY_SENTINEL/);return textReply('工作已保留，最终回复核对没有通过。');}
    if(++chat===1)return call('qq_task_submit',{requestId:'feedback'});return textReply('');
  });
  await h.message('执行并告诉我结果',{trigger:true});assert.match(JSON.stringify(h.platform.sent),/最终回复核对没有通过/);assert.doesNotMatch(JSON.stringify(h.platform.sent),/REJECTED_BODY_SENTINEL/);
  h.setResponse(request=>{assert.match(JSON.stringify(request.messages),/DELIVERY_UNFAITHFUL/);assert.doesNotMatch(JSON.stringify(request.messages),/REJECTED_BODY_SENTINEL/);return textReply('我能看到失败状态。');});
  await h.message('刚才进展如何',{trigger:true});
});
