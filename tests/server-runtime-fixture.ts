import { randomUUID } from 'node:crypto';
import type { ModelBudgetAuthority,ModelBudgetRequest,ModelBudgetSettlement,ModelCallOwner } from '@dafeiyu/server-runtime';
import type { ExecutorPermit } from '@dafeiyu/server-executor';

export const runtimeRoute={provider:'local-test',model:'scripted',reasoningEffort:null,contextWindow:65536,maxOutputTokens:8192,maxRequestBytes:1000000};
export const runtimeUsage={inputTokens:12,uncachedInputTokens:3,cacheReadTokens:4,cacheWriteTokens:5,outputTokens:6,reasoningTokens:2};
export const liveSignal=()=>new AbortController().signal;
export const runtimeCall=(owner:ModelCallOwner={kind:'host',profileId:'fixture'}):ModelBudgetRequest=>({authorizationId:'fictional-budget-only',owner,
  callId:randomUUID(),provider:runtimeRoute.provider,model:runtimeRoute.model,reasoningEffort:null,inputBound:runtimeRoute.contextWindow,outputBound:100,requestBytes:100,
  requestHash:'a'.repeat(64),sessionHash:'b'.repeat(64),purpose:'task',deadline:Date.now()+5000});
export const runtimeBill=(call:ModelBudgetRequest,permit:ExecutorPermit):ModelBudgetSettlement=>({authorizationId:call.authorizationId,owner:call.owner,callId:call.callId,reservationId:permit.reservationId,usage:runtimeUsage,finish:'stop',durationMs:1,error:null});
export function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}

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
