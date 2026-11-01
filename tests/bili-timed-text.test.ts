import assert from 'node:assert/strict';
import test from 'node:test';
import { danmakuText,subtitleText,subtitleTracks } from '../packages/bilibili/lib/timed-text.js';
import {allowedMediaUrl} from '../packages/bilibili/lib/media.js';
test('subtitle batches advance by the rows actually returned without skipping oversized pages',()=>{
  const body=Array.from({length:100},(_,index)=>({from:index,to:index+1,content:String(index)+':'+ '字幕'.repeat(180)}));
  const seen:number[]=[];let offset=0;
  for(;;){const page=subtitleText({body},0,100000,offset,50);assert.ok(JSON.stringify(page.entries).length<5500);seen.push(...page.entries.map(entry=>entry.startMs/1000));if(page.nextOffset===null)break;assert.ok(page.nextOffset>offset);offset=page.nextOffset;}
  assert.deepEqual(seen,Array.from({length:100},(_,index)=>index));
});
test('media selection can use a permitted CDN backup without permitting other hosts or ports',()=>{
  assert.equal(allowedMediaUrl({baseUrl:'https://peer.bilivideo.com:4483/video',backupUrl:['https://cdn.bilivideo.com/video']}),'https://cdn.bilivideo.com/video');
  assert.throws(()=>allowedMediaUrl({baseUrl:'http://cdn.bilivideo.com/video',backupUrl:['https://other.example/video']}),/BILI_URL_DENIED/);
});
const varint=(v:number)=>{const parts:number[]=[];do{const b=v&127;v=Math.floor(v/128);parts.push(b|(v?128:0));}while(v);return Buffer.from(parts);};
const bytes=(id:number,data:Buffer)=>Buffer.concat([varint(id*8+2),varint(data.length),data]);
export const danmakuFixture=()=>Buffer.concat([1000,2000,12000].map((at,i)=>bytes(1,Buffer.concat([Buffer.from([8]),varint(i+1),Buffer.from([16]),varint(at),bytes(7,Buffer.from('虚构弹幕'+i)),bytes(12,Buffer.from(String(100+i)))]))));

test('subtitle and protobuf parsers preserve timestamps, pagination and explicit text-only coverage',()=>{
  const data={body:[{from:0,to:2,content:'字幕甲'},{from:2,to:4,content:'字幕乙'},{from:8,to:10,content:'字幕丙'}]},first=subtitleText(data,0,5000,0,1),second=subtitleText(data,0,5000,first.nextOffset!,1);assert.equal(first.nextOffset,1);assert.equal(second.entries[0]!.text,'字幕乙');assert.equal(second.nextOffset,null);
  assert.throws(()=>subtitleText({body:[{from:4,to:2,content:'错误'}]},0,5000,0,5),/RANGE/);
  const tracks=subtitleTracks({subtitle:{subtitles:[{id:1e18,id_str:'1000000000000000001',lan:'zh-CN',lan_doc:'自动中文',subtitle_url:'//i0.hdslb.com/sub.json',ai_type:1}]}});assert.equal(tracks[0]!.id,'1000000000000000001');assert.equal(tracks[0]!.automatic,true);
  const dm=danmakuText(danmakuFixture(),0,5000,0,1);assert.equal(dm.items[0]?.atMs,1000);assert.equal(dm.received,3);assert.equal(dm.matching,2);assert.equal(dm.nextOffset,1);assert.equal(danmakuText(danmakuFixture(),0,5000,1,1).items[0]?.id,'101');
  assert.throws(()=>danmakuText(Buffer.from([10,255,255,127]),0,1000,0,5),/TRUNCATED/);assert.throws(()=>danmakuText(Buffer.from([11]),0,1000,0,5),/INVALID/);
});
