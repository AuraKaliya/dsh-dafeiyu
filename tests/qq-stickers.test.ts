import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile,mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { QqStore,QQ_STICKER_ACTIONS } from '@dafeiyu/qq';
import { MediaAssetRefSchema,conversationKey } from '@dafeiyu/contracts';
import type { GenerateOptions } from '@deepseek-ai/dsh-llm';
import { qqCapabilityFixture,scene,privateScene,otherGroup,owner,until,outcomes } from './qq-capabilities-fixture.js';
import { call,textReply } from './harness.js';
import { createImageFixture } from './phase1-image-fixture.js';
import { syntheticPcm } from './media-pcm-fixture.js';
import { testTempDir } from './test-temp.js';

// Two original GIF frames, different pixel indices, with a delay on each frame.
const gif=Buffer.from('47494638396101000100800000000000ffffff21f904000a0000002c000000000100010000020244010021f904000a0000002c00000000010001000002024c01003b','hex');
const metadata={name:'开心小鱼',description:'用于开心、认同和打招呼的虚构表情',tags:['开心','招呼']},origin={messageId:'1',sender:owner};
const digest=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
const collected=z.object({id:z.uuid(),sha256:z.string(),mime:z.string(),duplicate:z.boolean()});
const listed=z.object({media:z.array(z.object({ref:z.object({provider:z.string(),key:z.string()})}))});
const exposure=z.object({exposureId:z.uuid()});
function last<T>(request:GenerateOptions,schema:z.ZodType<T>):T{const results=outcomes(request).flatMap(result=>{const parsed=schema.safeParse(result.data);return parsed.success?[parsed.data]:[];});assert.ok(results.length,JSON.stringify(outcomes(request)));return results.at(-1)!;}
type H=Awaited<ReturnType<typeof qqCapabilityFixture>>;
async function picture(h:H,bytes=gif){const file=join(h.root,'onebot-cache/sticker.gif');await writeFile(file,bytes);h.platform.mediaFiles.set('sticker-fixture',file);}
function collectAndUse(h:H,caption:string){let step=0;h.setResponse(request=>{switch(++step){case 1:return call('qq_media_list',{});case 2:return call('dafeiyu_media_read',{requestId:'look',mode:'image',source:last(request,listed).media[0]!.ref});
    case 3:return call('qq_sticker_collect',{...metadata,exposureId:last(request,exposure).exposureId});case 4:return call('qq_sticker_use',{id:last(request,collected).id,requestId:'choose',expectedVersion:0});default:return textReply(caption);}});}
function encodedImages(h:H){return h.platform.sent.flatMap(raw=>z.object({message:z.array(z.object({type:z.string(),data:z.record(z.string(),z.unknown())}))}).parse(raw).message).filter(part=>part.type==='image').map(part=>Buffer.from(z.string().parse(part.data.file).slice('base64://'.length),'base64'));}
async function storeAt(h:H){return new QqStore(join(h.root,'qq/qq.sqlite'));}

