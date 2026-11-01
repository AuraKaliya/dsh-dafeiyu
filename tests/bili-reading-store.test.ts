import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';

import { BiliStore } from '../packages/bilibili/lib/store.js';
import {readingResume,publicReadingRecord} from '../packages/bilibili/lib/reading-resume.js';
import {readingContext} from '../packages/bilibili/lib/reading-context.js';
import {redactJson} from '@dafeiyu/contracts';
import { taskScopeKey } from '@dafeiyu/contracts';
import type { ExecutionContext, ExecutionGrant } from '@dafeiyu/contracts';
import { testTempDir } from './test-temp.js';

const bvid = 'BV1xNpFedEwH';

function context(taskId = randomUUID()): ExecutionContext {
  return {
    agentId: 'fish', taskId, scope: { kind: 'task', agentId: 'fish', taskId, scopeKey: taskScopeKey('fish', taskId) },
    runId: randomUUID(), operationId: randomUUID(), origin: { kind: 'native', producerId: 'fixture', requestId: 'start' }, intentVersion: 1,
    grant: {} as ExecutionGrant, signal: new AbortController().signal,
  };
}

async function fixture() {
  const root = await mkdtemp(join(testTempDir(), 'bili-reading-')), file = join(root, 'bilibili.sqlite'), identity = { agentId: 'fish', profileId: 'test' };
  const first = context(), second = context();
  return { file, identity, first, second, store: new BiliStore(file, identity, true) };
}

const record = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1, bvid, title: '养鱼第一年', author: 'UP甲', status: 'checkpoint',
  watched: [{ cid: '123', startMs: 0, endMs: 60000 }], commentCursor: null,
  frames: [], sources: [], conclusion: null, gaps: [], nextStep: '继续读评论区', ...over,
});
test('media understanding remains historical evidence when validation receives the equivalent unleased view',async()=>{
  const f=await fixture(),leased=f.first,scope={...f.first,guard:()=>{}};let current=true;
  const receipt={exposureId:randomUUID(),pageId:randomUUID(),mode:'images',source:{id:randomUUID()},coverage:{exposed:true}};
  const contributor=readingContext(f.store,()=>scope,()=>true,view=>view===leased&&current?[receipt]:[]);
  try{const item=(await contributor.prepare(leased))[0]!;assert.deepEqual(JSON.parse(item.text).mediaReadings,[receipt]);
    assert.equal(contributor.validateHistorical?.({...leased},item),true,'A different object for the same run must use its original program grant');
    current=false;assert.equal(contributor.validateHistorical?.({...leased},item),false,'Revoking the media evidence still invalidates the history');
  }finally{f.store.close();}
});
test('final delivery can use the issued media capability after the preparation lease is released',async()=>{
  const f=await fixture(),receipt={exposureId:randomUUID(),pageId:randomUUID(),mode:'images'};let authorized=true;
  const scope={...f.first,guard:()=>{},historyGuard:()=>{if(!authorized)throw new Error('SOURCE_STALE');},mediaReadings:()=>[receipt]};
  const contributor=readingContext(f.store,()=>scope,()=>true,()=>[]);
  try{const item=(await contributor.prepare(f.first))[0]!;assert.deepEqual(JSON.parse(item.text).mediaReadings,[receipt]);
    assert.equal(contributor.validateHistorical?.({...f.first},item),true);
    authorized=false;assert.equal(contributor.validateHistorical?.({...f.first},item),false,'Releasing a temporary preparation lease differs from revoking the task authority');
  }finally{f.store.close();}
});

