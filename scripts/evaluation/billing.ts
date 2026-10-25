import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-llm';
import type { TokenUsage } from '@deepseek-ai/dsh-llm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { EvaluationLedger } from './ledger.ts';
import type { EvaluationCall } from './ledger.ts';
import { sha256 } from './catalog.ts';
const count=z.number().int().nonnegative().safe();
export const BillingRouteSchema=z.strictObject({provider:z.string().min(1).max(100),model:z.string().min(1).max(160),contextWindow:z.number().int().min(1024).max(2000000),maxRequestBytes:z.number().int().min(1024).max(8000000)});
function totalUsage(raw:TokenUsage){const usage=z.object({inputTokens:count,outputTokens:count,cacheReadTokens:count.optional(),cacheWriteTokens:count.optional(),totalTokens:count.optional(),reasoningTokens:count.optional()}).parse(raw),inputTokens=usage.inputTokens+(usage.cacheReadTokens??0)+(usage.cacheWriteTokens??0);count.parse(inputTokens);
  if(usage.totalTokens!==undefined&&usage.totalTokens!==inputTokens+usage.outputTokens||usage.reasoningTokens!==undefined&&usage.reasoningTokens>usage.outputTokens)throw new Error('EVALUATION_USAGE_INCONSISTENT');return {inputTokens,outputTokens:usage.outputTokens};}
/** Reads DSH's frozen request without rewriting it; every next() dispatch is covered, including summary sessions. */
export function installEvaluationBilling(ctx:Context,ledger:EvaluationLedger,raw:z.infer<typeof BillingRouteSchema>,attemptId:()=>string){const route=Object.freeze(BillingRouteSchema.parse(raw));
  if(ledger.config.mode==='offline'&&(route.provider!=='local-test'||route.model!=='scripted'))throw new Error('EVALUATION_OFFLINE_ROUTE_REQUIRED');
  return ctx.on('llm/stream',async function*(options,next){
    if(options.provider!==route.provider||options.model!==route.model)throw new Error('EVALUATION_ROUTE_CHANGED');options.signal?.throwIfAborted();
    const body=JSON.stringify({provider:options.provider,model:options.model,messages:options.messages,tools:options.tools??[],maxTokens:options.maxTokens??null,purpose:options.purpose??null});if(Buffer.byteLength(body)>route.maxRequestBytes)throw new Error('EVALUATION_REQUEST_TOO_LARGE');
    const info=await ctx.llm.resolveModelInfo(route.provider,route.model,options.signal);if(info.context?.contextWindow!==route.contextWindow)throw new Error('EVALUATION_MODEL_CAPACITY_CHANGED');
    const output=options.maxTokens??info.defaultMaxTokens??route.contextWindow;if(!Number.isSafeInteger(output)||output<1||output>route.contextWindow)throw new Error('EVALUATION_OUTPUT_BOUND_INVALID');
    const attempt=attemptId(),id=randomUUID(),started=Date.now(),reservationId=ledger.config.mode==='real'?ledger.reserve(attempt,'call:'+id,route.contextWindow,output):null;
    const base:EvaluationCall={id,attemptId:attempt,phase:'started',provider:route.provider,model:route.model,purpose:options.purpose??'task',requestHash:sha256(body),sessionHash:sha256(String(options.sessionId??'')),at:new Date(started).toISOString(),durationMs:null,reservationId,inputTokens:null,outputTokens:null,finish:null,error:null};
    ledger.recordCall(base);let usage:{inputTokens:number;outputTokens:number}|null=null,finish:string|null=null,error:string|null=null,complete=false;
    try{for await(const chunk of next()){
      if(chunk.type==='usage'){try{usage=totalUsage(chunk.usage);}catch{usage=null;error='EVALUATION_USAGE_INVALID';}}
      if(chunk.type==='finish'){finish=chunk.reason.kind;complete=true;if(['error','aborted'].includes(finish))error??='EVALUATION_MODEL_FAILED';}
      yield chunk;
    }}catch{error??='EVALUATION_STREAM_FAILED';throw new Error(error);}
    finally{if(!complete){usage=null;error??='EVALUATION_STREAM_INTERRUPTED';}if(reservationId)ledger.settle(reservationId,usage);
      ledger.recordCall({...base,phase:'finished',at:new Date().toISOString(),durationMs:Math.max(0,Date.now()-started),inputTokens:usage?.inputTokens??null,outputTokens:usage?.outputTokens??null,finish,error});}
  });
}
