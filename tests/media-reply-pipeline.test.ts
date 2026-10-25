import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { DatabaseSync } from 'node:sqlite';
import { MediaAssetRefSchema,conversationKey } from '@dafeiyu/contracts';
import { qqCapabilityFixture,bot,owner,privateScene,scene,until,outcomes } from './qq-capabilities-fixture.js';
import { call,textReply } from './harness.js';
import { createImageFixture } from './phase1-image-fixture.js';
import type { MediaAssetRef } from '@dafeiyu/contracts';

for(const mode of ['image','file'] as const)test(`a ${mode} draft is bound to actual final text and exports only its verified scoped bytes`,async()=>{
  const h=await qqCapabilityFixture({media:true});try{const original=createImageFixture(91).data,file=join(h.root,'onebot-cache/reply.png');await writeFile(file,original);h.platform.mediaFiles.set('reply-picture',file);let step=0;
    h.setResponse(request=>{step++;if(step===1)return call('qq_media_list',{});if(step===2){const list=z.object({media:z.array(z.object({ref:z.object({provider:z.string(),key:z.string()})}))}).parse(outcomes(request).at(-1)?.data);return call('dafeiyu_media_acquire',{requestId:'acquire',source:list.media[0]!.ref});}
      if(step===3)return call('dafeiyu_media_reply',{requestId:'prepare',expectedVersion:0,parts:[{kind:'asset',asset:MediaAssetRefSchema.parse(outcomes(request).at(-1)?.data),as:mode}]});return textReply('这份媒体准备作为回复附件。');});
    const received=h.ctx.dafeiyuQQ.getStatus().counters.received;h.emit({post_type:'message',self_id:Number(bot),message_id:901,message_type:'private',user_id:Number(owner),time:1792886400,message:[{type:'image',data:{file:'reply-picture',name:'reply.png'}}]});await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.received>received);await h.core.whenIdle();
    const item=h.core.journal.messageFor({agentId:'dafeiyu',route:conversationKey('dafeiyu',privateScene)},'901')!;assert.equal(item.state,'reply-ready');assert.equal(h.platform.sent.length,0,'unsupported media transport must not silently send text only');
    assert.ok(h.core.journal.events(item.route).some(e=>e.data.code==='MEDIA_DELIVERY_NOT_CONFIGURED'));
    const choice=z.object({draftId:z.string()}).parse(outcomes(h.adapter.requests.at(-1)!).at(-1)?.data),draft=h.ctx.dafeiyuMedia.store.replies.draft(choice.draftId),abort=new AbortController();
    const access=await h.core.prepareMediaReplyAccess(draft.authority,item.reply!,abort.signal);
    try{const manifest=await h.ctx.dafeiyuMedia.finalizeReply(access);assert.ok(manifest);assert.equal(manifest.parts[0]?.kind,mode);const data=await h.ctx.dafeiyuMedia.readReplyPart(access,manifest.id,0);assert.equal(createHash('sha256').update(data).digest('hex'),manifest.parts[0]!.asset.sha256);
      if(mode==='file')assert.deepEqual(Buffer.from(data),original);else assert.equal(Buffer.from(data).subarray(0,8).toString('hex'),'89504e470d0a1a0a');
      await assert.rejects(h.ctx.dafeiyuMedia.finalizeReply({...access}),/SCOPE_DENIED/);await assert.rejects(h.ctx.dafeiyuMedia.readReplyPart(access,manifest.id,1),/BINDING_INVALID/);
      assert.deepEqual(await h.ctx.dafeiyuMedia.finalizeReply(access),manifest);abort.abort();await assert.rejects(h.ctx.dafeiyuMedia.readReplyPart(access,manifest.id,0));
      h.ctx.dafeiyuMedia.settleReply(access,manifest.id,'unknown');assert.equal(h.ctx.dafeiyuMedia.store.replies.exported(item.reply!.id)?.state,'unknown');
    }finally{access.release();}
    assert.equal(h.platform.visionReads,0,'output byte normalization does not claim a model understood the image');
  }finally{await h.close();}
});

