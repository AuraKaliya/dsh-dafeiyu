import type {DeliveryResult,PendingMessage} from '@dafeiyu/contracts';
import type {DeliveryChannel} from './delivery-channel.js';
import type {FeedbackLedger,FeedbackRecord} from './feedback-ledger.js';

export interface FeedbackTarget {
  readonly item:PendingMessage;
  readonly channel:DeliveryChannel;
}

export interface FeedbackDispatchPorts {
  readonly ledger:FeedbackLedger;
  target(record:FeedbackRecord):FeedbackTarget|null;
  deliver(record:FeedbackRecord,target:FeedbackTarget,deliveryId:string):Promise<DeliveryResult>;
  sent(record:FeedbackRecord,target:FeedbackTarget,result:DeliveryResult,deliveryId:string):void;
  pressure():{readonly interactiveActive:number;readonly interactiveWaiting:number};
}

/**
 * Sends already-generated feedback obligations through the existing channel queue.
 * It never generates text and never invents a target; must-know items may be sent while
 * chat is active, worth-sharing items only when no interactive work is active/waiting.
 */
export class FeedbackDispatcher {
  constructor(private readonly ports:FeedbackDispatchPorts,private readonly maxAttempts=3,private readonly maxPerTick=2){}

  async dispatch(now=Date.now()):Promise<number>{
    const routes=this.ports.ledger.routes();
    const mustKnow=routes.flatMap(route=>this.ports.ledger.due(route,now)).filter(record=>record.attempts<this.maxAttempts)
      .sort((left,right)=>(left.dueAt??'').localeCompare(right.dueAt??''));
    const pressure=this.ports.pressure();
    const idle=pressure.interactiveActive===0&&pressure.interactiveWaiting===0;
    const worth=idle?routes.flatMap(route=>this.ports.ledger.worthSharing(route,now))
      .filter(record=>record.attempts<this.maxAttempts)
      .sort((left,right)=>left.createdAt.localeCompare(right.createdAt)):[];
    let sent=0;
    for(const record of [...mustKnow,...worth].slice(0,this.maxPerTick)){
      const target=this.ports.target(record);
      if(!target)continue;
      const deliveryId=`feedback:${record.id}:${record.attempts+1}`;
      try{
        this.ports.ledger.beginSend(record.id,record.route,deliveryId);
      }catch{continue;}
      const result=await this.ports.deliver(record,target,deliveryId);
      if(result.status==='sent'){
        this.ports.ledger.markSent(record.id,deliveryId,record.route);
        this.ports.sent(record,target,result,deliveryId);
        sent++;
      }else{
        this.ports.ledger.release(record.id,record.route,result.status==='not-sent'?result.code:'DELIVERY_UNKNOWN');
      }
    }
    return sent;
  }
}
