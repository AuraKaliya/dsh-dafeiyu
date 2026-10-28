import type { Context } from '@deepseek-ai/cordis';
import { SessionId,pluginRecordOf } from '@deepseek-ai/dsh-session';
import type { PendingMessage,SourceRef,SourceDependency } from '@dafeiyu/contracts';
import type { ContextCoordinator } from './context.js';
import type { CompactionBinding } from './compaction-runtime.js';
import { provenanceRecordSchema,unionDependencies,eventText,digestSource } from './source-records.js';

/** Rehydrate captured program dependencies without borrowing an expired tool invocation. */
export async function prepareCapturedReplySources(agentId:string,item:PendingMessage,dependencies:readonly SourceDependency[],contexts:ContextCoordinator,binding:()=>CompactionBinding|undefined,signal:AbortSignal){
  const provider=binding();if(!provider?.provider.sources)throw new Error('DEPENDENCY_UNAVAILABLE');const scope={agentId,route:item.route,traceId:item.id},regions=await contexts.prepare(item,signal);
  const guard=()=>{signal.throwIfAborted();if(binding()?.provider!==provider.provider)throw new Error('SOURCE_STALE');
    for(const dep of dependencies){const valid=dep.agentId===agentId&&dep.route===item.route&&(dep.kind==='context'?regions.some(region=>region.entry.active&&region.entry.owner===dep.owner&&region.entry.contributor.id===dep.region
      &&(region.entry.contributor.validateHistorical?.(region.request,dep)??region.items.some(value=>value.id===dep.id&&value.version===dep.version&&digestSource(JSON.stringify([value.text,value.sources]))===dep.hash&&Date.parse(value.expiresAt)>Date.now()&&region.entry.contributor.validate(region.request,value))))
      :provider.provider.sources!.validate(scope,dep));if(!valid)throw new Error('SOURCE_STALE',{cause:dep});}
  };try{guard();return {guard,release:()=>contexts.release(regions)};}catch(error){contexts.release(regions);throw error;}
}

/** Rebind persisted answer evidence after the model turn has released its transient grants. */
export async function prepareReplySources(ctx:Context,agentId:string,item:PendingMessage,refs:readonly SourceRef[],contexts:ContextCoordinator,binding:()=>CompactionBinding|undefined,signal:AbortSignal){
  const provider=binding();if(!provider?.provider.sources)return {guard:()=>{},release:()=>{}};
  const seqs=new Set(refs.filter(ref=>ref.kind==='session'&&ref.id===item.sessionId&&ref.seq!==undefined).map(ref=>ref.seq));
  if(!seqs.size)throw new Error('SOURCE_STALE');
  const reader=await ctx.sessionPersistence.open(SessionId(item.sessionId),'read');
  const events=await reader.read(Math.min(...[...seqs].map(seq=>seq!))).finally(()=>reader.close());signal.throwIfAborted();
  const answer=events.events.findLast(event=>event.type==='assistant/message'&&seqs.has(event.seq)&&!event.data.interrupted&&eventText(event)?.trim()===item.reply?.text);
  const records=events.events.flatMap(event=>{const record=pluginRecordOf(event);return record&&(record.type==='plugin:dafeiyu/source-record'||record.type==='plugin:dafeiyu/request-sources')?[provenanceRecordSchema.parse(record)]:[];});
  const proof=records.find(record=>record.type==='plugin:dafeiyu/source-record'&&record.data.targetSeq===answer?.seq);
  if(!answer||proof?.type!=='plugin:dafeiyu/source-record'||proof.data.agentId!==agentId||proof.data.route!==item.route||proof.data.traceId!==item.id||proof.data.owner!==provider.owner||proof.data.producerVersion!==provider.version||proof.data.hash!==digestSource(eventText(answer)!))throw new Error('SOURCE_STALE');
  const request=records.find(record=>record.type==='plugin:dafeiyu/request-sources'&&record.seq===proof.data.requestSeq);
  if(request?.type!=='plugin:dafeiyu/request-sources'||request.data.agentId!==agentId||request.data.traceId!==item.id||request.data.route!==item.route||request.data.owner!==provider.owner||request.data.producerVersion!==provider.version||request.seq>=answer.seq||proof.seq<=answer.seq
    ||JSON.stringify(unionDependencies(request.data.dependencies))!==JSON.stringify(unionDependencies(proof.data.dependencies)))throw new Error('SOURCE_STALE');
  return prepareCapturedReplySources(agentId,item,proof.data.dependencies,contexts,binding,signal);
}
