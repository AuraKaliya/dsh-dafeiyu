import { Service } from '@deepseek-ai/cordis';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@dafeiyu/core';
import { join } from 'node:path';
import { realpathSync } from 'node:fs';
import { z } from 'zod';
import { API_VERSION,ServiceGate,TaskResultAnchorSchema,conversationKey } from '@dafeiyu/contracts';
import type { DeliveryResult,ExtensionHandle,InboundMessage,Reply,TaskResultAnchor } from '@dafeiyu/contracts';
import { BiliOwnerConfigSchema } from './config.js';
import type { BiliOwnerConfig } from './config.js';
import { BiliOwnerStore } from './store.js';
import type { BiliOwnerInbound } from './store.js';
import { BiliOwnerTasks } from './tasks.js';
import { BILI_OWNER_EXTENSION,BILI_OWNER_VERSION,biliOwnerScene,biliOwnerConsumerKey,
  BiliOwnerHashSchema,BiliOwnerBindingSchema,BiliOwnerPageSchema,BiliOwnerSendResultSchema,biliOwnerHash,biliOwnerCode } from './types.js';
import type { BiliOwnerPorts,BiliOwnerDelivery,BiliOwnerDeliveryPlan } from './types.js';

const result=(value:BiliOwnerDelivery):DeliveryResult=>value.state==='sent'?{status:'sent',receiptId:value.receiptId!}:value.state==='unknown'||value.state==='sending'?{status:'unknown',code:value.code??'BILI_OWNER_DELIVERY_UNKNOWN'}:{status:'not-sent',code:value.code??'BILI_OWNER_NOT_DISPATCHED'};
declare module '@deepseek-ai/cordis' {interface Context {dafeiyuBiliOwner:BiliOwnerChannel}}
/** Managed native channel. All real IO/consumer ownership must be provided by a trusted launcher; no ambient credential fallback. */
export class BiliOwnerChannel extends Service {
  readonly config:z.output<typeof BiliOwnerConfigSchema>;readonly store:BiliOwnerStore;
  private readonly gate=new ServiceGate();private readonly controller=new AbortController();private readonly handle:ExtensionHandle;private readonly tasks:BiliOwnerTasks|undefined;
  private readonly now:()=>number;private readonly identityHash:string;private readonly epoch:number;private readonly root:string;
  private verified=false;private held=true;private closed=false;private automatic=false;private tickWork:Promise<void>|undefined;private timer:ReturnType<typeof setInterval>|undefined;
  private nextAt=0;private lastPollAt:string|null=null;private error:string|null=null;private closing:Promise<void>|undefined;private readonly sending=new Map<string,Promise<DeliveryResult>>();
  private finalCounts:ReturnType<BiliOwnerStore['counts']>|undefined;private finalCursor:ReturnType<BiliOwnerStore['cursor']>|undefined;private finalReady:boolean|undefined;private finalBindingFault:string|null|undefined;
  private ownedFiber:Awaited<ReturnType<Context['plugin']>>|undefined;
  /** Transfers the injected resources once; failed construction also disposes its own Cordis scope and releases the ports. */
  static async open(ctx:Context,raw:BiliOwnerConfig,ports:BiliOwnerPorts):Promise<BiliOwnerChannel>{let channel:BiliOwnerChannel|undefined,fiber:ReturnType<Context['plugin']>|undefined;
    try{if(!ctx.get('dafeiyu'))throw new Error('BILI_OWNER_CORE_REQUIRED');
      fiber=ctx.plugin({name:'dafeiyu-bili-owner-runtime',inject:['dafeiyu'],apply:(scope:Context)=>{channel=new BiliOwnerChannel(scope,raw,ports);}});
      const loaded=await fiber;if(!channel)throw new Error('BILI_OWNER_CONSTRUCTION_FAILED');channel.ownedFiber=loaded;return channel;
    }catch(error){try{if(channel)await channel.close();else{try{await ports?.transport?.close?.();}finally{await ports?.lease?.release?.();}}}finally{await fiber?.dispose();}throw error;}}
  private constructor(ctx:Context,raw:BiliOwnerConfig,private readonly ports:BiliOwnerPorts){super(ctx,'dafeiyuBiliOwner');this.config=BiliOwnerConfigSchema.parse(raw);
    if(!ports||typeof ports.transport?.verify!=='function'||typeof ports.transport.readOwnerPage!=='function'||typeof ports.transport.sendOwnerText!=='function'||typeof ports.transport.guard!=='function'
      ||ports.lease?.key!==biliOwnerConsumerKey(this.config.settings)||typeof ports.lease.guard!=='function'||typeof ports.lease.release!=='function')throw new Error('BILI_OWNER_RUNTIME_PORT_REQUIRED');
    this.identityHash=BiliOwnerHashSchema.parse(ports.transport.identityHash);this.epoch=z.number().int().positive().parse(ports.lease.epoch);this.now=ports.now??Date.now;ports.lease.guard();ports.transport.guard();
    this.store=new BiliOwnerStore(join(this.config.dataDir,'bili-owner.sqlite'),{agentId:this.config.agentId,profileId:this.config.profileId,accountUid:this.config.settings.accountUid,ownerUid:this.config.settings.ownerUid},this.config.createStore);
    try{this.root=realpathSync(this.config.dataDir);}catch(error){this.store.close();throw error;}
    try{this.handle=ctx.dafeiyu.registerExtension({id:BILI_OWNER_EXTENSION,version:BILI_OWNER_VERSION,protocolVersion:API_VERSION,agentId:this.config.agentId,lifecycleReady:()=>!this.closed&&(this.gate.active||this.gate.state==='quiescing'),
      channels:[{channel:'bilibili',account:this.config.settings.accountUid,deliveryValidation:'per-segment',description:'当前为B站独立账号与配置的唯一主人的私聊；仅文字，每条最多1000个Unicode字符。不提供平台发布、QQ主人或服务器执行权限。视频探索使用本渠道只读Task，结果由原人格会话整理。',
        deliver:(reply,signal,authority)=>this.deliver(reply,signal,authority),deliverTaskResult:(reply,anchor,signal,authority,writeWindow)=>this.deliverTaskResult(reply,anchor,signal,authority,writeWindow)}]});}
    catch(error){this.store.close();throw error;}
    try{if(this.config.settings.tasks.enabled)this.tasks=new BiliOwnerTasks(ctx,{accountUid:this.config.settings.accountUid,ownerUid:this.config.settings.ownerUid,agentId:this.config.agentId,policyId:this.config.settings.tasks.policyId,version:'bili-owner-v1:'+biliOwnerHash({settings:this.config.settings,transport:this.identityHash,epoch:this.epoch}),
      deliverResults:this.config.settings.tasks.deliverResults,explorationResources:this.config.settings.tasks.explorationResources},()=>this.sourceReady(),()=>this.gate.active&&!this.held&&this.verified&&this.sourceReady());}
    catch(error){this.handle.dispose();this.store.close();throw error;}
    ctx.effect(()=>()=>{if(this.closed)return;this.ownedFiber=undefined;return this.close();},'bili-owner.close');
  }
  private guard(){if(this.closed||this.controller.signal.aborted)throw new Error('BILI_OWNER_CLOSED');if(this.store.bindingFault())throw new Error('BILI_OWNER_BINDING_REJECTED');if(realpathSync(this.config.dataDir)!==this.root)throw new Error('BILI_OWNER_STORAGE_CHANGED');
    if(this.ports.lease.key!==biliOwnerConsumerKey(this.config.settings)||this.ports.lease.epoch!==this.epoch||this.ports.transport.identityHash!==this.identityHash)throw new Error('BILI_OWNER_BINDING_CHANGED');this.ports.lease.guard();this.ports.transport.guard();}
  private sourceReady(){try{this.guard();return this.store.bindingReady()&&this.store.verifiedBinding()!==null&&['recovered','active','quiescing'].includes(this.gate.state);}catch{return false;}}
  private checkIdentity(raw:unknown){
    const identity=z.object({accountUid:z.string(),ownerUid:z.string(),loggedIn:z.boolean(),bindingStamp:z.string()}).safeParse(raw);
    if(identity.success&&(identity.data.accountUid!==this.config.settings.accountUid||identity.data.ownerUid!==this.config.settings.ownerUid))throw new Error('BILI_OWNER_ACCOUNT_MISMATCH');
    if(identity.success&&!identity.data.loggedIn)throw new Error('BILI_OWNER_LOGIN_REQUIRED');}
  private async verify(signal:AbortSignal){try{this.guard();signal.throwIfAborted();const raw=await this.ports.transport.verify(signal,()=>this.guard());this.checkIdentity(raw);
    const value=BiliOwnerBindingSchema.parse(raw);this.guard();signal.throwIfAborted();this.store.bindVerified(value.bindingStamp,this.now());this.verified=true;return value;
  }catch(error){this.verified=false;const code=biliOwnerCode(error);if(['BILI_OWNER_ACCOUNT_MISMATCH','BILI_OWNER_BINDING_CHANGED','BILI_ACCOUNT_MISMATCH','BILI_OWNER_MISMATCH'].includes(code))this.store.rejectBinding(code,this.now());throw error;}}
  recover(){const recovered=this.store.recover(this.now());if(!this.store.bindingReady())throw new Error('BILI_OWNER_HANDOVER_REQUIRED');if(this.store.bindingFault())throw new Error('BILI_OWNER_BINDING_REJECTED');for(const id of this.store.recalled())this.recordRecall(id);this.gate.recovered();return recovered;}
  activate(){this.gate.activate();}
  holdIngress(){this.held=true;}
  private backgroundTick(){void this.tick().catch(error=>{this.error=biliOwnerCode(error,'BILI_OWNER_STORAGE_FAILED');this.held=true;});}
  releaseIngress(){this.gate.assertActive();this.guard();this.held=false;if(this.automatic)this.backgroundTick();}
  async start(automatic=true){this.gate.assertActive();if(this.ctx.dafeiyu.lifecycleState!=='active')throw new Error('HOST_NOT_READY');await this.verify(this.controller.signal);this.automatic=automatic;this.error=null;
    if(automatic&&!this.timer)this.timer=setInterval(()=>this.backgroundTick(),Math.min(5000,this.config.settings.pollMs));}
  tick():Promise<void>{if(this.tickWork)return this.tickWork;if(!this.gate.active||this.held||this.closed)return Promise.resolve();
    const work=this.poll().finally(()=>{if(this.tickWork===work)this.tickWork=undefined;});this.tickWork=work;return work;}
  private async poll(){try{this.guard();const cursor=this.store.cursor(),now=this.now();if(now<Math.max(this.nextAt,cursor.nextAt))return;this.nextAt=now+this.config.settings.pollMs;
      const binding=await this.verify(this.controller.signal);await this.admitPending();
      for(let page=0;page<this.config.settings.maxPagesPerTick;page++){
        if(!this.gate.active||this.held)break;const available=this.config.settings.maxPending-this.store.pending().length;if(available<=0){this.error='BILI_OWNER_CAPACITY';return;}
        const before=this.store.cursor(),limit=Math.min(30,available),raw=await this.ports.transport.readOwnerPage({... (before.before?{beforeSeqno:before.before}:{}),limit},this.controller.signal,()=>this.guard());this.checkIdentity(raw);const observed=BiliOwnerPageSchema.parse(raw);
        this.guard();if(observed.messages.length>limit)throw new Error('BILI_OWNER_PAGE_LIMIT');if(observed.bindingStamp!==binding.bindingStamp)throw new Error('BILI_OWNER_BINDING_CHANGED');const accepted=this.store.acceptPage(observed,before.version,this.config.settings.maxPending,this.now());
        this.lastPollAt=new Date(this.now()).toISOString();await this.admitPending();
        if(accepted.complete)break;
      }
      this.error=null;
    }catch(error){this.error=biliOwnerCode(error,'BILI_OWNER_POLL_FAILED');if(['BILI_OWNER_ACCOUNT_MISMATCH','BILI_OWNER_BINDING_CHANGED','BILI_ACCOUNT_MISMATCH','BILI_OWNER_MISMATCH'].includes(this.error)){this.verified=false;this.store.rejectBinding(this.error,this.now());}
      if(!this.closed)this.store.backoff(this.error,this.now()+this.config.settings.backoffMs);}}
  private incoming(source:BiliOwnerInbound):InboundMessage {if(!source.message||source.message.senderUid!==this.config.settings.ownerUid||source.message.receiverUid!==this.config.settings.accountUid||source.message.type!==1||!source.message.text.trim())throw new Error('BILI_OWNER_SOURCE_NOT_READY');
    return {id:source.id,occurredAt:new Date(source.message.timestamp*1000).toISOString(),conversation:biliOwnerScene(this.config.settings),sender:{id:this.config.settings.ownerUid,displayName:'B站用户'+this.config.settings.ownerUid},text:source.message.text,mainText:source.message.text};}
  private async admitPending(){for(const source of this.store.pending()){
    if(!this.gate.active||this.held||!this.verified||!this.ctx.dafeiyu.accepting)return;this.guard();const receipt=this.handle.ingest(this.incoming(source));this.store.accepted(source.id,receipt.id,this.now());
  }}
  /** Trusted platform-recall seam only. A missing item on a bounded page is never treated as recall. */
  private recordRecall(messageId:string){this.guard();const scope={agentId:this.config.agentId,route:conversationKey(this.config.agentId,biliOwnerScene(this.config.settings))};
    if(!this.ctx.dafeiyu.journal.messageRecalled(scope,messageId))this.handle.observe({conversation:biliOwnerScene(this.config.settings),type:'message.recalled',data:{messageId}});}
  recall(messageId:string){this.guard();this.store.recall(messageId,this.now());this.recordRecall(messageId);}
  private checkSource(plan:BiliOwnerDeliveryPlan){const source=this.store.source(plan.sourceMessageId);if(source?.state!=='accepted'||source.hash!==plan.sourceHash||source.coreInboundId!==plan.coreInboundId)throw new Error('SOURCE_STALE');
    const scope={agentId:this.config.agentId,route:conversationKey(this.config.agentId,biliOwnerScene(this.config.settings))},bound=this.ctx.dafeiyu.journal.messageFor(scope,plan.sourceMessageId);
    if(!bound||bound.id!==source.coreInboundId||bound.extensionId!==BILI_OWNER_EXTENSION||biliOwnerHash(bound.message)!==biliOwnerHash(this.incoming(source))||this.ctx.dafeiyu.journal.messageRecalled(scope,plan.sourceMessageId))throw new Error('SOURCE_STALE');
    if(plan.anchor&&(plan.anchor.inboundId!==bound.id||biliOwnerHash(plan.anchor.target)!==biliOwnerHash(biliOwnerScene(this.config.settings))||Date.parse(plan.anchor.expiresAt)<=this.now()))throw new Error('SOURCE_STALE');}
  private deliverTaskResult(reply:Reply,raw:TaskResultAnchor,signal:AbortSignal,authority:()=>void,writeWindow:()=>()=>void){const anchor=TaskResultAnchorSchema.parse(raw);
    if(typeof authority!=='function'||typeof writeWindow!=='function'||biliOwnerHash(anchor.target)!==biliOwnerHash(biliOwnerScene(this.config.settings))||biliOwnerHash(reply.conversation)!==biliOwnerHash(biliOwnerScene(this.config.settings)))return Promise.resolve<DeliveryResult>({status:'not-sent',code:'BILI_OWNER_TARGET_DENIED'});
    return this.deliver({...reply,taskResult:anchor},signal,authority,writeWindow);}
  private deliver(reply:Reply,signal:AbortSignal,authority?:()=>void,writeWindow?:()=>()=>void):Promise<DeliveryResult>{
    if(!this.gate.active||!this.verified||this.closed)return Promise.resolve({status:'not-sent',code:'BILI_OWNER_CHANNEL_OFFLINE'});
    if(typeof authority!=='function'||reply.media)return Promise.resolve({status:'not-sent',code:reply.media?'BILI_OWNER_TEXT_ONLY':'BILI_OWNER_AUTHORITY_REQUIRED'});
    let value:BiliOwnerDelivery;try{this.guard();authority();value=this.store.prepareReply(reply,this.now());this.checkSource(value.plan);}catch(error){return Promise.resolve({status:'not-sent',code:biliOwnerCode(error,'BILI_OWNER_DELIVERY_INVALID')});}
    if(value.state!=='prepared')return Promise.resolve(result(value));const existing=this.sending.get(reply.id);if(existing)return existing;
    const work=this.send(value,AbortSignal.any([signal,this.controller.signal]),authority,writeWindow).finally(()=>this.sending.delete(reply.id));this.sending.set(reply.id,work);return work;
  }
  private async send(value:BiliOwnerDelivery,signal:AbortSignal,authority:()=>void,writeWindow?:()=>()=>void):Promise<DeliveryResult>{let invoked=false;
    const guard=()=>{this.guard();signal.throwIfAborted();authority();this.checkSource(value.plan);};
    try{guard();await this.verify(signal);guard();this.store.begin(value.plan.replyId,this.now());guard();
      const finishWrite=writeWindow?.();let response:z.infer<typeof BiliOwnerSendResultSchema>;
      try{invoked=true;response=BiliOwnerSendResultSchema.parse(await this.ports.transport.sendOwnerText({requestId:value.plan.requestId,text:value.plan.text,wireHash:value.plan.wireHash},signal,guard));}finally{finishWrite?.();}
      if(response.status==='sent'){if(response.accountUid!==this.config.settings.accountUid||response.ownerUid!==this.config.settings.ownerUid||response.requestId!==value.plan.requestId||response.wireHash!==value.plan.wireHash)throw new Error('BILI_OWNER_RECEIPT_MISMATCH');this.store.confirm(value.plan.replyId,response.receiptId,this.now());}
      else if(response.status==='not-dispatched')this.store.notDispatched(value.plan.replyId,response.code,this.now());else this.store.unknown(value.plan.replyId,response.code,this.now());
    }catch(error){const latest=this.store.delivery(value.plan.replyId)!;if(latest.state==='sending'){if(invoked)this.store.unknown(value.plan.replyId,biliOwnerCode(error,'BILI_OWNER_DELIVERY_UNKNOWN'),this.now());else this.store.notDispatched(value.plan.replyId,biliOwnerCode(error,'BILI_OWNER_PRECHECK_FAILED'),this.now());}
      else if(latest.state==='prepared')return {status:'not-sent',code:biliOwnerCode(error,'BILI_OWNER_PRECHECK_FAILED')};}
    return result(this.store.delivery(value.plan.replyId)!);
  }
  quiesce(){this.held=true;this.gate.quiesce();if(this.timer)clearInterval(this.timer);this.timer=undefined;}
  cancelRunning(){this.quiesce();this.controller.abort(new Error('BILI_OWNER_CANCELLED'));}
  async whenIdle(){if(this.tickWork)await this.tickWork;while(this.sending.size)await Promise.allSettled([...this.sending.values()]);}
  getStatus(){const cursor=this.finalCursor??this.store.cursor(),fault=this.closed?this.finalBindingFault??null:this.store.bindingFault();return {lifecycle:this.gate.state,accountUid:this.config.settings.accountUid,ownerUid:this.config.settings.ownerUid,transport:'program-injected' as const,verified:this.verified,ingressHeld:this.held,
    polling:!!this.tickWork,inFlight:this.sending.size,lastPollAt:this.lastPollAt,error:this.error,backoffUntil:cursor.nextAt,bindingReady:(this.finalReady??this.store.bindingReady())&&!fault,bindingFault:fault,counts:this.finalCounts??this.store.counts(),leaseEpoch:this.epoch};}
  close():Promise<void>{if(this.closing)return this.closing;this.quiesce();this.controller.abort(new Error('BILI_OWNER_CLOSED'));this.closing=(async()=>{
    let failure:unknown;const attempt=async(work:()=>unknown|Promise<unknown>)=>{try{await work();}catch(error){failure??=error;}};
    await attempt(()=>this.whenIdle());await attempt(()=>this.tasks?.close());await attempt(()=>this.handle.dispose());
    await attempt(()=>{this.finalCounts=this.store.counts();this.finalCursor=this.store.cursor();this.finalReady=this.store.bindingReady();this.finalBindingFault=this.store.bindingFault();});await attempt(()=>this.store.close());
    this.closed=true;this.verified=false;this.gate.close();await attempt(()=>this.ports.transport.close?.());await attempt(()=>this.ports.lease.release());
    await attempt(()=>this.ownedFiber?.dispose());if(failure)throw failure;
  })();return this.closing;}
}
export const openBiliOwnerChannel=(ctx:Context,config:BiliOwnerConfig,ports:BiliOwnerPorts)=>BiliOwnerChannel.open(ctx,config,ports);
