import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { MessagePartSchema,MessageSchema,conversationKey } from '@dafeiyu/contracts';
import type { InboundMessage } from '@dafeiyu/contracts';

export const QqBatchConfigSchema=z.strictObject({enabled:z.boolean().default(false),quietMs:z.number().int().min(10).max(10000).default(5000),maxWaitMs:z.number().int().min(10).max(30000).default(15000),maxMessages:z.number().int().min(2).max(10).default(10)}).refine(v=>v.maxWaitMs>=v.quietMs);
const bodySchema=z.strictObject({started:z.number(),last:z.number(),parts:z.array(z.strictObject({message:MessagePartSchema,focused:z.boolean()})).min(1).max(10)});
export interface QqBatchHost {current(message:InboundMessage):boolean;submit(message:InboundMessage):void;failed():void}
/** Pending inputs are durable before acknowledgement. Submission is idempotent in Core. */
export class QqMessageBatches {
  private timer:ReturnType<typeof setTimeout>|undefined;
  private running=false;
  private readonly continuing=new Map<string,{until:number;source:InboundMessage}>();
  constructor(private readonly db:DatabaseSync,private readonly config:z.output<typeof QqBatchConfigSchema>,private readonly host:QqBatchHost,private readonly now=Date.now){}
  private lane(message:InboundMessage){return JSON.stringify([conversationKey('',message.conversation),message.sender.id]);}
  private waiting(lane?:string){return this.db.prepare("SELECT id,lane,body FROM qq_message_batches WHERE state='waiting'"+(lane?' AND lane=?':'')+' ORDER BY rowid').all(...(lane?[lane]:[])).map(row=>({id:String(row.id),lane:String(row.lane),body:bodySchema.parse(JSON.parse(String(row.body)))}));}
  private continuous(lane:string){const focus=this.continuing.get(lane);if(!focus||focus.until<=this.now()||!this.host.current(focus.source)){this.continuing.delete(lane);return false;}return true;}
  has(message:InboundMessage){const lane=this.lane(message);return this.waiting(lane).some(row=>row.body.parts.some(part=>this.host.current(part.message)))||this.continuous(lane);}
  discard(message:InboundMessage){const lane=this.lane(message);this.continuing.delete(lane);for(const row of this.waiting(lane))this.finish(row.id,'cancelled');this.arm();}
  enqueue(message:InboundMessage,focused:boolean){const lane=this.lane(message),now=this.now();let row=this.waiting(lane)[0];
    if(row?.body.parts.some(part=>part.message.id===message.id))return;
    if(row&&(row.body.parts.length>=this.config.maxMessages||row.body.parts.reduce((n,p)=>n+p.message.text.length,0)+message.text.length>32000||row.body.parts.reduce((n,p)=>n+(p.message.media?.length??0),0)+(message.media?.length??0)>8)){this.flush(row.id);row=undefined;}
    if(!row&&!focused){if(!this.continuous(lane))return;focused=true;}
    if(!row&&this.waiting().length>=256)throw new Error('QQ_BATCH_CAPACITY');
    const body=bodySchema.parse(row?{...row.body,last:now,parts:[...row.body.parts,{message,focused}]}:{started:now,last:now,parts:[{message,focused}]});
    if(row)this.db.prepare('UPDATE qq_message_batches SET body=? WHERE id=?').run(JSON.stringify(body),row.id);
    else this.db.prepare("INSERT INTO qq_message_batches VALUES(?,?,'waiting',?)").run(randomUUID(),lane,JSON.stringify(body));
    if(body.parts.length>=this.config.maxMessages)this.flush(this.waiting(lane)[0]!.id);this.arm();
  }
  private flush(id:string){const row=this.waiting().find(row=>row.id===id);if(!row)return;const parts=row.body.parts.filter(part=>this.host.current(part.message));
    if(!parts.some(part=>part.focused)){this.finish(id,'cancelled');return;}
    const originals=parts.map(part=>part.message),last=originals.at(-1)!;
    const message=MessageSchema.parse(originals.length===1?last:{...last,batch:{sources:originals}});
    // A forced size/time cut does not require another @ while the same speaker is still typing.
    if(row.body.last+this.config.quietMs>this.now())this.continuing.set(row.lane,{until:row.body.last+this.config.quietMs,source:message});
    else this.continuing.delete(row.lane);
    // Freeze the exact payload before handing it to Core, including a crash between these steps.
    this.db.prepare("UPDATE qq_message_batches SET state='submitting',body=? WHERE id=?").run(JSON.stringify(message),id);
    this.submit(id,message);
  }
  private submit(id:string,message:InboundMessage){if(!this.host.current(message)){this.finish(id,'cancelled');return;}
    try{this.host.submit(message);this.finish(id,'submitted');}catch{this.host.failed();}
  }
  private finish(id:string,state:string){this.db.prepare("UPDATE qq_message_batches SET state=?,body='{}' WHERE id=?").run(state,id);}
  drain(){if(!this.running)return;for(const row of this.db.prepare("SELECT id,body FROM qq_message_batches WHERE state='submitting'").all())this.submit(String(row.id),MessageSchema.parse(JSON.parse(String(row.body))));
    for(const lane of this.continuing.keys())this.continuous(lane);
    const now=this.now();for(const row of this.waiting()){
      const parts=row.body.parts.filter(part=>this.host.current(part.message));if(!parts.some(part=>part.focused)){this.finish(row.id,'cancelled');continue;}
      if(parts.length!==row.body.parts.length)this.db.prepare('UPDATE qq_message_batches SET body=? WHERE id=?').run(JSON.stringify({...row.body,parts}),row.id);
      if(now>=Math.min(row.body.last+this.config.quietMs,row.body.started+this.config.maxWaitMs))this.flush(row.id);
    }this.arm();
  }
  private arm(){if(this.timer)clearTimeout(this.timer);this.timer=undefined;if(!this.running)return;
    const deadlines=this.waiting().map(row=>Math.min(row.body.last+this.config.quietMs,row.body.started+this.config.maxWaitMs));if(!deadlines.length)return;
    this.timer=setTimeout(()=>{this.timer=undefined;try{this.drain();}catch{this.host.failed();}},Math.max(1,Math.min(30000,Math.min(...deadlines)-this.now())));this.timer.unref();
  }
  start(){this.running=true;this.drain();}
  pause(){this.running=false;this.continuing.clear();if(this.timer)clearTimeout(this.timer);this.timer=undefined;}
  count(){return Number(this.db.prepare("SELECT count(*) AS n FROM qq_message_batches WHERE state IN ('waiting','submitting')").get()?.n??0);}
}
