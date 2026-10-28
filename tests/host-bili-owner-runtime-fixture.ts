import {BILI_OWNER_ACCOUNT,BILI_OWNER_UID} from './bili-owner-identity.js';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ManagedHost,HostRuntimeOptions } from '@dafeiyu/host';
import type { BiliOwnerIdentity } from '@dafeiyu/bilibili/channel';
import { testTempDir } from './test-temp.js';

const scenario=process.argv[2];assert.ok(['chat','task','missing','optional','optional-recovery','single','drain'].includes(scenario??''));
const root=await mkdtemp(join(testTempDir(),'host-bili-owner-')),file=join(root,'host.json'),coordination=join(root,'coordination.sqlite');
process.env.DSH_HOME=join(root,'data/core/dsh-home');
const {ManagedHost:Host,loadHostConfig,initializeProfile,inspectHost,owners,readHostStatus,BILI_OWNER_NATIVE_ACTIONS}=await import('@dafeiyu/host');
const {BiliOwnerStore,BILI_OWNER_TASK_ACTIONS,BILI_PUBLIC_SCENE}=await import('@dafeiyu/bilibili/channel');
const {biliOwnerBackend,incomingBili,fixtureHash}=await import('./bili-owner-channel-fixture.js');
const {ScriptedModel,textReply,call}=await import('./harness.js');
const {outcomes}=await import('./qq-capabilities-fixture.js');
const recovery=scenario==='optional-recovery',task=scenario==='task'||scenario==='optional'||recovery,backend=biliOwnerBackend(),identity:BiliOwnerIdentity={agentId:'dafeiyu',profileId:'bili-owner-host-fixture',accountUid:BILI_OWNER_ACCOUNT,ownerUid:BILI_OWNER_UID};
const plugins:{id:string;required:boolean;config:Record<string,unknown>}[]=[{id:'model-scripted',required:true,config:{}},{id:'timeline',required:true,config:{execution:true}},{id:"memory-growth",required:true,config:{}},
  ...(task?[{id:'media',required:true,config:{ffmpeg:process.execPath,ffprobe:process.execPath}}]:[]),
  {id:'bilibili',required:scenario!=='optional'&&!recovery,config:{...(task?{capabilities:{minIntervalMs:100}}:{}),channel:{accountUid:'10000001',ownerUid:'10000002',tasks:{enabled:task,deliverResults:!recovery}}}},...(scenario==='optional'?[{id:'channel-simulator',required:true,config:{account:'fixture'}}]:[])];
const config={schemaVersion:1,profileId:identity.profileId,agent:{id:identity.agentId},paths:{core:'data/core',memory:'data/memory',sessions:'data/sessions',query:'data/query.sqlite'},modelRoutes:{chat:{provider:'local-test',model:'scripted'}},
  persona:{fixedFile:'persona.md',kind:'test'},runtime:{turnTimeoutMs:10000,shutdownGraceMs:3000,...(recovery?{maxConcurrentRuns:1}:{})},diagnostics:{snapshotIntervalMs:recovery?60000:100},plugins,
  authorityPolicies:[{id:'local',producers:['host-cli'],actions:[],allowLocalWrite:false},
    ...(task?[{id:'conversation',producers:['channel-bili-owner',...(scenario==='optional'?['channel-simulator']:[])],actions:[...BILI_OWNER_TASK_ACTIONS],allowLocalWrite:true},
      {id:'bili-owner-task',producers:['bili-owner-tasks'],actions:[...BILI_OWNER_NATIVE_ACTIONS],allowLocalWrite:true,resources:[BILI_PUBLIC_SCENE]}]:[])]};