test('a large resume keeps every displayed frame/search source and stays within one context item',async()=>{
  const f=await fixture();try{
    const add=(kind:'video'|'search'|'browser',data:Record<string,unknown>)=>{
      const id=randomUUID();f.store.begin(f.first,id,{kind});
      const page=f.store.complete(f.first,id,{kind,sourceKey:kind+':'+randomUUID(),data:JSON.parse(JSON.stringify(data)),coverage:[],fields:[]});
      f.store.bindObservation(page,{id:randomUUID(),agentId:'fish',scopeKey:f.first.scope.kind==='task'?f.first.scope.scopeKey:'',version:1,contentHash:'a'.repeat(64),kind:'execution-source'});return page;
    };
    add('video',{bvid,aid:'900',pages:[{cid:'123',durationSeconds:60}]});
    const points=Array.from({length:30},(_,index)=>({positionMs:1000+index*1000,requestedMs:1000+index*1000,sourceKey:'frame:large-'+index,ok:true,errorCode:null}));
    add('browser',{bvid,section:'frames',points});
    for(let page=0;page<3;page++)add('search',{keyword:'很长关键词'+page,order:'pubdate',page:1,limit:5,nextPage:page+2,nextPageReason:'next-page',coverage:[],items:Array.from({length:8},(_,index)=>({bvid,aid:null,title:'很长的候选标题'.repeat(10)+index,author:'UP主'.repeat(10),publishedAt:null,views:100,durationSeconds:60}))});
    for(const [index,suffix] of ['wH','HJ','JK','KL','LM','MN','NP','PQ'].entries())f.store.saveReading(f.first,randomUUID(),record({bvid:'BV1xNpFedE'+suffix,title:'很长的阅读标题'.repeat(12),conclusion:'结论'.repeat(80)}));
    const scope={...f.first,guard:()=>{}},items=await readingContext(f.store,()=>scope,()=>true).prepare(f.first),item=items[0]!;
    assert.ok(Buffer.byteLength(item.text)<=16000);
    assert.ok(item.sources.length<=16);
    const parsed=JSON.parse(item.text) as {resume:{frames:{pageId:string}[]}[];search?:{pageId:string}[];omittedFrames?:number};
    const refs=new Set(item.sources.filter(source=>source.ref.startsWith('page:')).map(source=>source.ref.slice(5)));
    for(const frame of parsed.resume[0]?.frames??[])assert.ok(refs.has(frame.pageId),'Every displayed frame must have a validated page source');
    for(const group of parsed.search??[])assert.ok(refs.has(group.pageId),'Every displayed search group must have a validated page source');
    assert.ok((parsed.omittedFrames??0)>=0);
  }finally{f.store.close();}
});

test('search resume keeps the newest three pages and the selected video survives long pagination',async()=>{
  const f=await fixture();try{
    const add=(kind:'video'|'search'|'browser',data:Record<string,unknown>)=>{
      const id=randomUUID();f.store.begin(f.first,id,{kind});
      const page=f.store.complete(f.first,id,{kind,sourceKey:kind+':'+randomUUID(),data:JSON.parse(JSON.stringify(data)),coverage:[],fields:[]});
      f.store.bindObservation(page,{id:randomUUID(),agentId:'fish',scopeKey:f.first.scope.kind==='task'?f.first.scope.scopeKey:'',version:1,contentHash:'a'.repeat(64),kind:'execution-source'});return page;
    };
    add('video',{bvid,aid:'900',pages:[{cid:'123',durationSeconds:60}]});
    for(let page=0;page<4;page++)add('search',{keyword:'关键词'+page,order:'pubdate',page:1,limit:5,nextPage:null,nextPageReason:'platform-no-more',coverage:[],items:[]});
    for(let index=0;index<70;index++)add('browser',{bvid,section:'comments',item:index});
    const resumed=readingResume(f.store,f.first);
    assert.deepEqual(resumed.search?.map(group=>group.keyword),['关键词3','关键词2','关键词1']);
    assert.ok(resumed.resume[0]?.videoPageId,'The selected video must survive pages outside the recent-64 window');
    assert.ok((resumed.resume[0]?.sources.length??0)<=16);
    const scope={...f.first,guard:()=>{}},items=await readingContext(f.store,()=>scope,()=>true).prepare(f.first);
    assert.ok((items[0]?.sources.length??0)<=16);
  }finally{f.store.close();}
});

