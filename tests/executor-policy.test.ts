import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import * as Core from '@dafeiyu/core';
import * as Timeline from '@dafeiyu/timeline';
import * as Memory from '@dafeiyu/memory';
import { runtimeHash } from '@dafeiyu/core/runtime-store';
import { API_VERSION,HostConfigSchema,MessageTaskSubmitSchema,ExternalActionPoliciesSchema,ExternalTaskAuthorizationSchema } from '@dafeiyu/contracts';
import type { ActionOutcome,ActivityAnchor,ExecutionContextV3,ExternalActionPolicy,ExternalTaskAuthority,HostConfig } from '@dafeiyu/contracts';
import { probeHost } from './phase1-probe-fixture.js';
import { ScriptedModel,call,textReply } from './harness.js';
import type { Response } from './harness.js';
import { qqTaskDirective } from '../packages/channel-qq/lib/tasks.js';
import { testTempDir } from './test-temp.js';

const actionId='fixture_external',owner='server-executor',account='12345678',ownerId='87654321';
const scene={channel:'qq',account,kind:'group' as const,id:'11223344'};
const allowed:ExternalActionPolicy={extensionId:owner,actionId,actionVersion:'1'};
const completed=():ActionOutcome=>({status:'succeeded',effects:'confirmed',completeness:'complete',data:{fixture:true},sources:[],receipts:[{id:'fixture-receipt',kind:'fixture'}]});
const deferred=()=>{let resolve=()=>{};const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};};
const native=(session:unknown)=>String(session).startsWith('dafeiyu-task-');
type Policy=HostConfig['authorityPolicies'][number];

