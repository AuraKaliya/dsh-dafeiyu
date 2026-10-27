import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { MediaAssetRefSchema,conversationKey } from '@dafeiyu/contracts';
import type { MediaAssetRef,MediaProviderRefSchema } from '@dafeiyu/contracts';
import { MEDIA_ACTIONS } from '@dafeiyu/media';
import { QQ_MEDIA_ACTIONS } from '@dafeiyu/qq';
import { qqCapabilityFixture,bot,owner,scene,group,until,outcomes } from './qq-capabilities-fixture.js';
import { createImageFixture } from './phase1-image-fixture.js';
import { syntheticPcm } from './media-pcm-fixture.js';
import { call,textReply } from './harness.js';
import type {GenerateOptions} from '@deepseek-ai/dsh-llm';

type H=Awaited<ReturnType<typeof qqCapabilityFixture>>;
const messageSchema=z.object({group_id:z.number().optional(),message:z.array(z.object({type:z.string(),data:z.record(z.string(),z.unknown())}))});
const content=(raw:unknown)=>messageSchema.parse(raw).message.find(p=>p.type!=='reply')!;
async function prepare(h:H){const fixtures=[['picture',createImageFixture(67).data],['voice',syntheticPcm()],['document',Buffer.from('FILE_BYTES_SENTINEL')]] as const;
  for(const [name,data] of fixtures){const file=join(h.root,'onebot-cache',name);await writeFile(file,data);h.platform.mediaFiles.set(name,file);}
}
function script(h:H,text:string){let step=0,refs:z.infer<typeof MediaProviderRefSchema>[]=[];const assets:MediaAssetRef[]=[];
  const respond=(request:GenerateOptions)=>{step++;if(step===1)return call('qq_media_list',{});if(step===2)refs=z.object({media:z.array(z.object({ref:z.object({provider:z.string(),key:z.string()})}))}).parse(outcomes(request).at(-1)?.data).media.map(m=>m.ref);
    if(step>=3&&step<=5)assets.push(MediaAssetRefSchema.parse(outcomes(request).at(-1)?.data));if(step>=2&&step<=4)return call('dafeiyu_media_acquire',{requestId:'get-'+step,source:refs[step-2]});
    if(step===5)return call('dafeiyu_media_reply',{requestId:'parts',expectedVersion:0,parts:assets.map(asset=>({kind:'asset',asset}))});return textReply(text);};h.setResponse(respond);return respond;
}
async function emit(h:H,id:number){const received=h.ctx.dafeiyuQQ.getStatus().counters.received;h.emit({post_type:'message',self_id:Number(bot),message_id:id,message_type:'group',group_id:Number(group),user_id:Number(owner),time:Math.ceil(Date.now()/1000),
  message:[{type:'at',data:{qq:bot}},{type:'image',data:{file:'picture',name:'picture.png'}},{type:'record',data:{file:'voice',name:'voice.wav'}},{type:'file',data:{file:'document',name:'document.txt'}}]});await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.received>received);await h.core.whenIdle();return h.core.journal.messageFor({agentId:'dafeiyu',route:conversationKey('dafeiyu',scene)},String(id))!;}

