import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {z} from 'zod';
import {API_VERSION,MessageInstructionSubmitSchema} from '@dafeiyu/contracts';
import type {ExtensionHandle} from '@dafeiyu/contracts';
import {QqStore} from '@dafeiyu/qq';
import {QqStickers} from '../packages/channel-qq/lib/stickers.js';
import {QqDirectSendLedger} from '../packages/channel-qq/lib/direct-sticker-send.js';
import {FixtureAdapter,textResponse,toolResponse,verificationResponse} from './sdk-fixture.js';
import {testTempDir} from './test-temp.js';

test('an actual owner task exposes the directed sender and carries its group receipt through final delivery',{timeout:30000},async t=>{
  const root=await mkdtemp(join(testTempDir(),'direct-sticker-host-'));process.env.DSH_HOME=join(root,'data/core/dsh-home');const {ManagedHost,loadHostConfig,initializeProfile}=await import('@dafeiyu/host');
  const owner={channel:'qq',account:'100001',kind:'private' as const,id:'200001'},group={...owner,kind:'group' as const,id:'300001'},store=new QqStore(join(root,'qq.sqlite'));
  const sticker=store.stickers.collect(owner,{messageId:'picture',sender:owner.id},{name:'测试表情',description:'fixture',tags:[]},Buffer.from('GIF89a-fixture'),'image/gif');
  let channel:ExtensionHandle|undefined,stickers:QqStickers|undefined,chatStep=0,taskStep=0,sends=0,delivered=0;
  const adapter=new FixtureAdapter(request=>{
    const session=String(request.sessionId);if(session.startsWith('memory-expression-verify-'))return verificationResponse(request);
    if(session.startsWith('dafeiyu-delivery-')){assert.match(JSON.stringify(request.messages),/qq_sticker_send/);return textResponse('已向指定群发送表情，平台回执已确认。');}
    if(session.startsWith('dafeiyu-task-')){if(taskStep++===0){assert.ok(request.tools?.some(x=>x.name==='qq_sticker_send'));return toolResponse('qq_sticker_send',{id:sticker.id,requestId:'send'});}const tool=request.messages.findLast(m=>m.role==='tool')!;const result=JSON.parse(tool.content.filter(b=>b.type==='text').map(b=>b.text).join(''));assert.equal(result.status,'succeeded',JSON.stringify(result));assert.equal(result.data.target.id,group.id);return textResponse('已向指定群发送表情，平台回执已确认。');}
    if(chatStep++===0)return toolResponse('qq_task_submit',{requestId:'submit',title:'向测试甲群发表情',intent:{relation:'new'}});return textResponse('任务已受理。');
  });
  await writeFile(join(root,'persona.md'),'隔离测试。');const file=join(root,'host.json');
  await writeFile(file,JSON.stringify({schemaVersion:1,profileId:'direct-sticker-host',agent:{id:'fish'},paths:{core:'./data/core',memory:'./data/memory',sessions:'./data/sessions',query:'./data/query.sqlite'},modelRoutes:{chat:{provider:'local-test',model:'scripted'}},persona:{fixedFile:'./persona.md',kind:'test'},plugins:[{id:'model-scripted',required:true},{id:'timeline',required:true,config:{execution:true}},{id:'memory-growth',required:true},{id:'media',required:true,config:{ffmpeg:process.execPath,ffprobe:process.execPath}}],authorityPolicies:[{id:'conversation',producers:['channel-qq'],actions:['qq_task_submit'],allowLocalWrite:true},{id:'task',producers:['qq-tasks'],actions:['qq_sticker_send'],allowLocalWrite:true,externalActions:[{extensionId:'qq-stickers',actionId:'qq_sticker_send',actionVersion:'1'}]}]}));
  const config=loadHostConfig(file),coordination=join(root,'coordination.sqlite');initializeProfile(config,coordination);
  const host=await ManagedHost.start(config,{coordination,adapter,signal:t.signal,installChannels:ctx=>{
    channel=ctx.dafeiyu.registerExtension({id:'channel-qq',version:'fixture',protocolVersion:API_VERSION,agentId:'fish',channels:[{channel:'qq',account:owner.account,deliver:async()=>({status:'sent',receiptId:'1'}),deliverTaskResult:async(_reply,_anchor,_signal,guard,begin)=>{guard();const end=begin();try{delivered++;return {status:'sent',receiptId:'2'};}finally{end();}}}]});
    ctx.dafeiyu.registerExtension({id:'fixture-directory',version:'1',protocolVersion:API_VERSION,agentId:'fish',resourceProofs:{current:()=>true,epoch:()=>''},ownerDirectory:{channelExtensionId:'channel-qq',channel:'qq',account:owner.account,ownerId:owner.id,snapshot:()=>({revision:'1',resources:[owner,group]})}});
    ctx.dafeiyu.registerExtension({id:'qq-tasks',version:'1',protocolVersion:API_VERSION,agentId:'fish',actions:[{id:'qq_task_submit',version:'1',description:'受理任务',inputSchema:MessageInstructionSubmitSchema,outputSchema:z.json(),effects:'local-write',execute:async(input,context)=>({status:'succeeded',effects:'confirmed',completeness:'complete',data:ctx.dafeiyu.submitMessageTask(context,'qq-tasks',{...MessageInstructionSubmitSchema.parse(input),kind:'explicit-task'}),sources:[],receipts:[]})}]});
    ctx.dafeiyu.bindMessageTasks({id:'qq-tasks',pluginId:'qq-tasks',channelExtensionId:'channel-qq',channel:'qq',account:owner.account,ownerId:owner.id,policyId:'task',version:'1',autoDeliver:true,classify:message=>({kind:'submit',text:message.mainText??message.text}),active:()=>true});
    stickers=new QqStickers(ctx,{agentId:'fish',botId:owner.account,ownerId:owner.id,store:store.stickers,allowed:()=>true,directSend:{ledger:new QqDirectSendLedger(join(root,'direct-sends')),available:()=>true,groups:()=>[{id:group.id,name:'测试甲群'}],generation:()=>1,api:{verify:async()=>{},call:async()=>{sends++;return {message_id:'777'};}}}});
  }});
  try{
    channel!.ingest({id:'owner-command',occurredAt:new Date().toISOString(),conversation:owner,sender:{id:owner.id,displayName:'owner'},text:'选一张表情包发到测试甲群',mainText:'选一张表情包发到测试甲群'});await host.core.whenIdle();assert.equal(sends,1);assert.equal(delivered,1);
    const db=new DatabaseSync(join(root,'data/memory/memory.sqlite'),{readOnly:true});try{const packets=db.prepare('SELECT body FROM native_expression_packets').all();assert.ok(packets.some(r=>String(r.body).includes('qq_sticker_send')&&String(r.body).includes('777')),'final evidence must retain the actual group receipt');}finally{db.close();}
  }finally{stickers?.close();await host.close();store.close();}
});
