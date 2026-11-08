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

export async function runOwnerDeliveryFixture(t:Pick<TestContext,'signal'>,mode:'repair'|'render-offline'|'verification-offline'|'verification-control'|'verification-revoked'|'verification-cancelled'|'verification-repair-limit'|'verification-pending-restart'|'verification-notice-only'|'verification-notice-unknown'|'verification-notice-stale'|'task-offline'|'task-notice-stale'|'render-crash'|'verification-crash'|'resume-render-crash'|'resume-verification-crash'='repair',existingRoot?:string){
  const root=existingRoot??await mkdtemp(join(testTempDir(),'owner-task-delivery-'));process.env.DSH_HOME=join(root,'data/core/dsh-home');
  const {ManagedHost,loadHostConfig,initializeProfile}=await import('@dafeiyu/host');
  const owner:Conversation={channel:'qq',account:'100001',kind:'private',id:'200001'},group:Conversation={...owner,kind:'group',id:'300001'};
  let joined=true;
  const qq=new QqStore(join(root,'qq.sqlite')),groups=new GroupDirectory({account:owner.account,allowed:[group.id],store:qq,config:GroupSyncConfigSchema.parse({enabled:true}),fetchGroups:async()=>joined?[{id:group.id,name:'fixture group',msgMask:1}]:[],rejectIdentity:()=>{}});await groups.start();
  if(!existingRoot)qq.remember(qqResourceRoute(group),'group-message',owner.id,'GROUP_TEXT_MUST_REACH_OWNER',{occurredAt:new Date().toISOString(),unsupported:[],mentionedBot:true,groupGeneration:groups.generation(group.id)});
  let channel:ExtensionHandle|undefined,capabilities:QqCapabilities|undefined,submitted=false,taskStep=0,sawGroupEvidence=false,verificationCalls=0,renderingCalls=0;const delivered:Reply[]=[];
  let outage=false,injected=false,failedModelCalls=0;const notices:Reply[]=[];
  let resumeTaskId:string|null=null;
  const adapter=new FixtureAdapter(request=>{
    const session=String(request.sessionId);
    if(mode==='render-crash'&&session.startsWith('dafeiyu-delivery-')||mode==='verification-crash'&&session.startsWith('memory-expression-verify-'))return (async function*(){process.send?.({type:'delivery-crash-ready',root});await new Promise<void>(()=>{});})();
    if(!injected && (mode==='render-offline'&&session.startsWith('dafeiyu-delivery-') || mode.startsWith('verification-')&&session.startsWith('memory-expression-verify-')||(mode==='task-offline'||mode==='task-notice-stale')&&session.startsWith('dafeiyu-task-'))) {outage=true;injected=true;}
    if(outage){failedModelCalls++;throw new LlmError('fixture unavailable model','HTTP_ERROR',{status:402});}
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
  if(!existingRoot)await writeFile(join(root,'persona.md'),'隔离验收。');const file=join(root,'host.json');if(!existingRoot)await writeFile(file,JSON.stringify({schemaVersion:1,profileId:'owner-delivery',agent:{id:'fish'},paths:{core:'./data/core',memory:'./data/memory',sessions:'./data/sessions',query:'./data/query.sqlite'},modelRoutes:{chat:{provider:'local-test',model:'scripted'}},persona:{fixedFile:'./persona.md',kind:'test'},plugins:[{id:'model-scripted',required:true},{id:'timeline',required:true,config:{execution:true}},{id:'memory-growth',required:true}],authorityPolicies:[{id:'conversation',producers:['channel-qq'],actions:['fixture_task_submit','fixture_task_control'],allowLocalWrite:true},{id:'owner-task',producers:['fixture-tasks'],actions:['qq_browse','qq_groups'],resources:[]}]}));
  const config=loadHostConfig(file),coordination=join(root,'coordination.sqlite');if(!existingRoot)initializeProfile(config,coordination);
  const options:Parameters<typeof ManagedHost.start>[1]={coordination,adapter,signal:t.signal,installChannels:ctx=>{
    channel=ctx.dafeiyu.registerExtension({id:'channel-qq',version:'1',protocolVersion:API_VERSION,agentId:'fish',channels:[{channel:'qq',account:owner.account,deliver:async(reply,_signal,guard)=>{guard?.();if(reply.id.startsWith('feedback:')){notices.push(reply);if(mode==='verification-notice-unknown')throw new Error('fixture unknown transport');if(mode==='verification-notice-stale'||mode==='task-notice-stale')return {status:'not-sent',code:'CHANNEL_OFFLINE'};}return {status:'sent',receiptId:reply.id};},deliverTaskResult:async(reply,_anchor,_signal,guard,begin)=>{guard();const finish=begin();try{delivered.push(reply);return {status:'sent',receiptId:'123456'};}finally{finish();}}}]});
    capabilities=new QqCapabilities(ctx,{agentId:'fish',botId:owner.account,ownerId:owner.id,store:qq,groups,available:()=>true,allowed:scene=>scene.account===owner.account&&(scene.kind==='private'?scene.id===owner.id:scene.id===group.id)});
    ctx.dafeiyu.registerExtension({id:'fixture-tasks',version:'1',protocolVersion:API_VERSION,agentId:'fish',actions:[{id:'fixture_task_control',version:'1',description:'继续原任务',inputSchema:MessageTaskControlSchema,outputSchema:z.json(),effects:'local-write',scope:'conversation',execute:async(raw,context)=>({status:'succeeded',effects:'confirmed',completeness:'complete',sources:[],receipts:[],data:z.json().parse(ctx.dafeiyu.controlMessageTask(context,'fixture-tasks',raw))})},{id:'fixture_task_submit',version:'1',description:'受理检查',inputSchema:MessageInstructionSubmitSchema,outputSchema:z.json(),effects:'local-write',execute:async(raw,context)=>({status:'succeeded',effects:'confirmed',completeness:'complete',sources:[],receipts:[],data:z.json().parse(ctx.dafeiyu.submitMessageTask(context,'fixture-tasks',{...MessageInstructionSubmitSchema.parse(raw),kind:'explicit-task'}))})}]});
    ctx.dafeiyu.bindMessageTasks({id:'fixture-tasks',pluginId:'fixture-tasks',channelExtensionId:'channel-qq',channel:'qq',account:owner.account,ownerId:owner.id,policyId:'owner-task',version:'1',autoDeliver:true,active:()=>true,classify:message=>({kind:'submit',text:message.text})});
  }};
  let host=await ManagedHost.start(config,options);
  try{if(!existingRoot)channel!.ingest({id:'owner-request',occurredAt:new Date().toISOString(),conversation:owner,sender:{id:owner.id,displayName:'主人'},text:'请检查我在群里发的消息和@标记。',mainText:'请检查我在群里发的消息和@标记。'});await host.ctx.dafeiyu.whenIdle();
    if(existingRoot){
      const rows=await host.management('tasks','list',{}) as {id:string;taskId:string|null}[],run=rows.find(row=>row.taskId)!;
      const before=host.ctx.dafeiyu.messageTaskDeliveryStatus(run.id)!;assert.equal(before.state,'interrupted');assert.equal(before.recovery.available,true);
      assert.equal(before.recovery.draftCount,mode==='resume-verification-crash'?1:0);
      assert.equal(notices.length,1,'newly observed process interruption produces one program notice');assert.equal(adapter.requests.length,0);
      host.ctx.dafeiyu.resumeMessageTaskDelivery(run.id,{requestId:randomUUID(),expectedVersion:before.version});await host.ctx.dafeiyu.whenIdle();
      assert.equal(delivered.length,1);assert.equal(host.ctx.dafeiyu.messageTaskDeliveryStatus(run.id)?.state,'sent');
      assert.equal(adapter.requests.filter(request=>String(request.sessionId).startsWith('dafeiyu-task-')).length,0,'crash recovery does not replay completed business work');
      assert.equal(adapter.requests.filter(request=>String(request.sessionId).startsWith('dafeiyu-delivery-')).length,mode==='resume-verification-crash'?0:1);
      const database=z.object({operations:z.array(z.object({action:z.string()}))}).parse(acceptanceDatabase(root));assert.equal(database.operations.filter(operation=>operation.action==='qq_browse').length,1);return;
    }
    if(mode==='task-notice-stale'){
      assert.equal(notices.length,1);assert.equal(failedModelCalls,1);
      const rows=await host.management('tasks','list',{}) as {id:string;taskId:string|null;version:number}[],run=rows.find(row=>row.taskId)!;
      const detail=await host.management('tasks','detail',{id:run.id}) as {allowedActions:string[]};assert.ok(detail.allowedActions.includes('resume'));outage=false;
      await host.management('tasks','resume',{id:run.id,requestId:randomUUID(),expectedVersion:run.version});
      await host.ctx.dafeiyu.dispatchFeedback();await host.ctx.dafeiyu.whenIdle();await host.ctx.dafeiyu.dispatchFeedback();
      assert.equal(delivered.length,1);assert.equal(notices.length,1);assert.equal(host.ctx.dafeiyu.taskProgress(run.id).currentRun,false);
      const old=await host.management('tasks','detail',{id:run.id}) as {allowedActions:string[]};assert.ok(!old.allowedActions.includes('resume'));
      await assert.rejects(host.management('tasks','resume',{id:run.id,requestId:randomUUID(),expectedVersion:run.version}),/TASK_RESUME_NOT_AVAILABLE/);return;
    }
    if(mode==='verification-notice-stale'){
      assert.equal(notices.length,1);assert.equal(failedModelCalls,1);
      const rows=await host.management('tasks','list',{}) as {id:string;taskId:string|null}[],run=rows.find(row=>row.taskId)!;
      const before=host.ctx.dafeiyu.messageTaskDeliveryStatus(run.id)!;outage=false;
      host.ctx.dafeiyu.resumeMessageTaskDelivery(run.id,{requestId:randomUUID(),expectedVersion:before.version});
      await host.ctx.dafeiyu.dispatchFeedback();await host.ctx.dafeiyu.whenIdle();await host.ctx.dafeiyu.dispatchFeedback();
      assert.equal(delivered.length,1);assert.equal(notices.length,1,'outdated failure must not follow the successfully delivered result');
      const records=host.ctx.dafeiyu.feedbackLedger().pending(JSON.stringify(['fish','qq',owner.account,'private',owner.id]),Date.now(),true);
      assert.equal(records.length,1);assert.equal(records[0]!.state,'superseded');return;
    }
    if(mode==='verification-notice-only'||mode==='verification-notice-unknown'||mode==='task-offline'){
      assert.equal(injected,true);assert.equal(failedModelCalls,1,'fault notification must not invoke the unavailable model');assert.equal(notices.length,1);assert.equal(delivered.length,0);
      assert.equal(notices[0]!.conversation.id,owner.id);assert.doesNotMatch(notices[0]!.text,/GROUP_TEXT_MUST_REACH_OWNER|MODEL_HTTP|402|任务已完成|结果已发送/);
      assert.match(notices[0]!.text,mode==='task-offline'?/执行中断/:/交付尚未完成/);
      const rows=await host.management('tasks','list',{}) as {taskId:string|null;id:string;progress:unknown}[],run=rows.find(row=>row.taskId)!;
      const view=host.ctx.dafeiyu.taskProgress(run.id);assert.deepEqual(view,run.progress);assert.equal(view.goal.status,'uncertain');assert.equal(view.execution.state,mode==='task-offline'?'failed':'completed');assert.equal(view.delivery.state,mode==='task-offline'?'none':'rejected');
      const records=host.ctx.dafeiyu.feedbackLedger().pending(JSON.stringify(['fish','qq',owner.account,'private',owner.id]),Date.now(),true);
      assert.equal(records.length,1);assert.equal(records[0]!.state,mode==='verification-notice-unknown'?'unknown':'sent');
      const calls=adapter.requests.length;await host.ctx.dafeiyu.dispatchFeedback();await host.ctx.dafeiyu.dispatchFeedback();assert.equal(notices.length,1);assert.equal(adapter.requests.length,calls);
      capabilities?.close();await host.close();host=await ManagedHost.start(config,options);await host.ctx.dafeiyu.dispatchFeedback();await host.ctx.dafeiyu.whenIdle();
      assert.equal(notices.length,1);assert.equal(adapter.requests.length,calls);
      if(process.env.DAFEIYU_ACCEPTANCE_DIR)captureAcceptance(mode==='task-offline'?'execution-fault-notice':mode==='verification-notice-unknown'?'fault-notice-unknown':'fault-notice',{
        notices,failedModelCalls,database:acceptanceDatabase(root),requests:requestMeasurements(adapter.requests),progress:host.ctx.dafeiyu.taskProgress(run.id),
        feedback:host.ctx.dafeiyu.feedbackLedger().pending(JSON.stringify(['fish','qq',owner.account,'private',owner.id]),Date.now(),true),
      });return;
    }
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
