import type { DafeiyuService } from '@dafeiyu/core';
import type { MediaService } from '@dafeiyu/media';
import {readQqMediaDelivery} from '@dafeiyu/qq';
import { runtimeHash } from '@dafeiyu/core/runtime-store';

/** Reconcile only matching persisted facts. This module never constructs OneBot or reads credentials. */
export function reconcileMedia(core:DafeiyuService,media:MediaService,qqDirectory:string|undefined){
    return media.reconcile(manifest=>{try{const item=core.deliveryFact(manifest.anchor.inboundId);if(item.sourceMessageId!==manifest.sourceMessageId||runtimeHash(item.target)!==runtimeHash(manifest.target))return 'conflict';
      const transport=readQqMediaDelivery(qqDirectory,manifest.replyId),progress=transport?.progress;
      if(transport&&runtimeHash(transport.manifest)!==runtimeHash(manifest))return 'conflict';
      if(progress?.state==='sent')return 'sent';if(progress&&(progress.unknown||progress.confirmed||progress.state==='sending'))return 'unknown';
      if(manifest.anchor.kind==='task-result'){const native=core.messageTaskDeliveryStatus(manifest.runId);if(!native)return 'conflict';if(['uncertain','partial'].includes(native.state))return 'unknown';if(['rejected','interrupted','not-sent'].includes(native.state))return 'blocked';if(native.state==='sent')return 'conflict';}
      else{if(!item.reply||item.reply.id!==manifest.replyId||item.reply.textHash!==manifest.textHash)return 'conflict';if(item.state==='uncertain')return 'unknown';if(item.state==='failed')return 'blocked';if(item.state==='delivered')return 'conflict';}
      return Date.parse(manifest.expiresAt)<=Date.now()?'blocked':'pending';
    }catch{return 'conflict';}});
}