/** Real Core/Memory/DSH with a fictional QQ ingress; no process, network, credentials or paid model. */
async function fixture(options:{externalActions?:ExternalActionPolicy[]|null;allowLocalWrite?:boolean;requiresTask?:boolean;extensionId?:string;
  execute?:(context:ExecutionContextV3)=>Promise<ActionOutcome>|ActionOutcome;directory?:string;create?:boolean}={}){
  const directory=options.directory??await mkdtemp(join(testTempDir(),'executor-policy-'));let response:Response=()=>textReply('虚构完成');
  const adapter=new ScriptedModel(request=>response(request)),host=await probeHost(directory,adapter),ctx=host.ctx;
  let submission:{taskId:string;runId:string}|undefined,anchor:ActivityAnchor|undefined,invocations=0,messageId=0;
  try{
    await ctx.plugin(Core,{agentId:'dafeiyu',dataDir:join(directory,'core'),personaFile:resolve('profiles/persona.test.md'),provider:'local-test',model:'scripted',lifecycleMode:'managed',turnTimeoutMs:10000});
    await ctx.plugin(Timeline,{agentId:'dafeiyu',execution:true});
    await ctx.plugin(Memory,{agentId:'dafeiyu',dataDir:join(directory,'memory'),lifecycleMode:'managed',sourceTracking:true});
    const core=ctx.dafeiyu,extensionId=options.extensionId??owner;
    const extension=core.registerExtensionV3({protocolVersion:3,id:extensionId,version:'1',agentId:'dafeiyu',actions:[
      {id:actionId,version:'1',description:'本机虚构外部能力，无实际外部效果',requiresTask:options.requiresTask??true,effects:'external-write',inputSchema:z.strictObject({}),outputSchema:z.json(),
        execute:async(_raw,c)=>{invocations++;return options.execute?await options.execute(c):completed();}},
      {id:'fixture_anchor',version:'1',description:'取得真实持久活动锚点',requiresTask:true,effects:'local-write',inputSchema:z.strictObject({}),outputSchema:z.json(),
        execute:async(_raw,c)=>{anchor=core.captureActivityAnchor(c,extensionId);return {...completed(),data:{anchor}};}},
      {id:'fixture_read',version:'1',description:'只读能力不能取得外部授权',requiresTask:true,effects:'read',inputSchema:z.strictObject({}),outputSchema:z.json(),
        execute:async(_raw,c)=>{assert.throws(()=>core.authorizeExternalTask(c,extensionId),/SCOPE_DENIED/);return {...completed(),effects:'none'};}},
    ]});
    const policy:Policy={id:'test-policy',producers:['local-test','fixture-tasks','wake-test'],actions:[actionId,'fixture_anchor','fixture_read','dafeiyu_task_object','dafeiyu_task_intent'],
      allowLocalWrite:options.allowLocalWrite??true,sourceRules:[],resources:[],...(options.externalActions===null?{}:{externalActions:options.externalActions??[allowed]})};
    core.configureExecution({profileId:'fixture',createStore:options.create??true,policies:[policy,
      {id:'conversation',producers:['fixture-qq'],actions:['fixture_submit',actionId],allowLocalWrite:true,externalActions:[allowed]}]});
    const channel=core.registerExtension({id:'fixture-qq',version:'1',apiVersion:API_VERSION,agentId:'dafeiyu',channels:[{channel:'qq',account,
      deliver:async()=>({status:'sent',receiptId:'fictional-qq-receipt'})}]});
    const tasks=core.registerExtensionV3({protocolVersion:3,id:'fixture-tasks',version:'1',agentId:'dafeiyu',actions:[{
      id:'fixture_submit',version:'1',description:'通过真实当前消息提交测试任务',effects:'local-write',inputSchema:MessageTaskSubmitSchema,outputSchema:z.json(),
      execute:async(raw,c)=>{try{submission=core.submitMessageTask(c,'fixture-tasks',raw);return {...completed(),data:z.json().parse(submission)};}
        catch(error){return {status:'failed',effects:'none',completeness:'unknown',data:null,sources:[],receipts:[],errorCode:error instanceof Error?error.message:'FIXTURE_FAILED'};}}
    }]});
    const unbind=core.bindMessageTasks({id:'fixture-tasks',pluginId:'fixture-tasks',channelExtensionId:'fixture-qq',channel:'qq',account,ownerId,policyId:'test-policy',version:'1',autoDeliver:false,
      classify:message=>qqTaskDirective(message),active:()=>true});
    ctx.dafeiyuMemory.recover();ctx.dafeiyuMemory.activate();await core.recoverExecutions();core.recover();core.activate();
    return {directory,ctx,core,memory:ctx.dafeiyuMemory,adapter,policy,extension,port:core.executionProducer('local-test'),ownerPort:core.executionProducer('fixture-tasks'),
      get submission(){assert.ok(submission);return submission;},get anchor(){assert.ok(anchor);return anchor;},get invocations(){return invocations;},
      setResponse:(next:Response)=>{response=next;},
      message:(text='任务：核对本机虚构文件',sender=ownerId)=>{const id=String(++messageId);return channel.ingest({id,occurredAt:new Date().toISOString(),conversation:scene,sender:{id:sender,displayName:'虚构用户'},text,mainText:text});},
      recall:(id:string)=>channel.observe({conversation:scene,type:'message.recalled',data:{messageId:id}}),
      close:async()=>{core.quiesce();try{await core.whenIdle();}finally{unbind();tasks.dispose();channel.dispose();extension.dispose();try{await core.close();}finally{await host.close();}}}};
  }catch(error){await host.close();throw error;}
}
type Harness=Awaited<ReturnType<typeof fixture>>;
const request={requestId:'native',title:'虚构任务',goal:'仅用于程序边界测试',policyId:'test-policy'};
const waitForEntry=(h:Harness,entered:ReturnType<typeof deferred>)=>Promise.race([entered.promise,h.core.whenIdle().then(()=>{throw new Error('Expected external fixture action to enter');})]);
function ownerTurn(h:Harness,run:Response=(()=>{let step=0;return ()=>++step===1?call(actionId,{}):textReply('按照真实回执结束');})(),text?:string,sender?:string){
  let step=0;h.setResponse(input=>native(input.sessionId)?run(input):++step===1?call('fixture_submit',{requestId:'submit'}):textReply('已受理'));
  return h.message(text,sender);
}

