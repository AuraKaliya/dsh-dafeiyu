import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as wait} from 'node:timers/promises';
import {BiliStore} from '../packages/bilibili/lib/store.js';
import {BiliClient} from '../packages/bilibili/lib/client.js';
import {BiliConfigSchema} from '../packages/bilibili/lib/config.js';
import {testTempDir} from './test-temp.js';

test('a progressing media body may outlive the API deadline without restarting the download',{timeout:10000},async()=>{
  const root=await mkdtemp(join(testTempDir(),'bili-progress-deadline-')),store=new BiliStore(join(root,'bili.sqlite'),{agentId:'fish',profileId:'fixture'},true);let requests=0;
  const client=new BiliClient(BiliConfigSchema.parse({minIntervalMs:100,timeoutMs:1000,mediaIdleTimeoutMs:1000}),store,async()=>{requests++;return {status:200,headers:{'content-length':'4'},body:(async function*(){for(let i=0;i<4;i++){await wait(400);yield Buffer.from([i]);}})(),close(){}};});
  try{const opened=await client.external('https://cdn.bilivideo.com/progress.mp4','media',null,AbortSignal.timeout(7000),()=>{}),bytes:number[]=[];
    for await(const chunk of opened.response.body){opened.signal.throwIfAborted();bytes.push(...chunk);}assert.deepEqual(bytes,[0,1,2,3]);assert.equal(requests,1);
  }finally{client.dispose();store.close();}
});

test('a stalled media body fails with a durable body-stage timeout instead of an API-header success',{timeout:10000},async()=>{
  const root=await mkdtemp(join(testTempDir(),'bili-stall-deadline-')),store=new BiliStore(join(root,'bili.sqlite'),{agentId:'fish',profileId:'fixture'},true);
  const client=new BiliClient(BiliConfigSchema.parse({minIntervalMs:100,timeoutMs:1000,mediaIdleTimeoutMs:1000}),store,async()=>({status:200,headers:{'content-length':'1'},body:(async function*(){await wait(1800);yield Buffer.from([1]);})(),close(){}}));
  try{const opened=await client.external('https://cdn.bilivideo.com/stalled.mp4','media',null,AbortSignal.timeout(7000),()=>{}),started=performance.now();
    await assert.rejects(async()=>{for await(const _chunk of opened.response.body)assert.fail('stalled data must not be accepted');},/BILI_MEDIA_IDLE_TIMEOUT/);
    assert.ok(performance.now()-started<1600);const attempt=store.diagnostics.recent(1)[0]!;
    assert.equal(attempt.outcome,'failed');assert.equal(attempt.errorCode,'BILI_MEDIA_IDLE_TIMEOUT');assert.equal(attempt.kind,'network');
  }finally{client.dispose();store.close();}
});
