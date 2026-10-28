import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { BiliService,BILI_ACTIONS,BILI_SCENE } from '@dafeiyu/bilibili';
import { subtitleText,subtitleTracks,danmakuText } from '../packages/bilibili/lib/timed-text.js';
import { testTempDir } from './test-temp.js';
import { executionHarness } from './execution-fixture.js';
import { call,textReply } from './harness.js';
import { outcomes } from './qq-capabilities-fixture.js';
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

test('Task reads subtitle tracks, bounded text and a danmaku time window without any audio claims or URL exposure',async()=>{const root=await mkdtemp(join(testTempDir(),'bili-timed-'));let bili:BiliService|undefined,step=0,videoPageId='';const urls:URL[]=[];
  const h=await executionHarness(root,request=>{step++;if(step===1)return call('bili_video',{requestId:'video',bvid:'BV1xx411c7mD'});if(step===2){videoPageId=z.object({pageId:z.uuid()}).parse(outcomes(request).at(-1)?.data).pageId;return call('bili_subtitles',{requestId:'tracks',videoPageId,cid:'30',startMs:0,endMs:5000});}if(step===3)return call('bili_subtitles',{requestId:'text',videoPageId,cid:'30',startMs:0,endMs:5000,track:'7'});if(step===4)return call('bili_danmaku',{requestId:'dm',videoPageId,cid:'30',startMs:0,endMs:5000});return textReply('只读到字幕与弹幕，没有听过视频');},undefined,true,{extraActions:[...BILI_ACTIONS],resources:[BILI_SCENE],beforeActivate:async ctx=>{
    bili=new BiliService(ctx,{agentId:'dafeiyu',profileId:'test',dataDir:join(root,'core'),createStore:true,settings:{minIntervalMs:100}},async(url,headers)=>{urls.push(url);let data:unknown,raw:Buffer|undefined;
      if(url.hostname==='i0.hdslb.com'){assert.equal(headers.Cookie,undefined);raw=Buffer.from(JSON.stringify({body:[{from:0,to:4,content:'这是虚构字幕'}]}));}
      else if(url.pathname.endsWith('/nav'))data={wbi_img:{img_url:'https://i0.hdslb.com/'+'a'.repeat(32)+'.png',sub_url:'https://i0.hdslb.com/'+'b'.repeat(32)+'.png'}};
      else if(url.pathname.endsWith('/v2'))data={subtitle:{subtitles:[{id:7,lan:'zh',lan_doc:'中文',subtitle_url:'https://i0.hdslb.com/sub.json',ai_type:0}]}};
      else if(url.pathname.endsWith('seg.so'))raw=danmakuFixture();else data={bvid:'BV1xx411c7mD',aid:10,title:'虚构视频',desc:'虚构',duration:60,owner:{mid:20,name:'虚构'},pages:[{cid:30,page:1,part:'正片',duration:60}]};const payload=raw??Buffer.from(JSON.stringify({code:0,data}));return {status:200,headers:{},body:(async function*(){yield payload;})(),close(){}};
    });bili.recover();bili.activate();}});
  try{const accepted=h.port.submitTask({requestId:'timed',title:'时间文字',goal:'只读取字幕弹幕',policyId:'test-policy'});await h.core.whenIdle();assert.equal(h.port.status(accepted.run).state,'completed');assert.equal(step,5);const text=JSON.stringify(h.adapter.requests);assert.ok(text.includes('这是虚构字幕'));assert.ok(text.includes('虚构弹幕0'));assert.ok(!text.includes('https://i0.hdslb.com/sub.json'));assert.equal(urls.filter(u=>u.pathname.endsWith('seg.so')).length,1);
    const {biliOwner}=await import('../packages/bilibili/lib/store.js'),{taskScopeKey}=await import('@dafeiyu/contracts'),owner=biliOwner({scope:{kind:'task',agentId:'dafeiyu',taskId:accepted.task.id,scopeKey:taskScopeKey('dafeiyu',accepted.task.id)},intentVersion:1}),page=bili!.store.pages(owner).find(p=>p.kind==='danmaku')!;assert.equal(bili!.store.current(bili!.store.proof(page)),true);bili!.store.unavailable('video:BV1xx411c7mD');assert.equal(bili!.store.current(bili!.store.proof(page)),false);
  }finally{await bili!.close();await h.close();}
});
