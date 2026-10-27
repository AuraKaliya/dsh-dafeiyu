import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {MediaAnalysis} from '../packages/media/lib/analysis.js';
import {ScopedImages} from '../packages/media/lib/images.js';
import {harness,textReply} from './harness.js';
import {testTempDir} from './test-temp.js';

test('media cancellation settles even when a provider next promise has not yielded, and cannot publish its late output',async()=>{
  const root=await mkdtemp(join(testTempDir(),'media-cancel-'));let release!:()=>void,started!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;}),entered=new Promise<void>(resolve=>{started=resolve;});
  const h=await harness(root,async request=>{assert.equal(request.maxTokens,8192);started();await gate;return textReply('{"late":true}');}),images=new ScopedImages(h.ctx),analysis=new MediaAnalysis(h.ctx,images,join(root,'analysis')),controller=new AbortController();let published=false,timer:ReturnType<typeof setTimeout>|undefined;
  try{const work=analysis.run({route:{provider:'local-test',model:'scripted'},instructions:'cancel fixture',input:{},guard:()=>{},parse:()=>{published=true;return {}; }},controller.signal);
    const checked=assert.rejects(work,/MEDIA_ANALYSIS_TIMEOUT/);await entered;controller.abort(new DOMException('fixture deadline','TimeoutError'));
    await Promise.race([checked,new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('MEDIA_CANCELLATION_DID_NOT_SETTLE')),2000);})]);assert.equal(published,false);
  }finally{if(timer)clearTimeout(timer);release();images.close();await h.close();}
});
