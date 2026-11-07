import type {TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import {API_VERSION,MessageInstructionSubmitSchema,MessageTaskControlSchema} from '@dafeiyu/contracts';
import type {Conversation,ExtensionHandle,Reply} from '@dafeiyu/contracts';
import {QqStore,GroupDirectory,GroupSyncConfigSchema} from '@dafeiyu/qq';
import {QqCapabilities,qqResourceRoute} from '../packages/channel-qq/lib/capabilities.js';
import {FixtureAdapter,textResponse,toolResponse,verificationResponse} from './sdk-fixture.js';
import {testTempDir} from './test-temp.js';
import {LlmError} from '@deepseek-ai/dsh-llm';
import {randomUUID} from 'node:crypto';
import {captureAcceptance,acceptanceDatabase,requestMeasurements} from './acceptance-evidence.js';

export async function runOwnerDeliveryFixture(t:TestContext,mode:'repair'|'render-offline'|'verification-offline'|'verification-control'|'verification-revoked'|'verification-cancelled'|'verification-repair-limit'|'verification-pending-restart'='repair'){
  const root=await mkdtemp(join(testTempDir(),'owner-task-delivery-'));process.env.DSH_HOME=join(root,'data/core/dsh-home');
  const {ManagedHost,loadHostConfig,initializeProfile}=await import('@dafeiyu/host');
  const owner:Conversation={channel:'qq',account:'100001',kind:'private',id:'200001'},group:Conversation={...owner,kind:'group',id:'300001'};
  let joined=true;
  const qq=new QqStore(join(root,'qq.sqlite')),groups=new GroupDirectory({account:owner.account,allowed:[group.id],store:qq,config:GroupSyncConfigSchema.parse({enabled:true}),fetchGroups:async()=>joined?[{id:group.id,name:'fixture group',msgMask:1}]:[],rejectIdentity:()=>{}});await groups.start();
  qq.remember(qqResourceRoute(group),'group-message',owner.id,'GROUP_TEXT_MUST_REACH_OWNER',{occurredAt:new Date().toISOString(),unsupported:[],mentionedBot:true,groupGeneration:groups.generation(group.id)});
  let channel:ExtensionHandle|undefined,capabilities:QqCapabilities|undefined,submitted=false,taskStep=0,sawGroupEvidence=false,verificationCalls=0,renderingCalls=0;const delivered:Reply[]=[];
  let outage=false,injected=false;
  let resumeTaskId:string|null=null;
  const adapter=new FixtureAdapter(request=>{
    const session=String(request.sessionId);
    if(!injected && (mode==='render-offline'&&session.startsWith('dafeiyu-delivery-') || mode.startsWith('verification-')&&session.startsWith('memory-expression-verify-'))) {outage=true;injected=true;}
    if(outage)throw new LlmError('fixture unavailable model','HTTP_ERROR',{status:402});
    if(mode!=='repair'&&session.startsWith('memory-expression-verify-'))return verificationResponse(request,mode==='verification-repair-limit'?'fixture: unsupported statement':undefined);
    if(mode!=='repair'&&session.startsWith('dafeiyu-delivery-'))return textResponse('已核对群消息 GROUP_TEXT_MUST_REACH_OWNER，确实提到了我。');
    if(String(request.sessionId).startsWith('memory-expression-verify-')){if(verificationCalls++===0)throw new LlmError('fixture transient verifier outage','TRANSPORT');return verificationResponse(request,verificationCalls===2?'群消息和提及记录已存在，不能声称未收到。':verificationCalls===3?'单条消息不能证明所有群都没有过滤。':undefined);}
    if(String(request.sessionId).startsWith('dafeiyu-delivery-')){const text=request.messages.flatMap(message=>message.content.flatMap(block=>block.type==='text'?[block.text]:[])).join(' ');assert.match(text,/GROUP_TEXT_MUST_REACH_OWNER/);assert.match(text,/mentionedBot/);sawGroupEvidence=true;
      if(renderingCalls++===0)return textResponse('{"qq_messages":[{"type":"text","text":"群里没有收到主人消息。"}]}');
      assert.match(text,/previousCandidateUnapproved/);assert.match(text,/群消息和提及记录已存在/);
      if(renderingCalls===2)return textResponse('{"qq_messages":[{"type":"text","text":"已查到 GROUP_TEXT_MUST_REACH_OWNER，所以所有群都没有过滤。"}]}');
      assert.match(text,/单条消息不能证明所有群/);assert.match(text,/focused/);assert.match(String(request.sessionId),/-repair-2$/);return textResponse('{"qq_messages":[{"type":"text","text":"已核对群消息 GROUP_TEXT_MUST_REACH_OWNER，确实提到了我。"}]}');}
    if(!String(request.sessionId).startsWith('dafeiyu-task-')){if(resumeTaskId){const taskId=resumeTaskId;resumeTaskId=null;return mode==='verification-control'?toolResponse('fixture_task_control',{requestId:'resume-delivery-control',taskId,expectedVersion:1,action:'resume'}):toolResponse('fixture_task_submit',{requestId:'resume-inspection',intent:{relation:'retry',targetTaskId:taskId,expectedVersion:1}});}if(submitted)return textResponse('已经承接检查。');submitted=true;return toolResponse('fixture_task_submit',{requestId:'inspect-groups',title:'检查群消息'});}
    if(taskStep++===0)return toolResponse('qq_groups',{});
    if(taskStep===2)return toolResponse('qq_browse',{requestId:'read-group',target:group,limit:20});return textResponse('群原文和提及记录已取得。');
  });
  await writeFile(join(root,'persona.md'),'隔离验收。');const file=join(root,'host.json');await writeFile(file,JSON.stringify({schemaVersion:1,profileId:'owner-delivery',agent:{id:'fish'},paths:{core:'./data/core',memory:'./data/memory',sessions:'./data/sessions',query:'./data/query.sqlite'},modelRoutes:{chat:{provider:'local-test',model:'scripted'}},persona:{fixedFile:'./persona.md',kind:'test'},plugins:[{id:'model-scripted',required:true},{id:'timeline',required:true,config:{execution:true}},{id:'memory-growth',required:true}],authorityPolicies:[{id:'conversation',producers:['channel-qq'],actions:['fixture_task_submit','fixture_task_control'],allowLocalWrite:true},{id:'owner-task',producers:['fixture-tasks'],actions:['qq_browse','qq_groups'],resources:[]}]}));
  const config=loadHostConfig(file),coordination=join(root,'coordination.sqlite');initializeProfile(config,coordination);
  const options:Parameters<typeof ManagedHost.start>[1]={coordination,adapter,signal:t.signal,installChannels:ctx=>{
    channel=ctx.dafeiyu.registerExtension({id:'channel-qq',version:'1',protocolVersion:API_VERSION,agentId:'fish',channels:[{channel:'qq',account:owner.account,deliver:async reply=>({status:'sent',receiptId:reply.id}),deliverTaskResult:async(reply,_anchor,_signal,guard,begin)=>{guard();const finish=begin();try{delivered.push(reply);return {status:'sent',receiptId:'123456'};}finally{finish();}}}]});
    capabilities=new QqCapabilities(ctx,{agentId:'fish',botId:owner.account,ownerId:owner.id,store:qq,groups,available:()=>true,allowed:scene=>scene.account===owner.account&&(scene.kind==='private'?scene.id===owner.id:scene.id===group.id)});
    ctx.dafeiyu.registerExtension({id:'fixture-tasks',version:'1',protocolVersion:API_VERSION,agentId:'fish',actions:[{id:'fixture_task_control',version:'1',description:'继续原任务',inputSchema:MessageTaskControlSchema,outputSchema:z.json(),effects:'local-write',scope:'conversation',execute:async(raw,context)=>({status:'succeeded',effects:'confirmed',completeness:'complete',sources:[],receipts:[],data:z.json().parse(ctx.dafeiyu.controlMessageTask(context,'fixture-tasks',raw))})},{id:'fixture_task_submit',version:'1',description:'受理检查',inputSchema:MessageInstructionSubmitSchema,outputSchema:z.json(),effects:'local-write',execute:async(raw,context)=>({status:'succeeded',effects:'confirmed',completeness:'complete',sources:[],receipts:[],data:z.json().parse(ctx.dafeiyu.submitMessageTask(context,'fixture-tasks',{...MessageInstructionSubmitSchema.parse(raw),kind:'explicit-task'}))})}]});
    ctx.dafeiyu.bindMessageTasks({id:'fixture-tasks',pluginId:'fixture-tasks',channelExtensionId:'channel-qq',channel:'qq',account:owner.account,ownerId:owner.id,policyId:'owner-task',version:'1',autoDeliver:true,active:()=>true,classify:message=>({kind:'submit',text:message.text})});
  }};
  let host=await ManagedHost.start(config,options);
  try{channel!.ingest({id:'owner-request',occurredAt:new Date().toISOString(),conversation:owner,sender:{id:owner.id,displayName:'主人'},text:'请检查我在群里发的消息和@标记。',mainText:'请检查我在群里发的消息和@标记。'});await host.ctx.dafeiyu.whenIdle();
    if(mode!=='repair'){
      assert.equal(injected,true);assert.equal(delivered.length,0);
      const saved=z.object({runs:z.array(z.object({id:z.string(),state:z.string(),result:z.object({textHash:z.string().length(64)}).nullable()})),deliveries:z.array(z.object({run_id:z.string(),state:z.string()})),operations:z.array(z.object({action:z.string()}))}).parse(acceptanceDatabase(root));
      const delivery=saved.deliveries[0]!;assert.equal(delivery.state,'rejected');assert.ok(saved.runs.some(run=>run.id===delivery.run_id&&run.state==='completed'&&run.result!==null));
      assert.equal(saved.operations.filter(op=>op.action==='qq_browse').length,1);
      const before=host.ctx.dafeiyu.messageTaskDeliveryStatus(delivery.run_id)!;
      assert.deepEqual(await host.ctx.dafeiyu.deliverMessageTaskResult(delivery.run_id),before);
      capabilities?.close();await host.close();host=await ManagedHost.start(config,options);await host.ctx.dafeiyu.whenIdle();
      assert.deepEqual(host.ctx.dafeiyu.messageTaskDeliveryStatus(delivery.run_id),before);
      assert.equal(delivered.length,0);
      const rendersBefore=adapter.requests.filter(request=>String(request.sessionId).startsWith('dafeiyu-delivery-')).length;
      outage=false;
      const recovery={requestId:randomUUID(),expectedVersion:before.version};
      if(mode==='verification-revoked'||mode==='verification-cancelled'){
        const calls=adapter.requests.length;
        host.ctx.dafeiyu.resumeMessageTaskDelivery(delivery.run_id,recovery);
        if(mode==='verification-revoked'){joined=false;await groups.refresh();}
        else{const producer=host.ctx.dafeiyu.executionProducer('fixture-tasks'),task=producer.openTask(before.taskId),state=producer.taskState(task);producer.updateTask(task,{requestId:randomUUID(),expectedVersion:state.version,status:'paused'});}
        await host.ctx.dafeiyu.whenIdle();
        assert.equal(delivered.length,0);assert.equal(adapter.requests.length,calls,'revocation/cancellation is checked before another model call');
        const status=host.ctx.dafeiyu.messageTaskDeliveryStatus(delivery.run_id)!;assert.equal(status.state,'rejected');assert.equal(status.recovery.pendingRequestId,null);assert.ok(status.recovery.lastError);
        assert.equal(taskStep,3);return;
      }
      if(mode==='verification-repair-limit'){
        host.ctx.dafeiyu.resumeMessageTaskDelivery(delivery.run_id,recovery);await host.ctx.dafeiyu.whenIdle();
        const status=host.ctx.dafeiyu.messageTaskDeliveryStatus(delivery.run_id)!;
        assert.equal(status.state,'rejected');assert.equal(status.recovery.draftCount,3);assert.equal(status.recovery.reason,'DELIVERY_REPAIR_EXHAUSTED');assert.equal(delivered.length,0);assert.equal(taskStep,3);
        capabilities?.close();await host.close();host=await ManagedHost.start(config,options);
        assert.throws(()=>host.ctx.dafeiyu.resumeMessageTaskDelivery(delivery.run_id,{requestId:randomUUID(),expectedVersion:status.version}),/REPAIR_EXHAUSTED/);
        return;
      }
      if(mode==='verification-pending-restart'){
        host.ctx.dafeiyu.resumeMessageTaskDelivery(delivery.run_id,recovery);
        await host.close();capabilities?.close();host=await ManagedHost.start(config,options);
      }
      else if(mode==='render-offline'){
        const detail=await host.ctx.dafeiyu.managementTasks('detail',{id:delivery.run_id}) as {allowedActions:string[]};assert.ok(detail.allowedActions.includes('resume-delivery'));
        const receipt=await host.ctx.dafeiyu.managementTasks('resume-delivery',{id:delivery.run_id,...recovery});
        assert.deepEqual(host.ctx.dafeiyu.resumeMessageTaskDelivery(delivery.run_id,recovery),receipt,'same request has a durable receipt');
      }else{
        resumeTaskId=before.taskId;
        channel!.ingest({id:'owner-retry',occurredAt:new Date().toISOString(),conversation:owner,sender:{id:owner.id,displayName:'主人'},text:'继续把刚才的检查结果发给我，不用重新检查。',mainText:'继续把刚才的检查结果发给我，不用重新检查。'});
      }
      await host.ctx.dafeiyu.whenIdle();
      assert.equal(delivered.length,1);assert.match(delivered[0]!.text,/GROUP_TEXT_MUST_REACH_OWNER/);
      const after=host.ctx.dafeiyu.messageTaskDeliveryStatus(delivery.run_id)!;assert.equal(after.state,'sent');assert.equal(after.deliveryId,before.deliveryId);assert.equal(after.taskId,before.taskId);
      assert.equal(taskStep,3,'delivery recovery does not execute the completed business tools');
      const rendersAfter=adapter.requests.filter(request=>String(request.sessionId).startsWith('dafeiyu-delivery-')).length;
      assert.equal(rendersAfter-rendersBefore,mode==='render-offline'?1:0,'verifier recovery reuses the existing candidate');
      if(mode==='verification-offline'){
        const requests=adapter.requests.filter(request=>String(request.sessionId).startsWith('memory-expression-verify-'));
        const input=(request:typeof requests[number])=>request.messages.filter(message=>message.role==='user').flatMap(message=>message.content.flatMap(block=>block.type==='text'?[block.text]:[])).at(-1);
        assert.equal(input(requests[0]!),input(requests.at(-1)!),'same candidate and evidence are verified after restart');
      }
      capabilities?.close();await host.close();host=await ManagedHost.start(config,options);await host.ctx.dafeiyu.whenIdle();
      const calls=adapter.requests.length;await host.ctx.dafeiyu.deliverMessageTaskResult(delivery.run_id);
      if(mode==='render-offline')host.ctx.dafeiyu.resumeMessageTaskDelivery(delivery.run_id,recovery);
      await host.ctx.dafeiyu.whenIdle();assert.equal(delivered.length,1);assert.equal(adapter.requests.length,calls,'confirmed delivery and repeated recovery receipts do not redispatch');
      if(process.env.DAFEIYU_ACCEPTANCE_DIR&&(mode==='render-offline'||mode==='verification-offline'))captureAcceptance(mode==='render-offline'?'delivery-render-recovery':'delivery-verifier-recovery',{
        before,after,delivered,database:acceptanceDatabase(root),requests:requestMeasurements(adapter.requests),
        verificationInputs:adapter.requests.filter(request=>String(request.sessionId).startsWith('memory-expression-verify-')).map(request=>request.messages.filter(message=>message.role==='user').flatMap(message=>message.content.flatMap(block=>block.type==='text'?[block.text]:[])).at(-1)),
      });
      return;
    }
    assert.equal(delivered.length,1);assert.match(delivered[0]!.text,/GROUP_TEXT_MUST_REACH_OWNER/);assert.equal(delivered[0]!.conversation.kind,'private');assert.equal(delivered[0]!.conversation.id,owner.id);assert.equal(sawGroupEvidence,true);
    assert.equal(verificationCalls,4);assert.equal(renderingCalls,3);assert.equal(taskStep,3,'completed inspection is not rerun during verifier retry or factual repair');
    if(process.env.DAFEIYU_ACCEPTANCE_DIR)captureAcceptance('owner-report',{delivered,database:acceptanceDatabase(root),requests:requestMeasurements(adapter.requests)});
  }finally{capabilities?.close();await host.close();groups.pause();await groups.whenIdle();qq.close();}
}
