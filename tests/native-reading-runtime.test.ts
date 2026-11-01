import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
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

test('real DSH agent seals a segment after three completed videos without a fourth model request',async()=>{
  const root=await mkdtemp(join(testTempDir(),'native-units-'));
  const adapter=new FixtureAdapter((_request,call)=>toolResponse('bili_reading_save',{bvid:'video-'+call})),ctx=await sdkFixture(root,adapter);
  const runtime=new NativeRuntime(ctx,{provider:'fixture',model:'fixture'},root);
  try{const result=await runtime.run(frame([action(input=>({bvid:z.object({bvid:z.string()}).parse(input).bvid,status:'closed'}))]));
    assert.equal(result.segmentYield?.reason,'reading-unit-boundary');assert.equal(result.resultRef,null);assert.equal(adapter.requests.length,3);
  }finally{await runtime.close();await ctx.fiber.dispose();}
});

test('real request admission yields before an oversized second request reaches the model',async()=>{
  const root=await mkdtemp(join(testTempDir(),'native-budget-'));
  const adapter=new FixtureAdapter((_request,call)=>call===1?toolResponse('bili_reading_save',{bvid:'video-1'}):textResponse('must not dispatch'));
  const ctx=await sdkFixture(root,adapter),runtime=new NativeRuntime(ctx,{provider:'fixture',model:'fixture'},root);
  try{const input=frame([action(()=>({bvid:'video-1',status:'open',material:'材料'.repeat(18000)}))]);
    const result=await runtime.run(input);assert.ok(result.segmentYield);assert.equal(adapter.requests.length,1);
  }finally{await runtime.close();await ctx.fiber.dispose();}
});

test('unshrinkable first request stops instead of creating endless empty segments',async()=>{
  const root=await mkdtemp(join(testTempDir(),'native-minimum-')),adapter=new FixtureAdapter(()=>textResponse('not reached'));
  const ctx=await sdkFixture(root,adapter),runtime=new NativeRuntime(ctx,{provider:'fixture',model:'fixture'},root);
  try{const input=frame();input.program={required:'材料'.repeat(20000)};
    await assert.rejects(runtime.run(input),/READING_CONTEXT_CAPACITY/);assert.equal(adapter.requests.length,0);
  }finally{await runtime.close();await ctx.fiber.dispose();}
});

test('a large fixed prompt leaves useful reading headroom instead of yielding after one small result',async()=>{
  const root=await mkdtemp(join(testTempDir(),'native-headroom-'));
  const adapter=new FixtureAdapter((_request,call)=>call<4?toolResponse('bili_reading_save',{bvid:'video-1'}):textResponse('当前视频已读完。'));
  const ctx=await sdkFixture(root,adapter),runtime=new NativeRuntime(ctx,{provider:'fixture',model:'fixture'},root);
  try{const input={...frame([action(()=>({bvid:'video-1',status:'open',nextOffset:5}))]),readingBudget:{softTokens:1000,hardTokens:10000,maxCompletedUnits:3}};
    const result=await runtime.run(input);assert.equal(result.segmentYield,undefined);assert.equal(adapter.requests.length,4);assert.match(result.text,/读完/);
  }finally{await runtime.close();await ctx.fiber.dispose();}
});
