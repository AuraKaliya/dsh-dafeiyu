import type {TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import {API_VERSION,MessageInstructionSubmitSchema,MediaAssetRefSchema} from '@dafeiyu/contracts';
import type {Conversation,ExtensionHandle,MediaSourceDescription} from '@dafeiyu/contracts';
import {QqStore} from '@dafeiyu/qq';
import {QqSegmentedTransport} from '../packages/channel-qq/lib/transport.js';
import {QqMediaTransport} from '../packages/channel-qq/lib/media-transport.js';
import {FixtureAdapter,textResponse,toolResponse,verificationResponse} from './sdk-fixture.js';
import {testTempDir} from './test-temp.js';
import {captureAcceptance,acceptanceDatabase,requestMeasurements} from './acceptance-evidence.js';

export async function runTaskSendRecovery(t:TestContext,mode:'text'|'media'|'not-sent'|'unknown',revokeAfterRestart=false) {
  const root=await mkdtemp(join(testTempDir(),'task-send-recovery-'));process.env.DSH_HOME=join(root,'data/core/dsh-home');
  const {ManagedHost,loadHostConfig,initializeProfile}=await import('@dafeiyu/host');
  const owner:Conversation={channel:'qq',account:'100001',kind:'private',id:'200001'};
  const bytes=Buffer.from('isolated document bytes'),contentHash=createHash('sha256').update(bytes).digest('hex');
  const source:MediaSourceDescription={ref:{provider:'fixture-files',key:'document'},origin:{provider:'fixture-files',scene:owner,key:'document',version:1,hash:contentHash,roots:['fixture-document'],detail:{}},kind:'document',name:'fixture.txt',mimeHint:'text/plain',bytesHint:bytes.length,durationMsHint:null,rangeReadable:false,publicContent:false};
  let channel:ExtensionHandle|undefined,submitted=false,step=0,blocked=true,acquisitions=0,sourceAllowed=true;
  const sends:string[]=[],attempts:string[]=[],mediaManifests:string[]=[],notices:string[]=[];
  const adapter=new FixtureAdapter(request=>{
    const session=String(request.sessionId);
    if(session.startsWith('memory-expression-verify-'))return verificationResponse(request);
    if(session.startsWith('dafeiyu-delivery-'))return textResponse(mode==='media'?'已准备本地测试文件。':'{"qq_messages":[{"type":"text","text":"第一条测试结果。"},{"type":"text","text":"第二条测试结果。"}]}');
    if(!session.startsWith('dafeiyu-task-')){if(submitted)return textResponse('已受理。');submitted=true;return toolResponse('fixture_task_submit',{requestId:'send-result'});}
    if(mode==='media'){
      if(step++===0)return toolResponse('dafeiyu_media_acquire',{requestId:'acquire-file',source:source.ref});
      if(step===2){const previous=request.messages.findLast(message=>message.role==='tool')!,text=previous.content.flatMap(block=>block.type==='text'?[block.text]:[]).join('');
        const asset=z.object({data:MediaAssetRefSchema}).parse(JSON.parse(text)).data;
        return toolResponse('dafeiyu_media_reply',{requestId:'attach-file',expectedVersion:0,parts:[{kind:'asset',asset,as:'file'}]});}
      return textResponse('已准备本地测试文件。');
    }
    return textResponse('{"qq_messages":[{"type":"text","text":"第一条测试结果。"},{"type":"text","text":"第二条测试结果。"}]}');
  });
  await writeFile(join(root,'persona.md'),'本机隔离测试。');const settings=join(root,'host.json');
  await writeFile(settings,JSON.stringify({schemaVersion:1,profileId:'task-send-recovery',agent:{id:'fish'},paths:{core:'./data/core',memory:'./data/memory',sessions:'./data/sessions',query:'./data/query.sqlite',channels:{qq:'./qq'}},
    modelRoutes:{chat:{provider:'local-test',model:'scripted'}},persona:{fixedFile:'./persona.md',kind:'test'},plugins:[{id:'model-scripted',required:true},{id:'timeline',required:true,config:{execution:true}},{id:'memory-growth',required:true},...(mode==='media'?[{id:'media',required:true,config:{ffmpeg:process.execPath,ffprobe:process.execPath}}]:[])],
    authorityPolicies:[{id:'conversation',producers:['fixture-qq'],actions:['fixture_task_submit'],allowLocalWrite:true},{id:'owner-task',producers:['fixture-tasks'],actions:mode==='media'?['dafeiyu_media_acquire','dafeiyu_media_reply']:[],allowLocalWrite:true,resources:[owner]}]}));
  const config=loadHostConfig(settings),coordination=join(root,'coordination.sqlite');initializeProfile(config,coordination);
  const qq=new QqStore(join(root,'qq','qq.sqlite'));
  const options:Parameters<typeof ManagedHost.start>[1]={coordination,adapter,signal:t.signal,installChannels:ctx=>{
    const check=async()=>{if(blocked&&(mode==='not-sent'||sends.length>0)&&mode!=='unknown')throw new Error('CHANNEL_OFFLINE');};
    const send=async(text:string)=>{attempts.push(text);if(blocked&&mode==='unknown'&&attempts.length===2)throw new Error('unconfirmed transport');sends.push(text);return String(10000+sends.length);};
    const textTransport=new QqSegmentedTransport({ledger:qq.delivery,check,send:async(reply,text)=>{assert.deepEqual(reply.conversation,owner);assert.equal(reply.sourceMessageId,'owner-send');return send(text);},confirmed:()=>{}});
    const mediaTransport=new QqMediaTransport({ledger:qq.mediaDelivery,textProgress:id=>qq.delivery.progress(id),check,send:async(reply,part,data)=>{
      assert.deepEqual(reply.conversation,owner);assert.equal(reply.sourceMessageId,'owner-send');
      if(part.kind!=='text')assert.deepEqual(Buffer.from(data!),bytes);return send(part.kind==='text'?part.text:'file:'+part.asset.sha256);
    },confirmed:()=>{}});
    channel=ctx.dafeiyu.registerExtension({id:'fixture-qq',version:'1',protocolVersion:API_VERSION,agentId:'fish',channels:[{channel:'qq',account:owner.account,deliveryValidation:'per-segment',mediaDelivery:'parts-v1',
      deliveryProgress:id=>{const value=qq.mediaDelivery.progress(id)??qq.delivery.progress(id);if(!value)return null;const parts='parts'in value?value.parts:value.segments;return {total:value.total,confirmed:value.confirmed,pending:value.pending,unknown:value.unknown,sending:parts.filter(row=>row.state==='sending').length,receiptIds:parts.flatMap(row=>row.state==='sent'&&row.receipt?[row.receipt]:[]),canResume:value.pending>0&&!value.unknown};},
      deliver:async(reply,_signal,guard)=>{guard?.();notices.push(reply.text);return {status:'sent',receiptId:'90000'};},
      deliverTaskResult:(reply,_anchor,signal,guard,begin)=>textTransport.deliver(reply,signal,guard,begin),
      deliverMedia:(reply,signal,guard,read)=>{mediaManifests.push(reply.media.id);return mediaTransport.deliver(reply,signal,guard,read);}}]});
    ctx.dafeiyu.registerExtension({id:'fixture-tasks',version:'1',protocolVersion:API_VERSION,agentId:'fish',actions:[{id:'fixture_task_submit',version:'1',description:'受理任务',inputSchema:MessageInstructionSubmitSchema,outputSchema:z.json(),effects:'local-write',scope:'conversation',execute:async(input,context)=>({status:'succeeded',effects:'confirmed',completeness:'complete',data:z.json().parse(ctx.dafeiyu.submitMessageTask(context,'fixture-tasks',{...MessageInstructionSubmitSchema.parse(input),kind:'explicit-task'})),sources:[],receipts:[]})}]});
    ctx.dafeiyu.bindMessageTasks({id:'fixture-tasks',pluginId:'fixture-tasks',channelExtensionId:'fixture-qq',channel:'qq',account:owner.account,ownerId:owner.id,policyId:'owner-task',version:'1',autoDeliver:true,active:()=>true,classify:message=>({kind:'submit',text:message.text})});
    if(mode==='media'){
      ctx.dafeiyu.registerExtension({id:'fixture-files',version:'1',protocolVersion:API_VERSION,agentId:'fish',resourceProofs:{current:proof=>sourceAllowed&&JSON.stringify(proof)===JSON.stringify(source.origin),epoch:()=> 'fixture-'+sourceAllowed}});
      ctx.dafeiyu.registerMediaProvider({id:'fixture-files',describe:key=>key==='document'?source:null,open:async()=>{acquisitions++;return {bytes:bytes.length,mime:'text/plain',stream:(async function*(){yield bytes;})()};}});
    }
  }};
  let host=await ManagedHost.start(config,options);
  try{
    channel!.ingest({id:'owner-send',occurredAt:new Date().toISOString(),conversation:owner,sender:{id:owner.id,displayName:'主人'},text:mode==='media'?'请准备本地测试文件并发给我。':'请分两条给我测试结果。',mainText:mode==='media'?'请准备本地测试文件并发给我。':'请分两条给我测试结果。'});
    await host.ctx.dafeiyu.whenIdle();
    const rows=await host.management('tasks','list',{}) as {id:string;taskId:string|null}[],run=rows.find(row=>row.taskId)!;
    const before=host.ctx.dafeiyu.messageTaskDeliveryStatus(run.id)!;
    assert.equal(before.state,mode==='unknown'?'uncertain':mode==='not-sent'?'not-sent':'partial');
    assert.equal(host.ctx.dafeiyu.taskProgress(run.id).goal.status,'uncertain');
    if(mode==='unknown'){
      assert.equal(before.recovery.available,false);assert.throws(()=>host.ctx.dafeiyu.resumeMessageTaskDelivery(run.id,{requestId:randomUUID(),expectedVersion:before.version}),/RECOVERY_STATE/);
      await host.close();host=await ManagedHost.start(config,options);await host.ctx.dafeiyu.whenIdle();assert.equal(attempts.length,2);
      if(process.env.DAFEIYU_ACCEPTANCE_DIR)captureAcceptance('task-send-unknown',{before,after:host.ctx.dafeiyu.messageTaskDeliveryStatus(run.id),sends,attempts,database:acceptanceDatabase(root),requests:requestMeasurements(adapter.requests),progress:host.ctx.dafeiyu.taskProgress(run.id),transport:qq.delivery.progress('native-delivery:'+before.deliveryId)});
      return;
    }
    assert.equal(before.recovery.phase,'sending');assert.equal(sends.length,mode==='not-sent'?0:1);
    const calls=adapter.requests.length;await host.close();if(revokeAfterRestart)sourceAllowed=false;host=await ManagedHost.start(config,options);await host.ctx.dafeiyu.whenIdle();
    assert.equal(sends.length,mode==='not-sent'?0:1,'restart alone cannot retry a settled failure');blocked=false;
    host.ctx.dafeiyu.resumeMessageTaskDelivery(run.id,{requestId:randomUUID(),expectedVersion:before.version});await host.ctx.dafeiyu.whenIdle();
    if(revokeAfterRestart){assert.equal(sends.length,1);assert.equal(acquisitions,1);assert.equal(adapter.requests.length,calls);assert.equal(host.core.messageTaskDeliveryStatus(run.id)?.recovery.pendingRequestId,null);
      if(process.env.DAFEIYU_ACCEPTANCE_DIR)captureAcceptance('combined-media-revoke',{before,after:host.core.messageTaskDeliveryStatus(run.id),sends,attempts,acquisitions,mediaManifests,modelCallsBeforeRecovery:calls,requests:requestMeasurements(adapter.requests),database:acceptanceDatabase(root),progress:host.core.taskProgress(run.id),transport:qq.mediaDelivery.progress('native-delivery:'+before.deliveryId)});return;}
    const after=host.ctx.dafeiyu.messageTaskDeliveryStatus(run.id)!;assert.equal(after.state,'sent');assert.equal(after.deliveryId,before.deliveryId);assert.equal(after.taskId,before.taskId);
    assert.equal(sends.length,2);assert.equal(new Set(sends).size,2);assert.equal(adapter.requests.length,calls,'sending reuses approved text and media without model calls');
    if(mode==='media'){assert.equal(acquisitions,1);assert.equal(mediaManifests.length,2);assert.equal(new Set(mediaManifests).size,1);}
    const progress=host.ctx.dafeiyu.taskProgress(run.id);assert.equal(progress.execution.state,'completed');assert.equal(progress.delivery.state,'sent');assert.equal(progress.delivery.counts?.confirmed,2);
    await host.ctx.dafeiyu.deliverMessageTaskResult(run.id);assert.equal(sends.length,2);
    if(process.env.DAFEIYU_ACCEPTANCE_DIR)captureAcceptance('task-send-'+mode,{before,after,sends,attempts,acquisitions,mediaManifests,modelCallsBeforeRecovery:calls,
      database:acceptanceDatabase(root),requests:requestMeasurements(adapter.requests),progress,transport:qq.mediaDelivery.progress('native-delivery:'+before.deliveryId)??qq.delivery.progress('native-delivery:'+before.deliveryId)});
  }finally{await host.close();qq.close();}
}
