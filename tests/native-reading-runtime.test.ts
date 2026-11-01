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

test('eight completed videos stay in one task instead of forcing a three-video segment boundary',async()=>{
  const root=await mkdtemp(join(testTempDir(),'native-units-'));
  const adapter=new FixtureAdapter((_request,call)=>call<=8?toolResponse('bili_reading_save',{bvid:'video-'+call}):textResponse('八条读完。')),ctx=await sdkFixture(root,adapter);
  const runtime=new NativeRuntime(ctx,{provider:'fixture',model:'fixture'},root);
  try{const result=await runtime.run(frame([action(input=>({bvid:z.object({bvid:z.string()}).parse(input).bvid,status:'closed'}))]));
    assert.equal(result.segmentYield,undefined);assert.ok(result.resultRef);assert.equal(adapter.requests.length,9);
  }finally{await runtime.close();await ctx.fiber.dispose();}
});

test('a tool result beyond the old 32k reading threshold is still dispatched to the model',async()=>{
  const root=await mkdtemp(join(testTempDir(),'native-budget-'));
  const adapter=new FixtureAdapter((_request,call)=>call===1?toolResponse('bili_reading_save',{bvid:'video-1'}):textResponse('大结果已处理。'));
  const ctx=await sdkFixture(root,adapter),runtime=new NativeRuntime(ctx,{provider:'fixture',model:'fixture'},root);
  try{const input=frame([action(()=>({bvid:'video-1',status:'open',material:'材料'.repeat(12000)}))]);
    const result=await runtime.run(input);assert.equal(result.segmentYield,undefined);assert.match(result.text,/大结果/u);assert.equal(adapter.requests.length,2);
  }finally{await runtime.close();await ctx.fiber.dispose();}
});

test('a request estimated beyond the real model window is rejected before dispatch',async()=>{
  const root=await mkdtemp(join(testTempDir(),'native-minimum-')),adapter=new FixtureAdapter(()=>textResponse('not reached'));
  const ctx=await sdkFixture(root,adapter),runtime=new NativeRuntime(ctx,{provider:'fixture',model:'fixture'},root);
  try{const input=frame();input.program={required:'材料'.repeat(120000)};
    await assert.rejects(runtime.run(input),/MODEL_CONTEXT_CAPACITY/);assert.equal(adapter.requests.length,0);
  }finally{await runtime.close();await ctx.fiber.dispose();}
});
