import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { API_VERSION,conversationKey } from '@dafeiyu/contracts';
import type { Conversation,MemoryObservation } from '@dafeiyu/contracts';
import { MemoryStore } from '@dafeiyu/memory/store';
import { memoryFixture } from './memory-fixture.js';

export const observationConversation:Conversation={channel:'fictional-observer',account:'fixture-bot',kind:'group',id:'fictional-group'};
export function observationReport(overrides:Partial<MemoryObservation>={}):MemoryObservation {
  return {requestId:randomUUID(),conversation:{...observationConversation},startedAt:'2026-10-20T10:00:00.000Z',observedAt:'2026-10-20T10:00:01.000Z',finishedAt:'2026-10-20T10:00:02.000Z',
    outcome:'completed',selection:{policyId:'fictional-interest',policyVersion:'1',reasonCode:'selected'},counts:{received:1,processed:1,modelExposed:0},exposedSources:[],
    sources:[{key:'source-a',occurredAt:'2026-10-19T10:00:00.000Z',archive:{kind:'text',text:'A_ORIGINAL：这是虚构观察资料。尚未核实。'}}],
    contributions:[{id:'selected-a',form:'original',source:'source-a',exposure:['source-a']}],...overrides};
}
export async function observationFixture(root?:string,pluginVersion='fixture-v1'){
  const h=await memoryFixture(root,{compaction:{inputTokens:1000000},context:{}}),store=new MemoryStore(join(h.root,'memory.sqlite'));
  const handle=h.core.registerExtension({id:'fictional-observer',version:pluginVersion,apiVersion:API_VERSION,agentId:'dafeiyu',channels:[{
    channel:observationConversation.channel,account:observationConversation.account,deliver:async()=>({status:'sent',receiptId:'fictional-only'}),
  }]});
  const scope={agentId:'dafeiyu',route:conversationKey('dafeiyu',observationConversation),traceId:randomUUID(),operationId:randomUUID(),startedEventId:randomUUID()};
  return {...h,store,handle,scope,close:async()=>{handle.dispose();store.close();await h.close();}};
}
