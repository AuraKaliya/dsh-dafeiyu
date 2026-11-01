import {z} from 'zod';
import {ContextItemSchema,conversationKey} from '@dafeiyu/contracts';
import type {Journal} from '@dafeiyu/journal';
import type {ContextCoordinator} from './context.js';
import {runtimeHash} from './runtime-store.js';

const count=z.number().int().nonnegative().max(72);
export const DeliveryCountsSchema=z.strictObject({
  deliveryId:z.string().min(1).max(300),
  total:count,confirmed:count,pending:count,sending:count,unknown:count,
  receiptIds:z.array(z.string().min(1).max(80)).max(72),
}).refine(value=>value.total===value.confirmed+value.pending+value.sending+value.unknown&&value.receiptIds.length===value.confirmed);

/** One bounded, body-free receipt summary per reply in the current conversation. */
export function registerDeliveryCounts(contexts:ContextCoordinator,journal:Journal,agentId:string):()=>void {
  return contexts.register('core-delivery-counts','1',[{
    id:'qq-delivery-counts',kind:'operational-fact',
    async prepare(request){
      if(request.conversation.channel!=='qq')return [];
      const latest=new Map<string,{id:string;at:string;data:z.infer<typeof DeliveryCountsSchema>}>();
      for(const event of journal.recentEvents(conversationKey(agentId,request.conversation),'delivery.counts',64)){
        const parsed=DeliveryCountsSchema.safeParse(event.data);if(!parsed.success)continue;
        latest.delete(parsed.data.deliveryId);
        latest.set(parsed.data.deliveryId,{id:event.id,at:event.occurredAt,data:parsed.data});
      }
      return [...latest.values()].slice(-6).map(event=>{
        const text=JSON.stringify({kind:'qq-delivery-counts',...event.data,at:event.at,
          note:'total 是计划条数（含媒体），confirmed 是有平台回执的已发条数；其余未确认。unknown 不可自动重发；条数不代表对方已读。'});
        return ContextItemSchema.parse({id:event.data.deliveryId,version:runtimeHash(event.data),text,
          expiresAt:'9999-12-31T23:59:59.999Z',sources:[{ref:'dafeiyu:journal:'+event.id,version:'1',hash:runtimeHash(text)}]});
      });
    },validate:()=>true,
  }]);
}
