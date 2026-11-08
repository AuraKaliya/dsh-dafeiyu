import type {TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import {API_VERSION,MessageInstructionSubmitSchema} from '@dafeiyu/contracts';
import type {Conversation,ExtensionHandle,Reply,InboundMessage} from '@dafeiyu/contracts';
import {FixtureAdapter,textResponse,toolResponse,verificationResponse} from './sdk-fixture.js';
import {testTempDir} from './test-temp.js';
import {captureAcceptance,acceptanceDatabase,requestMeasurements} from './acceptance-evidence.js';

export async function runPatrolScenario(t:TestContext,relation:'new'|'amend'){
  const root=await mkdtemp(join(testTempDir(),'group-patrol-'));process.env.DSH_HOME=join(root,'data/core/dsh-home');
  const {ManagedHost,loadHostConfig,initializeProfile}=await import('@dafeiyu/host');
  const owner:Conversation={channel:'qq',account:'100001',kind:'private',id:'200001'},a:Conversation={...owner,kind:'group',id:'300001'},b:Conversation={...a,id:'300002'},delivered:Reply[]=[];
  const actual:InboundMessage={id:'authentic-group-message',occurredAt:new Date().toISOString(),conversation:a,sender:{id:'200002',displayName:'真实测试成员'},text:'大家觉得古画修复中保留原貌重要吗？',mainText:'大家觉得古画修复中保留原貌重要吗？'};
  let channel:ExtensionHandle|undefined,submitted=false,planned=false,statusRequested=false,patrolCalls=0,updating=false,planId='',configurationChecks=0;
  const configurationWaits:{sourceState:string;foregroundBusy:boolean;patrolBefore:number;patrolAfter:number}[]=[];
  const adapter=new FixtureAdapter(request=>{
    if(String(request.sessionId).startsWith('memory-expression-verify-'))return verificationResponse(request);
    if(String(request.sessionId).startsWith('dafeiyu-delivery-')){const evidence=request.messages.flatMap(message=>message.content.flatMap(block=>block.type==='text'?[block.text]:[])).join('\n');assert.ok(evidence.includes(updating?'120000':'60000'),'the final rendering must receive the recorded interval');return textResponse(updating?'群巡视已调整为每两分钟。':'群巡视计划已建立。');}
    if(request.tools?.some(tool=>tool.name==='fixture_task_submit')){if(submitted)return textResponse('已经承接巡视安排。');submitted=true;const prior=updating?host.ctx.dafeiyuActivity.store.get(planId):null;return toolResponse('fixture_task_submit',{requestId:updating?'adjust-owner-request':'watch-owner-request',title:'定期看群',...(updating&&relation==='amend'?{intent:{relation:'amend',targetTaskId:prior!.body.owner.kind==='task'?prior!.body.owner.taskId:undefined,expectedVersion:1}}:{})});}
    if(request.tools?.some(tool=>tool.name==='dafeiyu_activity_plan')){if(planned){
      const material=JSON.stringify(request.messages);assert.match(material,/configuration-only/);assert.match(material,/sourceTaskMustSettle/);
      if(!statusRequested){statusRequested=true;return toolResponse('dafeiyu_activity_status',{id:host.ctx.dafeiyuActivity.store.management()[0]!.body.id});}
      return (async function*(){
        assert.match(material,/waitsForCurrentTask\\?":true/);assert.match(material,/正在等待本次设置任务/);
        const status=host.ctx.dafeiyuActivity.management('status',null) as {plans:{dispatch:{sourceState:string;foregroundBusy:boolean}}[]};
        assert.equal(status.plans[0]!.dispatch.sourceState,'pending');
        const before=patrolCalls;await host.ctx.dafeiyuActivity.tick();configurationWaits.push({...status.plans[0]!.dispatch,patrolBefore:before,patrolAfter:patrolCalls});assert.equal(patrolCalls,before,'unfinished configuration must not wait for a patrol blocked by its own source');configurationChecks++;
        yield* textResponse('配置已保存，结束本次设置任务后再由后台调度；此回执不表示已经巡视。');
      })();
    }planned=true;if(updating&&relation==='amend')assert.deepEqual(host.ctx.dafeiyu.activityAnchorStatus(host.ctx.dafeiyuActivity.store.get(planId).body.anchor),{state:'stale',code:'TASK_NOT_ACTIVE'});
    return updating?toolResponse('dafeiyu_activity_update',{requestId:'update-watch',id:planId,expectedVersion:1,trigger:{kind:'interval',anchorAt:new Date(Date.now()+120000).toISOString(),intervalMs:120000}}):toolResponse('dafeiyu_activity_plan',{requestId:'watch-plan',kind:'group-watch',watch:{mode:'joined',reply:true},goal:'查看群新消息，有具体观点时参与',trigger:{kind:'interval',anchorAt:new Date(Date.now()-1000).toISOString(),intervalMs:60000}});}
    if(request.messages.some(message=>message.role==='system'&&message.content.some(block=>block.type==='text'&&block.text.includes('"kind":"accepted-task-handoff"'))))return textResponse('已经承接巡视安排。');
    const text=JSON.stringify(request.messages);assert.match(text,/主人授权的群巡视/);assert.doesNotMatch(text,/PRIVATE_SECRET|GROUP_B_SECRET/);patrolCalls++;return textResponse('{"qq_messages":[{"type":"text","text":"我会先区分哪些修复能撤销，哪些改变不可逆。"}]}');
  });
  await writeFile(join(root,'persona.md'),'隔离测试人格。');const file=join(root,'host.json');
  await writeFile(file,JSON.stringify({schemaVersion:1,profileId:'group-patrol',agent:{id:'fish'},paths:{core:'./data/core',memory:'./data/memory',sessions:'./data/sessions',query:'./data/query.sqlite'},modelRoutes:{chat:{provider:'local-test',model:'scripted'}},persona:{fixedFile:'./persona.md',kind:'test'},plugins:[{id:'model-scripted',required:true},{id:'timeline',required:true,config:{execution:true}},{id:'memory-growth',required:true},{id:'activity',required:true,config:{exploration:false,ownerSharing:{enabled:false},allowedCapabilities:[],idleAfterMs:0,tickMs:60000}}],authorityPolicies:[{id:'conversation',producers:['fixture-qq'],actions:['fixture_task_submit'],allowLocalWrite:true},{id:'owner-task',producers:['fixture-tasks'],actions:['dafeiyu_activity_plan','dafeiyu_activity_update','dafeiyu_activity_status'],allowLocalWrite:true,resources:[]},{id:'activity-explore',producers:['activity'],actions:['dafeiyu_activity_plan','dafeiyu_activity_update','dafeiyu_activity_status','dafeiyu_activity_rest'],allowLocalWrite:true,resources:[]}]}));
  const config=loadHostConfig(file),coordination=join(root,'coordination.sqlite');initializeProfile(config,coordination);
  const options:Parameters<typeof ManagedHost.start>[1]={coordination,adapter,signal:t.signal,installChannels:ctx=>{
    channel=ctx.dafeiyu.registerExtension({id:'fixture-qq',version:'1',protocolVersion:API_VERSION,agentId:'fish',ownerDirectory:{channelExtensionId:'fixture-qq',channel:'qq',account:'100001',ownerId:'200001',snapshot:()=>({revision:'1',available:true,resources:[owner,a,b]}),patrol:{peek:(target,cursor)=>target.id===a.id&&cursor<1?{cursor:1,message:actual}:{cursor,message:null},ingest:message=>channel!.ingest(message)}},channels:[{channel:'qq',account:'100001',deliver:async(reply,_signal,guard)=>{guard?.();delivered.push(reply);return {status:'sent',receiptId:'message-'+delivered.length};},deliverTaskResult:async(reply,_anchor,_signal,guard,begin)=>{guard();const end=begin();try{delivered.push(reply);return {status:'sent',receiptId:'plan-result'};}finally{end();}}}]});
    ctx.dafeiyu.registerExtension({id:'fixture-tasks',version:'1',protocolVersion:API_VERSION,agentId:'fish',actions:[{id:'fixture_task_submit',version:'1',description:'办理主人任务',inputSchema:MessageInstructionSubmitSchema,outputSchema:z.json(),effects:'local-write',scope:'conversation',execute:async(input,context)=>({status:'succeeded',effects:'confirmed',completeness:'complete',sources:[],receipts:[],data:z.json().parse(ctx.dafeiyu.submitMessageTask(context,'fixture-tasks',{...MessageInstructionSubmitSchema.parse(input),kind:'explicit-task'}))})}]});
    ctx.dafeiyu.bindMessageTasks({id:'fixture-tasks',pluginId:'fixture-tasks',channelExtensionId:'fixture-qq',channel:'qq',account:'100001',ownerId:'200001',policyId:'owner-task',version:'1',autoDeliver:true,classify:message=>({kind:'submit',text:message.mainText??''}),active:()=>true});
  }};
  let host=await ManagedHost.start(config,options);
  try{const text='每隔一段时间看看已加入的群的消息，如果有感兴趣的就可以回复回复。PRIVATE_SECRET 只属于私聊。';channel!.ingest({id:'owner-watch',occurredAt:new Date().toISOString(),conversation:owner,sender:{id:owner.id,displayName:'主人'},text,mainText:text});
    await host.ctx.dafeiyu.whenIdle();const plan=host.ctx.dafeiyuActivity.store.management()[0];assert.ok(plan);assert.equal(plan.body.purpose,'group-watch');
    await host.ctx.dafeiyuActivity.tick();await host.ctx.dafeiyu.whenIdle();
    assert.equal(patrolCalls,1);assert.equal(delivered.filter(reply=>reply.conversation.id===a.id).length,1);assert.equal(delivered.filter(reply=>reply.conversation.id===b.id).length,0);
    assert.equal(host.ctx.dafeiyuActivity.store.patrolCursor(plan.body.id,JSON.stringify(a)),1);
    const count=adapter.requests.length;for(let i=0;i<100;i++)assert.equal(host.ctx.dafeiyu.pollPatrol({planId:plan.body.id,version:plan.body.version,anchor:plan.body.anchor!,target:a,cursor:1,reply:true}).state,'no-new-message');
    assert.equal(adapter.requests.length,count);
    planId=plan.body.id;updating=true;submitted=false;planned=false;statusRequested=false;
    channel!.ingest({id:'owner-adjust-watch',occurredAt:new Date().toISOString(),conversation:owner,sender:{id:owner.id,displayName:'主人'},text:'把已有群巡视改成每两分钟，不新增计划。',mainText:'把已有群巡视改成每两分钟，不新增计划。'});
    await host.ctx.dafeiyu.whenIdle();const changed=host.ctx.dafeiyuActivity.store.get(planId);assert.equal(changed.body.version,2);assert.equal(changed.body.trigger.kind,'interval');
    if(changed.body.trigger.kind==='interval')assert.equal(changed.body.trigger.intervalMs,120000);assert.equal(host.ctx.dafeiyuActivity.store.management().length,1);assert.equal(configurationChecks,2);
    assert.equal(host.ctx.dafeiyuActivity.store.patrolCursor(planId,JSON.stringify(a)),1,'changing the interval must preserve the last observed group watermark');
    if(relation==='amend'){assert.equal(changed.body.owner.kind==='task'&&changed.body.owner.taskId,plan.body.owner.kind==='task'&&plan.body.owner.taskId);assert.equal(changed.body.anchor?.intentVersion,2);assert.equal(host.ctx.dafeiyu.activityAnchorStatus(changed.body.anchor).state,'valid');assert.equal(host.ctx.dafeiyu.activityAnchorStatus(plan.body.anchor).state,'stale','old authorization is not silently revived');}
    await host.close();host=await ManagedHost.start(config,options);await host.ctx.dafeiyuActivity.tick();await host.ctx.dafeiyu.whenIdle();assert.equal(patrolCalls,1);
    if(process.env.DAFEIYU_ACCEPTANCE_DIR)captureAcceptance('patrol-'+relation,{before:plan,after:changed,afterRestart:host.ctx.dafeiyuActivity.store.get(planId),
      cursor:host.ctx.dafeiyuActivity.store.patrolCursor(planId,JSON.stringify(a)),planCount:host.ctx.dafeiyuActivity.store.management().length,
      configurationWaits,patrolCalls,delivered,database:acceptanceDatabase(root),requests:requestMeasurements(adapter.requests)});
  }finally{await host.close();}
}