test('QQ sends final text plus image, standalone voice and file as ordered actual loopback message arrays',async()=>{
  const h=await qqCapabilityFixture({media:true,mediaSend:true});try{await prepare(h);const text='人格正文：'+'鱼'.repeat(4200);script(h,text);const item=await emit(h,1101);assert.equal(item.state,'delivered',JSON.stringify(h.core.journal.events(item.route).slice(-4)));
    const sent=h.platform.sent.map(content);assert.deepEqual(sent.map(p=>p.type),[...Array<string>(6).fill('text'),'image','record','file']);assert.equal(sent.filter(p=>p.type==='text').map(p=>p.data.text).join(''),text);
    const exported=h.ctx.dafeiyuMedia.store.replies.exported(item.reply!.id)!;assert.equal(exported.state,'sent');for(const [i,part] of sent.slice(6).entries()){const encoded=z.string().parse(part.data.file);assert.ok(encoded.startsWith('base64://'));const bytes=Buffer.from(encoded.slice(9),'base64');assert.equal(createHash('sha256').update(bytes).digest('hex'),exported.manifest.parts[i]!.asset.sha256);}
    assert.equal(messageSchema.parse(h.platform.sent[7]).message.length,1);assert.equal(messageSchema.parse(h.platform.sent[8]).message.length,1);assert.equal(sent[8]!.data.name,'document.txt');assert.equal(h.ctx.dafeiyuQQ.deliveryStatus(item.reply!.id)?.confirmed,9);assert.equal(h.ctx.dafeiyuQQ.getStatus().delivery.plans,1);
    const db=new DatabaseSync(join(h.root,'qq/qq.sqlite'),{readOnly:true});try{assert.ok(!JSON.stringify(db.prepare('SELECT text FROM messages').all()).includes('base64://'));}finally{db.close();}
  }finally{await h.close();}
});

test('a lost media-part response preserves earlier receipts and cannot resend after reload or duplicate invocation',async()=>{
  const h=await qqCapabilityFixture({media:true,mediaSend:true});try{await prepare(h);script(h,'鱼'.repeat(4200));h.platform.loseAt=7;const item=await emit(h,1102);assert.equal(item.state,'uncertain');assert.equal(h.platform.sent.length,7);const status=h.ctx.dafeiyuQQ.deliveryStatus(item.reply!.id)!;assert.equal(status.confirmed,6);assert.equal(status.unknown,1);assert.equal(status.pending,2);
    const manifest=h.ctx.dafeiyuMedia.store.replies.exported(item.reply!.id)!.manifest;await h.reload();const result=await h.ctx.dafeiyuQQ.deliverMedia({...item.reply!,media:manifest},new AbortController().signal,()=>{},async()=>{throw new Error('MUST_NOT_REOPEN_BYTES');});assert.equal(result.status,'unknown');assert.equal(h.platform.sent.length,7);
  }finally{await h.close();}
});
test('new input pauses a known-unsent media tail and a model resume sends only the remaining parts',async()=>{
  const h=await qqCapabilityFixture({media:true,mediaSend:true});try{await prepare(h);const original=script(h,'附件说明'),seen:unknown[]=[];let emitted=false;
    h.setResponse(request=>{const input=request.messages.findLast(m=>m.role==='user'&&m.source?.kind==='user')?.content.filter(b=>b.type==='text').map(b=>b.text).join('')??'';
      if(String(request.sessionId).startsWith('dafeiyu-reply-decision-')){const pending=z.object({pending:z.array(z.object({inboundId:z.uuid()}))}).parse(JSON.parse(input)).pending;seen.push(pending);return textReply(JSON.stringify({decisions:pending.map(p=>({inboundId:p.inboundId,action:'resume'}))}));}
      if(input.includes('继续附件'))return textReply('补充已收到');return original(request);});
    h.platform.beforeVerify=async()=>{if(h.platform.sent.length!==1||emitted)return;emitted=true;const received=h.ctx.dafeiyuQQ.getStatus().counters.received;h.emit({post_type:'message',message_type:'group',self_id:Number(bot),group_id:Number(group),user_id:Number(owner),message_id:1106,time:Math.ceil(Date.now()/1000),message:[{type:'text',data:{text:'继续附件'}}],sender:{nickname:'虚构主人'}});await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.received>received);};
    const item=await emit(h,1105);await h.core.whenIdle();assert.equal(seen.length,1);assert.equal(h.core.journal.get(item.id).state,'delivered');assert.equal(h.ctx.dafeiyuQQ.deliveryStatus(item.reply!.id)?.unknown,0);assert.equal(h.ctx.dafeiyuMedia.store.replies.exported(item.reply!.id)!.state,'sent');assert.deepEqual(h.platform.sent.map(content).filter(p=>p.type!=='text').map(p=>p.type),['image','record','file']);
  }finally{await h.close();}
});

