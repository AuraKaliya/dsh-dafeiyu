import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {ToolCallId} from '@deepseek-ai/dsh-llm';
import { taskScopeKey } from '@dafeiyu/contracts';
import { NativeRuntime } from '../packages/core/lib/native-runtime.js';
import { readingStage } from '../packages/core/lib/reading-stage.js';
import type { NativeAction,TaskExecutionFrame } from '../packages/core/lib/execution-frame.js';
import { FixtureAdapter,sdkFixture,toolResponse,textResponse } from './sdk-fixture.js';
import { testTempDir } from './test-temp.js';

function frame(actions:NativeAction[]=[]):TaskExecutionFrame {
  const taskId=randomUUID(),scope={kind:'task' as const,agentId:'fish',taskId,scopeKey:taskScopeKey('fish',taskId)};
  return {mode:'task',toolStage:'bili-reading',sessionId:'native-reading-'+randomUUID(),view:{runId:randomUUID(),taskId,scope,
    origin:{kind:'native',producerId:'fixture',requestId:'task'},signal:new AbortController().signal},
    persona:{text:'Read the requested public video.',version:'a'.repeat(64)},goal:'Read videos',inputs:[],actions,guard:()=>{},
    contexts:[],requestMaxBytes:1000000,outputReserveBytes:16000};
}
function action(work:(input:unknown)=>unknown):NativeAction {
  return {definition:{id:'bili_reading_save',owner:'bilibili',version:'1',pluginVersion:'1',description:'Record one completed reading.',
    input:{type:'object',properties:{bvid:{type:'string'}},required:['bvid']},parameters:{type:'object',properties:{bvid:{type:'string'}},required:['bvid']},effects:'local-write',scope:'task',active:()=>true,
    signal:new AbortController().signal,validateInput:input=>z.json().parse(input),execute:async()=>({status:'succeeded',effects:'confirmed',completeness:'complete',data:null,sources:[],receipts:[]})},
    execute:async input=>z.json().parse({status:'succeeded',effects:'confirmed',completeness:'complete',data:work(input),sources:[],receipts:[]})};
}

test('reading stage follows the goal, not the presence of Bili resources',()=>{
  const resources=[{channel:'bilibili',account:'public',kind:'local' as const,id:'public'}];
  assert.equal(readingStage('找一个关于养鱼的视频看看',resources),'bili-reading');
  assert.equal(readingStage('整理本地文件',resources),'general');
  assert.equal(readingStage('修复B站插件代码',resources),'general');
  assert.equal(readingStage('看B站',[]),'general');
});
test('a transient model connection failure retries the request without replaying its completed tool',async()=>{
  const root=await mkdtemp(join(testTempDir(),'native-transport-'));let executed=0;
  const adapter=new FixtureAdapter((_request,call)=>call===1?toolResponse('bili_reading_save',{bvid:'video-1'}):call===2?(async function*(){yield {type:'finish' as const,reason:{kind:'error' as const,failure:{code:'TRANSPORT',message:'fixture connection lost'}}};})():textResponse('恢复后完成。'));
  const ctx=await sdkFixture(root,adapter),runtime=new NativeRuntime(ctx,{provider:'fixture',model:'fixture'},root);
  try{const result=await runtime.run(frame([action(()=>{executed++;return {bvid:'video-1',status:'closed'};})]));assert.equal(executed,1);assert.equal(adapter.requests.length,3);assert.match(result.text,/完成/);}
  finally{await runtime.close();await ctx.fiber.dispose();}
});

test('malformed JSON repairs the whole unexecuted attempt without duplicating its valid earlier call',async()=>{
  const root=await mkdtemp(join(testTempDir(),'native-json-repair-'));let executed=0;
  const adapter=new FixtureAdapter((request,call)=>{
    if(call===1)return (async function*(){for(const [index,argumentsJson] of ['{"bvid":"first"}','{"bvid":'].entries()){
      yield {type:'block-start' as const,index,blockType:'tool-call' as const};yield {type:'block-end' as const,index,block:{type:'tool-call' as const,id:ToolCallId(randomUUID()),name:'bili_reading_save',arguments:argumentsJson}};
    }yield {type:'finish' as const,reason:{kind:'tool-calls' as const}};})();
    assert.match(JSON.stringify(request.messages),/invalid-json/);return call===2?toolResponse('bili_reading_save',{bvid:'first'}):textResponse('恢复完成。');
  });
  const ctx=await sdkFixture(root,adapter),runtime=new NativeRuntime(ctx,{provider:'fixture',model:'fixture'},root);
  try{const result=await runtime.run(frame([action(()=>{executed++;return {bvid:'first',status:'closed'};})]));assert.equal(executed,1);assert.equal(adapter.requests.length,3);assert.match(result.text,/完成/);}
  finally{await runtime.close();await ctx.fiber.dispose();}
});

