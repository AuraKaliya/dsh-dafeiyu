import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import type {Context} from '@deepseek-ai/cordis';
import type {TokenUsage} from '@deepseek-ai/dsh-llm';
export interface UsageReceipt {id:string;tokens:number|null;durationMs:number;external?:true;marker?:true}
const attribution=new AsyncLocalStorage<(receipt:UsageReceipt)=>void>();
export const reportExternalUsage=(receipt:UsageReceipt)=>attribution.getStore()?.({...receipt,external:true});
export const withRunUsage=<T>(settle:(receipt:UsageReceipt)=>void,work:()=>Promise<T>)=>attribution.run(settle,work);
/** DSH counters are disjoint for input/cache; reasoning is already part of output. */
export function usageTokens(usage:TokenUsage):number|null {const parts=[usage.inputTokens,usage.outputTokens,usage.cacheReadTokens??0,usage.cacheWriteTokens??0];if(parts.some(n=>!Number.isSafeInteger(n)||n<0))return null;const sum=parts.reduce((a,b)=>a+b,0);return usage.totalTokens===undefined?sum:usage.totalTokens===sum?sum:null;}
export function observeUsage(ctx:Context){return ctx.on('llm/stream',async function*(_options,next){const settle=attribution.getStore();if(!settle){yield* next();return;}const id=randomUUID(),start=performance.now();let usage:TokenUsage|undefined,finished=false;
  try{for await(const chunk of next()){if(chunk.type==='usage')usage=chunk.usage;if(chunk.type==='finish')finished=chunk.reason.kind!=='error';yield chunk;}}
  finally{settle({id,tokens:finished&&usage?usageTokens(usage):null,durationMs:Math.max(0,Math.round(performance.now()-start))});}});}
