import {BILI_OWNER_ACCOUNT,BILI_OWNER_UID,BILI_OWNER_SCENE,BILI_OWNER_CONSUMER_KEY} from './bili-owner-identity.js';
import { mkdtemp } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { z } from 'zod';
import * as Core from '@dafeiyu/core';
import * as Timeline from '@dafeiyu/timeline';
import * as Memory from '@dafeiyu/memory';
import { API_VERSION,conversationKey } from '@dafeiyu/contracts';
import type { ResourceProof } from '@dafeiyu/contracts';
import type { Context } from '@deepseek-ai/cordis';
import { BILI_PUBLIC_SCENE,BILI_OWNER_TASK_ACTIONS,BiliOwnerStore,openBiliOwnerChannel,biliOwnerHash } from '@dafeiyu/bilibili/channel';
import type { BiliOwnerPorts,BiliOwnerTransport,BiliOwnerChannel,BiliOwnerMessage,BiliOwnerIdentity } from '@dafeiyu/bilibili/channel';
import { QqTaskCapabilities,QQ_TASK_ACTIONS } from '../packages/channel-qq/lib/tasks.js';
import { probeHost } from './phase1-probe-fixture.js';
import { ScriptedModel,textReply } from './harness.js';
import type { Response } from './harness.js';
import { testTempDir } from './test-temp.js';

export const fixedNow=1793000000000,fixtureHash='a'.repeat(64),fixtureStamp='b'.repeat(64);
export const incomingBili=(id='9007199254740993123',text='虚构主人文字'):BiliOwnerMessage=>({id,seqno:id,senderUid:BILI_OWNER_UID,receiverUid:BILI_OWNER_ACCOUNT,type:1,timestamp:fixedNow/1000,text});
export function biliOwnerBackend(){const state={messages:[] as BiliOwnerMessage[],reads:[] as {beforeSeqno?:string;limit:number}[],attempts:[] as {requestId:string;text:string;wireHash:string}[],sent:[] as {requestId:string;text:string;wireHash:string}[],
    verifications:0,closes:0,releases:0,pinsValid:true,leaseValid:true,account:BILI_OWNER_ACCOUNT as string,receiptAccount:BILI_OWNER_ACCOUNT as string,receiptOwner:BILI_OWNER_UID as string,stamp:fixtureStamp,sendMode:'sent' as 'sent'|'unknown'|'throw'|'not-dispatched',now:fixedNow,
    beforeVerify:async()=>{},beforeSend:async(_guard:()=>void)=>{}};
  const createPorts=():BiliOwnerPorts=>{let released=false,closed=false;const guard=()=>{if(closed)throw new Error('BILI_OWNER_TRANSPORT_CLOSED');if(!state.pinsValid)throw new Error('BILI_OWNER_PIN_CHANGED');};
    return {now:()=>state.now,lease:{key:BILI_OWNER_CONSUMER_KEY,epoch:1,guard:()=>{if(released||!state.leaseValid)throw new Error('BILI_OWNER_LEASE_REVOKED');},release:()=>{if(released)throw new Error('LEASE_RELEASED_TWICE');released=true;state.releases++;}},
      transport:{identityHash:fixtureHash,guard,verify:async(signal,check)=>{signal.throwIfAborted();check();await state.beforeVerify();state.verifications++;
        return {accountUid:state.account,ownerUid:BILI_OWNER_UID,loggedIn:true,bindingStamp:state.stamp} as Awaited<ReturnType<BiliOwnerTransport['verify']>>;},
        readOwnerPage:async(input,signal,check)=>{signal.throwIfAborted();check();state.reads.push({...input});const all=state.messages.filter(message=>!input.beforeSeqno||BigInt(message.seqno)<BigInt(input.beforeSeqno)).sort((a,b)=>BigInt(a.seqno)>BigInt(b.seqno)?-1:BigInt(a.seqno)<BigInt(b.seqno)?1:0),messages=all.slice(0,input.limit),hasMore=all.length>messages.length;
          return {accountUid:BILI_OWNER_ACCOUNT,ownerUid:BILI_OWNER_UID,loggedIn:true,bindingStamp:state.stamp,messages,hasMore,nextBeforeSeqno:hasMore?messages.at(-1)!.seqno:null};},
        sendOwnerText:async(input,signal,check)=>{check();signal.throwIfAborted();await state.beforeSend(check);check();signal.throwIfAborted();
          if(state.sendMode==='not-dispatched')return {status:'not-dispatched',code:'BILI_OWNER_PRECHECK_STOPPED'};state.attempts.push({...input});
          if(state.sendMode==='throw')throw new Error('BILI_OWNER_NETWORK_UNKNOWN');if(state.sendMode==='unknown')return {status:'unknown',code:'BILI_OWNER_NETWORK_UNKNOWN'};
          state.sent.push({...input});return {status:'sent',receiptId:String(1000+state.sent.length),accountUid:state.receiptAccount,ownerUid:state.receiptOwner,requestId:input.requestId,wireHash:input.wireHash};},
        close:()=>{if(closed)throw new Error('TRANSPORT_CLOSED_TWICE');closed=true;state.closes++;}}};};
  return {state,createPorts};
}
export type BiliOwnerBackend=ReturnType<typeof biliOwnerBackend>;

