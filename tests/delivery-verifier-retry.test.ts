import test from 'node:test';
import assert from 'node:assert/strict';
import type {Context} from '@deepseek-ai/cordis';
import type {GenerateOptions,StreamChunk} from '@deepseek-ai/dsh-llm';
import {modelRetryDelay,transientModelFailure} from '@dafeiyu/contracts';
import {verifyPersonaDelivery} from '../packages/memory/lib/expression-runtime.js';
import {verificationResponse} from './sdk-fixture.js';

const input={question:'Report the recorded fact',evidence:[{id:'one',text:'The file contains the fixture marker.'}]};
const context=(stream:(request:GenerateOptions)=>AsyncIterable<StreamChunk>)=>({
  llm:{stream,resolveModelInfo:async()=>({reasoning:{efforts:[{id:'off'},{id:'low'}]}})},dafeiyu:{analysisModelRoute:()=>({provider:'fixture',model:'verifier'}),phaseTimeouts:()=>({verification:10000}),inspectContextRequest:async()=>{}},
}) as unknown as Context;

test('a transient verifier retry discards partial output and keeps the same evidence and candidate',async()=>{
  const requests:GenerateOptions[]=[];const ctx=context(async function*(request){requests.push(request);
    if(requests.length===1){yield {type:'block-end',index:0,block:{type:'text',text:'incomplete'}};yield {type:'finish',reason:{kind:'error',failure:{code:'HTTP_ERROR',status:503,message:'temporary'}}};return;}
    yield* verificationResponse(request);
  });
  await verifyPersonaDelivery(ctx,input,'The file contains the fixture marker.',new AbortController().signal,()=>{});
  assert.equal(requests.length,2);assert.equal(requests[0]!.reasoningEffort,'off');assert.deepEqual(requests[0]!.messages,requests[1]!.messages);assert.notEqual(requests[0]!.sessionId,requests[1]!.sessionId);
  assert.equal(modelRetryDelay({code:'RATE_LIMIT',status:429,providerRetryAfterMs:5000},0),5000);
});

test('account failures and definitive fidelity decisions are not retried',async()=>{
  assert.equal(transientModelFailure({code:'TRANSPORT',status:401}),false);
  for(const status of [401,402,403]){let calls=0;const ctx=context(async function*(){calls++;yield {type:'finish',reason:{kind:'error',failure:{code:'HTTP_ERROR',status,message:'private provider detail'}}};});
    await assert.rejects(verifyPersonaDelivery(ctx,input,'fixture',new AbortController().signal,()=>{}),error=>error instanceof Error&&error.message==='DELIVERY_VERIFICATION_MODEL_ERROR'&&!JSON.stringify(error.cause).includes('private provider detail'));assert.equal(calls,1);}
  let calls=0;const ctx=context(async function*(request){calls++;yield* verificationResponse(request,'Unsupported claim');});
  await assert.rejects(verifyPersonaDelivery(ctx,input,'fixture',new AbortController().signal,()=>{}),/delivery_unfaithful/);assert.equal(calls,1);
});

test('verifier retries remain bounded and cancellation interrupts the provider-requested wait',async()=>{
  let calls=0;const ctx=context(async function*(){calls++;yield {type:'finish',reason:{kind:'error',failure:{code:'TRANSPORT',message:'offline'}}};});
  await assert.rejects(verifyPersonaDelivery(ctx,input,'fixture',new AbortController().signal,()=>{}),/DELIVERY_VERIFICATION_MODEL_ERROR/);assert.equal(calls,3);
  const abort=new AbortController();calls=0;const pending=context(async function*(){calls++;setTimeout(()=>abort.abort(),20);yield {type:'finish',reason:{kind:'error',failure:{code:'RATE_LIMIT',status:429,providerRetryAfterMs:60000,message:'wait'}}};});
  const start=performance.now();await assert.rejects(verifyPersonaDelivery(pending,input,'fixture',abort.signal,()=>{}));assert.equal(calls,1);assert.ok(performance.now()-start<1000);
});
