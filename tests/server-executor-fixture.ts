import { randomUUID } from 'node:crypto';
import type { ExecutionBudgetPort,ExecutionBudgetRequest } from '../packages/server-executor/lib/budget.js';
import type { ExecutorIpcEndpoint,ExecutorPermit,ExecutorSettlement } from '../packages/server-executor/lib/protocol.js';

export const executorRoute={provider:'executor-scripted',model:'fixture',reasoningEffort:null,contextWindow:1024,maxOutputTokens:100,maxRequestBytes:8000};
export const executorProfileHash='a'.repeat(64);
export const executorCall=()=>({callId:randomUUID(),provider:executorRoute.provider,model:executorRoute.model,reasoningEffort:null,requestHash:'b'.repeat(64),sessionHash:'c'.repeat(64),inputBound:1024,outputBound:100,requestBytes:90,purpose:'task' as const});
export const executorUsage={inputTokens:12,outputTokens:6,uncachedInputTokens:3,cacheReadTokens:4,cacheWriteTokens:5,reasoningTokens:2};
export class ScriptedExecutorBudget implements ExecutionBudgetPort {
  readonly admitted:ExecutionBudgetRequest[]=[];
  readonly settled:(ExecutorSettlement&{authorizationId:string;jobId:string})[]=[];
  readonly permits:ExecutorPermit[]=[];
  deny:string|null=null;
  unknown=false;
  async reserve(input:ExecutionBudgetRequest,signal:AbortSignal):Promise<ExecutorPermit>{signal.throwIfAborted();if(this.deny)throw new Error(this.deny);this.admitted.push(structuredClone(input));const permit={reservationId:randomUUID(),dispatchPermit:randomUUID()};this.permits.push(permit);return permit;}
  async settle(input:ExecutorSettlement&{authorizationId:string;jobId:string}):Promise<{unknown:boolean}>{this.settled.push(structuredClone(input));return {unknown:this.unknown||input.usage===null};}
}
/** Test-only asynchronous endpoints preserve message order and expose injection for negative protocol tests. */
export function executorIpcPair(){
  type Listener={message:(value:unknown)=>void;disconnect:()=>void};
  const listeners:[Set<Listener>,Set<Listener>]=[new Set(),new Set()];let closed=false;
  const send=(side:0|1,value:unknown)=>{if(closed)throw new Error('EXECUTOR_IPC_CLOSED');const copy=structuredClone(value);queueMicrotask(()=>{for(const listener of listeners[side])listener.message(copy);});};
  const endpoint=(side:0|1):ExecutorIpcEndpoint=>({send:async value=>send(side===0?1:0,value),subscribe:(message,disconnect)=>{const listener={message,disconnect};listeners[side].add(listener);return ()=>{listeners[side].delete(listener);};},
    disconnect:()=>{if(closed)return;closed=true;queueMicrotask(()=>{for(const list of listeners)for(const listener of list)listener.disconnect();});}});
  return {parent:endpoint(0),child:endpoint(1),injectParent:(value:unknown)=>send(0,value),injectChild:(value:unknown)=>send(1,value)};
}
