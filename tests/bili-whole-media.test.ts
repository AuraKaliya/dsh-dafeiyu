import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {BiliStore} from '../packages/bilibili/lib/store.js';
import {BiliClient} from '../packages/bilibili/lib/client.js';
import {BiliMedia} from '../packages/bilibili/lib/media.js';
import {BiliConfigSchema} from '../packages/bilibili/lib/config.js';
import {taskScopeKey} from '@dafeiyu/contracts';
import type {ExecutionContext,ExecutionGrant} from '@dafeiyu/contracts';
import {testTempDir} from './test-temp.js';

test('whole media acquisition uses a verified full range and rejects an inconsistent range response',async()=>{
  const root=await mkdtemp(join(testTempDir(),'bili-full-range-')),store=new BiliStore(join(root,'bilibili.sqlite'),{agentId:'fish',profileId:'fixture'},true);
  const bytes=Buffer.from('fixture complete media bytes'),ranges:string[]=[],taskId=randomUUID();let malformed=false;
  const context:ExecutionContext={agentId:'fish',taskId,scope:{kind:'task',agentId:'fish',taskId,scopeKey:taskScopeKey('fish',taskId)},runId:randomUUID(),operationId:randomUUID(),intentVersion:1,origin:{kind:'native',producerId:'fixture',requestId:'fixture'},signal:new AbortController().signal,grant:{} as ExecutionGrant};
  const client=new BiliClient(BiliConfigSchema.parse({minIntervalMs:100}),store,async(_url,headers)=>{
    const requested=headers.Range;ranges.push(requested??'none');assert.ok(requested,'This CDN rejects requests without Range');
    const match=/^bytes=(\d+)-(\d+)$/.exec(requested!)!,start=Number(match[1]),end=Number(match[2]),part=bytes.subarray(start,end+1);
    return {status:206,headers:{etag:'"stable-entity"','content-length':String(part.length),'content-range':`bytes ${start}-${malformed?end-1:end}/${bytes.length}`},body:(async function*(){yield part;})(),close(){}};
  }),media=new BiliMedia(store,client,()=>true);
  try{const prepared=await media.prepare({dash:{video:[{id:32,baseUrl:'https://cdn.bilivideo.com/fixture.mp4',codecs:'avc1.fixture',bandwidth:1}],audio:[]}}, {bvid:'BV1xNpFedEwH',cid:'123',durationMs:1000},context.signal,()=>{});
    store.begin(context,'register',{});store.complete(context,'register',{kind:'media',sourceKey:'media:fixture',data:prepared.data,fields:[],coverage:prepared.coverage},Date.now(),prepared.register);
    const key=prepared.data.streams[0]!.source.key,opened=await media.open(key,null,context.signal),received:Buffer[]=[];
    for await(const part of opened.stream)received.push(Buffer.from(part));assert.deepEqual(Buffer.concat(received),bytes);assert.equal(opened.range,null);
    assert.deepEqual(ranges,['bytes=0-0',`bytes=0-${bytes.length-1}`]);
    malformed=true;await assert.rejects(media.open(key,null,context.signal),/BILI_RANGE_UNCONFIRMED/);
  }finally{client.dispose();store.close();}
});
