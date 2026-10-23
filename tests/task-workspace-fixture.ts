import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { API_VERSION,conversationKey } from '@dafeiyu/contracts';
import type { TaskController,TaskReference,ExtensionHandle,Conversation } from '@dafeiyu/contracts';
import { observationFixture,observationReport,observationConversation } from './observation-fixture.js';

export const sceneB:Conversation={channel:'fictional-research',account:'research-account',kind:'local',id:'workspace-b'};
export const taskVersion=(task:TaskController)=>z.object({task:z.object({version:z.number()})}).parse(task.read()).task.version;
export async function taskFixture(root?:string){
  const h=await observationFixture(root);
  h.store.taskWorkspace((scope,ref,hash)=>h.ctx.dafeiyuTimeline.checkArchivedSource(scope,ref,hash),(scope,a,b)=>h.ctx.dafeiyuTimeline.sameArchivedSource(scope,a,b));
  const second=h.core.registerExtension({id:'fictional-research',version:'1',apiVersion:API_VERSION,agentId:'dafeiyu',channels:[{channel:sceneB.channel,account:sceneB.account,deliver:async()=>({status:'sent',receiptId:'fictional-research'})}]});
  const a=h.handle.observeMemory(observationReport()),b=second.observeMemory(observationReport({conversation:sceneB,sources:[{key:'source-b',occurredAt:'2026-10-19T10:00:00.000Z',archive:{kind:'text',text:'B_PRIVATE_MEMORY：另一个场景的虚构资料。'}}],contributions:[{id:'b',form:'original',source:'source-b',exposure:['source-b']}]}));
  const join=(task:TaskController,handle:ExtensionHandle,conversation:Conversation)=>handle.tasks.join(task.reference,{requestId:randomUUID(),conversation});
  const activate=(task:TaskController|null,handle:ExtensionHandle,conversation:Conversation,expectedVersion:number)=>handle.tasks.activate(task?.reference??null,{requestId:randomUUID(),conversation,expectedVersion});
  const link=(task:TaskController,handle:ExtensionHandle,conversation:Conversation,id:string)=>{
    const memory=h.store.read({agentId:'dafeiyu',route:conversationKey('dafeiyu',conversation)},id,'normal',undefined,'internal');assert.ok(memory);
    return z.object({links:z.array(z.string())}).parse(handle.tasks.link(task.reference,{requestId:randomUUID(),conversation,expectedVersion:taskVersion(task),items:[{kind:'memory',id,revision:memory.revision,version:memory.version,contentHash:memory.contentHash}]})).links[0]!;
  };
  const begin=(ref:TaskReference,handle:ExtensionHandle,conversation:Conversation,slot:string,inputs:string[],expectedSlotVersion=0)=>handle.tasks.begin(ref,{requestId:randomUUID(),conversation,slot,expectedSlotVersion,inputs});
  return {...h,second,a,b,join,activate,link,begin,close:async()=>{second.dispose();await h.close();}};
}
