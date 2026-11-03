import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import type {Context} from '@deepseek-ai/cordis';
import type {TokenUsage} from '@deepseek-ai/dsh-llm';
export interface UsageBreakdown {inputTokens:number;outputTokens:number;cacheReadTokens:number;cacheWriteTokens:number;totalTokens:number}
export interface UsageReceipt {id:string;tokens:number|null;durationMs:number;external?:true;marker?:true;provider?:string;model?:string;sessionId?:string;breakdown?:UsageBreakdown}
const attribution=new AsyncLocalStorage<(receipt:UsageReceipt)=>void>();
export const reportExternalUsage=(receipt:UsageReceipt)=>attribution.getStore()?.({...receipt,external:true});
export const withRunUsage=<T>(settle:(receipt:UsageReceipt)=>void,work:()=>Promise<T>)=>attribution.run(settle,work);
/** DSH counters are disjoint for input/cache; reasoning is already part of output. */
export function usageTokens(usage:TokenUsage):number|null {const parts=[usage.inputTokens,usage.outputTokens,usage.cacheReadTokens??0,usage.cacheWriteTokens??0];if(parts.some(n=>!Number.isSafeInteger(n)||n<0))return null;const sum=parts.reduce((a,b)=>a+b,0);return usage.totalTokens===undefined?sum:usage.totalTokens===sum?sum:null;}
export function usageBreakdown(usage:TokenUsage):UsageBreakdown|null {const totalTokens=usageTokens(usage);return totalTokens===null?null:{inputTokens:usage.inputTokens,outputTokens:usage.outputTokens,cacheReadTokens:usage.cacheReadTokens??0,cacheWriteTokens:usage.cacheWriteTokens??0,totalTokens};}
export function observeUsage(ctx:Context){return ctx.on('llm/stream',async function*(options,next){const settle=attribution.getStore();if(!settle){yield* next();return;}const id=randomUUID(),start=performance.now();let usage:TokenUsage|undefined,finished=false;
  try{for await(const chunk of next()){if(chunk.type==='usage')usage=chunk.usage;if(chunk.type==='finish')finished=chunk.reason.kind!=='error';yield chunk;}}
  finally{const breakdown=finished&&usage?usageBreakdown(usage):null;settle({id,tokens:breakdown?.totalTokens??null,durationMs:Math.max(0,Math.round(performance.now()-start)),provider:options.provider,model:options.model,...(options.sessionId?{sessionId:options.sessionId}:{}),...(breakdown?{breakdown}:{})});}});}
