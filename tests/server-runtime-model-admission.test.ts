import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime,{createUserMessage} from '@deepseek-ai/dsh-llm';
import type { StreamChunk } from '@deepseek-ai/dsh-llm';
import { SharedModelBudget,installParentModelAdmission,validateParentModelAdmission } from '@dafeiyu/server-runtime';
import { FictionalBudgetAuthority,RuntimeScriptAdapter,liveSignal,runtimeRoute,sdkUsage,runtimeCall,runtimeBill,observedAbort } from './server-runtime-fixture.js';

const consume=async(stream:AsyncIterable<StreamChunk>)=>{const chunks:StreamChunk[]=[];for await(const chunk of stream)chunks.push(chunk);return chunks;};
const request=(signal:AbortSignal=liveSignal())=>({provider:runtimeRoute.provider,model:runtimeRoute.model,messages:[createUserMessage({source:{kind:'user'},content:[{type:'text',text:'虚构模型接线检查'}]})],signal,maxTokens:100});

test('official DSH parent middleware observes a prepared frozen request exactly once and shares a released tool-round permit with a child',async()=>{
  const ctx=new Context(),authority=new FictionalBudgetAuthority(),budget=new SharedModelBudget(authority);
  try{
    await ctx.plugin(LlmRuntime);const adapter=new RuntimeScriptAdapter(async function*(){yield {type:'usage',usage:sdkUsage};yield {type:'finish',reason:{kind:'tool-calls'}};});ctx.llm.registerAdapter(['local-test'],adapter);
    installParentModelAdmission(ctx,budget,{profileId:'fixture',maximumCallMs:5000,cancelActive:()=>{}});
    const prepared=await ctx.llm.prepareCall({provider:'local-test',model:'scripted',maxTokens:100});
    await consume(prepared.stream(Object.freeze({...request(),...prepared.config})));assert.equal(adapter.requests.length,1);assert.equal(authority.settled.length,1);assert.equal(authority.settled[0]!.usage!.inputTokens,12);
    const child=runtimeCall({kind:'executor',jobId:crypto.randomUUID()}),permit=await budget.reserve(child,liveSignal());await budget.settle(runtimeBill(child,permit));assert.equal(authority.admitted.length,2);
    assert.throws(()=>installParentModelAdmission(ctx,budget,{profileId:'fixture',maximumCallMs:5000,cancelActive:()=>{}}),/ALREADY_INSTALLED/);
    assert.throws(()=>installParentModelAdmission(ctx.extend({}),budget,{profileId:'fixture',maximumCallMs:5000,cancelActive:()=>{}}),/ALREADY_INSTALLED/);
  }finally{await ctx.fiber.dispose();}
});

test('route, size and missing signal are rejected before any reservation or scripted dispatch',async()=>{
  const ctx=new Context(),authority=new FictionalBudgetAuthority(),budget=new SharedModelBudget(authority);
  try{await ctx.plugin(LlmRuntime);const adapter=new RuntimeScriptAdapter(async function*(){yield {type:'finish',reason:{kind:'stop'}};});ctx.llm.registerAdapter(['local-test'],adapter);
    installParentModelAdmission(ctx,budget,{profileId:'fixture',maximumCallMs:5000,cancelActive:()=>{}});
    await assert.rejects(consume(ctx.llm.stream({...request(),model:'other'})),/RUNTIME_ROUTE_CHANGED/);
    await assert.rejects(consume(ctx.llm.stream({...request(),system:'x'.repeat(1000001)})),/RUNTIME_REQUEST_TOO_LARGE/);
    const {signal:_signal,...withoutSignal}=request();await assert.rejects(consume(ctx.llm.stream(withoutSignal)),/RUNTIME_MODEL_SIGNAL_REQUIRED/);
    assert.equal(authority.admitted.length,0);assert.equal(adapter.requests.length,0);
  }finally{await ctx.fiber.dispose();}
});

test('deadline cancels the actual provider signal and unknown settlement still completes',async()=>{
  const ctx=new Context(),authority=new FictionalBudgetAuthority(),budget=new SharedModelBudget(authority),abort=new AbortController();let observed=false;
  try{await ctx.plugin(LlmRuntime);ctx.llm.registerAdapter(['local-test'],new RuntimeScriptAdapter(async function*(options){
      assert.ok(options.signal);observed=await observedAbort(options.signal);
      yield {type:'finish',reason:{kind:'aborted',failure:{message:'Scripted abort',code:'ABORTED'}}};
    }));
    installParentModelAdmission(ctx,budget,{profileId:'fixture',maximumCallMs:20,cancelActive:()=>abort.abort()});
    await assert.rejects(consume(ctx.llm.stream(request(abort.signal))));assert.equal(observed,true);assert.equal(authority.settled.length,1);assert.equal(authority.settled[0]!.usage,null);assert.equal(budget.snapshot()[0]!.state,'unknown');
  }finally{await ctx.fiber.dispose();}
});

test('invalid usage remains unknown even if a later usage frame looks correct',async()=>{
  const ctx=new Context(),authority=new FictionalBudgetAuthority(),budget=new SharedModelBudget(authority);
  try{await ctx.plugin(LlmRuntime);ctx.llm.registerAdapter(['local-test'],new RuntimeScriptAdapter(async function*(){yield {type:'usage',usage:{inputTokens:1,outputTokens:1,totalTokens:999}};yield {type:'usage',usage:sdkUsage};yield {type:'finish',reason:{kind:'stop'}};}));
    installParentModelAdmission(ctx,budget,{profileId:'fixture',maximumCallMs:5000,cancelActive:()=>{}});await consume(ctx.llm.stream(request()));
    assert.equal(authority.settled[0]!.usage,null);assert.equal(budget.status.stopped,'RUNTIME_USAGE_UNKNOWN');
  }finally{await ctx.fiber.dispose();}
});

test('startup preflight checks actual official model metadata before mounting or reserving',async()=>{
  const ctx=new Context(),authority=new FictionalBudgetAuthority(),budget=new SharedModelBudget(authority);
  try{await ctx.plugin(LlmRuntime);const adapter=new RuntimeScriptAdapter(async function*(){yield {type:'finish',reason:{kind:'stop'}};});
    const registration=ctx.llm.registerAdapter(['local-test'],adapter);await validateParentModelAdmission(ctx,budget);
    const original=adapter.resolveModel.bind(adapter);adapter.resolveModel=async(provider,model)=>({...await original(provider,model),defaultMaxTokens:256000});
    registration.replace(['local-test']);await assert.rejects(validateParentModelAdmission(ctx,budget),/RUNTIME_PROVIDER_DEFAULT_MISMATCH/);
    assert.equal(authority.admitted.length,0);assert.equal(adapter.requests.length,0);
  }finally{await ctx.fiber.dispose();}
});
