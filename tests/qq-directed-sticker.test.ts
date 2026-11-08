import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Context} from '@deepseek-ai/cordis';
import {QqStore} from '@dafeiyu/qq';
import type {DafeiyuService} from '@dafeiyu/core';
import type {ExecutionContext,Extension,Conversation} from '@dafeiyu/contracts';
import {QqStickers} from '../packages/channel-qq/lib/stickers.js';
import {directedStickerTarget,QqDirectSendLedger} from '../packages/channel-qq/lib/direct-sticker-send.js';
import {testTempDir} from './test-temp.js';

const groups=[{id:'300001',name:'测试甲群'},{id:'300002',name:'测试乙群'}];
test('direct sticker targets require a positive owner command and one explicit group reference',()=>{
  assert.equal(directedStickerTarget('选一张表情包发到那个群里',['看看测试甲群'],groups),'300001');
  assert.equal(directedStickerTarget('给测试乙群发一张表情',[],groups),'300002');
  for(const text of ['不要往测试甲群发表情','可以查看测试甲群吗','查看测试甲群的表情发送记录','发一张表情到群里','向测试甲群和测试乙群发表情'])assert.throws(()=>directedStickerTarget(text,[],groups),/INSTRUCTION_REQUIRED|AMBIGUOUS/);
  assert.throws(()=>directedStickerTarget('往测试甲群发表情',[],groups,'300002'),/MISMATCH/);
  assert.throws(()=>directedStickerTarget('发到那个群，一张表情',['测试甲群和测试乙群'],groups),/AMBIGUOUS/);
});

async function fixture(options:{uncertain?:boolean;revokeAtVerify?:boolean;foreignSticker?:boolean}={}){
  const root=await mkdtemp(join(testTempDir(),'direct-sticker-')),store=new QqStore(join(root,'qq.sqlite')),ctx=new Context();let extension!:Extension,sends=0,active=true;
  const scene:Conversation={channel:'qq',account:'100001',kind:'private',id:'200001'},sourceId=randomUUID(),source={kind:'owner-message',inboundId:sourceId,messageId:'actual-owner-message',messageHash:'source-hash',conversation:scene,senderId:scene.id,modality:'text'};
  const item={id:sourceId,route:'private',message:{id:source.messageId,conversation:scene,sender:{id:scene.id},mainText:'选一张表情包发到那个群里'}},prior={id:'prior',route:'private',message:{id:'prior-msg',conversation:scene,sender:{id:scene.id},mainText:'看看测试甲群'}};
  ctx.provide('dafeiyu',{registerExtension:(value:Extension)=>{extension=value;return {dispose(){}};},registerMediaProvider:()=>()=>{},
    authorizeExternalTask:()=>({authorization:{source},guard:()=>{if(!active)throw new Error('SOURCE_STALE');}}),authorizeCapabilityResource:()=>{},journal:{get:()=>item,list:()=>[prior,item],messageRecalled:()=>false}} as unknown as DafeiyuService);
  const bytes=Buffer.from('GIF89a-fixture'),row=store.stickers.collect(options.foreignSticker?{...scene,kind:'group',id:'300002'}:scene,{messageId:'image',sender:scene.id},{name:'表情',description:'fixture',tags:[]},bytes,'image/gif');
  const ledger=new QqDirectSendLedger(join(root,'direct-sends'));
  const stickers=new QqStickers(ctx,{agentId:'fish',botId:scene.account,ownerId:scene.id,store:store.stickers,allowed:()=>true,directSend:{ledger,groups:()=>groups,generation:()=>1,available:()=>true,api:{verify:async()=>{if(options.revokeAtVerify)active=false;},call:async(action,params)=>{sends++;assert.equal(action,'send_group_msg');const body=params as {group_id:number;message:{data:{file:string}}[]};assert.equal(body.group_id,300001);assert.equal(body.message[0]!.data.file,'base64://'+bytes.toString('base64'));if(options.uncertain)throw new Error('ONEBOT_CALL_UNCERTAIN');return {message_id:'777'};}}}});
  const action=extension.actions!.find(x=>x.id==='qq_sticker_send')!;assert.equal(action.effects,'external-write');assert.equal(action.scope,'task');
  const context={signal:new AbortController().signal} as ExecutionContext;
  return {store,ledger,row,sourceId,call:(requestId:string)=>action.execute({id:row.id,requestId},context),sends:()=>sends,close:async()=>{stickers.close();store.close();await ctx.fiber.dispose();}};
}
test('owner-directed group delivery sends original bytes once without making a private sticker global',async()=>{
  const f=await fixture();try{const sent=await f.call('first');assert.equal(sent.status,'succeeded');assert.equal(sent.effects,'confirmed');assert.equal(sent.receipts[0]?.id,'777');
    assert.equal((await f.call('another-id')).status,'succeeded');assert.equal(f.sends(),1);assert.equal(f.store.stickers.get(f.row.id).body.scope,'conversation');assert.equal(f.ledger.read(f.sourceId)?.state,'sent');
  }finally{await f.close();}
});
test('uncertain direct sends remain held and revoked or foreign private sources never dispatch',async()=>{
  for(const options of [{uncertain:true},{revokeAtVerify:true},{foreignSticker:true}]){const f=await fixture(options);try{const first=await f.call('one');const second=await f.call('two');
    if(options.uncertain){assert.equal(first.effects,'unknown');assert.equal(second.effects,'unknown');assert.equal(f.sends(),1);}else{assert.equal(first.status,'failed');assert.equal(f.sends(),0);}
  }finally{await f.close();}}
});
test('a crash after the durable direct-send claim cannot create a new send after reopening',async()=>{
  const root=await mkdtemp(join(testTempDir(),'direct-send-crash-'));const ledger=new QqDirectSendLedger(root),binding={sourceId:'source',sourceHash:'h',stickerId:randomUUID(),stickerVersion:1,sha256:'h',groupId:'300001',groupGeneration:1};
  assert.equal(ledger.claim(binding),true);const reopened=new QqDirectSendLedger(root);assert.equal(reopened.claim(binding),false);assert.equal(reopened.read('source')?.state,'sending');
  const file=(await readdir(root))[0]!;await writeFile(join(root,file),'{');assert.throws(()=>new QqDirectSendLedger(root).read('source'),/LEDGER_UNCERTAIN/);assert.equal(reopened.claim(binding),false);
});