test('external policy omission preserves historical shape and hash; exact triples reject wildcards and duplicates',()=>{
  const old={id:'old',producers:['local-test'],actions:[actionId],allowLocalWrite:true,sourceRules:[],resources:[]},schema=HostConfigSchema.shape.authorityPolicies;
  const parsed=schema.parse([old])[0]!;assert.equal(Object.hasOwn(parsed,'externalActions'),false);assert.equal(runtimeHash(parsed),runtimeHash(old));
  const enabled=schema.parse([{...old,externalActions:[allowed]}])[0]!;assert.deepEqual(enabled.externalActions,[allowed]);assert.notEqual(runtimeHash(enabled),runtimeHash(old));
  assert.throws(()=>ExternalActionPoliciesSchema.parse([allowed,allowed]));assert.throws(()=>ExternalActionPoliciesSchema.parse([{...allowed,actionId:'*'}]));
  for(const actionVersion of ['*','1.*','',' ',' 1','1 ','版本1','１','1\n','a'.repeat(81)])assert.throws(()=>ExternalActionPoliciesSchema.parse([{...allowed,actionVersion}]));
  for(const actionVersion of ['1','1.0.0-alpha+1'])assert.equal(ExternalActionPoliciesSchema.parse([{...allowed,actionVersion}])[0]?.actionVersion,actionVersion);
  assert.throws(()=>schema.parse([{...old,allowExternalWrite:true}]));
});

test('external actions stay hidden without an exact name, owner and version or without requiresTask',async()=>{
  for(const options of [{externalActions:null},{externalActions:[]},{externalActions:[{...allowed,extensionId:'another'}]},
    {externalActions:[{...allowed,actionId:'another_action'}]},{externalActions:[{...allowed,actionVersion:'2'}]},{requiresTask:false}]){
    const h=await fixture(options);try{ownerTurn(h,request=>{assert.equal(request.tools?.some(tool=>tool.name===actionId),false);return textReply('没有获准外部工具');});
      await h.core.whenIdle();assert.equal(h.invocations,0);assert.equal(h.ownerPort.status(h.ownerPort.restoreRun(h.submission.runId)).state,'completed');
    }finally{await h.close();}
  }
});

test('a real owner Task receives immutable current authority, while copied, foreign, read-only and expired grants fail',async()=>{
  let h:Harness,authority:ExternalTaskAuthority|undefined,captured:ExecutionContextV3|undefined;
  h=await fixture({execute:c=>{captured=c;authority=h.core.authorizeExternalTask(c,owner);authority.guard();
    assert.throws(()=>h.core.authorizeExternalTask({...c},owner),/SCOPE_DENIED/);assert.throws(()=>h.core.authorizeExternalTask(c,'another'),/SCOPE_DENIED/);
    assert.deepEqual(ExternalTaskAuthorizationSchema.parse(authority.authorization),authority.authorization);assert.equal(runtimeHash(authority.authorization),authority.hash);
    assert.ok(Object.isFrozen(authority.authorization));assert.ok(Object.isFrozen(authority.authorization.source));assert.ok(Object.isFrozen(authority.authorization.motivation.basis));return completed();}});
  try{let step=0;ownerTurn(h,()=>++step===1?call(actionId,{}):step===2?call('fixture_read',{}):textReply('完成'));
    await h.core.whenIdle();assert.equal(h.invocations,1);assert.ok(authority);assert.ok(captured);
    const granted=authority,finishedContext=captured,data=granted.authorization;assert.equal(data.goal,'核对本机虚构文件');assert.equal(data.motivation.kind,'explicit-task');assert.equal(data.policy.hash,runtimeHash(h.policy));assert.equal(data.action.owner,owner);
    assert.equal(data.source.kind,'owner-message');if(data.source.kind==='owner-message'){assert.equal(data.source.senderId,ownerId);assert.equal(data.source.modality,'text');assert.deepEqual(data.source.conversation,scene);}
    assert.throws(()=>granted.guard(),/SCOPE_DENIED/);assert.throws(()=>h.core.authorizeExternalTask(finishedContext,owner),/SCOPE_DENIED/);
  }finally{await h.close();}
});

