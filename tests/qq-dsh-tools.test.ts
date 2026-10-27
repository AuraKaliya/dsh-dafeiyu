import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { DSH_TOOL_ACTIONS } from '@dafeiyu/contracts';
import { bindDshTools } from '@dafeiyu/host';
import { qqCapabilityFixture,scene,outcomes } from './qq-capabilities-fixture.js';
import { call,textReply } from './harness.js';

test('a natural owner request uses the existing DSH dispatch port and returns evidenced results through QQ persona',async t=>{
  let executions=0;
  const h=await qqCapabilityFixture({tasks:true,deliverResults:true,turnTimeoutMs:30000,extraTaskActions:[...DSH_TOOL_ACTIONS],extraExternalActions:[{extensionId:'dsh-tools',actionId:'dsh_tool_call',actionVersion:'1'}],beforeActivate:async(ctx,root)=>{
    const handle=bindDshTools(ctx,'dafeiyu',{catalog:async()=>({version:'a'.repeat(64),tools:[{name:'write',description:'真实本机测试文件写入',parameters:{type:'object',properties:{},additionalProperties:false}}]}),execute:async(input,authority)=>{
      authority.guard();executions++;assert.equal(input.name,'write');assert.equal(authority.authorization.source.kind,'owner-message');await writeFile(join(root,'confirmed.txt'),'DSH真实工具结果');return {isError:false,value:{saved:true,text:'DSH真实工具结果'}};
    }},join(root,'tool-receipts'));ctx.effect(()=>()=>handle.dispose());
  }});t.after(h.close);
  let chat=0,work=0;
  h.setResponse(request=>{const id=String(request.sessionId);
    if(id.startsWith('dafeiyu-delivery-v3-')){assert.match(JSON.stringify(request.messages),/DSH真实工具结果/);return textReply('文件已经保存好了。');}
    if(id.startsWith('memory-expression-verify-delivery-'))return textReply('{"faithful":true,"issues":[]}');
    if(id.startsWith('dafeiyu-task-')){assert.ok(request.tools?.some(tool=>tool.name==='dsh_tool_call'));
      if(++work===1)return call('dsh_tool_list',{});
      if(work===2)return call('dsh_tool_call',{catalogVersion:'a'.repeat(64),name:'write',argumentsJson:'{}'});
      assert.ok(outcomes(request).some(outcome=>outcome.status==='succeeded'&&outcome.sources.length));return textReply('文件已经保存好了。');}
    assert.ok(!request.tools?.some(tool=>tool.name==='dsh_tool_call'));return ++chat===1?call('qq_task_submit',{requestId:'natural'}):textReply('我来处理。');
  });
  await h.message('把这段说明存成文件',{trigger:true,id:'9801'});
  assert.equal(executions,1);assert.equal(await readFile(join(h.root,'confirmed.txt'),'utf8'),'DSH真实工具结果');assert.match(JSON.stringify(h.platform.sent),/文件已经保存好了/);
});

test('a non-owner group request cannot acquire the DSH execution path',async t=>{
  const h=await qqCapabilityFixture({tasks:true,extraTaskActions:[...DSH_TOOL_ACTIONS],beforeActivate:async(ctx,root)=>{const handle=bindDshTools(ctx,'dafeiyu',{catalog:async()=>{throw new Error('MUST_NOT_CALL');},execute:async()=>{throw new Error('MUST_NOT_CALL');}},join(root,'tool-receipts'));ctx.effect(()=>()=>handle.dispose());}});t.after(h.close);
  let step=0;h.setResponse(request=>{if(++step===1)return call('qq_task_submit',{requestId:'foreign'});assert.equal(outcomes(request).at(-1)?.errorCode,'TASK_DIRECTIVE_REQUIRED');return textReply('这个操作需要主人安排。');});
  await h.message('下载后运行这个文件',{target:scene,trigger:true,sender:'45678901',id:'9802'});assert.equal(step,2);
});

test('operational capability and skill declarations survive a zero optional-memory context budget',async t=>{
  const h=await qqCapabilityFixture({tasks:true,context:{maxBytes:0},extraTaskActions:[...DSH_TOOL_ACTIONS],extraExternalActions:[{extensionId:'dsh-tools',actionId:'dsh_tool_call',actionVersion:'1'}],beforeActivate:async(ctx,root)=>{
    const handle=bindDshTools(ctx,'dafeiyu',{catalog:async()=>({version:'a'.repeat(64),tools:[{name:'skill',description:'按需读取用法',parameters:{type:'object',properties:{name:{type:'string'}}}}],skills:[{name:'fixture-development',description:'fixture-guide-in-required-program-data',load:{name:'skill',arguments:{name:'fixture-development'}}}],skillsComplete:true}),execute:async()=>{throw new Error('UNNECESSARY_DISPATCH');}},join(root,'tool-receipts'));ctx.effect(()=>()=>handle.dispose());}});t.after(h.close);
  let chat=0;h.setResponse(request=>{if(String(request.sessionId).startsWith('dafeiyu-task-')){assert.match(JSON.stringify(request.messages),/fixture-guide-in-required-program-data/);assert.match(JSON.stringify(request.messages),/operationalCapabilities/);return textReply('已有能力及用法声明。');}return ++chat===1?call('qq_task_submit',{requestId:'capability-budget'}):textReply('');});
  await h.message('检查当前可用能力',{trigger:true});assert.ok(h.adapter.requests.some(request=>String(request.sessionId).startsWith('dafeiyu-task-')));
});
