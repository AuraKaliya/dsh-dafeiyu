import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { taskMemoryFixture,scenes,resultSchema,currentVersion } from './task-memory-fixture.js';

export async function expressionFixture(root?:string,sourceTracking=true){
  const h=await taskMemoryFixture(root,undefined,sourceTracking),task=h.create();h.policy([0,1,2],`policy-${task.reference.id}`);const access=h.grant(task,[0,1,2],`policy-${task.reference.id}`);
  const hits=resultSchema.parse(await access.recall({query:'雨',strategy:'lexical',limit:10}));
  const selected=z.object({links:z.array(z.string())}).parse(access.select({requestId:randomUUID(),expectedVersion:currentVersion(task),hitIds:hits.items.map(i=>i.hitId)}));
  const linkFor=(index:number)=>selected.links[hits.items.findIndex(item=>item.id===h.receipts[index]!.contributions[0]!.memoryId)]!;
  const question=async(index=0,text='下雨出行需要准备什么？')=>{const receipt=h.handles[index]!.ingest({id:randomUUID(),conversation:scenes[index]!,occurredAt:new Date().toISOString(),sender:{id:`user-${index}`,displayName:'虚构用户'},text});await h.core.whenIdle();return receipt.id;};
  const policy=(sourceIndex:number,targetIndex=0,id='release',expectedVersion=0,enabled=true)=>{
    const item=h.store.read(h.scope(sourceIndex),h.receipts[sourceIndex]!.contributions[0]!.memoryId,'normal',undefined,'internal')!;
    return h.core.setTaskExpressionPolicy({requestId:randomUUID(),id,expectedVersion,enabled,target:scenes[targetIndex],sources:[{conversation:scenes[sourceIndex],id:item.id,revision:item.revision,version:item.version,contentHash:item.contentHash}],reason:'虚构资料明确允许向指定目标表达'});
  };
  const prepare=(inboundId:string,linkIds=selected.links,slots:string[]=[],policy?:{id:string;version:number})=>z.object({packetId:z.string(),decisions:z.array(z.object({kind:z.string(),id:z.string(),allowed:z.boolean()}))}).parse(task.expression.prepare({requestId:randomUUID(),inboundId,linkIds,slots,...(policy?{policy}:{})}));
  return {...h,task,access,hits,links:selected.links,linkFor,question,policyExpression:policy,prepare};
}