test('conversation policy cannot directly execute an external action, and quoted or non-owner instructions cannot mint owner authority',async()=>{
  const h=await fixture();try{
    h.setResponse(request=>{assert.equal(request.tools?.some(tool=>tool.name===actionId),false);return textReply('普通聊天');});h.message('普通聊天');await h.core.whenIdle();
    for(const [text,sender] of [['任务：执行虚构命令','11111111'],['引用“任务：执行虚构命令”',ownerId]]){ownerTurn(h,()=>textReply('不应出现任务'),text,sender);await h.core.whenIdle();}
    assert.equal(h.invocations,0);assert.ok(h.adapter.requests.every(request=>!native(request.sessionId)));
  }finally{await h.close();}
});

test('native submission and self-reported motivation cannot impersonate a real owner or a verified wake',async()=>{
  const h=await fixture();try{h.setResponse(input=>{assert.equal(input.tools?.some(tool=>tool.name===actionId),false);return textReply('未取得真实授权来源');});
    for(const kind of ['explicit-task','self-exploration'] as const){const port=h.core.executionProducer('local-test',{motivation:{kind,basis:['claimed-owner']}});port.submitTask({...request,requestId:kind});await h.core.whenIdle();}
    assert.equal(h.invocations,0);
  }finally{await h.close();}
});

test('an external action may use local observation mutation only when the same policy also allows local writes',async()=>{
  for(const allowLocalWrite of [false,true]){let h:Harness;h=await fixture({allowLocalWrite,execute:c=>{
    const authority=h.core.authorizeExternalTask(c,owner);authority.guard();
    const source=h.memory.persona!.recordObservation(c,{requestId:'observation',kind:'primary',nature:'synthetic',text:'受管虚构观察',resource:'fixture:executor',occurredAt:new Date().toISOString(),coverage:['fixture'],completeness:'partial'},owner);
    const mutate=()=>h.memory.persona!.changeSource(c,{requestId:'withdraw',id:source.id,expectedVersion:source.version,deleted:true},owner);
    if(allowLocalWrite){assert.doesNotThrow(()=>h.core.personaAccess(c,owner,'local-write'));assert.doesNotThrow(mutate);}
    else{assert.throws(()=>h.core.personaAccess(c,owner,'local-write'),/SCOPE_DENIED/);assert.throws(mutate,/SCOPE_DENIED/);}return completed();}});
    try{ownerTurn(h);await h.core.whenIdle();assert.equal(h.invocations,1);const db=new DatabaseSync(join(h.directory,'memory','memory.sqlite'),{readOnly:true});
      try{assert.equal(db.prepare('SELECT deleted FROM execution_sources').get()?.deleted,Number(allowLocalWrite));}finally{db.close();}
    }finally{await h.close();}
  }
});

test('owner source withdrawal and task cancellation revoke a live external authority without erasing the actual receipt',async()=>{
  for(const mode of ['recall','cancel'] as const){const entered=deferred(),release=deferred();let h:Harness,authority:ExternalTaskAuthority|undefined;
    h=await fixture({execute:async c=>{authority=h.core.authorizeExternalTask(c,owner);entered.resolve();await release.promise;assert.throws(()=>authority!.guard());return completed();}});
    try{const inbound=ownerTurn(h);await waitForEntry(h,entered);const ref=h.ownerPort.restoreRun(h.submission.runId);
      if(mode==='recall')h.recall(h.core.journal.get(inbound.id).message.id);else h.ownerPort.cancel(ref,{requestId:'cancel',expectedVersion:h.ownerPort.status(ref).version,reason:'测试取消'});
      release.resolve();await h.core.whenIdle();const status=h.ownerPort.status(ref);assert.notEqual(status.state,'completed');assert.equal(status.operations[0]?.effects,'confirmed');assert.equal(h.invocations,1);assert.ok(authority);const granted=authority;assert.throws(()=>granted.guard());
    }finally{release.resolve();await h.close();}
  }
});

