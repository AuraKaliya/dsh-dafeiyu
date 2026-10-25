import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { DafeiyuService } from '@dafeiyu/core';
import type { MediaService } from '@dafeiyu/media';
import { QqMediaDeliveryLedger } from '@dafeiyu/channel-qq';
import { runtimeHash } from '@dafeiyu/core/runtime-store';

/** Reconcile only matching persisted facts. This module never constructs OneBot or reads credentials. */
export function reconcileMedia(core:DafeiyuService,media:MediaService,qqDirectory:string|undefined){let db:DatabaseSync|undefined;
  try{if(qqDirectory&&existsSync(join(qqDirectory,'qq.sqlite')))db=new DatabaseSync(join(qqDirectory,'qq.sqlite'),{readOnly:true});const ledger=db?new QqMediaDeliveryLedger(db):null;
    return media.reconcile(manifest=>{try{const item=core.journal.get(manifest.anchor.inboundId);if(item.message.id!==manifest.sourceMessageId||runtimeHash(item.message.conversation)!==runtimeHash(manifest.target))return 'conflict';
      const transport=ledger?.plan(manifest.replyId),progress=transport?ledger!.progress(manifest.replyId):null;
      if(transport&&runtimeHash(transport.manifest)!==runtimeHash(manifest))return 'conflict';
      if(progress?.state==='sent')return 'sent';if(progress&&(progress.unknown||progress.confirmed||progress.state==='sending'))return 'unknown';
      if(manifest.anchor.kind==='task-result'){const native=core.messageTaskDeliveryStatus(manifest.runId);if(!native)return 'conflict';if(['uncertain','partial'].includes(native.state))return 'unknown';if(['rejected','interrupted','not-sent'].includes(native.state))return 'blocked';if(native.state==='sent')return 'conflict';}
      else{if(!item.reply||item.reply.id!==manifest.replyId||createHash('sha256').update(item.reply.text).digest('hex')!==manifest.textHash)return 'conflict';if(item.state==='uncertain')return 'unknown';if(item.state==='failed')return 'blocked';if(item.state==='delivered')return 'conflict';}
      return Date.parse(manifest.expiresAt)<=Date.now()?'blocked':'pending';
    }catch{return 'conflict';}});
  }finally{db?.close();}
}
