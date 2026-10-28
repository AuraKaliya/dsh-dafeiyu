import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { mkdtemp,readFile,writeFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import * as Core from '@dafeiyu/core';
import * as Timeline from '@dafeiyu/timeline';
import * as Memory from '@dafeiyu/memory';
import { API_VERSION,ActionOutcomeSchema,MessageTaskSubmitSchema,ResourceProofSchema } from '@dafeiyu/contracts';
import type { ActivityAnchor,Conversation,ExecutionContext,ExternalActionPolicy,HostConfig,Json } from '@dafeiyu/contracts';
import { ServerExecutorService,SERVER_EXECUTOR_ACTIONS } from '../packages/server-executor/lib/service.js';
import type { ServerExecutorDependencies } from '../packages/server-executor/lib/service.js';
import { ServerExecutorConfigSchema,ServerExecutorPluginConfigSchema,serverExecutorScene } from '../packages/server-executor/lib/config.js';
import type { ServerExecutorConfig } from '../packages/server-executor/lib/config.js';
import { ExecutorOutputCollector } from '@dafeiyu/server-executor';
import type { ExecutorNodeRunOptions,ExecutorNodeRunResult,ExecutionBudgetPort,ExecutorNodeCommand,ExecutorRoute } from '@dafeiyu/server-executor';
import { executorHash } from '../packages/server-executor/lib/types.js';
import { qqTaskDirective } from '../packages/channel-qq/lib/tasks.js';
import { probeHost } from './phase1-probe-fixture.js';
import { ScriptedModel,call,textReply } from './harness.js';
import type { Response } from './harness.js';
import { testTempDir } from './test-temp.js';

const account='12345678',ownerId='87654321';
const privateScene:Conversation={channel:'qq',account,kind:'private',id:ownerId};
const groupScene:Conversation={channel:'qq',account,kind:'group',id:'11223344'};
const h64='1'.repeat(64),native=(session:unknown)=>String(session).startsWith('dafeiyu-task-');
const route:ExecutorRoute={provider:'local-test',model:'scripted',reasoningEffort:null,contextWindow:32768,maxOutputTokens:2048,maxRequestBytes:100000};
const input={requestId:'single-request',instruction:'核对虚构材料并报告观察',sources:[]};
const extensionId='server-executor';
const grants:ExternalActionPolicy[]=SERVER_EXECUTOR_ACTIONS.slice(0,2).map(actionId=>({extensionId,actionId,actionVersion:'1'}));
const success=(data:Json=null)=>({status:'succeeded' as const,effects:'confirmed' as const,completeness:'complete' as const,data,sources:[],receipts:[]});
const defer=()=>{let resolve=()=>{};const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};};
function command(directory:string):ExecutorNodeCommand{return {nodePath:process.execPath,nodeHash:h64,entryPath:join(directory,'offline-entry.js'),entryHash:h64,cwd:directory,args:[],profilePath:join(directory,'offline-profile.json'),profileHash:h64,env:{}};}
function config(directory:string,extra:Partial<ServerExecutorConfig>={}):ServerExecutorConfig{return {agentId:'dafeiyu',profileId:'test',dataDir:join(directory,'executor'),createStore:true,mode:'offline',settings:{command:command(directory),route,budgetAuthorizationId:'fixture-ledger',resultOwner:{account,ownerId}},...extra};}
const processControl={identify:async()=>{throw new Error('Offline runner must not inspect a real process');},terminate:async()=>{throw new Error('Offline runner must not stop a real process');}};
const emptyBudget:ExecutionBudgetPort={reserve:async()=>({reservationId:randomUUID(),dispatchPermit:randomUUID()}),settle:async()=>({unknown:false})};
function visible(text='已读取虚构文件；此句只是执行器自述。'){const output=new ExecutorOutputCollector();
  for(const value of [{type:'session',sessionId:'fixture-session'},{type:'thinking',text:'不得保存的虚构内部块'},{type:'final',text}])output.stdout(Buffer.from(JSON.stringify(value)+'\n'));return output.finish();}