test('a draft can be cancelled by a confirmed new version, but foreign scopes and changed bytes cannot be exported',async()=>{
  const h=await qqCapabilityFixture({media:true});let asset:MediaAssetRef|undefined;try{const file=join(h.root,'onebot-cache/file.txt');await writeFile(file,'source bytes');h.platform.mediaFiles.set('document',file);let step=0;
    h.setResponse(request=>{step++;if(step===1)return call('qq_media_list',{});if(step===2){const value=z.object({media:z.array(z.object({ref:z.object({provider:z.string(),key:z.string()})}))}).parse(outcomes(request).at(-1)?.data);return call('dafeiyu_media_acquire',{requestId:'source',source:value.media[0]!.ref});}
      if(step===3){asset=MediaAssetRefSchema.parse(outcomes(request).at(-1)?.data);return call('dafeiyu_media_reply',{requestId:'draft',expectedVersion:0,parts:[{kind:'asset',asset,as:'file'}]});}
      if(step===4)return call('dafeiyu_media_reply',{requestId:'cancel',expectedVersion:1,parts:[]});return textReply('已取消附件，只回复文字');});
    const before=h.ctx.dafeiyuQQ.getStatus().counters.received;h.emit({post_type:'message',self_id:Number(bot),message_id:902,message_type:'private',user_id:Number(owner),time:1792886400,message:[{type:'file',data:{file:'document',name:'document.txt'}}]});await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.received>before);await h.core.whenIdle();assert.equal(h.platform.sent.length,1);assert.ok(asset);
    step=0;h.setResponse(()=>++step===1?call('dafeiyu_media_reply',{requestId:'foreign',expectedVersion:0,parts:[{kind:'asset',asset,as:'file'}]}):textReply('没有转发权限'));await h.message('尝试跨群',{target:scene,trigger:true,id:'903'});assert.ok(h.adapter.requests.flatMap(outcomes).some(o=>o.errorCode==='RESOURCE_SCOPE_DENIED'));
    const path=await h.ctx.dafeiyuMedia.files.path(asset.sha256);await writeFile(path,'wrong bytes');await assert.rejects(h.ctx.dafeiyuMedia.files.bytes(asset,new AbortController().signal,()=>{}),/BLOB_CORRUPT|SIZE_LIMIT/);assert.equal((await readFile(path)).toString(),'wrong bytes');
  }finally{await h.close();}
});

test('a failure after a draft commit is unknown and cannot fall back to an ordinary text delivery',async()=>{
  const h=await qqCapabilityFixture({media:true});try{const file=join(h.root,'onebot-cache/incomplete.txt');await writeFile(file,'fixture');h.platform.mediaFiles.set('incomplete',file);let step=0;
    const ensure=h.ctx.dafeiyuMedia.store.ensureLease.bind(h.ctx.dafeiyuMedia.store);h.ctx.dafeiyuMedia.store.ensureLease=()=>{throw new Error('SIMULATED_PIN_FAILURE');};
    h.setResponse(request=>{step++;if(step===1)return call('qq_media_list',{});if(step===2){const list=z.object({media:z.array(z.object({ref:z.object({provider:z.string(),key:z.string()})}))}).parse(outcomes(request).at(-1)?.data);return call('dafeiyu_media_acquire',{requestId:'get',source:list.media[0]!.ref});}
      if(step===3)return call('dafeiyu_media_reply',{requestId:'prepare',expectedVersion:0,parts:[{kind:'asset',asset:MediaAssetRefSchema.parse(outcomes(request).at(-1)?.data),as:'file'}]});return textReply('准备状态尚未确定');});
    const count=h.ctx.dafeiyuQQ.getStatus().counters.received;h.emit({post_type:'message',self_id:Number(bot),message_id:904,message_type:'private',user_id:Number(owner),time:1792886400,message:[{type:'file',data:{file:'incomplete',name:'incomplete.txt'}}]});await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.received>count);await h.core.whenIdle();
    h.ctx.dafeiyuMedia.store.ensureLease=ensure;assert.equal(h.ctx.dafeiyuMedia.store.replies.counts().drafts,1);assert.equal(h.platform.sent.length,0);
    const db=new DatabaseSync(join(h.root,'core/runtime.sqlite'),{readOnly:true});try{const row=db.prepare("SELECT state,outcome FROM run_operations WHERE action='dafeiyu_media_reply'").get();assert.ok(row);assert.ok(row.state==='unknown'||JSON.parse(String(row.outcome)).effects==='unknown');}finally{db.close();}
  }finally{await h.close();}
});
