import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import TokenMeter from '@deepseek-ai/dsh-token-meter';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {ExecutionToolReceiptSchema,taskScopeKey} from '@dafeiyu/contracts';
import type {CompactionProvider,PersonaSourceRef,SourceDependency} from '@dafeiyu/contracts';
import {CompactionRuntime} from '../packages/core/lib/compaction-runtime.js';
import {openAgentSession,runAgentTurn} from '../packages/core/lib/agent-session.js';
import {EXECUTION_MESSAGE_SOURCE} from '../packages/core/lib/native-runtime.js';
import {runtimeHash} from '../packages/core/lib/runtime-store.js';
import {FixtureAdapter,sdkFixture,textResponse,toolResponse} from './sdk-fixture.js';
import {testTempDir} from './test-temp.js';

test('folded SDK history reopens after restart and withdraws expired or revoked evidence without replay',{timeout:30000},async()=>{
  const root=await mkdtemp(join(testTempDir(),'folded-history-')),taskId=randomUUID(),runId=randomUUID(),route=taskScopeKey('fish',taskId),sessionId='fold-test-'+randomUUID();
  const body=(index:number)=>`BODY_${index}_`+'原文'.repeat(2200),refs:PersonaSourceRef[]=Array.from({length:6},(_,index)=>({kind:'execution-source',agentId:'fish',scopeKey:route,id:randomUUID(),version:1,contentHash:runtimeHash(body(index))}));
  let phase:'initial'|'resume'|'revoked'|'expired'='initial',reads=0,reopens=0,epoch=0,expires=Infinity,revoked=false;
  const scoped={agentId:'fish',route},context:SourceDependency={...scoped,kind:'context',owner:'fixture',region:'live',id:'expiring-scope',version:'1',hash:'a'.repeat(64)};
  const provider:CompactionProvider={policy:{enabled:false,inputTokens:1000000,thresholdRatio:0.75,targetRatio:0.58,minGrowthTokens:1024,minSavingsTokens:512,cooldownMs:60000,retainTurns:2,maxSourceBytes:65536,maxSummaryChars:2000},
    basis:()=>({epoch:String(epoch),taskId,versions:{source:epoch}}),sources:{inbound:()=>[{...scoped,kind:'ephemeral',traceId:runId}],context:()=>[context],
      tool:(_scope,_name,_text,meta)=>z.object({dafeiyuExecution:ExecutionToolReceiptSchema}).parse(meta).dafeiyuExecution.sources.map(ref=>({...scoped,kind:'execution-source',ref})),
      validate:(_scope,dep)=>dep.kind==='ephemeral'||dep.kind==='execution-source'&&(!revoked||dep.ref.id!==refs[0]!.id)},summarizeFragments:async()=>assert.fail('semantic calls are disabled')};
  const adapter=new FixtureAdapter(request=>{
    const input=JSON.stringify(request.messages);assert.match(input,/最新纠正/);assert.match(input,/不得修改/);assert.match(input,/待办/);
    if(phase==='initial'){
      if(reads>0)assert.ok(input.includes(body(reads-1)),'A new result must be exposed in full first');
      if(reads<6)return toolResponse('dsh_tool_read',{index:reads});
      assert.match(input,/archived-tool-result/);assert.ok(!input.includes(body(0)));return textResponse('已读并保存，待办仍保留。');
    }
    if(phase==='resume'&&!reopens){assert.match(input,/archived-tool-result/);return toolResponse('dsh_result_read',{index:0});}
    if(phase==='resume'){assert.ok(input.includes(body(0)));return textResponse('原归档已回查。');}
    assert.ok(!input.includes(body(0)),'Revoked body must not survive in a placeholder or derived response');
    if(phase==='expired')for(let index=0;index<6;index++)assert.ok(!input.includes(body(index)));
    return textResponse('来源已失效，保留限制与待办。');
  });
  const open=async()=>{
    const ctx=await sdkFixture(root,adapter);await ctx.plugin(TokenMeter,{});let compact!:CompactionRuntime;
    const handle=await openAgentSession(ctx,sessionId,{provider:'fixture',model:'fixture'},root,scope=>{
      compact=new CompactionRuntime(scope,'fish',()=>({owner:'fixture',version:'1',provider}),()=>{}, {sourceItems:()=>[],nativeDependencies:()=>[context],validateHistorical:()=>Date.now()<expires});
      scope.on('llm/stream',async function*(options,next){compact.guard(options,true);yield* next();compact.guard(options);});
      for(const name of ['dsh_tool_read','dsh_result_read'])scope.tools.register({name,description:'Scoped archived fixture',parameters:{type:'object',properties:{index:{type:'integer'}},required:['index']},
        output:{schema:{},render:(_args,value)=>[{type:'text',text:JSON.stringify(z.object({outcome:z.json()}).parse(value).outcome)}],presentationMeta:(_args,value)=>z.json().parse({dafeiyuExecution:z.object({receipt:z.json()}).parse(value).receipt})},
        execute:async(args,execution)=>{const {index}=z.object({index:z.number().int().min(0).max(5)}).parse(args);assert.ok(Date.now()<expires);assert.ok(!revoked||index!==0);
          if(name==='dsh_tool_read')reads++;else reopens++;
          const source=refs[index]!,outcome={status:'succeeded',effects:'none',completeness:'partial',data:{page:{resultId:source.id,path:[],execution:{receiptId:source.id},view:{text:body(index),coverage:{start:0,end:4407,total:9000,complete:false}}}},sources:[{id:source.id,scopeKey:source.scopeKey,version:source.version,contentHash:source.contentHash}],receipts:[]};
          return z.json().parse({outcome,receipt:{schemaVersion:1,runId,operationId:randomUUID(),callId:String(execution.callId),outcomeHash:runtimeHash(outcome),inputHash:'b'.repeat(64),sources:[source]}});
        }});
    });
    const turn=async(signal=new AbortController().signal)=>{compact.begin({id:runId,route,sessionId,inputKind:EXECUTION_MESSAGE_SOURCE,inputSourceId:runId},handle.agent);
      const input=createUserMessage({source:{kind:EXECUTION_MESSAGE_SOURCE,form:'notice',summary:'fixture execution',taskId,runId,inputId:randomUUID(),originKind:'native'},content:[{type:'text',text:'最新纠正：只核对片段；不得修改文件；待办：合法回查和报告范围。'}]});compact.expectInput(input);
      try{return await runAgentTurn(ctx,handle.agent,input,signal,()=>compact.seal());}finally{compact.end();}};
    return {turn,history:()=>JSON.stringify(handle.agent.session.deriveMessages()),close:async()=>{await handle.dispose();await ctx.fiber.dispose();}};
  };
  let runtime=await open();try{await runtime.turn();assert.equal(reads,6);}finally{await runtime.close();}
  phase='resume';runtime=await open();try{await runtime.turn();assert.equal(reads,6);assert.equal(reopens,1);
    phase='revoked';revoked=true;epoch++;await runtime.turn();assert.equal(reads,6);
    phase='expired';expires=0;const beforeExpiry=adapter.requests.length;await assert.rejects(runtime.turn(),/SOURCE_VALIDATION_FAILED/);assert.equal(adapter.requests.length,beforeExpiry);
    for(let index=0;index<6;index++)assert.ok(!runtime.history().includes(body(index)));
    const before=adapter.requests.length,controller=new AbortController();controller.abort();await assert.rejects(runtime.turn(controller.signal));assert.equal(adapter.requests.length,before);
  }finally{await runtime.close();}
});