test('local original bytes survive reopen, deduplicate per source conversation and require explicit promotion for reuse',async()=>{
  const root=await mkdtemp(join(testTempDir(),'stickers-')),file=join(root,'qq.sqlite');let store=new QqStore(file);try{const a=store.stickers.collect(scene,origin,metadata,gif,'image/gif');assert.equal(store.stickers.collect(scene,origin,metadata,gif,'image/gif').duplicate,true);assert.equal(store.stickers.list({...scene,id:otherGroup}).length,0);
    const lease=store.stickers.lease(a.id,scene,'selection'),asset=MediaAssetRefSchema.parse({schemaVersion:1,id:crypto.randomUUID(),version:1,kind:'image',sha256:digest(gif),bytes:gif.length,mime:'image/gif'});store.stickers.bind(lease.ref.key,asset);assert.equal(store.stickers.permits(scene,asset),true);assert.equal(store.stickers.permits({...scene,id:otherGroup},asset),false);
    store.stickers.used(scene,asset,'same-reply');store.stickers.used(scene,asset,'same-reply');assert.equal(store.stickers.get(a.id).body.uses,1);store.close();store=new QqStore(file);assert.deepEqual(store.stickers.open(lease.ref.key).data,gif);
    store.stickers.manage(a.id,'global');assert.equal(store.stickers.list({...scene,id:otherGroup}).length,1);assert.equal(store.stickers.current(lease.origin),false);assert.equal(store.stickers.permits(scene,asset),false);
    const global=store.stickers.lease(a.id,{...scene,id:otherGroup},'global-selection');assert.deepEqual(store.stickers.open(global.ref.key).data,gif);store.stickers.revokeSource(scene,'1');assert.equal(store.stickers.describe(global.ref.key),null);
  }finally{store.close();}
});
test('owner metadata edits fence old selections; deleting an entry removes its final original copy',async()=>{
  const root=await mkdtemp(join(testTempDir(),'sticker-edit-')),store=new QqStore(join(root,'qq.sqlite'));try{const a=store.stickers.collect(scene,origin,metadata,gif,'image/gif'),lease=store.stickers.lease(a.id,scene,'old');store.stickers.manage(a.id,'rename','新名字');assert.equal(store.stickers.describe(lease.ref.key),null);
    store.stickers.manage(a.id,'tags','招呼,晚安');assert.deepEqual(store.stickers.get(a.id).body.tags,['招呼','晚安']);store.stickers.manage(a.id,'disable');assert.throws(()=>store.stickers.lease(a.id,scene,'disabled'),/SCOPE_DENIED/);store.stickers.manage(a.id,'enable');store.stickers.manage(a.id,'delete');assert.equal(store.stickers.list(scene).length,0);assert.throws(()=>store.stickers.bytes(store.stickers.get(a.id)),/ENOENT/);
  }finally{store.close();}
});
test('a full library refuses collection without evicting existing original bytes',async()=>{
  const root=await mkdtemp(join(testTempDir(),'sticker-capacity-')),store=new QqStore(join(root,'qq.sqlite'),{stickers:{maxEntries:1}});try{const a=store.stickers.collect(scene,origin,metadata,gif,'image/gif');assert.throws(()=>store.stickers.collect(scene,origin,{...metadata,name:'别的图'},createImageFixture(34).data,'image/png'),/LIBRARY_FULL/);assert.deepEqual(store.stickers.bytes(store.stickers.get(a.id)),gif);}finally{store.close();}
});
for(const caption of ['', '看到这张就开心。'])test(`actual DSH collects an observed GIF and sends ${caption?'text plus original animation':'only the selected original animation'}`,async t=>{
  const h=await qqCapabilityFixture({media:true,stickers:true,turnTimeoutMs:30000});t.after(h.close);await picture(h);collectAndUse(h,caption);
  await h.message('可以自行挑选收录适合的表情',{trigger:true,id:caption?'9102':'9101',parts:[{type:'image',data:{file:'sticker-fixture',name:'sticker.gif'}}]});
  const item=h.core.journal.list().at(-1)!;assert.equal(item.state,'delivered',JSON.stringify(h.core.journal.events(item.route).slice(-3)));assert.equal(item.reply?.text,caption);assert.equal(h.platform.visionReads,1);assert.deepEqual(encodedImages(h),[gif]);assert.equal(h.platform.sent.length,caption?2:1);
  const store=await storeAt(h);try{const row=store.stickers.list(scene)[0]!;assert.equal(row.sha256,digest(gif));assert.equal(row.mime,'image/gif');assert.equal(row.uses,1);assert.equal(row.scope,'conversation');}finally{store.close();}
  assert.ok(h.adapter.requests.flatMap(outcomes).every(outcome=>outcome.status==='succeeded'));
});
test('a saved library entry remains usable after the platform media handle expires and QQ reloads',async t=>{
  const h=await qqCapabilityFixture({media:true,stickers:true,turnTimeoutMs:30000});t.after(h.close);await picture(h);collectAndUse(h,'先收录');await h.message('收录',{trigger:true,id:'9201',parts:[{type:'image',data:{file:'sticker-fixture'}}]});
  const store=await storeAt(h);try{store.media.prune(0);}finally{store.close();}await h.reload();let step=0;
  h.setResponse(request=>++step===1?call('qq_sticker_list',{}):step===2?call('qq_sticker_use',{id:last(request,z.object({stickers:z.array(z.object({id:z.uuid()}))})).stickers[0]!.id,requestId:'reuse',expectedVersion:0}):textReply(''));
  await h.message('再来一次',{trigger:true,id:'9202'});assert.equal(h.core.journal.list().at(-1)?.state,'delivered');assert.deepEqual(encodedImages(h),[gif,gif]);assert.equal(h.platform.visionReads,1);
});
test('owner management uses authenticated QQ command text; non-owner commands cannot disable or promote',async t=>{
  const h=await qqCapabilityFixture({media:true,stickers:true});t.after(h.close);const store=await storeAt(h);let id:string;try{id=store.stickers.collect(scene,origin,metadata,gif,'image/gif').id;}finally{store.close();}
  const command=async(text:string,id:string,sender=owner,target=scene)=>{let step=0;h.setResponse(()=>++step===1?call('qq_sticker_manage',{}):textReply('处理结果'));await h.message(text,{trigger:true,id,sender,target});};
  await command('表情管理：通用 '+id,'9301','99999999');let inspect=await storeAt(h);try{assert.equal(inspect.stickers.get(id).body.scope,'conversation');}finally{inspect.close();}
  await command('表情管理：通用 '+id,'9302',owner,privateScene);inspect=await storeAt(h);try{assert.equal(inspect.stickers.get(id).body.scope,'global');}finally{inspect.close();}
  await command('表情管理：列表','9305',owner,privateScene);assert.ok(h.adapter.requests.flatMap(outcomes).some(outcome=>z.object({entries:z.array(z.object({id:z.literal(id)}))}).safeParse(outcome.data).success));
  await command('请你自己决定是否删除 '+id,'9303',owner,privateScene);inspect=await storeAt(h);try{assert.equal(inspect.stickers.get(id).body.deleted,false);}finally{inspect.close();}
  await command('表情管理：停用 '+id,'9304',owner,privateScene);inspect=await storeAt(h);try{assert.equal(inspect.stickers.get(id).body.enabled,false);}finally{inspect.close();}
});
test('cross-conversation private entries cannot be selected for a group reply',async t=>{
  const h=await qqCapabilityFixture({media:true,stickers:true});t.after(h.close);const store=await storeAt(h);let id:string;try{id=store.stickers.collect(privateScene,origin,metadata,gif,'image/gif').id;}finally{store.close();}
  let step=0;h.setResponse(()=>++step===1?call('qq_sticker_use',{id,requestId:'forbidden',expectedVersion:0}):textReply('无法使用这个表情'));await h.message('用私人库的表情',{trigger:true,id:'9401'});assert.equal(encodedImages(h).length,0);assert.ok(h.adapter.requests.flatMap(outcomes).some(result=>result.errorCode==='STICKER_SCOPE_DENIED'));
});
test('sticker permission does not enable arbitrary images, voice or file output',async t=>{
  const h=await qqCapabilityFixture({media:true,stickers:true,turnTimeoutMs:30000});t.after(h.close);
  const fixtures=[['external-picture',createImageFixture(17).data],['external-voice',syntheticPcm()],['external-file',Buffer.from('fixture file')]] as const;
  for(const [name,data] of fixtures){const file=join(h.root,'onebot-cache',name);await writeFile(file,data);h.platform.mediaFiles.set(name,file);}
  let step=0,refs:{provider:string;key:string}[]=[],assets:z.infer<typeof MediaAssetRefSchema>[]=[];
  h.setResponse(request=>{step++;if(step===1)return call('qq_media_list',{});if(step===2)refs=last(request,listed).media.map(media=>media.ref);if(step>=3&&step<=5)assets.push(last(request,MediaAssetRefSchema));
    if(step>=2&&step<=4)return call('dafeiyu_media_acquire',{requestId:'outside-'+step,source:refs[step-2]});if(step===5)return call('dafeiyu_media_reply',{requestId:'outside-draft',expectedVersion:0,parts:assets.map(asset=>({kind:'asset',asset}))});return textReply('发送前必须检查范围');});
  await h.message('这不是本地表情库的素材',{trigger:true,id:'9402',parts:[{type:'image',data:{file:'external-picture'}},{type:'record',data:{file:'external-voice'}},{type:'file',data:{file:'external-file',name:'fixture.txt'}}]});assert.equal(h.platform.sent.length,0);assert.equal(h.core.journal.list().at(-1)?.state,'reply-ready');
});
test('a lost sticker response is recorded as uncertain and is never automatically retried',async t=>{
  const h=await qqCapabilityFixture({media:true,stickers:true,turnTimeoutMs:30000});t.after(h.close);const store=await storeAt(h);let id:string;try{id=store.stickers.collect(scene,origin,metadata,gif,'image/gif').id;}finally{store.close();}
  let step=0;h.setResponse(()=>++step===1?call('qq_sticker_use',{id,requestId:'lost',expectedVersion:0}):textReply(''));h.platform.loseAt=1;await h.message('来一个',{trigger:true,id:'9403'});assert.equal(h.core.journal.list().at(-1)?.state,'uncertain');assert.equal(h.platform.sent.length,1);await h.reload();await h.core.whenIdle();assert.equal(h.platform.sent.length,1);
});
test('recall during a merged image/text turn blocks the chosen sticker before delivery',async t=>{
  const h=await qqCapabilityFixture({media:true,stickers:true,batch:{quietMs:90,maxWaitMs:1000},turnTimeoutMs:30000});t.after(h.close);await picture(h);collectAndUse(h,'会被撤回拦住');
  await h.message('先发图',{trigger:true,id:'9501',parts:[{type:'image',data:{file:'sticker-fixture'}}]});await h.message('接上刚才的话',{id:'9502'});h.platform.afterVisionRead=async()=>{h.emit({post_type:'notice',notice_type:'group_recall',self_id:Number(scene.account),group_id:Number(scene.id),message_id:9501});await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.recalled===1);};
  await until(()=>h.ctx.dafeiyuQQ.getStatus().counters.accepted===1);await h.core.whenIdle();assert.equal(h.platform.sent.length,0);assert.equal(h.core.journal.list()[0]?.state,'failed');assert.equal(h.core.journal.messageFor({agentId:'dafeiyu',route:conversationKey('dafeiyu',scene)},'9502')?.message.batch?.sources.length,2);
});
