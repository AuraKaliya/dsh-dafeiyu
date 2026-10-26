import { randomUUID } from 'node:crypto';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions,LlmResolvedModelInfo,StreamChunk } from '@deepseek-ai/dsh-llm';
import type { ModelBudgetAuthority,ModelBudgetRequest,ModelBudgetSettlement,ModelCallOwner } from '@dafeiyu/server-runtime';
import type { ExecutorPermit } from '@dafeiyu/server-executor';

export const runtimeRoute={provider:'local-test',model:'scripted',reasoningEffort:null,contextWindow:65536,maxOutputTokens:8192,maxRequestBytes:1000000};
export const runtimeUsage={inputTokens:12,uncachedInputTokens:3,cacheReadTokens:4,cacheWriteTokens:5,outputTokens:6,reasoningTokens:2};
export const sdkUsage={inputTokens:3,cacheReadTokens:4,cacheWriteTokens:5,outputTokens:6,reasoningTokens:2,totalTokens:18};
export const liveSignal=()=>new AbortController().signal;
export const runtimeCall=(owner:ModelCallOwner={kind:'host',profileId:'fixture'}):ModelBudgetRequest=>({authorizationId:'fictional-budget-only',owner,
  callId:randomUUID(),provider:runtimeRoute.provider,model:runtimeRoute.model,reasoningEffort:null,inputBound:runtimeRoute.contextWindow,outputBound:100,requestBytes:100,
  requestHash:'a'.repeat(64),sessionHash:'b'.repeat(64),purpose:'task',deadline:Date.now()+5000});
export const runtimeBill=(call:ModelBudgetRequest,permit:ExecutorPermit):ModelBudgetSettlement=>({authorizationId:call.authorizationId,owner:call.owner,callId:call.callId,reservationId:permit.reservationId,usage:runtimeUsage,finish:'stop',durationMs:1,error:null});
export function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}
export async function observedAbort(signal:AbortSignal|undefined):Promise<boolean>{
  if(!signal)return false;if(signal.aborted)return true;
  return new Promise(resolve=>{const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve(true);};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',done);resolve(false);},1500);signal.addEventListener('abort',done,{once:true});if(signal.aborted)done();});
}

/** Explicitly fictitious money. No EvaluationLedger, operating authorization, OS or network. */
export class FictionalBudgetAuthority implements ModelBudgetAuthority {
  readonly kind='offline-test';readonly authorizationId='fictional-budget-only';readonly route=runtimeRoute;
  readonly admitted:ModelBudgetRequest[]=[];readonly settled:ModelBudgetSettlement[]=[];
  remaining=60000;held=0;unknown=false;failSettlement=false;
  guard(){if(this.unknown)throw new Error('FIXTURE_UNKNOWN_COST');if(this.held)throw new Error('FIXTURE_RESERVED');}
  remainingMs(){return this.remaining;}
  async reserve(input:ModelBudgetRequest,signal:AbortSignal){signal.throwIfAborted();this.guard();this.admitted.push(structuredClone(input));this.held++;return {reservationId:randomUUID(),dispatchPermit:randomUUID()};}
  async settle(input:ModelBudgetSettlement){if(this.failSettlement)throw new Error('FIXTURE_SETTLEMENT_LOST');this.settled.push(structuredClone(input));this.held--;this.unknown=input.usage===null;return {unknown:this.unknown};}
}

/** Uses the official DSH adapter ABI with a scripted provider and observable usage. */
export class RuntimeScriptAdapter extends LlmAdapter {
  readonly requests:GenerateOptions[]=[];
  private readonly response:(options:GenerateOptions)=>AsyncIterable<StreamChunk>;
  constructor(response:(options:GenerateOptions)=>AsyncIterable<StreamChunk>){super();this.response=response;}
  override async resolveModel(provider:string,model:string):Promise<LlmResolvedModelInfo>{return {provider,id:model,name:model,systemPromptUpdate:'in-history',toolUpdate:'in-history',context:{contextWindow:runtimeRoute.contextWindow},defaultMaxTokens:1024};}
  override async *stream(options:GenerateOptions):AsyncIterable<StreamChunk>{this.requests.push(options);yield* this.response(options);}
}