await writeFile(join(root,'persona.md'),'虚构本机底色：爱世界、独立判断，只根据当前来源回答。');await writeFile(file,JSON.stringify(config));
const prepared=loadHostConfig(file),initial=initializeProfile(prepared,coordination);
assert.equal(initial.ready,false);assert.ok(initial.codes.includes('HOST_BILI_OWNER_HANDOVER_REQUIRED'));
const store=new BiliOwnerStore(join(prepared.paths.core,'bili-owner.sqlite'),identity);
try{store.initializeFresh({requestId:'fixture-handover',since:backend.state.now-60000,cutoverHash:fixtureHash},backend.state.now);
  if(scenario==='single'){const message=incomingBili('9007199254740993123','留给稍后daemon处理的虚构消息');backend.state.messages.push(message);
    store.acceptPage({accountUid:BILI_OWNER_ACCOUNT,ownerUid:BILI_OWNER_UID,loggedIn:true,bindingStamp:backend.state.stamp,messages:[message],hasMore:false,nextBeforeSeqno:null},store.cursor().version,1000,backend.state.now);}
}finally{store.close();}
assert.equal(inspectHost(prepared,coordination).ready,true);
let phase='',calls=0,factories=0,publicRequests=0,chatCalls=0,nativeCalls=0,rendered=0,verified=0;
let recoveryAdmission=true,connectionFailure:'none'|'factory'|'verify'='none';
let entered!:()=>void,release!:()=>void;const inflight=new Promise<void>(done=>{entered=done;}),continueModel=new Promise<void>(done=>{release=done;});
const publicSentinel='PUBLIC_BILI_HOST_FIXTURE',opaque='OPAQUE_NATIVE_TASK_SENTINEL',persona='人格整理：我看到了公开列表中的虚构星空标题，还没有观看视频画面或音轨。',normal='独立B站人格的虚构文字回复';
const adapter=new ScriptedModel(async request=>{calls++;assert.ok(['ready','degraded','draining'].includes(phase));const session=String(request.sessionId),wire=JSON.stringify(request.messages);
  if(scenario==='optional'){assert.equal(request.tools?.some(tool=>tool.name==='bili_owner_task_submit')??false,false);return textReply(normal);}
  if(task){if(session.startsWith('dafeiyu-delivery-v3-')){rendered++;assert.ok(wire.includes(publicSentinel));assert.equal(wire.includes(opaque),false);return textReply(persona);}
    if(session.startsWith('memory-expression-verify-delivery-')){verified++;return textReply('{"faithful":true,"issues":[]}');}
    if(session.startsWith('dafeiyu-task-')){nativeCalls++;if(nativeCalls===1)return call('bili_discover',{requestId:'host-read'});assert.equal(outcomes(request).at(-1)?.status,'succeeded');return textReply(opaque);}
    if(++chatCalls===1)return call('bili_owner_task_submit',{requestId:'host-directive'});if(recovery&&recoveryAdmission)host!.core.quiesce();return textReply('已受理本B站只读探索任务。');}
  if(scenario==='drain'){entered();await continueModel;}return textReply(normal);
});
const options:HostRuntimeOptions={coordination,adapter,onPhase:next=>{phase=next;},...(scenario==='missing'?{}:{createBiliOwnerPorts:async()=>{factories++;if(scenario==='single')throw new Error('SINGLE_RUN_OPENED_CHANNEL');if(scenario==='optional'||connectionFailure==='factory')throw new Error('BILI_OWNER_LEASE_REVOKED');return backend.createPorts();}}),
  ...(task?{biliTransport:async(url:URL)=>{assert.equal(url.pathname,'/x/web-interface/popular');publicRequests++;const bytes=Buffer.from(JSON.stringify({code:0,data:{list:[{bvid:'BV1xx411c7mD',aid:10,title:publicSentinel+' 星空',owner:{name:'虚构UP'},duration:20}],no_more:true}}));
    return {status:200,headers:{},body:(async function*(){yield bytes;})(),close(){}};}}:{})};