test('search candidates and captured frames survive as resumable work before any judgement',async()=>{
  const f=await fixture();try{
    const add=(kind:'video'|'search'|'browser',data:Record<string,unknown>)=>{
      const id=randomUUID();f.store.begin(f.first,id,{kind});
      const page=f.store.complete(f.first,id,{kind,sourceKey:kind+':'+randomUUID(),data:JSON.parse(JSON.stringify(data)),coverage:[],fields:[]});
      f.store.bindObservation(page,{id:randomUUID(),agentId:'fish',scopeKey:f.first.scope.kind==='task'?f.first.scope.scopeKey:'',version:1,contentHash:'a'.repeat(64),kind:'execution-source'});return page;
    };
    add('search',{keyword:'养鱼',order:'pubdate',page:1,limit:5,nextPage:2,nextPageReason:'next-page',coverage:[],items:[{bvid,aid:null,title:'养鱼第一年',author:'UP甲',publishedAt:null,views:100,durationSeconds:60}]});
    add('video',{bvid,aid:'900',pages:[{cid:'123',durationSeconds:60}]});
    add('browser',{bvid,section:'frames',points:[{positionMs:12000,requestedMs:12000,sourceKey:'frame:captured-1',ok:true,errorCode:null}]});
    const resumed=readingResume(f.store,f.first);
    assert.equal(resumed.search?.[0]?.keyword,'养鱼');
    assert.equal(resumed.search?.[0]?.nextPage,2);
    assert.equal(resumed.resume[0]?.frames[0]?.sourceKey,'frame:captured-1');
    assert.match(resumed.resume[0]?.nextStep??'',/视觉理解/u);
  }finally{f.store.close();}
});

test('observed page handles survive a segment before judgement, remain task-scoped and validate invalidation',async()=>{
  const f=await fixture();try{
    const add=(kind:'video'|'subtitles',data:Record<string,unknown>)=>{
      const id=randomUUID();f.store.begin(f.first,id,{kind});
      const page=f.store.complete(f.first,id,{kind,sourceKey:kind+':fixture',data:JSON.parse(JSON.stringify(data)),coverage:[],fields:[]});
      f.store.bindObservation(page,{id:randomUUID(),agentId:'fish',scopeKey:f.first.scope.kind==='task'?f.first.scope.scopeKey:'',version:1,contentHash:'a'.repeat(64),kind:'execution-source'});return page;
    };
    const video=add('video',{bvid,aid:'900',pages:[{cid:'123',durationSeconds:60}]}),subtitle=add('subtitles',{bvid,cid:'123',track:{id:'456'},range:{startMs:0,endMs:60000},offset:0,nextOffset:5});
    assert.equal(f.store.reading(f.first,bvid),null);
    const resume=readingResume(f.store,f.first).resume[0]!;assert.equal(resume.videoPageId,video.id);assert.equal(resume.subtitle?.nextOffset,5);assert.equal(resume.judgementSaved,false);assert.deepEqual(readingResume(f.store,f.second).resume,[]);
    const scope={...f.first,guard:()=>{}},contributor=readingContext(f.store,()=>scope,()=>true),items=await contributor.prepare(f.first);
    assert.ok(Buffer.byteLength(JSON.stringify(items))<6000);assert.equal(contributor.validate(f.first,items[0]!),true);
    f.store.unavailable(subtitle.sourceKey);assert.equal(contributor.validateHistorical?.(f.first,items[0]!),false);
  }finally{f.store.close();}
});

test('a saved comment cursor remains readable without being confused with a credential',async()=>{
  const f=await fixture();try{
    const cursorId=randomUUID(),saved=f.store.saveReading(f.first,randomUUID(),record({commentCursor:{aid:'900',parent:null,sort:'hot',page:2,seen:[],token:cursorId}}));
    const visible=publicReadingRecord(saved);assert.equal(redactJson(JSON.parse(JSON.stringify(visible))).redacted,false);
    assert.equal('cursor' in visible.commentCursor!&&visible.commentCursor.cursor,cursorId);
    assert.equal(f.store.reading(f.first,bvid)?.commentCursor?.token,cursorId);
  }finally{f.store.close();}
});