/** Real Core/Memory/official DSH. All Bili, consumer-lease and model transport facts are fictional test ports. */
export async function biliOwnerChannelFixture(options:{root?:string;create?:boolean;tasks?:boolean;deliverResults?:boolean;deferWork?:boolean;maxPending?:number;backend?:BiliOwnerBackend;
  omitTaskPolicy?:boolean;otherChannel?:boolean;maxConcurrentRuns?:number;beforeStart?:(ctx:Context,channel:BiliOwnerChannel,adapter:ScriptedModel)=>void|Promise<void>}={}){
  const root=options.root??await mkdtemp(join(testTempDir(),'bili-owner-channel-')),backend=options.backend??biliOwnerBackend(),create=options.create??true;
  let response:Response=()=>textReply('虚构人格回复'),channel:BiliOwnerChannel|undefined;
  const adapter=new ScriptedModel(request=>response(request)),host=await probeHost(root,adapter),ctx=host.ctx,ports=backend.createPorts();
  const identity:BiliOwnerIdentity={agentId:'dafeiyu',profileId:'bili-owner-test',accountUid:BILI_OWNER_ACCOUNT,ownerUid:BILI_OWNER_UID},directory=join(root,'bili');
  let publicReads=0;const proofs=new Map<string,ResourceProof>(),publicPage={kind:'public-bili-fixture',text:'PUBLIC_BILI_EVIDENCE：虚构视频文字，未取得画面或音频。'};
  let publicHandle:ReturnType<typeof ctx.dafeiyu.registerExtension>|undefined,qqHandle:ReturnType<typeof ctx.dafeiyu.registerExtension>|undefined,qqTasks:QqTaskCapabilities|undefined;
  try{
    await ctx.plugin(Core,{agentId:'dafeiyu',dataDir:join(root,'core'),personaFile:resolve('profiles/persona.test.md'),provider:'local-test',model:'scripted',turnTimeoutMs:10000});
    await ctx.plugin(Timeline,{agentId:'dafeiyu',execution:true});await ctx.plugin(Memory,{agentId:'dafeiyu',dataDir:join(root,'memory'),});
    ctx.dafeiyu.configureExecution({profileId:identity.profileId,createStore:create,...(options.maxConcurrentRuns?{maxConcurrentRuns:options.maxConcurrentRuns}:{}),policies:[
      {id:'conversation',producers:['channel-bili-owner',...(options.otherChannel?['channel-qq']:[])],actions:options.tasks?[...BILI_OWNER_TASK_ACTIONS,...(options.otherChannel?QQ_TASK_ACTIONS:[])]:[],allowLocalWrite:true},
      ...(!options.omitTaskPolicy?[{id:'bili-owner-task',producers:['bili-owner-tasks'],actions:['bili_fixture_read','dafeiyu_task_intent','dafeiyu_task_object'],allowLocalWrite:true,resources:[BILI_PUBLIC_SCENE]}]:[]),
      ...(options.otherChannel?[{id:'qq-task',producers:['qq-tasks'],actions:[],allowLocalWrite:true,resources:[]}]:[]),
    ]});
    publicHandle=ctx.dafeiyu.registerExtension({protocolVersion:4,id:'bili-public-fixture',version:'1',agentId:'dafeiyu',resourceProofs:{current:proof=>biliOwnerHash(proofs.get(proof.key)??null)===biliOwnerHash(proof),epoch:()=>fixtureHash,publicView:(proof,view)=>proofs.has(proof.key)&&view===JSON.stringify(publicPage)},actions:[
      {id:'bili_fixture_read',version:'1',description:'仅本机虚构的公共视频文字来源',effects:'read',scope:'task',inputSchema:z.strictObject({}),outputSchema:z.json(),execute:async(_raw,context)=>{
        publicReads++;ctx.dafeiyu.authorizeCapabilityResource(context,'bili-public-fixture',BILI_PUBLIC_SCENE);const proof:ResourceProof={provider:'bili-public-fixture',scene:BILI_PUBLIC_SCENE,key:context.operationId,version:1,hash:biliOwnerHash(publicPage),roots:['fixture-public-video'],detail:{scope:context.scope}};proofs.set(proof.key,proof);
        const observation=ctx.dafeiyu.recordCapabilityObservation(context,'bili-public-fixture',{requestId:context.operationId,proof,text:JSON.stringify(publicPage),occurredAt:new Date().toISOString(),coverage:['only-fictional-text'],counts:{received:1,processed:1}});
        const {id,scopeKey,version,contentHash}=observation.source;return {status:'succeeded',effects:'none',completeness:'partial',data:z.json().parse({page:publicPage,observation}),sources:[{id,scopeKey,version,contentHash}],receipts:[]};}},
    ]});
    if(options.otherChannel){qqHandle=ctx.dafeiyu.registerExtension({id:'channel-qq',version:'fixture',protocolVersion:4,agentId:'dafeiyu',channels:[{channel:'qq',account:'12345678',deliver:async()=>({status:'sent',receiptId:'fictional-qq'})}]});
      qqTasks=new QqTaskCapabilities(ctx,{agentId:'dafeiyu',botId:'12345678',ownerId:'87654321',policyId:'qq-task',naturalNames:[],deliverResults:false});}
    if(create){const store=new BiliOwnerStore(join(directory,'bili-owner.sqlite'),identity,true);try{store.initializeFresh({requestId:'fresh',since:backend.state.now-60000,cutoverHash:fixtureHash},backend.state.now);}finally{store.close();}}
    channel=await openBiliOwnerChannel(ctx,{agentId:identity.agentId,profileId:identity.profileId,dataDir:directory,settings:{accountUid:'10000001',ownerUid:'10000002',tasks:{enabled:options.tasks??false,deliverResults:options.deliverResults??true},...(options.maxPending?{maxPending:options.maxPending}:{})}},ports);
    ctx.dafeiyuMemory.recover();ctx.dafeiyuMemory.activate();channel.recover();channel.activate();await ctx.dafeiyu.recoverExecutions();ctx.dafeiyu.recover();
    await options.beforeStart?.(ctx,channel,adapter);ctx.dafeiyu.activate({deferWork:options.deferWork??false});await channel.start(false);channel.releaseIngress();
    const service=channel;
    return {root,ctx,core:ctx.dafeiyu,channel:service,backend,adapter,scene:BILI_OWNER_SCENE,scope:{agentId:'dafeiyu',route:conversationKey('dafeiyu',BILI_OWNER_SCENE)},get publicReads(){return publicReads;},
      setResponse(next:Response){response=next;},advance(ms=30000){backend.state.now+=ms;},
      async poll(){await service.tick();await ctx.dafeiyu.whenIdle();},
      async message(text:string,id='9007199254740993123'){backend.state.messages.push(incomingBili(id,text));backend.state.now+=30000;await service.tick();await ctx.dafeiyu.whenIdle();},
      async otherMessage(text:string){if(!qqHandle)throw new Error('No fictional QQ channel');qqHandle.ingest({id:'qq-1',occurredAt:new Date().toISOString(),conversation:{channel:'qq',account:'12345678',kind:'private',id:'87654321'},sender:{id:'87654321',displayName:'虚构QQ用户'},text,mainText:text});await ctx.dafeiyu.whenIdle();},
      close:async()=>{ctx.dafeiyu.quiesce();service.quiesce();try{await ctx.dafeiyu.whenIdle();await service.whenIdle();}finally{await service.close();qqTasks?.close();qqHandle?.dispose();publicHandle?.dispose();try{await ctx.dafeiyu.close();}finally{await host.close();}}},
    };
  }catch(error){if(channel)await channel.close();qqTasks?.close();qqHandle?.dispose();publicHandle?.dispose();await host.close();throw error;}
}