let host:ManagedHost|undefined;
const storedRuns=()=>{const db=new DatabaseSync(join(prepared.paths.core,'runtime.sqlite'),{readOnly:true});try{return db.prepare("SELECT r.id,r.state,r.error FROM runs r JOIN execution_requests q ON q.id=r.request_key WHERE q.producer='bili-owner-tasks' ORDER BY r.rowid").all();}finally{db.close();}};
backend.state.beforeVerify=async()=>{if(connectionFailure==='verify')throw new Error('BILI_OWNER_NETWORK_UNAVAILABLE');};
try{
  if(scenario==='missing'){await assert.rejects(()=>Host.start(prepared,options),/HOST_BILI_OWNER_RUNTIME_PORT_REQUIRED/);assert.equal(calls,0);assert.equal(factories,0);assert.equal(backend.state.verifications,0);assert.equal(owners(coordination).length,0);}
  else if(scenario==='optional'){host=await Host.start(prepared,options);assert.equal(host.snapshot().phase,'degraded');assert.equal(host.snapshot().plugins.find(plugin=>plugin.id==='channel-bili-owner')?.code,'BILI_OWNER_LEASE_REVOKED');
    host.ctx.dafeiyuSimulator.send('room','虚构普通聊天仍可用',{id:'sim-message'});await host.core.whenIdle();assert.equal(calls,1);assert.equal(factories,1);assert.equal(backend.state.verifications,0);assert.equal(backend.state.attempts.length,0);}
  else if(scenario==='single'){host=await Host.start(prepared,{...options,mode:'single-run'});const result=await host.run({requestId:'local',title:'离线单次任务',goal:'不读取私信队列',policyId:'local'});assert.equal(result.state,'completed');assert.equal(factories,0);assert.equal(backend.state.reads.length,0);assert.equal(host.snapshot().services.biliOwner,undefined);await host.close();
    const saved=new BiliOwnerStore(join(prepared.paths.core,'bili-owner.sqlite'),identity);try{assert.equal(saved.counts().inbound.pending,1);}finally{saved.close();}}
  else if(recovery){
    host=await Host.start(prepared,options);await host.ctx.dafeiyuBiliOwner.whenIdle();backend.state.messages.push(incomingBili('9007199254740993123','任务：恢复之后再阅读虚构公开列表。'));backend.state.now+=30000;
    await host.ctx.dafeiyuBiliOwner.tick();await host.core.whenIdle();assert.equal(storedRuns()[0]?.state,'accepted');assert.equal(nativeCalls,0);await host.close();
    const before=storedRuns(),beforeCalls=calls;connectionFailure='factory';await assert.rejects(()=>Host.start(prepared,options),/HOST_BILI_OWNER_PENDING_WORK_REQUIRES_CHANNEL/);
    assert.deepEqual(storedRuns(),before);assert.equal(calls,beforeCalls);assert.equal(owners(coordination).length,0);
    connectionFailure='verify';await assert.rejects(()=>Host.start(prepared,options),/BILI_OWNER_NETWORK_UNAVAILABLE/);assert.deepEqual(storedRuns(),before);assert.equal(calls,beforeCalls);assert.equal(owners(coordination).length,0);
    connectionFailure='none';recoveryAdmission=false;host=await Host.start(prepared,options);await host.ctx.dafeiyuBiliOwner.whenIdle();await host.core.whenIdle();assert.equal(storedRuns()[0]?.state,'completed');assert.equal(storedRuns()[0]?.id,before[0]?.id);assert.equal(nativeCalls,2);assert.equal(publicRequests,1);
  }
  else{
    host=await Host.start(prepared,options);await host.ctx.dafeiyuBiliOwner.whenIdle();await host.core.whenIdle();assert.equal(calls,0);assert.equal(host.snapshot().services.biliOwner?.verified,true);
    backend.state.messages.push(incomingBili('9007199254740993123',task?'任务：阅读一页B站公开列表，只说明已观察的内容。':'虚构主人打招呼'));backend.state.now+=30000;
    const poll=host.ctx.dafeiyuBiliOwner.tick();
    if(scenario==='drain'){await inflight;const closing=host.close();release();await poll;await closing;assert.equal(calls,1);assert.equal(backend.state.sent.length,0);
      host=await Host.start(prepared,options);await host.ctx.dafeiyuBiliOwner.whenIdle();await host.core.whenIdle();assert.equal(calls,1);assert.equal(backend.state.sent.length,1);}
    else{await poll;await host.core.whenIdle();}
    if(task){assert.equal(publicRequests,1);assert.equal(nativeCalls,2);assert.equal(chatCalls,2);assert.equal(rendered,1);assert.equal(verified,1);assert.equal(backend.state.sent.length,2);
      assert.equal(backend.state.sent.filter(item=>item.text===persona).length,1);assert.equal(JSON.stringify(backend.state.sent).includes(opaque),false);assert.equal(host.snapshot().services.taskDelivery?.sent,1);}
    else{assert.equal(calls,1);assert.equal(backend.state.sent[0]?.text,normal);}
    host.publish();const status=readHostStatus(prepared,coordination).snapshot;assert.equal(status?.schemas.biliOwner,2);assert.equal(status?.services.biliOwner?.counts.deliveries.sent,task?2:1);assert.equal(JSON.stringify(status).includes(normal),false);
    const before={calls,publicRequests,sent:backend.state.sent.length};await host.close();const opened=factories;assert.equal(backend.state.closes,opened);assert.equal(backend.state.releases,opened);
    host=await Host.start(prepared,options);await host.ctx.dafeiyuBiliOwner.whenIdle();await host.core.whenIdle();assert.deepEqual({calls,publicRequests,sent:backend.state.sent.length},before);await host.close();assert.equal(backend.state.closes,factories);assert.equal(backend.state.releases,factories);
  }
}finally{await host?.close();}
console.log(JSON.stringify({passed:true,realHost:true,realModel:false,realPlatform:false,serverAccess:false}));
