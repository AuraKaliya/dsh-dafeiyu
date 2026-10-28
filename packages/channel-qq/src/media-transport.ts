import { createHash } from 'node:crypto';
import type { Reply,ReplyMediaManifest,DeliveryResult } from '@dafeiyu/contracts';
import type { QqMediaDeliveryLedger,QqMediaDeliveryPlan,QqMediaDeliveryProgress } from './media-delivery.js';
import {deliveryAbortCode} from './reply-delay.js';
type MediaReply=Reply&{media:ReplyMediaManifest};
type Part=QqMediaDeliveryPlan['parts'][number];
interface Host {ledger:QqMediaDeliveryLedger;textProgress(id:string):{confirmed:number;unknown:number;state:string}|null;
  beforeSend?(reply:Reply,signal:AbortSignal):Promise<void>;
  betweenMessages?(signal:AbortSignal):Promise<void>;
  check(reply:Reply,signal:AbortSignal):Promise<void>;send(reply:MediaReply,part:Part,data:Uint8Array|null,signal:AbortSignal):Promise<string>;confirmed(reply:MediaReply,part:Part,receipt:string):void;}
const safe=(error:unknown)=>error instanceof Error&&/^[A-Z][A-Z0-9_]{0,99}$/.test(error.message)?error.message:'MEDIA_DELIVERY_PRECHECK_FAILED';
function result(value:QqMediaDeliveryProgress,code:string):DeliveryResult {if(value.state==='sent')return {status:'sent',receiptId:value.parts[0]!.receipt!};
  return value.confirmed||value.unknown||value.state==='sending'?{status:'unknown',code:value.unknown||value.state==='sending'?'PLATFORM_RESULT_UNKNOWN':'PARTIAL_DELIVERY'}:{status:'not-sent',code};}
/** No generation, file paths or re-rendering. Each approved part has one durable external-effect transition. */
export class QqMediaTransport {
  private readonly active=new Map<string,Promise<DeliveryResult>>();
  constructor(private readonly host:Host){}
  deliver(reply:MediaReply,signal:AbortSignal,authority:()=>void,bytes:(position:number)=>Promise<Uint8Array>):Promise<DeliveryResult>{if(typeof authority!=='function'||typeof bytes!=='function')return Promise.resolve({status:'not-sent',code:'TARGET_NOT_ALLOWED'});
    let plan:QqMediaDeliveryPlan;try{plan=this.host.ledger.prepare(reply);}catch(error){const old=this.host.ledger.progress(reply.id)??this.host.textProgress(reply.id);return Promise.resolve(old&&(old.confirmed||old.unknown||old.state==='sending')?{status:'unknown',code:'DELIVERY_PLAN_CONFLICT'}:{status:'not-sent',code:safe(error)});}
    const running=this.active.get(reply.id);if(running)return running;const progress=this.host.ledger.progress(reply.id)!;if(progress.state==='sent'||progress.unknown||progress.state==='sending')return Promise.resolve(result(progress,'DELIVERY_NOT_RESUMABLE'));
    const snapshot:MediaReply={id:plan.replyId,conversation:plan.target,sourceMessageId:plan.sourceMessageId,text:plan.originalText??plan.parts.filter(p=>p.kind==='text').map(p=>p.text).join(''),media:plan.manifest,...(plan.manifest.anchor.kind==='task-result'?{taskResult:plan.manifest.anchor}:{})};
    const work=this.execute(snapshot,plan,signal,authority,bytes).finally(()=>this.active.delete(reply.id));this.active.set(reply.id,work);return work;
  }
  private async execute(reply:MediaReply,plan:QqMediaDeliveryPlan,signal:AbortSignal,authority:()=>void,bytes:(position:number)=>Promise<Uint8Array>):Promise<DeliveryResult>{const guard=()=>{if(signal.aborted)throw new Error(deliveryAbortCode(signal));try{authority();}catch{throw new Error('DELIVERY_AUTHORITY_REVOKED');}};let mediaPosition=0,delayed=false;
    for(const [position,part] of plan.parts.entries()){const mediaIndex=part.kind==='text'?null:mediaPosition++;const progress=this.host.ledger.progress(reply.id)!;if(progress.state==='sent'||progress.unknown||progress.state==='sending')return result(progress,'DELIVERY_NOT_RESUMABLE');if(progress.parts[position]!.state==='sent')continue;
      let invoked=false;try{guard();let data:Buffer|null=null;
        if(part.kind!=='text'){data=Buffer.from(await bytes(mediaIndex!));if(data.length!==part.asset.bytes||data.length>16*1024**2||createHash('sha256').update(data).digest('hex')!==part.asset.sha256)throw new Error('MEDIA_BLOB_CORRUPT');}
        guard();if(!delayed&&progress.confirmed===0){await this.host.beforeSend?.(reply,signal);delayed=true;}else if(progress.confirmed>0)await this.host.betweenMessages?.(signal);guard();await this.host.check(reply,signal);guard();this.host.ledger.begin(reply.id,position);invoked=true;const receipt=await this.host.send(reply,part,data,signal);this.host.ledger.confirm(reply.id,position,receipt);this.host.confirmed(reply,part,receipt);
      }catch(error){const current=this.host.ledger.progress(reply.id)!;if(current.parts[position]!.state==='sending')this.host.ledger.unknown(reply.id,position,'PLATFORM_RESULT_UNKNOWN');else if(current.parts[position]!.state==='pending')this.host.ledger.defer(reply.id,position,safe(error));
        return result(this.host.ledger.progress(reply.id)!,invoked?'LOCAL_PROJECTION_FAILED':safe(error));}
    }return result(this.host.ledger.progress(reply.id)!,'DELIVERY_INCOMPLETE');
  }
}