for(const change of ['identity','recall'] as const)test(`${change} between media parts preserves a truthful partial delivery`,async()=>{
  const h=await qqCapabilityFixture({media:true,mediaSend:true});try{await prepare(h);script(h,'先介绍附件');h.platform.afterSend=async count=>{if(count!==1)return;if(change==='identity')h.platform.identity='99999999';else{h.emit({post_type:'notice',notice_type:'group_recall',self_id:Number(bot),group_id:Number(group),message_id:1103});await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.recalled>0);}};
    const item=await emit(h,1103);assert.equal(item.state,'uncertain');assert.equal(h.platform.sent.length,1);assert.equal(h.ctx.dafeiyuQQ.deliveryStatus(item.reply!.id)?.confirmed,1);assert.equal(h.ctx.dafeiyuQQ.deliveryStatus(item.reply!.id)?.pending,3);
  }finally{await h.close();}
});

test('native media is sent only after clean target rendering and a fixed verified media credential',async()=>{
  const h=await qqCapabilityFixture({media:true,mediaSend:true,tasks:true,deliverResults:true,extraTaskActions:[...MEDIA_ACTIONS,...QQ_MEDIA_ACTIONS]});try{await prepare(h);let chat=0,work=0,asset:MediaAssetRef|undefined;
    h.setResponse(request=>{const id=String(request.sessionId);if(id.startsWith('dafeiyu-delivery-v3-'))return textReply('这是为当前会话准备的文件。');if(id.startsWith('memory-expression-verify-delivery-'))return textReply('{"faithful":true,"issues":[]}');
      if(!id.startsWith('dafeiyu-task-'))return ++chat===1?call('qq_task_submit',{requestId:'native-media'}):textReply('任务已受理');work++;
      if(work===1)return call('qq_media_list',{target:scene,messageId:'1104'});if(work===2){const ref=z.object({media:z.array(z.object({ref:z.object({provider:z.string(),key:z.string()})}))}).parse(outcomes(request).at(-1)?.data).media[0]!.ref;return call('dafeiyu_media_acquire',{requestId:'file',source:ref});}
      if(work===3){asset=MediaAssetRefSchema.parse(outcomes(request).at(-1)?.data);return call('dafeiyu_media_reply',{requestId:'result-file',expectedVersion:0,parts:[{kind:'asset',asset,as:'file'}]});}return textReply('PRIVATE_EXECUTOR_REPORT_MUST_NOT_SEND');});
    const received=h.ctx.dafeiyuQQ.getStatus().counters.received;h.emit({post_type:'message',self_id:Number(bot),message_id:1104,message_type:'group',group_id:Number(group),user_id:Number(owner),time:Math.ceil(Date.now()/1000),message:[{type:'file',data:{file:'document',name:'document.txt'}}]});await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.received>received);
    await h.message('任务：准备这份文件作为附件',{trigger:true,id:'1105'});const db=new DatabaseSync(join(h.root,'core/runtime.sqlite'),{readOnly:true});let runId:string;try{runId=String(db.prepare("SELECT r.id FROM runs r JOIN execution_requests q ON q.id=r.request_key WHERE q.producer='qq-tasks' ORDER BY r.rowid DESC LIMIT 1").get()?.id);}finally{db.close();}
    const status=h.core.messageTaskDeliveryStatus(runId)!;assert.equal(status.state,'sent',JSON.stringify(status));const sent=h.platform.sent.map(content);assert.ok(sent.some(p=>p.type==='file'));assert.ok(!JSON.stringify(h.platform.sent).includes('PRIVATE_EXECUTOR_REPORT'));
    assert.equal(h.ctx.dafeiyuQQ.deliveryStatus('native-delivery:'+status.deliveryId)?.confirmed,2);const count=h.platform.sent.length;await h.core.deliverMessageTaskResult(runId);assert.equal(h.platform.sent.length,count);
  }finally{await h.close();}
});