test('only a validated wake with a real persistent anchor supplies autonomous external authority',async()=>{
  let h:Harness,authority:ExternalTaskAuthority|undefined;h=await fixture({execute:c=>{authority=h.core.authorizeExternalTask(c,owner);authority.guard();return completed();}});
  let unbind=()=>{};
  try{let step=0;h.setResponse(()=>++step===1?call('fixture_anchor',{}):textReply('锚点来源已闭合'));h.port.submitTask({...request,requestId:'anchor'});await h.core.whenIdle();
    assert.equal(h.core.activityAnchorStatus(h.anchor).state,'valid');const wake=h.core.executionProducer('wake-test',{motivation:{kind:'self-exploration',basis:['trusted-schedule']}}),task=wake.createTask({requestId:'wake-task',title:'自主测试',goal:'查看虚构本机材料'});
    const origin={kind:'wake' as const,producerId:'wake-test',scheduleId:'fictional-schedule',scheduleVersion:1,occurrenceId:'occurrence-1',dueAt:'2026-10-26T00:00:00Z'};
    unbind=h.core.bindWakeAuthority({producerId:'wake-test',validate:value=>value.scheduleVersion===1,sourceAnchor:()=>h.anchor});
    step=0;h.setResponse(()=>++step===1?call(actionId,{}):textReply('自主测试结束'));const run=wake.acceptWake({requestId:origin.occurrenceId,taskId:task.id,expectedVersion:1,policyId:'test-policy',origin},task);
    await h.core.whenIdle();assert.equal(wake.status(run.run).state,'completed');assert.equal(h.invocations,1);assert.ok(authority);assert.equal(authority.authorization.source.kind,'activity-wake');
    if(authority.authorization.source.kind==='activity-wake'){assert.deepEqual(authority.authorization.source.anchor,h.anchor);assert.deepEqual(authority.authorization.source.origin,origin);}
    const granted=authority;assert.equal(granted.authorization.motivation.kind,'self-exploration');assert.throws(()=>granted.guard());
  }finally{unbind();await h.close();}
});

test('a wake without an anchor cannot acquire external actions and revoking a valid wake invalidates its live grant',async()=>{
  const entered=deferred(),release=deferred();let h:Harness,valid=true,authority:ExternalTaskAuthority|undefined;
  h=await fixture({execute:async c=>{authority=h.core.authorizeExternalTask(c,owner);entered.resolve();await release.promise;assert.throws(()=>authority!.guard());return completed();}});let unbind=()=>{};
  try{const wake=h.core.executionProducer('wake-test',{motivation:{kind:'self-exploration',basis:[]}}),task=wake.createTask({requestId:'no-anchor',title:'虚构唤醒',goal:'不得伪造来源'});
    const origin={kind:'wake' as const,producerId:'wake-test',scheduleId:'fixture',scheduleVersion:1,occurrenceId:'missing-anchor',dueAt:'2026-10-26T00:00:00Z'};
    unbind=h.core.bindWakeAuthority({producerId:'wake-test',validate:()=>true});h.setResponse(input=>{assert.equal(input.tools?.some(tool=>tool.name===actionId),false);return textReply('缺少锚点');});
    wake.acceptWake({requestId:origin.occurrenceId,taskId:task.id,expectedVersion:1,policyId:'test-policy',origin},task);await h.core.whenIdle();assert.equal(h.invocations,0);unbind();
    let step=0;h.setResponse(()=>++step===1?call('fixture_anchor',{}):textReply('形成锚点'));h.port.submitTask({...request,requestId:'anchor'});await h.core.whenIdle();
    unbind=h.core.bindWakeAuthority({producerId:'wake-test',validate:()=>valid,sourceAnchor:()=>h.anchor});const next=wake.createTask({requestId:'with-anchor',title:'有效唤醒',goal:'测试撤销'});
    h.setResponse(()=>call(actionId,{}));const current={...origin,occurrenceId:'valid-anchor'};const accepted=wake.acceptWake({requestId:current.occurrenceId,taskId:next.id,expectedVersion:1,policyId:'test-policy',origin:current},next);
    await waitForEntry(h,entered);valid=false;release.resolve();await h.core.whenIdle();assert.notEqual(wake.status(accepted.run).state,'completed');assert.equal(h.invocations,1);assert.ok(authority);
  }finally{release.resolve();unbind();await h.close();}
});

