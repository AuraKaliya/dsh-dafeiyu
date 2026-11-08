import type {TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {LlmError} from '@deepseek-ai/dsh-llm';
import {API_VERSION,MessageInstructionSubmitSchema,MessageTaskControlSchema} from '@dafeiyu/contracts';
import type {Conversation,ExtensionHandle} from '@dafeiyu/contracts';
import {QqStore,GroupDirectory,GroupSyncConfigSchema} from '@dafeiyu/qq';
import {QqCapabilities,qqResourceRoute} from '../packages/channel-qq/lib/capabilities.js';
import {QqSegmentedTransport} from '../packages/channel-qq/lib/transport.js';
import {FixtureAdapter,textResponse,toolResponse,verificationResponse} from './sdk-fixture.js';
import {testTempDir} from './test-temp.js';
import {captureAcceptance,acceptanceDatabase,requestMeasurements} from './acceptance-evidence.js';

export type CombinedMode='chain'|'unknown'|'cancel'|'revise'|'revoke-query'|'revoke-render'|'revoke-verification'|'revoke-send'|'revoke-between';
export async function combinedDelivery(t:Pick<TestContext,'signal'>,mode:CombinedMode){
  const root=await mkdtemp(join(testTempDir(),'combined-delivery-'));process.env.DSH_HOME=join(root,'data/core/dsh-home');
  const {ManagedHost,loadHostConfig,initializeProfile}=await import('@dafeiyu/host');
  const owner:Conversation={channel:'qq',account:'100001',kind:'private',id:'200001'},group:Conversation={...owner,kind:'group',id:'300001'};
  const qq=new QqStore(join(root,'qq.sqlite'));let joined=true;
  const groups=new GroupDirectory({account:owner.account,allowed:[group.id],store:qq,config:GroupSyncConfigSchema.parse({enabled:true}),fetchGroups:async()=>joined?[{id:group.id,name:'synthetic group',msgMask:1}]:[],rejectIdentity:()=>{}});await groups.start();
  qq.remember(qqResourceRoute(group),'group-evidence',owner.id,'COMBINED_GROUP_EVIDENCE',{occurredAt:new Date().toISOString(),unsupported:[],mentionedBot:true,groupGeneration:groups.generation(group.id)});
  let channel:ExtensionHandle|undefined,capabilities:QqCapabilities|undefined,host:Awaited<ReturnType<typeof ManagedHost.start>>;
  let phase:'render-down'|'verify-down'|'healthy'='render-down',submitted=false,taskStep=0,renderCalls=0,verifyCalls=0,rendered=0,rejected=false,cut=false,allowRemaining=false;
  let originalRun:string|undefined,taskId:string|undefined,controlPending=false;
  const sends:{runId:string;text:string;receipt:string;target:Conversation;sourceMessageId:string}[]=[],attempts:{runId:string;text:string;target:Conversation}[]=[],verificationInputs:string[]=[],notices:string[]=[],stages:unknown[]=[];
  const revoke=async()=>{joined=false;await groups.refresh();};
  const good=JSON.stringify({qq_messages:[{type:'text',text:'已读取 COMBINED_GROUP_EVIDENCE，当前记录含提及标记。'},{type:'text',text:'这只覆盖本次群记录，不代表上游所有消息的投递情况。'}]});
  const adapter=new FixtureAdapter(request=>{
    const session=String(request.sessionId);
    if(session.startsWith('dafeiyu-delivery-')){renderCalls++;if(phase==='render-down')throw new LlmError('synthetic render unavailable','HTTP_ERROR',{status:402});
      assert.match(JSON.stringify(request.messages),/COMBINED_GROUP_EVIDENCE/);return textResponse(rendered++===0?'所有群的消息都已经正常投递。':good);}
    if(session.startsWith('memory-expression-verify-')){verifyCalls++;const text=request.messages.filter(message=>message.role==='user').flatMap(message=>message.content.flatMap(block=>block.type==='text'?[block.text]:[])).at(-1)!;verificationInputs.push(text);
      if(phase==='verify-down')throw new LlmError('synthetic verifier unavailable','HTTP_ERROR',{status:402});
      if(!rejected){rejected=true;return verificationResponse(request,'本次群记录不能证明所有群的投递情况。');}
      if(mode==='revoke-verification'&&!cut)return (async function*(){yield* verificationResponse(request);cut=true;await revoke();})();
      return verificationResponse(request);
    }
    if(!session.startsWith('dafeiyu-task-')){
      if(controlPending){controlPending=false;const producer=host.core.executionProducer('fixture-tasks'),task=producer.openTask(taskId!),state=producer.taskState(task);return toolResponse('fixture_task_control',{requestId:'interruption-'+mode,taskId,expectedVersion:state.version,action:mode});}
      if(submitted)return textResponse('已记录当前请求。');submitted=true;return toolResponse('fixture_task_submit',{requestId:'combined-inspection'});
    }
    if(taskStep++===0)return toolResponse('qq_groups',{});
    if(taskStep===2)return toolResponse('qq_browse',{requestId:'one-group-read',target:group,limit:20});
    if(mode==='revoke-query'&&!cut)return (async function*(){cut=true;await revoke();yield* textResponse('已完成资料读取。');})();
    return textResponse(mode==='revise'&&taskStep>3?'REVISED_RESULT 已确认新的目标，不再补发旧群资料。':'群资料及提及记录已取得，保留本次范围。');
  });
  const file=join(root,'host.json');await writeFile(join(root,'persona.md'),'本地组合回归。');await writeFile(file,JSON.stringify({schemaVersion:1,profileId:'combined-delivery',agent:{id:'fish'},paths:{core:'./data/core',memory:'./data/memory',sessions:'./data/sessions',query:'./data/query.sqlite'},modelRoutes:{chat:{provider:'local-test',model:'scripted'}},persona:{fixedFile:'./persona.md',kind:'test'},plugins:[{id:'model-scripted',required:true},{id:'timeline',required:true,config:{execution:true}},{id:'memory-growth',required:true}],authorityPolicies:[{id:'conversation',producers:['channel-qq'],actions:['fixture_task_submit','fixture_task_control'],allowLocalWrite:true},{id:'owner-task',producers:['fixture-tasks'],actions:['qq_groups','qq_browse'],resources:[]}]}));
  const config=loadHostConfig(file),coordination=join(root,'coordination.sqlite');initializeProfile(config,coordination);
  const options:Parameters<typeof ManagedHost.start>[1]={coordination,adapter,signal:t.signal,installChannels:ctx=>{
    const transport=new QqSegmentedTransport({ledger:qq.delivery,check:async()=>{},confirmed:()=>{},beforeSend:async reply=>{if(mode==='revoke-send'&&!cut&&reply.taskResult?.runId===originalRun){cut=true;await revoke();}},
      betweenMessages:async()=>{if(cut||allowRemaining||mode==='unknown')return;cut=true;
        if(mode==='revoke-between'){await revoke();return;}
        if(mode==='cancel'||mode==='revise'){controlPending=true;const text=mode==='cancel'?'先停一下，取消这个任务，不要再发剩下的内容。':'修订目标：不要再发旧群资料，只确认新的目标。';channel!.ingest({id:'owner-interruption',occurredAt:new Date().toISOString(),conversation:owner,sender:{id:owner.id,displayName:'主人'},text,mainText:text});}
        throw new Error('DELIVERY_INTERRUPTED_BY_MESSAGE');
      },send:async(reply,text)=>{const runId=reply.taskResult!.runId;attempts.push({runId,text,target:reply.conversation});if(mode==='unknown'&&runId===originalRun&&attempts.filter(row=>row.runId===runId).length===2)throw new Error('synthetic unknown platform outcome');
        assert.deepEqual(reply.conversation,owner);assert.doesNotMatch(text,/所有群的消息都已经正常投递/);const receipt=String(10000+sends.length);sends.push({runId,text,receipt,target:reply.conversation,sourceMessageId:reply.sourceMessageId});return receipt;}});
    channel=ctx.dafeiyu.registerExtension({id:'channel-qq',version:'1',protocolVersion:API_VERSION,agentId:'fish',channels:[{channel:'qq',account:owner.account,deliveryValidation:'per-segment',
      deliveryProgress:id=>{const p=qq.delivery.progress(id);return p?{total:p.total,confirmed:p.confirmed,pending:p.pending,unknown:p.unknown,sending:p.segments.filter(row=>row.state==='sending').length,receiptIds:p.segments.flatMap(row=>row.state==='sent'&&row.receipt?[row.receipt]:[]),canResume:p.pending>0&&!p.unknown}:null;},
      deliver:async(reply,_signal,guard)=>{guard?.();if(reply.id.startsWith('feedback:'))notices.push(reply.text);return {status:'sent',receiptId:reply.id};},
      deliverTaskResult:(reply,_anchor,signal,guard,begin)=>transport.deliver(reply,signal,guard,begin)}]});
    capabilities=new QqCapabilities(ctx,{agentId:'fish',botId:owner.account,ownerId:owner.id,store:qq,groups,available:()=>true,allowed:scene=>scene.account===owner.account&&(scene.kind==='private'?scene.id===owner.id:scene.id===group.id)});
    ctx.dafeiyu.registerExtension({id:'fixture-tasks',version:'1',protocolVersion:API_VERSION,agentId:'fish',actions:[{id:'fixture_task_submit',version:'1',description:'受理检查',inputSchema:MessageInstructionSubmitSchema,outputSchema:z.json(),effects:'local-write',execute:async(raw,context)=>({status:'succeeded',effects:'confirmed',completeness:'complete',sources:[],receipts:[],data:z.json().parse(ctx.dafeiyu.submitMessageTask(context,'fixture-tasks',{...MessageInstructionSubmitSchema.parse(raw),kind:'explicit-task'}))})},
      {id:'fixture_task_control',version:'1',description:'根据当前主人消息控制原任务',inputSchema:MessageTaskControlSchema,outputSchema:z.json(),effects:'local-write',scope:'conversation',execute:async(raw,context)=>({status:'succeeded',effects:'confirmed',completeness:'complete',sources:[],receipts:[],data:z.json().parse(ctx.dafeiyu.controlMessageTask(context,'fixture-tasks',raw))})}]});
    ctx.dafeiyu.bindMessageTasks({id:'fixture-tasks',pluginId:'fixture-tasks',channelExtensionId:'channel-qq',channel:'qq',account:owner.account,ownerId:owner.id,policyId:'owner-task',version:'1',autoDeliver:true,active:()=>true,classify:message=>({kind:'submit',text:message.text})});
  }};
  host=await ManagedHost.start(config,options);
  const snapshot=(label:string)=>{const delivery=host.core.messageTaskDeliveryStatus(originalRun!);stages.push({label,delivery,progress:host.core.taskProgress(originalRun!),requestCount:adapter.requests.length});return delivery;};
  const restart=async()=>{capabilities?.close();await host.close();host=await ManagedHost.start(config,options);await host.core.whenIdle();};
  const resume=()=>{const status=host.core.messageTaskDeliveryStatus(originalRun!)!;return host.core.resumeMessageTaskDelivery(originalRun!,{requestId:randomUUID(),expectedVersion:status.version});};
  try{channel!.ingest({id:'owner-original',occurredAt:new Date().toISOString(),conversation:owner,sender:{id:owner.id,displayName:'主人'},text:'检查群资料的提及记录并分两条汇报。',mainText:'检查群资料的提及记录并分两条汇报。'});await host.core.whenIdle();
    const rows=z.array(z.object({id:z.string(),taskId:z.string().nullable()})).parse(await host.management('tasks','list',{})),run=rows.find(row=>row.taskId)!;originalRun=run.id;taskId=run.taskId!;
    if(mode!=='revoke-query'){
      const initial=snapshot('render-failed')!;assert.equal(initial.state,'rejected');assert.equal(initial.recovery.phase,'rendering');assert.equal(sends.length,0);
      await restart();phase='verify-down';const calls=adapter.requests.length;resume();if(mode==='revoke-render')await revoke();await host.core.whenIdle();
      if(mode==='revoke-render'){assert.equal(adapter.requests.length,calls);assert.equal(sends.length,0);snapshot('source-revoked-before-render');}
      else{const verifying=snapshot('verification-failed')!;assert.equal(verifying.recovery.phase,'verification');assert.equal(sends.length,0);phase='healthy';resume();await host.core.whenIdle();
        assert.equal(verificationInputs[0],verificationInputs[1],'verifier service failure must reuse the original candidate and evidence');
        assert.equal(rendered,2,'only a semantic rejection creates one repaired candidate');snapshot('after-repair-and-dispatch');
        if(mode==='chain'){const partial=host.core.messageTaskDeliveryStatus(originalRun)!;assert.equal(partial.state,'partial');assert.equal(sends.length,1);const count=adapter.requests.length;await restart();assert.equal(sends.length,1);allowRemaining=true;resume();await host.core.whenIdle();assert.equal(sends.length,2);assert.equal(adapter.requests.length,count);assert.equal(snapshot('delivered')?.state,'sent');}
      }
    }else{assert.equal(renderCalls,0);assert.equal(sends.length,0);snapshot('source-revoked-after-query');}
    const originalSends=()=>sends.filter(row=>row.runId===originalRun),beforeRestart=originalSends().length,calls=adapter.requests.length;
    if(mode==='cancel'||mode==='revise'||mode==='revoke-between'||mode==='unknown')assert.equal(beforeRestart,1);
    if(mode==='revoke-verification'||mode==='revoke-send'||mode==='revoke-render'||mode==='revoke-query')assert.equal(beforeRestart,0);
    if(mode==='revise')assert.equal(sends.filter(row=>row.text.includes('REVISED_RESULT')).length,1);
    await restart();assert.equal(originalSends().length,beforeRestart);assert.equal(adapter.requests.length,calls);
    if(mode==='chain'){await host.core.deliverMessageTaskResult(originalRun);assert.equal(originalSends().length,2);}
    else if(mode!=='revoke-query'){
      try{resume();}catch(error){assert.match(String(error),/RECOVERY|SOURCE|SUPERSEDED/);}await host.core.whenIdle();assert.equal(originalSends().length,beforeRestart);
      if(mode.startsWith('revoke')){joined=true;await groups.refresh();try{resume();}catch{}await host.core.whenIdle();assert.equal(originalSends().length,beforeRestart,'rejoin does not restore old group evidence');}
    }
    const database=z.object({operations:z.array(z.object({action:z.string(),outcome:z.unknown()}))}).parse(acceptanceDatabase(root));assert.equal(database.operations.filter(row=>row.action==='qq_browse').length,1);
    assert.ok(notices.every(text=>!text.includes('COMBINED_GROUP_EVIDENCE')));
    if(process.env.DAFEIYU_ACCEPTANCE_DIR)captureAcceptance('combined-'+mode,{mode,originalRun,taskId,stages,sends,attempts,renderCalls,verifyCalls,verificationInputs,notices,finalProgress:host.core.taskProgress(originalRun),requests:requestMeasurements(adapter.requests),database:acceptanceDatabase(root),transport:qq.delivery.progress('native-delivery:'+host.core.messageTaskDeliveryStatus(originalRun)?.deliveryId)});
  }finally{capabilities?.close();await host.close();groups.pause();await groups.whenIdle();qq.close();}
}