test('a rejected private parameter is repaired without executing it or replaying completed work',async()=>{
  const root=await mkdtemp(join(testTempDir(),'native-argument-repair-'));let executed=0;
  const adapter=new FixtureAdapter((request,call)=>{
    if(call===1)return toolResponse('bili_reading_save',{bvid:'video-1',token:'fictional-private-value-never-persist'});
    assert.match(JSON.stringify(request.messages),/tool-argument-repair/);
    assert.doesNotMatch(JSON.stringify(request.messages),/fictional-private-value-never-persist/);
    return call===2?toolResponse('bili_reading_save',{bvid:'video-1'}):textResponse('参数已修正，任务继续完成。');
  });
  const ctx=await sdkFixture(root,adapter),runtime=new NativeRuntime(ctx,{provider:'fixture',model:'fixture'},root);
  try{const result=await runtime.run(frame([action(()=>{executed++;return {bvid:'video-1',status:'closed'};})]));
    assert.match(result.text,/任务继续完成/);assert.equal(executed,1);assert.equal(adapter.requests.length,3);
  }finally{await runtime.close();await ctx.fiber.dispose();}
});

test('repeating the same rejected field stops safely without dispatch',async()=>{
  const root=await mkdtemp(join(testTempDir(),'native-argument-stop-'));let executed=0;
  const adapter=new FixtureAdapter(()=>toolResponse('bili_reading_save',{bvid:'video-1',token:'fictional-private-value-never-persist'}));
  const ctx=await sdkFixture(root,adapter),runtime=new NativeRuntime(ctx,{provider:'fixture',model:'fixture'},root);
  try{await assert.rejects(runtime.run(frame([action(()=>{executed++;return {};})])),/PRIVATE_INPUT_REJECTED/);
    assert.equal(executed,0);assert.equal(adapter.requests.length,2);
  }finally{await runtime.close();await ctx.fiber.dispose();}
});

test('eight completed videos stay in one task instead of forcing a three-video segment boundary',async()=>{
  const root=await mkdtemp(join(testTempDir(),'native-units-'));
  const adapter=new FixtureAdapter((_request,call)=>call<=8?toolResponse('bili_reading_save',{bvid:'video-'+call}):textResponse('八条读完。')),ctx=await sdkFixture(root,adapter);
  const runtime=new NativeRuntime(ctx,{provider:'fixture',model:'fixture'},root);
  try{const result=await runtime.run(frame([action(input=>({bvid:z.object({bvid:z.string()}).parse(input).bvid,status:'closed'}))]));
    assert.equal('segmentYield' in result,false);assert.ok(result.resultRef);assert.equal(adapter.requests.length,9);
  }finally{await runtime.close();await ctx.fiber.dispose();}
});

test('a tool result beyond the old 32k reading threshold is still dispatched to the model',async()=>{
  const root=await mkdtemp(join(testTempDir(),'native-budget-'));
  const adapter=new FixtureAdapter((_request,call)=>call===1?toolResponse('bili_reading_save',{bvid:'video-1'}):textResponse('大结果已处理。'));
  const ctx=await sdkFixture(root,adapter),runtime=new NativeRuntime(ctx,{provider:'fixture',model:'fixture'},root);
  try{const input=frame([action(()=>({bvid:'video-1',status:'open',material:'材料'.repeat(12000)}))]);
    const result=await runtime.run(input);assert.equal('segmentYield' in result,false);assert.match(result.text,/大结果/u);assert.equal(adapter.requests.length,2);
  }finally{await runtime.close();await ctx.fiber.dispose();}
});

test('a heuristic overestimate does not reject an otherwise valid model request',async()=>{
  const root=await mkdtemp(join(testTempDir(),'native-minimum-')),adapter=new FixtureAdapter(()=>textResponse('provider accepted'));
  const ctx=await sdkFixture(root,adapter),runtime=new NativeRuntime(ctx,{provider:'fixture',model:'fixture'},root);
  try{const input=frame();input.program={required:'材料'.repeat(120000)};
    const result=await runtime.run(input);assert.equal(result.text,'provider accepted');assert.equal(adapter.requests.length,1);
  }finally{await runtime.close();await ctx.fiber.dispose();}
});