test('task objections and unknown external effects keep the existing execution barriers',async()=>{
  let h=await fixture();try{let step=0;ownerTurn(h,()=>++step===1?call('dafeiyu_task_object',{requestId:'block',category:'missing-information',blocking:true,actions:[actionId],reason:'虚构必要材料缺失'}):step===2?call(actionId,{}):textReply('等待必要材料'));
    await h.core.whenIdle();const status=h.ownerPort.status(h.ownerPort.restoreRun(h.submission.runId));assert.equal(status.state,'waiting');assert.equal(h.invocations,0);assert.equal(status.operations.at(-1)?.status,'failed');
  }finally{await h.close();}
  const entered=deferred(),release=deferred();h=await fixture({execute:async()=>{entered.resolve();await release.promise;return {status:'unknown',effects:'unknown',completeness:'unknown',data:null,sources:[],receipts:[]};}});
  try{ownerTurn(h);await waitForEntry(h,entered);const ref=h.ownerPort.restoreRun(h.submission.runId);h.ownerPort.cancel(ref,{requestId:'cancel',expectedVersion:h.ownerPort.status(ref).version,reason:'未知效果演练'});release.resolve();await h.core.whenIdle();
    const status=h.ownerPort.status(ref);assert.equal(status.state,'interrupted');assert.equal(status.operations[0]?.effects,'unknown');
    assert.throws(()=>h.ownerPort.resume(h.ownerPort.openTask(h.submission.taskId),{requestId:'resume',taskId:h.submission.taskId,expectedVersion:1,policyId:'test-policy',parentRunId:ref.id,checkpointId:status.checkpoints[0]}),/OPERATION_UNCERTAIN/);assert.equal(h.invocations,1);
  }finally{release.resolve();await h.close();}
});

test('a confirmed external operation is not replayed by a legitimate owner continuation',async()=>{
  const entered=deferred(),release=deferred();const h=await fixture({execute:async()=>{entered.resolve();await release.promise;return completed();}});
  try{ownerTurn(h);await waitForEntry(h,entered);const ref=h.ownerPort.restoreRun(h.submission.runId);
    h.ownerPort.pause(ref,{requestId:'pause',expectedVersion:h.ownerPort.status(ref).version,reason:'保留真实回执后继续'});release.resolve();await h.core.whenIdle();
    const paused=h.ownerPort.status(ref);assert.equal(paused.state,'waiting');assert.equal(paused.operations[0]?.effects,'confirmed');
    let step=0;h.setResponse(()=>++step===1?call(actionId,{}):textReply('使用既有回执，不再执行'));
    const resumed=h.ownerPort.resume(h.ownerPort.openTask(h.submission.taskId),{requestId:'resume',taskId:h.submission.taskId,expectedVersion:1,policyId:'test-policy',parentRunId:ref.id,checkpointId:paused.checkpoints.at(-1)});
    await h.core.whenIdle();assert.equal(h.ownerPort.status(resumed.run).state,'completed');assert.equal(h.invocations,1);
  }finally{release.resolve();await h.close();}
});

test('reopening an old policy does not rewrite persisted Run bytes or add external permission',async()=>{
  let h=await fixture({externalActions:null});const directory=h.directory;let row:unknown,id='';
  try{const run=h.port.submitTask(request);await h.core.whenIdle();id=run.run.id;const db=new DatabaseSync(join(directory,'core','runtime.sqlite'),{readOnly:true});
    try{const stored=db.prepare('SELECT definition,snapshot FROM runs WHERE id=?').get(id);assert.ok(stored);row=stored;assert.equal(JSON.parse(String(stored.snapshot)).authorityVersion,runtimeHash(h.policy));}finally{db.close();}
  }finally{await h.close();}
  h=await fixture({directory,create:false,externalActions:null});try{assert.equal(h.adapter.requests.length,0);assert.equal(Object.hasOwn(h.policy,'externalActions'),false);const db=new DatabaseSync(join(directory,'core','runtime.sqlite'),{readOnly:true});
    try{assert.deepEqual(db.prepare('SELECT definition,snapshot FROM runs WHERE id=?').get(id),row);}finally{db.close();}
  }finally{await h.close();}
});