async function closedRun(options:ExecutorNodeRunOptions,alter?:Partial<ExecutorNodeRunResult>):Promise<ExecutorNodeRunResult>{
  options.guard();await options.beforeSpawn();const process={pid:23456,creationId:'fixture-creation',executableHash:options.command.nodeHash};await options.onReady(process);options.guard();
  return {schemaVersion:1,spawned:true,ready:true,finished:true,process,exit:{code:0,signal:null},termination:{requested:false,verified:false},output:visible(),budget:[],tools:[],gaps:[],...alter};
}

/** Real official DSH loop + Core/Memory. Only the subprocess and ledger are explicitly offline program ports. */
async function fixture(options:{directory?:string;create?:boolean;scene?:Conversation;run?:(options:ExecutorNodeRunOptions)=>Promise<ExecutorNodeRunResult>;budget?:ExecutionBudgetPort;
  standing?:NonNullable<ServerExecutorConfig['settings']['standingAuthority']>;loadProfile?:ServerExecutorDependencies['loadProfile'];onAnchor?:(anchor:ActivityAnchor)=>void}={}){
  const directory=options.directory??await mkdtemp(join(testTempDir(),'server-executor-service-'));let response:Response=()=>textReply('虚构任务闭合');
  const adapter=new ScriptedModel(request=>response(request)),host=await probeHost(directory,adapter),ctx=host.ctx;let calls=0,lastJob='',messageId=0,submission:{taskId:string;runId:string}|undefined,anchor:ActivityAnchor|undefined;
  let executor:ServerExecutorService|undefined;
  try{
    await ctx.plugin(Core,{agentId:'dafeiyu',dataDir:join(directory,'core'),personaFile:resolve('profiles/persona.test.md'),provider:'local-test',model:'scripted',turnTimeoutMs:10000});
    await ctx.plugin(Timeline,{agentId:'dafeiyu',execution:true});await ctx.plugin(Memory,{agentId:'dafeiyu',dataDir:join(directory,'memory'),});
    const core=ctx.dafeiyu,scene=options.scene??privateScene;
    const serviceConfig=config(directory,{createStore:options.create??true});if(options.standing)serviceConfig.settings={...serviceConfig.settings,standingAuthority:options.standing};
    executor=new ServerExecutorService(ctx,serviceConfig,{budget:options.budget??emptyBudget,processControl,run:async input=>{calls++;lastJob=input.jobId;return options.run?options.run(input):closedRun(input);},loadProfile:options.loadProfile??(async()=>({allowedTools:[],guard:()=>{}}))});
    const policy:HostConfig['authorityPolicies'][number]={id:'test-policy',producers:['fixture-tasks','local-test','wake-test'],actions:[...SERVER_EXECUTOR_ACTIONS,'fixture_anchor'],allowLocalWrite:true,externalActions:grants,sourceRules:[],resources:[serverExecutorScene('test')]};
    core.configureExecution({profileId:'test',createStore:options.create??true,policies:[policy,{id:'conversation',producers:['fixture-qq'],actions:['fixture_submit'],allowLocalWrite:true}]});
    const channel=core.registerExtension({id:'fixture-qq',version:'1',protocolVersion:4,agentId:'dafeiyu',channels:[{channel:'qq',account,deliver:async()=>({status:'sent',receiptId:'never-direct-executor-send'})}]});
    const taskTools=core.registerExtension({protocolVersion:4,id:'fixture-tasks',version:'1',agentId:'dafeiyu',actions:[
      {id:'fixture_submit',version:'1',description:'提交真实虚构主人消息的任务',effects:'local-write',inputSchema:MessageTaskSubmitSchema,outputSchema:z.json(),execute:async(raw,c)=>{submission=core.submitMessageTask(c,'fixture-tasks',raw);return success(z.json().parse(submission));}},
      {id:'fixture_anchor',version:'1',description:'虚构来源形成真实程序锚点',effects:'local-write',scope:'task',inputSchema:z.strictObject({}),outputSchema:z.json(),execute:async(_raw,c)=>{anchor=core.captureActivityAnchor(c,'fixture-tasks');options.onAnchor?.(anchor);return success(z.json().parse({anchor}));}},
    ]});
    const unbind=core.bindMessageTasks({id:'fixture-tasks',pluginId:'fixture-tasks',channelExtensionId:'fixture-qq',channel:'qq',account,ownerId,policyId:'test-policy',version:'1',autoDeliver:false,classify:message=>qqTaskDirective(message),active:()=>true});
    ctx.dafeiyuMemory.recover();ctx.dafeiyuMemory.activate();executor.recover();executor.activate();await core.recoverExecutions();core.recover();core.activate();
    const service=executor;
    return {directory,ctx,core,service,adapter,policy,port:core.executionProducer('fixture-tasks'),nativePort:core.executionProducer('local-test'),
      get calls(){return calls;},get lastJob(){return lastJob;},get submission(){assert.ok(submission);return submission;},get anchor(){assert.ok(anchor);return anchor;},
      setResponse(next:Response){response=next;},
      owner(run:Response,text='任务：核对本机虚构文件'){let step=0;response=request=>native(request.sessionId)?run(request):++step===1?call('fixture_submit',{requestId:`submit-${messageId+1}`}):textReply('虚构受理');const id=String(++messageId);return channel.ingest({id,occurredAt:new Date().toISOString(),conversation:scene,sender:{id:ownerId,displayName:'虚构主人'},text,mainText:text});},
      recall(inboundId:string){const item=core.journal.get(inboundId);channel.observe({conversation:scene,type:'message.recalled',data:{messageId:item.message.id}});},
      close:async()=>{core.quiesce();try{await core.whenIdle();await service.whenIdle();}finally{await service.close();unbind();taskTools.dispose();channel.dispose();try{await core.close();}finally{await host.close();}}},
    };
  }catch(error){await executor?.close();await host.close();throw error;}
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
const status=(h:Fixture)=>h.port.status(h.port.restoreRun(h.submission.runId));
function outcomes(h:Fixture,runId=h.submission.runId){const db=new DatabaseSync(join(h.directory,'core','runtime.sqlite'),{readOnly:true});
  try{return db.prepare('SELECT outcome FROM run_operations WHERE run_id=? AND outcome IS NOT NULL ORDER BY ordinal').all(runId).map(row=>ActionOutcomeSchema.parse(JSON.parse(String(row.outcome))));}finally{db.close();}}
const operationData=(h:Fixture)=>outcomes(h).map(operation=>operation.data);
const readPage=(data:unknown)=>z.object({page:z.record(z.string(),z.json()),proof:ResourceProofSchema,observation:z.object({source:z.object({id:z.string()})})}).parse(data);

test('server executor settings are strict and production does not accept offline program replacements',async()=>{
  const directory=await mkdtemp(join(testTempDir(),'server-executor-config-')),raw=config(directory),settings=ServerExecutorPluginConfigSchema.parse(raw.settings);
  for(const field of ['actor','grant','owner','profile','mode','allowedTools'])assert.throws(()=>ServerExecutorPluginConfigSchema.parse({...settings,[field]:'model supplied'}));
  assert.equal(ServerExecutorConfigSchema.parse({...raw,mode:undefined}).mode,'production');
  const ctx=new Context();try{assert.throws(()=>new ServerExecutorService(ctx,{...raw,mode:'production'},{budget:emptyBudget,processControl,run:closedRun}),/EXECUTOR_PRODUCTION_PORT_REQUIRED/);}finally{await ctx.fiber.dispose();}
});

test('a real owner task seals callbacks and budget links, pages self-report, and never dispatches the same request twice',async()=>{
  let reserved=0,settled=0;const budget:ExecutionBudgetPort={reserve:async()=>{reserved++;return {reservationId:randomUUID(),dispatchPermit:randomUUID()};},settle:async()=>{settled++;return {unknown:false};}};
  const h=await fixture({budget,run:async options=>{const base=await closedRun(options),call={callId:randomUUID(),provider:route.provider,model:route.model,reasoningEffort:null,requestHash:h64,sessionHash:h64,inputBound:route.contextWindow,outputBound:route.maxOutputTokens,requestBytes:100,purpose:'task' as const};
    const permit=await options.budget.reserve({...call,authorizationId:options.authorizationId,jobId:options.jobId,deadline:options.deadline},new AbortController().signal);
    const settlement={callId:call.callId,reservationId:permit.reservationId,usage:{inputTokens:100,outputTokens:10,uncachedInputTokens:100,cacheReadTokens:0,cacheWriteTokens:0,reasoningTokens:null},finish:'stop' as const,durationMs:10,error:null};
    await options.budget.settle({...settlement,authorizationId:options.authorizationId,jobId:options.jobId},new AbortController().signal);return {...base,budget:[{call,permit,state:'settled',settlement,accountingError:null}]};}});
  try{let step=0;h.owner(()=>++step===1?call(SERVER_EXECUTOR_ACTIONS[0],input):step===2?call(SERVER_EXECUTOR_ACTIONS[3],{jobId:h.lastJob,section:'final',offset:0,limit:8}):step===3?call(SERVER_EXECUTOR_ACTIONS[0],input):textReply('按分页自述与程序回执整理'));
    await h.core.whenIdle();assert.equal(h.calls,1);assert.equal(reserved,1);assert.equal(settled,1);
    const run=status(h),task=h.port.taskState(h.port.openTask(h.submission.taskId)),scope={kind:'task' as const,agentId:'dafeiyu',taskId:task.id,scopeKey:JSON.stringify(['dafeiyu-scope-v1','task','dafeiyu',task.id])};
    const job=h.service.store.get(h.lastJob,scope);assert.equal(job.state,'completed');assert.deepEqual(h.service.store.events(job.id,scope).map(event=>event.type),['prepared','launching','running','terminal']);assert.equal(h.service.store.budgetLinks(job.id,scope)[0]?.state,'settled');
    const data=operationData(h).filter(value=>value&&typeof value==='object'&&'page'in value),metadata=readPage(data[0]),page=readPage(data[1]);
    assert.equal(metadata.page.kind,'executor-process-metadata');assert.equal(Object.hasOwn(metadata.page,'text'),false);assert.equal(page.page.kind,'executor-self-report');assert.equal(page.page.offset,0);assert.equal(page.page.end,8);assert.equal(typeof page.page.nextOffset,'number');
    assert.deepEqual(metadata.page.identity,{mode:'offline',adminTokenVerified:false,wholeTreeTerminationVerified:false});
    const db=new DatabaseSync(join(h.directory,'memory','memory.sqlite'),{readOnly:true});try{const histories=[metadata,page].map(value=>z.object({history:z.array(z.json())}).parse(JSON.parse(String(db.prepare('SELECT body FROM capability_observations WHERE id=?').get(value.observation.source.id)?.body))).history);
      assert.equal(histories[0]!.length,0);assert.ok(histories[1]!.length>0);}finally{db.close();}
    if(data[2])assert.notEqual(readPage(data[2]).observation.source.id,metadata.observation.source.id);
    assert.equal(h.core.capabilityPublicView(page.proof,JSON.stringify(page.page)),false);assert.equal(h.core.capabilityTargetView(page.proof,JSON.stringify(page.page),privateScene,scope)?.kind,'inference');
    assert.equal(h.core.capabilityTargetView(page.proof,JSON.stringify(page.page),{...privateScene,id:'11111111'},scope),null);
    assert.equal(h.core.capabilityTargetView(page.proof,JSON.stringify(page.page)+' ',privateScene,scope),null);
    const saved=await readFile(join(h.directory,'executor',job.receipt!.output!.relative),'utf8');assert.equal(saved.includes('不得保存的虚构内部块'),false);assert.equal(run.operations[0]?.effects,'confirmed');
  }finally{await h.close();}
});

test('group-origin task permits fixed metadata only to its original group, never grants final private delivery',async()=>{
  const h=await fixture({scene:groupScene});try{let step=0;h.owner(()=>++step===1?call(SERVER_EXECUTOR_ACTIONS[0],input):step===2?call(SERVER_EXECUTOR_ACTIONS[3],{jobId:h.lastJob,section:'final'}):textReply('保留范围边界'));await h.core.whenIdle();
    const [meta,final]=operationData(h).filter(value=>value&&typeof value==='object'&&'page'in value).map(readPage);assert.ok(meta);assert.ok(final);const scope=z.object({scope:z.json()}).parse(meta.proof.detail).scope;
    assert.equal(h.core.capabilityTargetView(meta.proof,JSON.stringify(meta.page),groupScene,scope)?.kind,'reported');
    assert.equal(h.core.capabilityTargetView(final.proof,JSON.stringify(final.page),groupScene,scope),null);assert.equal(h.core.capabilityTargetView(final.proof,JSON.stringify(final.page),privateScene,scope),null);
  }finally{await h.close();}
});

test('unknown SDK tool effects block another request and survive reopening without subprocess replay',async()=>{
  let h=await fixture({run:async options=>closedRun(options,{tools:[{call:{callId:randomUUID(),name:'write',sourceCallHash:h64,sessionHash:h64,argumentsHash:h64},permitId:randomUUID(),state:'unknown'}]})});const directory=h.directory;
  try{let step=0;h.owner(()=>++step===1?call(SERVER_EXECUTOR_ACTIONS[0],input):textReply('不能确认效果'));await h.core.whenIdle();assert.equal(h.calls,1);assert.equal(h.service.store.unresolved(),1);assert.equal(status(h).operations[0]?.effects,'unknown');
    step=0;h.owner(()=>++step===1?call(SERVER_EXECUTOR_ACTIONS[0],{...input,requestId:'new-request'}):textReply('等待原执行核验'));await h.core.whenIdle();assert.equal(h.calls,1);assert.equal(outcomes(h)[0]?.errorCode,'EXECUTOR_PROFILE_UNRESOLVED');
  }finally{await h.close();}
  h=await fixture({directory,create:false});try{assert.equal(h.calls,0);assert.equal(h.adapter.requests.length,0);assert.equal(h.service.store.unresolved(),1);}finally{await h.close();}
});

test('another real task cannot read the first task job by identifier',async()=>{
  const h=await fixture();try{let step=0;h.owner(()=>++step===1?call(SERVER_EXECUTOR_ACTIONS[0],input):textReply('原任务完成'));await h.core.whenIdle();const jobId=h.lastJob;
    step=0;h.owner(()=>++step===1?call(SERVER_EXECUTOR_ACTIONS[2],{jobId}):step===2?call(SERVER_EXECUTOR_ACTIONS[3],{jobId,section:'final'}):textReply('未取得其它任务材料'));await h.core.whenIdle();
    assert.equal(h.calls,1);assert.ok(outcomes(h).slice(0,2).every(operation=>operation.errorCode==='EXECUTOR_SCOPE_DENIED'));
  }finally{await h.close();}
});

test('copied execution contexts and model source identifiers never acquire owner authority or unexposed material',async()=>{
  const h=await fixture();try{const taskId=randomUUID(),fake={agentId:'dafeiyu',taskId,runId:randomUUID(),operationId:randomUUID(),origin:{kind:'native',producerId:'fixture-tasks',requestId:'forged'},
      scope:{kind:'task',agentId:'dafeiyu',taskId,scopeKey:JSON.stringify(['dafeiyu-scope-v1','task','dafeiyu',taskId])},intentVersion:1,grant:{id:randomUUID()},signal:new AbortController().signal} as ExecutionContext;
    await assert.rejects(h.service.executeOwner(fake,input),/SCOPE_DENIED/);let step=0;
    h.owner(()=>++step===1?call(SERVER_EXECUTOR_ACTIONS[0],{...input,sources:[`execution-source:${randomUUID()}`]}):textReply('未知引用没有授权'));await h.core.whenIdle();
    assert.equal(h.calls,0);assert.equal(outcomes(h)[0]?.errorCode,'SOURCE_NOT_EXPOSED');assert.deepEqual(h.service.store.counts(),{});
  }finally{await h.close();}
});

test('source recall invalidates an already sealed target proof, without erasing its actual receipt',async()=>{
  const h=await fixture();try{let step=0;const inbound=h.owner(()=>++step===1?call(SERVER_EXECUTOR_ACTIONS[0],input):textReply('虚构完成'));await h.core.whenIdle();const page=readPage(operationData(h)[0]);assert.equal(h.core.capabilityResourceCurrent(page.proof),true);
    h.recall(inbound.id);assert.equal(h.core.capabilityResourceCurrent(page.proof),false);assert.equal(h.service.store.counts().completed,1);
  }finally{await h.close();}
});

test('profile guard failure before spawn is sealed as undispatched and cannot claim a successful execution',async()=>{
  const h=await fixture({loadProfile:async()=>({allowedTools:[],guard:()=>{throw new Error('EXECUTOR_PROGRAM_CHANGED');}})});try{let step=0;h.owner(()=>++step===1?call(SERVER_EXECUTOR_ACTIONS[0],input):textReply('程序指纹改变，未执行'));await h.core.whenIdle();
    assert.equal(h.calls,0);assert.equal(h.service.store.counts().failed,1);assert.equal(status(h).operations[0]?.effects,'none');assert.equal(JSON.stringify(operationData(h)).includes('EXECUTOR_PROGRAM_CHANGED'),true);
  }finally{await h.close();}
});

test('a cancellation after dispatch retains uncertain effects and never exposes final text under a revoked live grant',async()=>{
  const entered=defer(),release=defer();const h=await fixture({run:async options=>{const result=await closedRun(options);entered.resolve();await release.promise;assert.throws(options.guard);return {...result,finished:false,exit:null,gaps:['EXECUTOR_CANCELLED']};}});
  try{let step=0;h.owner(()=>++step===1?call(SERVER_EXECUTOR_ACTIONS[0],input):textReply('不应声称完成'));await Promise.race([entered.promise,h.core.whenIdle().then(()=>{throw new Error('Expected admitted executor');})]);
    const ref=h.port.restoreRun(h.submission.runId);h.port.cancel(ref,{requestId:'cancel',expectedVersion:h.port.status(ref).version,reason:'虚构取消'});release.resolve();await h.core.whenIdle();
    assert.equal(h.calls,1);assert.equal(h.service.store.counts().unknown,1);assert.equal(status(h).operations[0]?.effects,'unknown');assert.equal(JSON.stringify(operationData(h)).includes('已读取虚构文件'),false);
  }finally{release.resolve();await h.close();}
});

test('a verified autonomous wake additionally requires the pinned standing file and never obtains an owner target',async()=>{
  const directory=await mkdtemp(join(testTempDir(),'server-executor-standing-')),path=join(directory,'standing.json');
  const body={schemaVersion:1,id:'fictional-standing',version:1,agentId:'dafeiyu',producers:['wake-test'],policyIds:['test-policy'],actionIds:[SERVER_EXECUTOR_ACTIONS[1]],purpose:'虚构自主观察',effectiveAt:'2026-01-01T00:00:00Z',expiresAt:null,revoked:false,allowedWorkRoots:[directory],budgetAuthorizationId:'fixture-ledger',maxExecutionMs:10000};
  const bytes=JSON.stringify(body);await writeFile(path,bytes);const standing={path,configurationRoot:directory,id:body.id,version:1,hash:createHash('sha256').update(bytes).digest('hex')};
  const h=await fixture({directory,standing});let unbind=()=>{};
  try{let step=0;h.setResponse(()=>++step===1?call('fixture_anchor',{}):textReply('形成虚构锚点'));h.nativePort.submitTask({requestId:'anchor',title:'锚点',goal:'形成虚构可见来源',policyId:'test-policy'});await h.core.whenIdle();assert.equal(h.core.activityAnchorStatus(h.anchor).state,'valid');
    const wake=h.core.executionProducer('wake-test',{motivation:{kind:'self-exploration',basis:['fictional-standing']}});unbind=h.core.bindWakeAuthority({producerId:'wake-test',validate:()=>true,sourceAnchor:()=>h.anchor});
    const task=wake.createTask({requestId:'wake-task',title:'自主测试',goal:'观察虚构材料'}),origin={kind:'wake' as const,producerId:'wake-test',scheduleId:'fixture',scheduleVersion:1,occurrenceId:'wake-one',dueAt:new Date().toISOString()};
    step=0;h.setResponse(()=>++step===1?call(SERVER_EXECUTOR_ACTIONS[1],input):textReply('自主观察结束'));const accepted=wake.acceptWake({requestId:'wake-one',taskId:task.id,expectedVersion:1,policyId:'test-policy',origin},task);await h.core.whenIdle();
    assert.equal(h.calls,1);const page=readPage(outcomes(h,accepted.run.id)[0]?.data),scope=z.object({scope:z.json()}).parse(page.proof.detail).scope;
    assert.equal(h.core.capabilityTargetView(page.proof,JSON.stringify(page.page),privateScene,scope),null);assert.equal(h.core.capabilityResourceCurrent(page.proof),true);
    await writeFile(path,JSON.stringify({...body,revoked:true}));assert.equal(h.core.capabilityResourceCurrent(page.proof),false);
  }finally{unbind();await h.close();}
});
