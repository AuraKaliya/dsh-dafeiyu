import {createHash} from 'node:crypto';
import {z} from 'zod';
import {ContextItemSchema,conversationKey} from '@dafeiyu/contracts';
import type {ContextContributor,ContextItem} from '@dafeiyu/contracts';
import type {Journal} from '@dafeiyu/journal';
import type {ContextCoordinator} from './context.js';

const sentNoticeSchema=z.strictObject({
  text:z.string().min(1).max(4000),
  deliveryId:z.string().min(1).max(300),
  status:z.enum(['sent','not-sent','unknown']),
  kind:z.enum(['progress','result','failure']),
  receiptId:z.string().min(1).max(256).optional(),
});

const hash=(value:string)=>createHash('sha256').update(value).digest('hex');

/**
 * Read-only view of text this bot already sent to the current conversation.
 * It closes the loop between delivery and the next conversation turn: the main
 * session can answer "what did I tell them?" without replaying channel receipts.
 */
export function registerSentNotices(contexts:ContextCoordinator,journal:Journal,agentId:string):()=>void {
  const contributor:ContextContributor={
    id:'sent-notices',
    kind:'operational-fact',
    async prepare(request){
      const route=conversationKey(agentId,request.conversation);
      const items:ContextItem[]=[];
      const rows=journal.recentEvents(route,'notice.sent',6);
      for(const event of rows){
        const parsed=sentNoticeSchema.safeParse(event.data);
        if(!parsed.success)continue;
        const text=JSON.stringify({
          kind:'sent-notice',
          deliveryId:parsed.data.deliveryId,
          noticeKind:parsed.data.kind,
          status:parsed.data.status,
          at:event.occurredAt,
          text:parsed.data.text.slice(0,1200),
        });
        items.push(ContextItemSchema.parse({
          id:`notice:${event.id}`,
          version:event.id,
          text,
          expiresAt:'9999-12-31T23:59:59.999Z',
          sources:[{ref:`dafeiyu:journal:${event.id}`,version:'1',hash:hash(text)}],
        }));
      }
      return items;
    },
    // Journal events are immutable facts. A missing event is handled by the
    // journal read returning nothing, not by inventing a replacement.
    validate:()=>true,
  };
  return contexts.register('core-notices','1',[contributor]);
}
