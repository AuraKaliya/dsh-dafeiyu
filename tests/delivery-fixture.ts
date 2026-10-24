import { randomUUID } from 'node:crypto';
import { API_VERSION } from '@dafeiyu/contracts';
import type { Reply,DeliveryResult } from '@dafeiyu/contracts';
import { expressionFixture } from './expression-fixture.js';
import { scenes } from './task-memory-fixture.js';
import { textReply } from './harness.js';

export async function deliveryFixture(root?:string,sourceTracking=true){
  const h=await expressionFixture(root,sourceTracking),attempts:Reply[]=[],sent:Reply[]=[];
  let transport:(reply:Reply,signal:AbortSignal)=>Promise<DeliveryResult>=async reply=>({status:'sent',receiptId:`fixture:${reply.id}`});
  for(const [index,scene] of scenes.entries()){
    h.handles[index]!.dispose();h.handles[index]=h.core.registerExtension({id:`observer-${index}`,version:'1',apiVersion:API_VERSION,agentId:'dafeiyu',channels:[{
      channel:scene.channel,account:scene.account,taskDelivery:'simulated',deliver:async(reply,signal)=>{
        if(!reply.id.startsWith('task-delivery:'))return {status:'sent',receiptId:'ordinary-fictional'};
        attempts.push(reply);const result=await transport(reply,signal);if(result.status==='sent')sent.push(reply);return result;
      }}]});
  }
  const activate=(index=0,expectedVersion=0)=>{h.handles[index]!.tasks.join(h.task.reference,{requestId:randomUUID(),conversation:scenes[index]});h.handles[index]!.tasks.activate(h.task.reference,{requestId:randomUUID(),conversation:scenes[index],expectedVersion});};
  const ready=async(index=0)=>{activate(index);const inboundId=await h.question(index);const packet=h.prepare(inboundId,index===0?h.links:[h.linkFor(index)]);
    const draft=await h.task.expression.generate({requestId:randomUUID(),packetId:packet.packetId,target:scenes[index]});h.setResponse(()=>textReply('PERSONA_FINAL：下雨出门记得带伞。'));return {inboundId,packetId:packet.packetId,jobId:String(draft.jobId),draft:String(draft.answer),input:{requestId:randomUUID(),jobId:String(draft.jobId),target:scenes[index]!}};};
  return {...h,attempts,sent,activate,ready,setTransport:(next:typeof transport)=>{transport=next;}};
}
