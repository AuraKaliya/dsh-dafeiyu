import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID,createHash} from 'node:crypto';
import type {Context} from '@deepseek-ai/cordis';
import type {TokenUsage,GenerateOptions} from '@deepseek-ai/dsh-llm';
import {workContexts} from '@dafeiyu/contracts';
import type {ModelUsagePhase,ModelUsageWorkType,ModelInputMeasurement} from '@dafeiyu/contracts';
export interface UsageBreakdown {inputTokens:number;outputTokens:number;cacheReadTokens:number;cacheWriteTokens:number;totalTokens:number}
export interface UsageReceipt {id:string;tokens:number|null;durationMs:number;external?:true;marker?:true;provider?:string;model?:string;sessionId?:string;breakdown?:UsageBreakdown}
export interface UsageAttribution {runId?:string;workItemId?:string;phase?:ModelUsagePhase;workType?:ModelUsageWorkType;environment?:ModelInputMeasurement['environment']}
export interface UsageStart extends UsageAttribution {id:string;startedAt:string;provider:string;model:string;sessionId?:string;inputContext?:ModelInputMeasurement}
export interface UsageSettlement {state:'completed'|'failed'|'cancelled'|'interrupted';finishedAt:string;reason:string|null;receipt:UsageReceipt}
export interface UsageRecorder {begin(input:UsageStart):void;finish(id:string,result:UsageSettlement):void}
const attribution=new AsyncLocalStorage<{settle?:(receipt:UsageReceipt)=>void;context:UsageAttribution}>();
export const reportExternalUsage=(receipt:UsageReceipt)=>attribution.getStore()?.settle?.({...receipt,external:true});
export const withRunUsage=<T>(settle:(receipt:UsageReceipt)=>void,work:()=>Promise<T>,context:UsageAttribution={})=>attribution.run({settle,context},work);
export const withUsageContext=<T>(context:UsageAttribution,work:()=>Promise<T>)=>attribution.run({...attribution.getStore(),context:{...attribution.getStore()?.context,...context}},work);
/** DSH counters are disjoint for input/cache; reasoning is already part of output. */
export function usageTokens(usage:TokenUsage):number|null {const parts=[usage.inputTokens,usage.outputTokens,usage.cacheReadTokens??0,usage.cacheWriteTokens??0];if(parts.some(n=>!Number.isSafeInteger(n)||n<0))return null;const sum=parts.reduce((a,b)=>a+b,0);return usage.totalTokens===undefined?sum:usage.totalTokens===sum?sum:null;}
export function usageBreakdown(usage:TokenUsage):UsageBreakdown|null {const totalTokens=usageTokens(usage);return totalTokens===null?null:{inputTokens:usage.inputTokens,outputTokens:usage.outputTokens,cacheReadTokens:usage.cacheReadTokens??0,cacheWriteTokens:usage.cacheWriteTokens??0,totalTokens};}
/** No prompt content is persisted. This measures repeated input, not provider billing or cache hits. */
export function measureModelInput(options:Pick<GenerateOptions,'messages'|'tools'|'toolHistory'>,environment:ModelInputMeasurement['environment']):ModelInputMeasurement{
  const messages=JSON.stringify(options.messages),tools=JSON.stringify(options.tools??[]),history=JSON.stringify(options.toolHistory??null);
  const input=`{"messages":${messages},"tools":${tools},"toolHistory":${history}}`;
  return {schemaVersion:1,environment,inputHash:createHash('sha256').update(input).digest('hex'),bytes:Buffer.byteLength(input),messagesBytes:Buffer.byteLength(messages),toolsBytes:Buffer.byteLength(tools),toolHistoryBytes:Buffer.byteLength(history),messageCount:options.messages.length,toolCount:options.tools?.length??0,measurement:'utf8-serialized-input-not-billable-tokens'};
}
function phaseFor(session:string|undefined,fallback:ModelUsagePhase):ModelUsagePhase{
  if(session?.startsWith('media-analysis-'))return 'media';
  if(session?.includes('expression-verify'))return 'verification';
  if(session?.startsWith('dafeiyu-delivery-'))return 'rendering';
  if(session?.includes('review'))return 'review';
  if(session?.includes('compaction'))return 'compaction';
  if(session?.includes('reply-decision')||session?.includes('recovery'))return 'recovery';
  return fallback;
}
export function observeUsage(ctx:Context,recorder?:()=>UsageRecorder|undefined){return ctx.effect(()=>ctx.root.on('llm/stream',async function*(options,next){
  const bound=attribution.getStore(),sink=recorder?.();if(!sink&&!bound?.settle){yield* next();return;}
  const id=randomUUID(),start=performance.now(),work=workContexts.resolveSession(options.sessionId),context=bound?.context??{};
  const input:UsageStart={...context,id,startedAt:new Date().toISOString(),provider:String(options.provider),model:String(options.model),...(options.sessionId?{sessionId:options.sessionId}:{}),
    ...(!context.runId&&work?{runId:work.runId,workItemId:work.workItemId}:{}),phase:phaseFor(options.sessionId,context.phase??(work?.stage==='conversation'?'conversation':work?'task':'other')),
    inputContext:measureModelInput(options,context.environment??(['local-test','fixture'].includes(String(options.provider))?'deterministic-test':'runtime'))};
  sink?.begin(input);let usage:TokenUsage|undefined,finished=false;
  try{for await(const chunk of next()){if(chunk.type==='usage')usage=chunk.usage;if(chunk.type==='finish')finished=!['error','aborted','max-tokens'].includes(chunk.reason.kind);yield chunk;}}
  finally{const breakdown=usage?usageBreakdown(usage):null,receipt:UsageReceipt={id,tokens:breakdown?.totalTokens??null,durationMs:Math.max(0,Math.round(performance.now()-start)),provider:input.provider,model:input.model,...(input.sessionId?{sessionId:input.sessionId}:{}),...(breakdown?{breakdown}:{})};
    if(sink)sink.finish(id,{state:finished?'completed':options.signal?.aborted?'cancelled':'failed',finishedAt:new Date().toISOString(),reason:breakdown?null:usage?'PROVIDER_USAGE_INVALID':'PROVIDER_USAGE_UNAVAILABLE',receipt});
    else bound?.settle?.(receipt);
  }
},{global:true}),'dafeiyu.model-usage');}