test('reading records are scoped to the task and carry a record version', async () => {
  const f = await fixture();
  try {
    const saved = f.store.saveReading(f.first, randomUUID(), record());
    assert.equal(saved.version, 1);
    assert.equal(f.store.reading(f.first, bvid)!.nextStep, '继续读评论区');
    assert.equal(f.store.reading(f.second, bvid), null, 'another task must not see this progress');

    const again = f.store.saveReading(f.first, randomUUID(), record({ nextStep: '看评论' }));
    assert.equal(again.version, 2);
    assert.equal(f.store.reading(f.first, bvid)!.version, 2);

    const reopened = new BiliStore(f.file, f.identity);
    try {
      assert.equal(reopened.reading(f.first, bvid)!.version, 2);
      assert.equal(reopened.readingSummary(f.second).total, 0);
    } finally { reopened.close(); }
  } finally { }
});

test('reading summary is per task and bounded', async () => {
  const f = await fixture();
  try {
    for (let index = 0; index < 5; index += 1)
      f.store.saveReading(f.first, randomUUID(), record({ bvid: 'BV1xNpFedE' + 'ABCDE'[index]! + '1', title: '视频' + index }));
    const summary = f.store.readingSummary(f.first, 2);
    assert.equal(summary.total, 5);
    assert.equal(summary.recent.length, 2);
    assert.equal(f.store.readingSummary(f.second).total, 0);
  } finally { f.store.close(); }
});

test('closed records need a conclusion or a recorded gap', async () => {
  const f = await fixture();
  try {
    assert.throws(() => f.store.saveReading(f.first, randomUUID(), record({ status: 'closed' })), /conclusion/i);
    assert.equal(f.store.saveReading(f.first, randomUUID(), record({ status: 'closed', gaps: ['没有字幕'] })).status, 'closed');
  } finally { f.store.close(); }
});

test('a replayed save returns the original receipt and changed parameters conflict', async () => {
  const f = await fixture();
  try {
    const requestId = randomUUID();
    const first = f.store.saveReading(f.first, requestId, record());
    const repeat = f.store.saveReading(f.first, requestId, record());
    assert.equal(repeat.version, first.version);
    assert.equal(repeat.conclusion, first.conclusion);
    assert.throws(() => f.store.saveReading(f.first, requestId, record({ nextStep: '不应写入' })), /BILI_READING_REQUEST_CONFLICT/);

    const next = f.store.saveReading(f.first, randomUUID(), record({ nextStep: '看评论' }));
    assert.equal(next.version, 2);
    const replay = f.store.saveReading(f.first, requestId, record());
    assert.equal(replay.version, first.version);
    assert.equal(replay.nextStep, first.nextStep);
  } finally { f.store.close(); }
});

test('the reading index stays bounded as a task accumulates videos', async () => {
  const f = await fixture();
  try {
    const suffixes = ['11', '22', '33', '44', '55', '66', '77', '88', '99', 'AA', 'BB', 'CC', 'DD', 'EE', 'FF', 'GG', 'HH', 'JJ', 'KK', 'LL'];
    for (const [index, suffix] of suffixes.entries()) {
      f.store.saveReading(f.first, randomUUID(), record({ bvid: 'BV1xNpFedE' + suffix, title: '视频' + index, updatedAt: new Date(Date.now() - index * 1000).toISOString() }));
    }
    const summary = f.store.readingSummary(f.first);
    assert.equal(summary.total, 20);
    assert.equal(summary.recent.length, 8);
    assert.ok(JSON.stringify(summary).length < 4096, 'index must stay small: ' + JSON.stringify(summary).length);
    const view = f.store.readingView(f.first);
    assert.equal(view.total, 20);
    assert.equal(view.recent.length, 8);
    assert.ok(JSON.stringify(view).length < 4096);
  } finally { f.store.close(); }
});

test('reading saves accept the persona request id format used by tools', async () => {
  const f = await fixture();
  try {
    const saved = f.store.saveReading(f.first, 'reading-1', record({ title: '工具请求' }));
    assert.equal(saved.title, '工具请求');
    assert.equal(f.store.reading(f.first, bvid)!.title, '工具请求');
  } finally { f.store.close(); }
});
