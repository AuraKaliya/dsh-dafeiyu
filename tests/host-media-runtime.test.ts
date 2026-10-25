import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve,join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { MediaAssetRefSchema } from '@dafeiyu/contracts';
import { qqCapabilityFixture,bot,owner,scene,until,outcomes } from './qq-capabilities-fixture.js';
import { call,textReply } from './harness.js';
import { reconcileMedia } from '../packages/host/lib/media-recovery.js';
import { qqMediaHash } from '../packages/channel-qq/lib/media-delivery.js';

test('actual single-run Host assembles media, reads a document, retains selected evidence and restarts without model replay',async()=>{
  const result=await promisify(execFile)(process.execPath,[resolve('build-tests/host-media-runtime-fixture.js')],{cwd:resolve('.'),timeout:30000,maxBuffer:200000});const report=JSON.parse(result.stdout.trim().split('\n').at(-1)!);assert.equal(report.passed,true);assert.equal(report.realModel,false);assert.equal(report.serverAccess,false);
});

test('persisted QQ media receipts repair a failed export-state projection without another send or model call',async()=>{
  const h=await qqCapabilityFixture({media:true,mediaSend:true});try{const file=join(h.root,'onebot-cache/recovery.txt');await writeFile(file,'recovery fixture bytes');h.platform.mediaFiles.set('recovery',file);let step=0;
    h.setResponse(request=>{step++;if(step===1)return call('qq_media_list',{});if(step===2){const ref=z.object({media:z.array(z.object({ref:z.object({provider:z.string(),key:z.string()})}))}).parse(outcomes(request).at(-1)?.data).media[0]!.ref;return call('dafeiyu_media_acquire',{requestId:'get',source:ref});}
      if(step===3)return call('dafeiyu_media_reply',{requestId:'prepare',expectedVersion:0,parts:[{kind:'asset',asset:MediaAssetRefSchema.parse(outcomes(request).at(-1)?.data),as:'file'}]});return textReply('这份文件来自当前消息');});
    const settle=h.ctx.dafeiyuMedia.store.replies.settle.bind(h.ctx.dafeiyuMedia.store.replies);h.ctx.dafeiyuMedia.store.replies.settle=()=>{throw new Error('FIXTURE_SETTLEMENT_FAILED');};
    const count=h.ctx.dafeiyuQQ.getStatus().counters.received;h.emit({post_type:'message',self_id:Number(bot),message_id:1301,message_type:'group',group_id:Number(scene.id),user_id:Number(owner),time:1792886400,message:[{type:'at',data:{qq:bot}},{type:'file',data:{file:'recovery',name:'recovery.txt'}}]});await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.received>count);await h.core.whenIdle();
    assert.equal(h.platform.sent.length,2);assert.equal(h.ctx.dafeiyuMedia.store.replies.exports()[0]?.state,'ready');h.ctx.dafeiyuMedia.store.replies.settle=settle;const modelCalls=h.adapter.requests.length,sends=h.platform.sent.length;
    const db=new DatabaseSync(join(h.root,'qq/qq.sqlite'));try{const saved=db.prepare('SELECT reply_id,body,plan_hash FROM qq_media_deliveries').get()!;
      const changed=JSON.parse(String(saved.body));changed.manifest.expiresAt='2099-01-01T00:00:00.000Z';db.prepare('UPDATE qq_media_deliveries SET body=?,plan_hash=? WHERE reply_id=?').run(JSON.stringify(changed),qqMediaHash(changed),String(saved.reply_id));
      assert.deepEqual(reconcileMedia(h.core,h.ctx.dafeiyuMedia,join(h.root,'qq')),{settled:0,pending:0,conflicts:1});assert.equal(h.ctx.dafeiyuMedia.store.replies.exports()[0]?.state,'ready');
      db.prepare('UPDATE qq_media_deliveries SET body=?,plan_hash=? WHERE reply_id=?').run(String(saved.body),String(saved.plan_hash),String(saved.reply_id));
    }finally{db.close();}
    assert.deepEqual(reconcileMedia(h.core,h.ctx.dafeiyuMedia,join(h.root,'qq')),{settled:1,pending:0,conflicts:0});assert.equal(h.ctx.dafeiyuMedia.store.replies.exports()[0]?.state,'sent');
    assert.deepEqual(reconcileMedia(h.core,h.ctx.dafeiyuMedia,join(h.root,'qq')),{settled:0,pending:0,conflicts:0});assert.equal(h.adapter.requests.length,modelCalls);assert.equal(h.platform.sent.length,sends);
  }finally{await h.close();}
});
