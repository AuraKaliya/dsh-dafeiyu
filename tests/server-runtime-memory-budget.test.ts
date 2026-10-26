import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import { z } from 'zod';
import { SharedModelBudget,installParentModelAdmission,cancelManagedModelWork } from '@dafeiyu/server-runtime';
import { FictionalBudgetAuthority,RuntimeScriptAdapter,sdkUsage,observedAbort } from './server-runtime-fixture.js';
import { memoryFixture } from './memory-fixture.js';

const compaction={inputTokens:5000,minGrowthTokens:0,minSavingsTokens:64,cooldownMs:0,retainTurns:1,maxSummaryChars:400};
const text=(i:number)=>`虚构预算检查${i}：`+'观察：蓝色纸船尚未测试，不能认定成功。'.repeat(200);
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const submitted=z.object({status:z.literal('ok'),jobId:z.uuid()});

test('actual background Memory analysis and compaction traverse the same parent billing hook with scripted usage',async()=>{
  const h=await memoryFixture(undefined,{analysis:{},compaction}),authority=new FictionalBudgetAuthority(),budget=new SharedModelBudget(authority);
  const adapter=new RuntimeScriptAdapter(async function*(request){for await(const chunk of h.adapter.stream(request)){if(chunk.type==='finish')yield {type:'usage',usage:sdkUsage};yield chunk;}});
  try{
    h.adapterRegistration();h.ctx.llm.registerAdapter(['local-test'],adapter);
    installParentModelAdmission(h.ctx,budget,{profileId:'fixture',maximumCallMs:10000,cancelActive:code=>cancelManagedModelWork(h.ctx,code)});
    const source=await h.evidence('a','虚构编号青羽731。');
    const job=submitted.parse(await h.probe('a',context=>h.memory.analyze(context,{requestId:randomUUID(),sourceRefs:[source.ref]})));
    await h.memory.whenAnalysisIdle();const status=await h.probe('a',context=>h.memory.analysisStatus(context,job.jobId));assert.match(JSON.stringify(status),/completed/);
    for(let i=0;i<6;i++)await h.seed('a',text(i));await h.seed('a','当前虚构检查不包含旧正文。');
    const analysis=adapter.requests.find(request=>String(request.sessionId).startsWith('memory-analysis-'));
    const compact=adapter.requests.find(request=>request.purpose==='compaction');assert.ok(analysis);assert.ok(compact);
    assert.equal(authority.admitted.length,adapter.requests.length);assert.equal(authority.settled.length,adapter.requests.length);
    assert.ok(authority.admitted.some(call=>call.sessionHash===digest(String(analysis.sessionId))));
    assert.ok(authority.admitted.some(call=>call.purpose==='compaction'&&call.sessionHash===digest(String(compact.sessionId))));
    assert.equal(authority.held,0);assert.ok(budget.snapshot().every(call=>call.state==='settled'));
  }finally{await h.close();}
});

test('a real isolated background analysis receives deadline cancellation through the current Memory service',async()=>{
  const h=await memoryFixture(undefined,{analysis:{}}),authority=new FictionalBudgetAuthority(),budget=new SharedModelBudget(authority);let cancelled=false,analysisCalls=0;
  const adapter=new RuntimeScriptAdapter(async function*(request){
    if(String(request.sessionId).startsWith('memory-analysis-')){analysisCalls++;cancelled=await observedAbort(request.signal);yield {type:'finish',reason:{kind:'aborted',failure:{message:'Script fixture abort',code:'ABORTED'}}};return;}
    for await(const chunk of h.adapter.stream(request)){if(chunk.type==='finish')yield {type:'usage',usage:sdkUsage};yield chunk;}
  });
  try{
    h.adapterRegistration();h.ctx.llm.registerAdapter(['local-test'],adapter);installParentModelAdmission(h.ctx,budget,{profileId:'fixture',maximumCallMs:200,cancelActive:code=>cancelManagedModelWork(h.ctx,code)});
    const source=await h.evidence('a','虚构来源，供隔离分析取消检查。');
    await h.probe('a',context=>h.memory.analyze(context,{requestId:randomUUID(),sourceRefs:[source.ref]}));await h.memory.whenAnalysisIdle();
    assert.equal(analysisCalls,1);assert.equal(cancelled,true);assert.equal(budget.status.interrupted,'RUNTIME_CALL_DEADLINE');
    const analysis=adapter.requests.find(request=>String(request.sessionId).startsWith('memory-analysis-'))!;
    assert.equal(budget.snapshot().find(call=>call.request.sessionHash===digest(String(analysis.sessionId)))?.state,'unknown');
    await budget.whenIdle(1000);
  }finally{await h.close();}
});

test('an actual compaction request inherits cancellation instead of continuing behind an expired billing permit',async()=>{
  const h=await memoryFixture(undefined,{compaction}),authority=new FictionalBudgetAuthority(),budget=new SharedModelBudget(authority);let cancelled=false,compactions=0;
  const adapter=new RuntimeScriptAdapter(async function*(request){
    if(request.purpose==='compaction'){compactions++;cancelled=await observedAbort(request.signal);yield {type:'finish',reason:{kind:'aborted',failure:{message:'Script fixture abort',code:'ABORTED'}}};return;}
    for await(const chunk of h.adapter.stream(request)){if(chunk.type==='finish')yield {type:'usage',usage:sdkUsage};yield chunk;}
  });
  try{
    h.adapterRegistration();h.ctx.llm.registerAdapter(['local-test'],adapter);installParentModelAdmission(h.ctx,budget,{profileId:'fixture',maximumCallMs:200,cancelActive:code=>cancelManagedModelWork(h.ctx,code)});
    for(let i=0;i<7&&!budget.status.stopped;i++)await h.seed('a',text(i));
    assert.equal(compactions,1);assert.equal(cancelled,true);assert.equal(budget.snapshot().find(call=>call.request.purpose==='compaction')?.state,'unknown');await budget.whenIdle(1000);
  }finally{await h.close();}
});
