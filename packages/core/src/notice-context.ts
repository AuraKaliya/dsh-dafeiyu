import {createHash} from 'node:crypto';
import {z} from 'zod';
import {ContextItemSchema,conversationKey} from '@dafeiyu/contracts';
import type {ContextContributor,ContextItem,EventRecord} from '@dafeiyu/contracts';
import type {Journal} from '@dafeiyu/journal';
import type {ContextCoordinator} from './context.js';

const attemptSchema=z.strictObject({
  text:z.string().min(1).max(4000),
  textHash:z.string().regex(/^[a-f0-9]{64}$/),
  deliveryId:z.string().min(1).max(300),
  status:z.enum(['sent','not-sent','unknown']),
  kind:z.enum(['progress','result','failure']),
  receiptId:z.string().min(1).max(256).optional(),
  code:z.string().min(1).max(120).optional(),
});

const hash=(value:string)=>createHash('sha256').update(value).digest('hex');

export interface NoticeAttempt {
  readonly eventId:string;
  readonly seq:number;
  readonly at:string;
  readonly deliveryId:string;
  readonly status:'sent'|'not-sent'|'unknown';
  readonly kind:'progress'|'result'|'failure';
  readonly text:string;
  readonly textHash:string;
  readonly receiptId?:string;
  readonly code?:string;
}

/** Latest delivery view for one deliveryId. Body is present only for confirmed sends. */
export interface NoticeView {
  readonly deliveryId:string;
  readonly status:'sent'|'not-sent'|'unknown';
  readonly kind:'progress'|'result'|'failure';
  readonly at:string;
  readonly eventId:string;
  readonly textLength:number;
  readonly textHash:string;
  readonly text?:string;
  readonly receiptId?:string;
  readonly code?:string;
}

/**
 * Groups immutable attempts into one current view per deliveryId.
 * Precedence: sent > unknown > not-sent. A later attempt never downgrades a confirmed send.
 * Only a confirmed send carries its body; unsent/uncertain drafts stay out of model context.
 */
export function buildNoticeViews(events:readonly EventRecord[]):NoticeView[] {
  interface Group {sent?:NoticeAttempt;unknown?:NoticeAttempt;notSent?:NoticeAttempt;latest:NoticeAttempt}
  const groups=new Map<string,Group>();
  for(const event of events){
    const parsed=attemptSchema.safeParse(event.data);
    if(!parsed.success)continue;
    const attempt:NoticeAttempt={eventId:event.id,seq:event.seq,at:event.occurredAt,deliveryId:parsed.data.deliveryId,status:parsed.data.status,
      kind:parsed.data.kind,text:parsed.data.text,textHash:parsed.data.textHash,
      ...(parsed.data.receiptId?{receiptId:parsed.data.receiptId}:{}),...(parsed.data.code?{code:parsed.data.code}:{})};
    const group=groups.get(attempt.deliveryId)??{latest:attempt};
    group.latest=attempt;
    if(attempt.status==='sent')group.sent=attempt;
    else if(attempt.status==='unknown')group.unknown=attempt;
    else group.notSent=attempt;
    groups.set(attempt.deliveryId,group);
  }
  const views:NoticeView[]=[];
  for(const [deliveryId,group] of groups){
    const selected=group.sent??group.unknown??group.notSent!;
    views.push({
      deliveryId,
      status:selected.status,
      kind:selected.kind,
      at:selected.at,
      eventId:selected.eventId,
      textLength:Array.from(selected.text).length,
      textHash:selected.textHash,
      ...(selected.status==='sent'?{text:selected.text.slice(0,1200)}:{}),
      ...(selected.receiptId?{receiptId:selected.receiptId}:{}),
      ...(selected.code?{code:selected.code}:{}),
    });
  }
  return views.sort((left,right)=>groups.get(left.deliveryId)!.latest.seq-groups.get(right.deliveryId)!.latest.seq);
}

function render(view:NoticeView):string {
  const common={kind:'notice',deliveryId:view.deliveryId,noticeKind:view.kind,status:view.status,at:view.at,textLength:view.textLength};
  if(view.status==='sent')return JSON.stringify({...common,...(view.receiptId?{receiptId:view.receiptId}:{}),text:view.text??''});
  if(view.status==='unknown')return JSON.stringify({...common,...(view.code?{code:view.code}:{}),textHash:view.textHash,
    note:'发送结果不明：草稿可能已送达，但正文不进入上下文；先核对渠道回执，不能据此重发。'});
  return JSON.stringify({...common,...(view.code?{code:view.code}:{}),textHash:view.textHash,
    note:'该草稿确定未发送，正文不进入上下文；只保留交付状态。'});
}

/**
 * Read-only view of what this bot already said (or failed to say) in the current conversation.
 * It closes the loop between delivery and the next conversation turn without replaying unsent drafts.
 */
export function registerSentNotices(contexts:ContextCoordinator,journal:Journal,agentId:string):()=>void {
  const contributor:ContextContributor={
    id:'sent-notices',
    kind:'operational-fact',
    async prepare(request){
      const route=conversationKey(agentId,request.conversation);
      const views=buildNoticeViews(journal.recentEvents(route,'notice.attempt',64)).slice(-6);
      return views.map(view=>{
        const text=render(view);
        return ContextItemSchema.parse({
          id:`notice:${view.deliveryId}`,
          version:hash(JSON.stringify([view.deliveryId,view.status,view.eventId,view.textHash])),
          text,
          expiresAt:'9999-12-31T23:59:59.999Z',
          sources:[{ref:`dafeiyu:journal:${view.eventId}`,version:'1',hash:hash(text)}],
        });
      });
    },
    // Journal events are immutable facts. A missing event is handled by the
    // journal read returning nothing, not by inventing a replacement.
    validate:()=>true,
  };
  return contexts.register('core-notices','1',[contributor]);
}
