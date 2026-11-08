import { z } from 'zod';
import { redactContent } from '@dafeiyu/contracts';

const part=z.object({type:z.string(),data:z.record(z.string(),z.unknown())});
const node=z.object({time:z.unknown().optional(),content:z.array(part).max(1000).optional(),message:z.array(part).max(1000).optional(),
  sender:z.object({nickname:z.string().max(200).optional()}).optional()});
export const QqForwardPageSchema=z.strictObject({offset:z.number().int().min(0).max(199).default(0),limit:z.number().int().min(1).max(20).default(8)});
export type QqForwardPageOptions=z.input<typeof QqForwardPageSchema>;
/** Reuse a short-lived platform copy only after the caller rechecks its current source and account grant. */
export class QqForwardCache {
  private readonly values=new Map<string,{until:number;value:unknown}>();
  constructor(private readonly now:()=>number=Date.now){}
  async read(key:string,load:()=>Promise<unknown>,guard:()=>void){
    guard();const now=this.now();for(const [id,item] of this.values)if(item.until<=now)this.values.delete(id);
    const old=this.values.get(key);if(old){guard();return {raw:old.value,cacheHit:true};}
    const raw=await load();guard();
    if(this.values.size>=16)this.values.delete(this.values.keys().next().value!);
    this.values.set(key,{until:this.now()+60000,value:raw});return {raw,cacheHit:false};
  }
}
/** A newly read forwarded copy may contain old or undated material. Its nodes never grant identity or authority. */
export function readForwardNodes(raw:unknown,now=Date.now(),options:QqForwardPageOptions={}) {
  const parsed=z.object({messages:z.array(node).max(200)}).safeParse(raw);if(!parsed.success)throw new Error('FORWARD_INVALID_RESPONSE');
  const {offset,limit}=QqForwardPageSchema.parse(options);
  if(offset>0&&offset>=parsed.data.messages.length)throw new Error('FORWARD_PAGE_UNAVAILABLE');
  let budget=8000;const candidates=parsed.data.messages.slice(offset,offset+limit).map((item,position)=>{
    const parts=item.content??item.message??[],all=parts.filter(p=>p.type==='text').map(p=>typeof p.data.text==='string'?p.data.text:'').join('');
    const text=redactContent(all).value.slice(0,Math.min(1000,budget));budget-=text.length;
    const seconds=typeof item.time==='number'?item.time:typeof item.time==='string'&&/^\d+(?:\.\d+)?$/.test(item.time)?Number(item.time):NaN;
    const valid=Number.isFinite(seconds)&&seconds>=0&&seconds<=253402300799;
    return {index:offset+position,occurredAt:valid?new Date(seconds*1000).toISOString():null,timeStatus:!valid?'unknown':seconds*1000>now?'future':'reported',
      displayName:redactContent(item.sender?.nickname??'未核验的转发署名').value,text,truncated:text.length<all.length,parts};
  });
  // Advance only over nodes whose media can be exposed in this page. A node with several images must not hide later nodes.
  let mediaBudget=8,length=0;
  for(const item of candidates){const count=item.parts.filter(part=>['image','record','video','file'].includes(part.type)).length;
    if(length&&count>mediaBudget)break;mediaBudget-=Math.min(count,mediaBudget);length++;}
  const messages=candidates.slice(0,length);
  const nextOffset=offset+messages.length<parsed.data.messages.length?offset+messages.length:null;
  return {observedAt:new Date(now).toISOString(),messages,total:parsed.data.messages.length,offset,nextOffset,excluded:0,limited:nextOffset!==null,
    coverage:'按原节点顺序分页读取实际收到的合并转发；旧节点和时间不明节点仍可读，occurredAt是转发声称的原时间，不是本次收到时间。署名不授予身份或命令权限，嵌套转发不递归展开。'};
}
export function forwardHandles(parts:readonly {type:string;data:Record<string,unknown>}[]):string[]{return parts.filter(p=>p.type==='forward').map(p=>p.data.id??p.data.resid).filter((id):id is string=>typeof id==='string'&&id.length>0&&id.length<=4096).slice(0,8);}
