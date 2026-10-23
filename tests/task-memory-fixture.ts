import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { API_VERSION,conversationKey } from '@dafeiyu/contracts';
import type { Conversation,TaskController } from '@dafeiyu/contracts';
import { MemoryStore } from '@dafeiyu/memory/store';
import type { RetrievalConfig,RetrievalDependencies } from '@dafeiyu/memory/retrieval-profile';
import { memoryFixture } from './memory-fixture.js';
import { config,fakeDependencies } from './retrieval-fixture.js';
import { observationReport } from './observation-fixture.js';

export const scenes:Conversation[]=['A','B','C'].map(id=>({channel:`fictional-${id}`,account:'fixture',kind:'local',id}));
export const resultSchema=z.object({usage:z.literal('internal-only'),items:z.array(z.object({id:z.string(),hitId:z.string(),sourceRoute:z.string(),chunk:z.object({text:z.string()}),authorization:z.object({grantId:z.string()})})),scenes:z.array(z.object({cacheHits:z.number(),vectorsComputed:z.number(),degraded:z.boolean()}))});
export const currentVersion=(task:TaskController)=>z.object({task:z.object({version:z.number()})}).parse(task.read()).task.version;
export async function taskMemoryFixture(root?:string,options?:{config:RetrievalConfig;dependencies?:RetrievalDependencies}){
  const fake=fakeDependencies(),h=await memoryFixture(root,{context:{},compaction:{inputTokens:1000000},retrieval:options?.config??config},options?options.dependencies:fake.dependency);
  const handles=scenes.map((scene,i)=>h.core.registerExtension({id:`observer-${i}`,version:'1',apiVersion:API_VERSION,agentId:'dafeiyu',channels:[{channel:scene.channel,account:scene.account,deliver:async()=>({status:'sent',receiptId:'fictional'})}]}));
  const receipts=handles.map((handle,i)=>handle.observeMemory(observationReport({requestId:`seed-${i}`,conversation:scenes[i]!,sources:[{key:`source-${i}`,occurredAt:'2026-10-20T00:00:00Z',archive:{kind:'text',text:[
    '虚构天气计划：下雨出门应带雨伞。A_ONLY。','虚构旅行计划：遇到降水，需要准备雨具。B_INTERNAL_ONLY。','无授权的虚构秘密：雨具藏在阁楼。C_DENIED。'][i]!},...(i===1?{policy:{externalExpression:'none' as const}}:{})}],contributions:[{id:'fact',form:'original',source:`source-${i}`,exposure:[`source-${i}`]}]})));
  const store=new MemoryStore(join(h.root,'memory.sqlite'));
  const tasks=store.taskWorkspace((s,r,hash)=>h.ctx.dafeiyuTimeline.checkArchivedSource(s,r,hash),(s,a,b)=>h.ctx.dafeiyuTimeline.sameArchivedSource(s,a,b));store.taskMemory(tasks,null);
  const create=()=>h.core.createTaskWorkspace({requestId:randomUUID(),title:'虚构调研',goal:'内部关联天气与出行'});
  const policy=(indices=[0,1],id='fixture-policy',expectedVersion=0,enabled=true)=>h.core.setTaskMemoryPolicy({requestId:randomUUID(),id,expectedVersion,enabled,sources:indices.map(i=>({conversation:scenes[i]})),reason:'虚构验收配置'});
  const grant=(task:TaskController,indices=[0,1],policyId='fixture-policy',expectedPolicyVersion=1)=>task.memory.grant({requestId:randomUUID(),policyId,expectedPolicyVersion,sources:indices.map(i=>({conversation:scenes[i]})),expiresAt:new Date(Date.now()+3600000).toISOString(),reason:'仅本次虚构任务内部使用'});
  const scope=(index:number)=>({agentId:'dafeiyu',route:conversationKey('dafeiyu',scenes[index]!)});
  return {...h,...fake,handles,receipts,store,create,policy,grant,scope,close:async()=>{handles.forEach(h=>h.dispose());store.close();await h.close();}};
}
