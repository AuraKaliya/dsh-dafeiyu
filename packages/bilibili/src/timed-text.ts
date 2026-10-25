import { z } from 'zod';
import { plain,platformId } from './pages.js';
import { biliUrl } from './http.js';

export function subtitleTracks(raw:unknown){const result=z.object({subtitle:z.object({subtitles:z.array(z.object({id_str:platformId.optional(),id:z.union([z.string(),z.number()]).optional(),lan:z.string().max(100),lan_doc:z.string().max(200),subtitle_url:z.string().max(8192),ai_type:z.number().optional()})).max(100)}).optional()}).parse(raw);
  return (result.subtitle?.subtitles??[]).map(t=>{const id=t.id_str??platformId.parse(t.id);return {id,language:t.lan,label:plain(t.lan_doc,100),automatic:t.ai_type===undefined?null:t.ai_type!==0,url:biliUrl(t.subtitle_url,'subtitle').href};});}
export function subtitleText(raw:unknown,startMs:number,endMs:number,offset:number,limit:number){const value=z.object({body:z.array(z.object({from:z.number().nonnegative().finite(),to:z.number().nonnegative().finite(),content:z.string().max(100000)})).max(20000)}).parse(raw);
  if(value.body.some(r=>r.to<r.from))throw new Error('BILI_SUBTITLE_RANGE_INVALID');const matching=value.body.filter(r=>r.from*1000<endMs&&r.to*1000>startMs),selected=matching.slice(offset,offset+limit);
  return {entries:selected.map(r=>({startMs:r.from*1000,endMs:r.to*1000,text:plain(r.content,400)})),received:matching.length,nextOffset:offset+limit<matching.length?offset+limit:null,range:{startMs,endMs},coverage:['平台字幕文字；不代表音频识别','仅所选区间与分页，每条最多400字符']};}
/** The fixed DmSegMobileReply/DanmakuElem fields we use; no code generation or schema fetch at runtime. */
class Wire {
  offset=0;
  constructor(readonly bytes:Uint8Array){}
  varint(){let value=0n;for(let i=0;i<10;i++){if(this.offset>=this.bytes.length)throw new Error('BILI_PROTO_TRUNCATED');const byte=this.bytes[this.offset++]!;if(i===9&&byte>1)throw new Error('BILI_PROTO_INVALID');value|=BigInt(byte&127)<<BigInt(i*7);if(!(byte&128))return value;}throw new Error('BILI_PROTO_INVALID');}
  field(){const tag=this.varint();if(tag>0xffffffffn||tag<8n)throw new Error('BILI_PROTO_INVALID');return {id:Number(tag>>3n),wire:Number(tag&7n)};}
  block(){const size=this.varint();if(size>BigInt(this.bytes.length-this.offset))throw new Error('BILI_PROTO_TRUNCATED');const result=this.bytes.subarray(this.offset,this.offset+Number(size));this.offset+=Number(size);return result;}
  skip(wire:number){if(wire===0){this.varint();return;}if(wire===2){this.block();return;}const size=wire===1?8:wire===5?4:0;if(!size||this.offset+size>this.bytes.length)throw new Error('BILI_PROTO_INVALID');this.offset+=size;}
}
export function danmakuText(bytes:Uint8Array,startMs:number,endMs:number,offset:number,limit:number){const root=new Wire(bytes),items:{id:string;atMs:number;mode:number;text:string}[]=[];let count=0,fields=0;
  while(root.offset<bytes.length){if(++fields>100000)throw new Error('BILI_PROTO_LIMIT');const outer=root.field();if(outer.id!==1||outer.wire!==2){root.skip(outer.wire);continue;}if(++count>20000)throw new Error('BILI_PROTO_LIMIT');const row=new Wire(root.block());let id:string|null=null,at:number|null=null,text:string|null=null,mode=1,n=0;
    while(row.offset<row.bytes.length){if(++n>64)throw new Error('BILI_PROTO_LIMIT');const f=row.field();if(f.id===1&&f.wire===0)id=row.varint().toString();else if(f.id===2&&f.wire===0){const value=row.varint();if(value>2147483647n)throw new Error('BILI_PROTO_INVALID');at=Number(value);}else if(f.id===3&&f.wire===0){const value=row.varint();if(value>100n)throw new Error('BILI_PROTO_INVALID');mode=Number(value);}
      else if((f.id===7||f.id===12)&&f.wire===2){const value=new TextDecoder('utf-8',{fatal:true}).decode(row.block());if(f.id===12){if(!/^\d{1,30}$/.test(value))throw new Error('BILI_PROTO_INVALID');id=value;}else text=plain(value,300);}else row.skip(f.wire);}
    if(id===null||at===null||text===null)throw new Error('BILI_PROTO_INVALID');if(at>=startMs&&at<endMs)items.push({id,atMs:at,mode,text});
  }
  return {items:items.slice(offset,offset+limit),received:count,matching:items.length,nextOffset:offset+limit<items.length?offset+limit:null,range:{startMs,endMs},coverage:['平台六分钟弹幕段内按时间筛选；不是全部历史弹幕','每条文字最多300字符，分页保持同一区间']};}
