import type { Context } from '@deepseek-ai/cordis';
import {setImmediate as yieldEventLoop} from 'node:timers/promises';
import {withRunUsage,withUsageContext} from './usage.js';
import type { AgentOptions } from '@deepseek-ai/dsh-agent';
import { NativeExpressionPacketSchema,NativeVerificationFeedbackSchema,ContextItemSchema,conversationKey,qqVisibleText,redactJson,DELIVERY_MAX_DRAFTS } from '@dafeiyu/contracts';
import type { NativeExpressionAccess,NativeExpressionPort,PendingMessage,TaskResultAnchor,ContextItem,ContextRequest,MediaPort,MediaReplyAccess,MediaReplyAuthority,Reply,Conversation,TaskProgress } from '@dafeiyu/contracts';
import {taskFailureNotice} from './task-progress.js';
import type { ContextCoordinator } from './context.js';
import type { RuntimeStore } from './runtime-store.js';
import type { DeliveryChannel } from './delivery-channel.js';
import type { FeedbackLedger } from './feedback-ledger.js';
import { nativeDeliveryHash } from './native-delivery-store.js';
import { renderTaskResult } from './target-renderer.js';
import type {DeliveryRepair} from './target-renderer.js';
import { readPersistedResult } from './agent-session.js';
import { z } from 'zod';
export const NATIVE_RENDER_ATTEMPTS=DELIVERY_MAX_DRAFTS;
interface Host {ctx:Context;store:RuntimeStore;contexts:ContextCoordinator;cwd:string;signal:AbortSignal;timeoutMs:number;sendTimeoutMs:number;
  feedbackSource(runId:string):{item:PendingMessage;taskId:string;state:string;error:string|null;operations:readonly {action?:string;state:string;status:string|null;effects:string|null}[]}|null;
  describe(runId:string):{item:PendingMessage|null;anchor:TaskResultAnchor;autoDeliver:boolean|undefined}|null;
  access(runId:string):Promise<NativeExpressionAccess>;expression():NativeExpressionPort|undefined;
  validateRecovery(runId:string):void;
  progressView(runId:string):TaskProgress;dispatchFeedback():Promise<number>;
  persona(item:PendingMessage,id:string,signal:AbortSignal,guard:()=>void):{text:string;foundationHash:string;stamp:string;items:readonly ContextItem[];guard():void};
  model():AgentOptions;channel(item:PendingMessage):DeliveryChannel|null;accepting():boolean;flush():void;
  activityChannel?(target:Conversation):DeliveryChannel|null;
  admitActivityShare?(runId:string):boolean;
  activityPersona?(runId:string,signal:AbortSignal,guard:()=>void):{text:string;foundationHash:string;stamp:string;items:readonly ContextItem[];guard():void};
  enqueue<T>(route:string,work:()=>Promise<T>):Promise<T>;acquire():Promise<()=>void>;
  notice(input:{item:PendingMessage;text:string;deliveryId:string;status:'sent'|'not-sent'|'unknown';kind:'progress'|'result'|'failure';receiptId?:string;code?:string}):void;
  feedback?:FeedbackLedger;
  media():MediaPort|undefined;mediaAccess(authority:MediaReplyAuthority,reply:Reply,signal:AbortSignal):Promise<MediaReplyAccess>;
}
const codes=new Set(['SOURCE_STALE','DEPENDENCY_UNAVAILABLE','DELIVERY_BINDING_CONFLICT','DELIVERY_RENDER_ALREADY_EXISTS','DELIVERY_TOOLS_FORBIDDEN','DELIVERY_CAPACITY','MODEL_INCOMPLETE','PERSISTENCE_FAILED','DELIVERY_CREDENTIAL_INVALID','DELIVERY_BODY_MISMATCH','NATIVE_EXPRESSION_NO_PUBLIC_MATERIAL','NATIVE_EXPRESSION_UNAVAILABLE','NATIVE_EXPRESSION_CAPACITY','PRIVATE_INPUT_REJECTED','DELIVERY_UNFAITHFUL','DELIVERY_VERIFICATION_INCOMPLETE','MEDIA_TARGET_DENIED','MEDIA_SOURCE_SUPPRESSED','MEDIA_DELIVERY_NOT_CONFIGURED','MEDIA_DRAFT_AUTHORITY_MISMATCH']);
const code=(error:unknown)=>error instanceof Error&&(codes.has(error.message.toUpperCase())||['DELIVERY_VERIFICATION_TIMEOUT','DELIVERY_VERIFICATION_MODEL_CHANGED','DELIVERY_VERIFICATION_MAX_TOKENS','DELIVERY_VERIFICATION_MODEL_ERROR','DELIVERY_VERIFICATION_ABORTED','DELIVERY_VERIFICATION_INVALID_RESULT','DELIVERY_RENDER_TIMEOUT'].includes(error.message))?error.message.toUpperCase():'NATIVE_DELIVERY_FAILED';
const resultSchema=z.discriminatedUnion('status',[z.object({status:z.literal('sent'),receiptId:z.string().min(1).max(256)}),z.object({status:z.literal('not-sent'),code:z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/)}),z.object({status:z.literal('unknown'),code:z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/)})]);
const terminal=new Set(['sent','not-sent','partial','uncertain','rejected','interrupted']);
/** Deliver the main Agent result; isolate and verify expression only when source scope requires it. */
export class NativeTaskDelivery {
  private readonly notices=new Map<string,Promise<import('@dafeiyu/contracts').Json>>();
  private readonly active=new Map<string,Promise<ReturnType<RuntimeStore['nativeDeliveries']['status']>>>();
  private readonly views=new WeakMap<ContextRequest,Map<string,{hash:string;guard:()=>void}>>();
  private readonly unregister:()=>void;
  constructor(private readonly host:Host){this.unregister=host.contexts.register('native-task-results','1',[{id:'delivered-results',kind:'evidence',prepare:request=>this.context(request),validate:(request,item)=>{
    try{host.contexts.scopeFor(request);const view=this.views.get(request)?.get(item.id);if(!view||view.hash!==nativeDeliveryHash(item))return false;view.guard();return true;}catch{return false;}}}]);}
  private async context(request:ContextRequest){const scope=this.host.contexts.scopeFor(request),views=new Map<string,{hash:string;guard:()=>void}>(),items:ContextItem[]=[];this.views.set(request,views);
    // These are program effect receipts, not inferences from the old result they may have invalidated.
    const conversationRun=this.host.store.findRequest('conversation',scope.traceId)?.runId;
    if(conversationRun)for(const operation of this.host.store.operations(conversationRun).filter(op=>op.plugin==='qq-tasks'&&op.action==='qq_task_control'&&op.outcome).slice(-8).reverse()){
      const result=operation.outcome!,data=z.object({taskId:z.uuid(),action:z.enum(['cancel','revise','resolve','resume']),taskVersion:z.number(),intentVersion:z.number(),taskState:z.string(),runId:z.uuid()}).safeParse(result.data);
      const item=ContextItemSchema.parse({id:`task-control:${operation.id}`,version:'1',text:JSON.stringify({kind:'task-control-receipt',status:result.status,effects:result.effects,data:data.success?data.data:null,code:result.errorCode??null,note:'核心保存的本轮任务控制回执。效果未知时不得当成未执行并重复写入。'}),expiresAt:'9999-12-31T23:59:59.999Z',sources:[{ref:`dafeiyu:operation:${operation.id}`,version:'1',hash:nativeDeliveryHash(result)}]});
      views.set(item.id,{hash:nativeDeliveryHash(item),guard:()=>{this.host.contexts.scopeFor(request);if(nativeDeliveryHash(this.host.store.operation(operation.id).outcome)!==nativeDeliveryHash(result))throw new Error('SOURCE_STALE');}});items.push(item);
    }
    const rows=this.host.store.nativeDeliveries.recent(request.conversation).filter(row=>conversationKey(scope.agentId,row.anchor.target)===scope.route);
    for(const row of rows){try{
      const status=this.status(row.runId);if(status&&terminal.has(row.state)&&row.state!=='sent'){
        const item=ContextItemSchema.parse({id:`native-status:${row.id}`,version:String(row.version),text:JSON.stringify({kind:'task-delivery-status',...status,note:'程序交付事实；不包含结果正文，不能由运行结束推断已送达。'}),expiresAt:'9999-12-31T23:59:59.999Z',sources:[{ref:`dafeiyu:native-status:${row.id}`,version:String(row.version),hash:nativeDeliveryHash(status)}]});
        views.set(item.id,{hash:nativeDeliveryHash(item),guard:()=>{this.host.contexts.scopeFor(request);if(nativeDeliveryHash(this.status(row.runId))!==nativeDeliveryHash(status))throw new Error('SOURCE_STALE');}});items.push(item);continue;}
      const provider=this.host.expression();if(!provider?.ready()||!row.material)continue;const access=await this.host.access(row.runId);request.signal.throwIfAborted();const packet=provider.open(access,row.material.packetId,'context');
      const guard=()=>{this.host.contexts.scopeFor(request);if(this.host.expression()!==provider||this.host.store.nativeDeliveries.get(row.runId)?.state!=='sent')throw new Error('SOURCE_STALE');access.guard();if(provider.open(access,packet.id,'context').sourceStamp!==row.material!.sourceStamp)throw new Error('SOURCE_STALE');};guard();
      const body=this.host.store.nativeDeliveries.verifyCredential(row.runId),characters=Array.from(body),excerpt=characters.slice(0,1000).join('');
      const item=ContextItemSchema.parse({id:`native-result:${row.id}`,version:row.credential!,text:JSON.stringify({kind:'delivered-task-result',note:'此前已确认发到当前会话的任务回答；只是已发表内容，不是新的独立世界证据。',text:excerpt,coverage:{start:0,end:Math.min(1000,characters.length),total:characters.length,complete:characters.length<=1000}}),expiresAt:'9999-12-31T23:59:59.999Z',sources:[{ref:`dafeiyu:native-result:${row.id}`,version:String(row.version),hash:nativeDeliveryHash(body)}]});
      views.set(item.id,{hash:nativeDeliveryHash(item),guard});items.push(item);
    }catch{/* Invalid or unavailable sources cannot fall back to the old body. */}}
    return items;
  }
  async request(runId:string,automatic=false){if(this.host.store.activityShare(runId)&&this.host.admitActivityShare?.(runId)===false)return null;
    const description=this.host.describe(runId);if(!description){if(automatic)return Promise.resolve(null);throw new Error('RESULT_UNAVAILABLE');}
    if(automatic&&!description.autoDeliver)return Promise.resolve(null);if(!automatic&&!this.host.accepting())throw new Error('HOST_NOT_READY');
    const record=this.host.store.nativeDeliveries.create(description.anchor);this.host.flush();
    const recovery=this.host.store.nativeDeliveries.pendingRecovery(runId);
    if(recovery&&['sent','uncertain'].includes(record.state)){
      this.host.store.nativeDeliveries.settleRecovery(runId,recovery.requestId,record.state==='sent'?null:'DELIVERY_EFFECT_UNCERTAIN');this.host.flush();
      return Promise.resolve(this.status(runId));
    }
    const pending=this.active.get(runId);if(pending)return pending;if(terminal.has(record.state)&&!this.host.store.nativeDeliveries.pendingRecovery(runId)||!this.host.accepting())return Promise.resolve(this.status(runId));
    const work=withRunUsage(receipt=>this.host.store.modelUsage.external(runId,receipt),()=>this.execute(runId,description.item,automatic),{runId,phase:'rendering'}).finally(()=>this.active.delete(runId));this.active.set(runId,work);return work;
  }
  requestRecovery(runId:string,input:unknown){
    if(!this.host.accepting())throw new Error('HOST_NOT_READY');
    const description=this.host.describe(runId);if(!description?.item)throw new Error('MESSAGE_REQUIRED');
    this.host.validateRecovery(runId);
    const receipt=this.host.store.nativeDeliveries.requestRecovery(runId,input,this.deliveryCounts(runId));this.host.flush();
    const schedule=()=>{if(this.host.accepting()&&this.host.store.nativeDeliveries.pendingRecovery(runId))void this.request(runId).catch(error=>{
      if(this.host.accepting()){this.host.store.nativeDeliveries.settleRecovery(runId,receipt.requestId,code(error));this.host.flush();}
    });};
    const active=this.active.get(runId);if(active)void active.finally(schedule).catch(()=>{});else schedule();
    return receipt;
  }
  activate(){for(const runId of this.host.store.nativeDeliveryCandidates())if(this.host.describe(runId)?.autoDeliver)void this.request(runId,true).catch(()=>{});
    for(const runId of this.host.store.nativeDeliveries.pendingRecoveries())void this.request(runId).catch(error=>{const pending=this.host.store.nativeDeliveries.pendingRecovery(runId);if(pending){this.host.store.nativeDeliveries.settleRecovery(runId,pending.requestId,code(error));this.host.flush();}});
    for(const runId of this.host.store.statusNoticeCandidates())void this.progress(runId).catch(()=>{});
  }
  async whenIdle(){while(this.active.size||this.notices.size)await Promise.allSettled([...this.active.values(),...this.notices.values()]);}
  get pending(){return this.active.size+this.notices.size;}
  status(runId:string){
    let counts:unknown;try{counts=this.deliveryCounts(runId);}catch{counts={unavailable:true};}
    const status=this.host.store.nativeDeliveries.status(runId,counts);
    if(status?.recovery.available)try{this.host.validateRecovery(runId);}catch{return {...status,recovery:{...status.recovery,available:false,reason:'DELIVERY_SOURCE_UNAVAILABLE'}};}
    return status;
  }
  deliveryCounts(runId:string){const row=this.host.store.nativeDeliveries.get(runId),description=this.host.describe(runId);if(!row||!description)return null;
    const channel=description.item?this.host.channel(description.item):this.host.activityChannel?.(row.anchor.target);
    const progress=channel?.capability.deliveryProgress?.('native-delivery:'+row.id);
    return progress&&progress.total!==undefined&&progress.sending!==undefined&&progress.receiptIds?{total:progress.total,confirmed:progress.confirmed,pending:progress.pending,sending:progress.sending,unknown:progress.unknown,receiptIds:[...progress.receiptIds]}:null;
  }
  progress(runId:string):Promise<import('@dafeiyu/contracts').Json>{const existing=this.notices.get(runId);if(existing)return existing;const work=withRunUsage(receipt=>this.host.store.modelUsage.external(runId,receipt),()=>this.statusNotice(runId),{runId,phase:'feedback'}).finally(()=>this.notices.delete(runId));this.notices.set(runId,work);return work;}
  private async statusNotice(runId:string):Promise<import('@dafeiyu/contracts').Json>{
    if(!this.host.accepting()||!this.host.feedback)return {status:'not-sent',code:'STATUS_LEDGER_UNAVAILABLE'};
    const source=this.host.feedbackSource(runId);if(!source)return {status:'not-sent',code:'STATUS_SOURCE_UNAVAILABLE'};
    const progress=this.host.progressView(runId),text=taskFailureNotice(progress);
    if(!text)return {status:'not-sent',code:'STATUS_NOTICE_NOT_REQUIRED'};
    const record=this.host.feedback.queue({workItemId:runId,route:source.item.route,kind:'must-know',text,
      sourceMessageId:source.item.id,taskId:source.taskId,runId,intentVersion:this.host.store.get(runId).definition.intentVersion,
      dueAt:new Date().toISOString(),statusVersion:progress.version});
    await this.host.dispatchFeedback();
    const current=this.host.feedback.pending(source.item.route,Date.now(),true).find(row=>row.id===record.id);
    return {feedbackId:record.id,state:current?.state??'unavailable',statusVersion:progress.version};
  }
  close(){this.unregister();}
  private async execute(runId:string,item:PendingMessage|null,notify:boolean){const release=await this.host.acquire(),deadlineAt=performance.now()+this.host.timeoutMs,recovery=this.host.store.nativeDeliveries.pendingRecovery(runId);let recoveryError:string|null=null,stage='source-admission',invoked=false,signal=AbortSignal.any([this.host.signal,AbortSignal.timeout(this.host.timeoutMs)]),mediaAccess:MediaReplyAccess|undefined,mediaId:string|undefined,media:MediaPort|undefined;
    try{let record=this.host.store.nativeDeliveries.get(runId)!;if(terminal.has(record.state)&&!recovery)return this.status(runId);
      if(!this.host.accepting())throw new Error('DELIVERY_HOST_QUIESCING');
      const access=await this.host.access(runId),provider=this.host.expression(),target=record.anchor.target,route=conversationKey(access.execution.view.scope.agentId,target),channelAt=()=>item?this.host.channel(item):this.host.activityChannel?.(target)??null,channel=channelAt();
      if(!provider?.ready()||!channel?.capability.deliverTaskResult)throw new Error('DEPENDENCY_UNAVAILABLE');
      const sendTaskResult=channel.capability.deliverTaskResult.bind(channel.capability);
      signal=AbortSignal.any([signal,channel.signal,...(provider.signal?[provider.signal]:[])]);
      if(nativeDeliveryHash(record.anchor)!==nativeDeliveryHash(access.anchor)||item&&route!==item.route)throw new Error('DELIVERY_BINDING_CONFLICT');
      await yieldEventLoop();signal.throwIfAborted();access.guard();
      stage='packet-prepare';const packet=NativeExpressionPacketSchema.parse(record.material?provider.open(access,record.material.packetId):provider.prepare(access));
      if(nativeDeliveryHash(packet.anchor)!==nativeDeliveryHash(record.anchor))throw new Error('DELIVERY_BINDING_CONFLICT');
      const guardMaterial=()=>{signal.throwIfAborted();if(!this.host.accepting())throw new Error('DELIVERY_HOST_QUIESCING');if(recovery)this.host.validateRecovery(runId);access.guard();if(this.host.expression()!==provider||!provider.ready()||channelAt()?.identity!==channel.identity)throw new Error('DEPENDENCY_UNAVAILABLE');
        if(provider.open(access,packet.id).sourceStamp!==packet.sourceStamp||Date.parse(record.anchor.expiresAt)<=Date.now())throw new Error('SOURCE_STALE');};
      await yieldEventLoop();guardMaterial();
      stage='persona-prepare';const persona=item?this.host.persona(item,record.id,signal,guardMaterial):this.host.activityPersona?.(runId,signal,guardMaterial);if(!persona)throw new Error('DEPENDENCY_UNAVAILABLE');
      await yieldEventLoop();signal.throwIfAborted();
      const model=this.host.model(),material={packetId:packet.id,sourceStamp:packet.sourceStamp,foundationHash:persona.foundationHash,personaHash:persona.stamp,modelHash:nativeDeliveryHash(model),...(packet.media?{mediaStamp:packet.media.sourceStamp}:{})};
      const guard=()=>{persona.guard();if(nativeDeliveryHash(this.host.model())!==material.modelHash)throw new Error('SOURCE_STALE');};guard();
      if(recovery){if(nativeDeliveryHash(record.material)!==nativeDeliveryHash(material))throw new Error('SOURCE_STALE');
        if(record.state!=='ready')record=this.host.store.nativeDeliveries.beginRecovery(runId,recovery.requestId,this.deliveryCounts(runId));this.host.flush();}
      if(record.state==='accepted'){
        this.host.store.nativeDeliveries.start(runId,material);this.host.flush();
        const completed=this.host.store.get(runId);
        if(packet.resultIncluded&&['completed','waiting'].includes(completed.state)&&completed.result){
          const text=await readPersistedResult(this.host.ctx,completed.result);guard();
          this.host.store.appendExecutionEvent(runId,'task.stage',{phase:'source-admission',expression:'main-agent'});
          this.host.store.nativeDeliveries.rendered(runId,completed.result);this.host.store.nativeDeliveries.approve(runId,text);this.host.flush();
        }
      }
      while(['rendering','verifying'].includes(this.host.store.nativeDeliveries.get(runId)!.state)){
          const work=this.host.store.nativeDeliveries.work(runId);let candidate=work.candidate;
          if(!candidate){
            if(work.draftCount>=NATIVE_RENDER_ATTEMPTS)throw new Error('DELIVERY_UNFAITHFUL');
            const repair:DeliveryRepair|undefined=work.lastRejected?{previousAnswer:await readPersistedResult(this.host.ctx,work.lastRejected),issues:work.issues,round:work.draftCount,focused:work.draftCount>1}:undefined;guard();
            stage='rendering';const attemptId=this.host.store.nativeDeliveries.renderAttempt(runId);
            this.host.store.appendExecutionEvent(runId,'task.stage',{phase:stage,attempt:work.draftCount,deadlineAt:new Date(Date.now()+this.host.ctx.dafeiyu.phaseTimeouts().render).toISOString()});this.host.flush();
            const rendered=await renderTaskResult(this.host.ctx,model,this.host.cwd,attemptId,persona.text,persona.items,packet,signal,guard,access.requestMaxBytes,repair,access.maxTokens);guard();
            this.host.store.nativeDeliveries.candidate(runId,rendered.resultRef);this.host.flush();candidate=rendered.resultRef;
          }
          const text=await readPersistedResult(this.host.ctx,candidate);guard();const attempt=this.host.store.nativeDeliveries.work(runId).draftCount-1;
          stage='verification';this.host.store.appendExecutionEvent(runId,'task.stage',{phase:stage,attempt,deadlineAt:new Date(Date.now()+this.host.ctx.dafeiyu.phaseTimeouts().verification).toISOString()});this.host.flush();
          try{await provider.verify(access,packet.id,['qq','local-owner'].includes(record.anchor.target.channel)?(qqVisibleText(text)||text):text,signal,guard);}
          catch(error){const feedback=NativeVerificationFeedbackSchema.safeParse(error instanceof Error&&error.message==='delivery_unfaithful'?error.cause:null);
            if(!feedback.success)throw error;const safe=redactJson(z.json().parse(feedback.data));
            this.host.store.appendExecutionEvent(runId,'native.delivery.verification-rejected',{attempt,renderRef:candidate,feedback:safe.value});this.host.flush();
            if(attempt+1>=NATIVE_RENDER_ATTEMPTS||safe.redacted)throw error;guard();
            this.host.store.nativeDeliveries.repair(runId);this.host.flush();continue;}
          guard();this.host.store.nativeDeliveries.rendered(runId,candidate);this.host.store.nativeDeliveries.approve(runId,text);this.host.flush();break;
      }
      stage='pre-dispatch';record=this.host.store.nativeDeliveries.get(runId)!;if(record.state!=='ready'||nativeDeliveryHash(record.material)!==nativeDeliveryHash(material)||!record.renderRef)throw new Error('SOURCE_STALE');
      const body=this.host.store.nativeDeliveries.verifyCredential(runId);if(await readPersistedResult(this.host.ctx,record.renderRef)!==body)throw new Error('DELIVERY_BODY_MISMATCH');guard();
      const reply=Object.freeze({id:`native-delivery:${record.id}`,conversation:Object.freeze({...record.anchor.target}),sourceMessageId:item?.message.id??'',text:body,taskResult:record.anchor});
      let result:z.infer<typeof resultSchema>;
      if(packet.media){media=this.host.media();if(!media?.ready()||!media.replyDraft||!media.finalizeReply||!media.readReplyPart||!media.validateReply||!media.settleReply||channel.capability.mediaDelivery!=='parts-v1'||!channel.capability.deliverMedia)throw new Error('MEDIA_DELIVERY_NOT_CONFIGURED');
        const sendMedia=channel.capability.deliverMedia.bind(channel.capability);
        const draft=media.replyDraft(runId);if(!draft||draft.id!==packet.media.draftId||draft.version!==packet.media.draftVersion)throw new Error('MEDIA_DRAFT_AUTHORITY_MISMATCH');mediaAccess=await this.host.mediaAccess(draft.authority,reply,signal);
        const manifest=await media.finalizeReply(mediaAccess);if(!manifest)throw new Error('MEDIA_DRAFT_AUTHORITY_MISMATCH');mediaId=manifest.id;const authorized=()=>{guard();mediaAccess!.guard();if(this.host.media()!==media)throw new Error('SOURCE_STALE');media!.validateReply!(mediaAccess!,manifest.id);};authorized();
        result=await this.host.enqueue(route,async()=>{const sending=AbortSignal.any([signal,AbortSignal.timeout(this.host.sendTimeoutMs)]),check=()=>{sending.throwIfAborted();authorized();};
          try{check();}catch{return {status:'not-sent' as const,code:'SOURCE_STALE'};}
          this.host.store.nativeDeliveries.sending(runId);this.host.flush();invoked=true;
          try{return resultSchema.parse(await sendMedia(structuredClone({...reply,media:manifest}),sending,check,position=>{check();return media!.readReplyPart!(mediaAccess!,manifest.id,position);}));}
          catch{return {status:'unknown' as const,code:'MEDIA_DELIVERY_UNKNOWN'};}});
      }else{result=await this.host.enqueue(route,async()=>{
        await yieldEventLoop();
        const writeBudget=new AbortController(),sending=AbortSignal.any([signal,writeBudget.signal]),check=()=>{sending.throwIfAborted();guard();};let timer:ReturnType<typeof setTimeout>|undefined,remaining=this.host.sendTimeoutMs,active=false;
        try{check();}catch{return {status:'not-sent' as const,code:'SOURCE_STALE'};}
        const begin=()=>{check();if(active||remaining<=0||deadlineAt-performance.now()<remaining)throw new Error('DELIVERY_BUDGET_EXHAUSTED');
          if(!invoked){this.host.store.nativeDeliveries.sending(runId);this.host.flush();}if(deadlineAt-performance.now()<remaining)throw new Error('DELIVERY_BUDGET_EXHAUSTED');
          const started=performance.now();timer=setTimeout(()=>writeBudget.abort(new DOMException('Task result write timed out','TimeoutError')),remaining);active=true;invoked=true;let ended=false;
          return ()=>{if(ended)return;ended=true;if(timer)clearTimeout(timer);timer=undefined;remaining=Math.max(0,remaining-(performance.now()-started));active=false;};};
        this.host.store.appendExecutionEvent(runId,'native.delivery.preflight',{deferredWriteBudget:true,writeTimeoutMs:this.host.sendTimeoutMs});this.host.flush();
        try{let outcome:z.infer<typeof resultSchema>;try{outcome=resultSchema.parse(await sendTaskResult(reply,record.anchor,sending,check,begin));}catch{outcome={status:'unknown',code:'DELIVERY_TRANSPORT_UNKNOWN'};}
          if(!invoked&&outcome.status!=='not-sent'){if(this.host.store.nativeDeliveries.get(runId)?.state==='ready')this.host.store.nativeDeliveries.sending(runId);this.host.flush();invoked=true;return {status:'unknown' as const,code:'DELIVERY_DISPATCH_NOT_NOTIFIED'};}return outcome;
        }finally{if(timer)clearTimeout(timer);}
      });}
      const progress=!item&&!packet.media?channel.capability.deliveryProgress?.(reply.id):null;
      const deferred=!item&&!packet.media&&(result.status==='not-sent'&&!invoked&&result.code==='DELIVERY_INTERRUPTED_BY_MESSAGE'
        ||result.status==='unknown'&&result.code==='PARTIAL_DELIVERY'&&progress?.canResume===true&&progress.unknown===0&&progress.sending===0&&progress.pending>0);
      if(deferred)this.host.store.nativeDeliveries.deferActivity(runId);
      else if(!invoked&&result.status==='not-sent'&&this.host.store.nativeDeliveries.get(runId)?.state==='ready')this.host.store.nativeDeliveries.notSentBeforeDispatch(runId,result.code);
      else this.host.store.nativeDeliveries.finish(runId,result.status==='sent'?'sent':result.status==='not-sent'?'not-sent':result.code==='PARTIAL_DELIVERY'?'partial':'uncertain',result.status==='sent'?result.receiptId:null,result.status==='sent'?null:result.code);
      if(item)this.host.notice({item,text:body,deliveryId:`native-delivery:${record.id}`,status:result.status==='sent'?'sent':result.status==='not-sent'?'not-sent':'unknown',kind:'result',...(result.status==='sent'?{receiptId:result.receiptId}:{code:result.code})});
      else this.host.store.appendExecutionEvent(runId,deferred?'activity.share.deferred':'activity.share.settled',{deliveryId:record.id,status:result.status});
    }catch(error){recoveryError=code(error);const modelFailure=z.object({code:z.string().regex(/^[A-Z0-9_]{1,100}$/),status:z.number().int().min(400).max(599).optional(),attempts:z.number().int().min(1).max(3)}).safeParse(error instanceof Error?error.cause:null);
      this.host.store.appendExecutionEvent(runId,'native.delivery.diagnostic',{stage,code:code(error),name:error instanceof Error?error.name:'Unknown',...(modelFailure.success?{modelFailure:z.json().parse(modelFailure.data)}:{}),
      ...(error instanceof z.ZodError?{issues:error.issues.map(issue=>({code:issue.code,path:issue.path.map(String).join('.')}))}:{})});
      const record=this.host.store.nativeDeliveries.get(runId);if(record?.state==='sending')this.host.store.nativeDeliveries.finish(runId,invoked?'uncertain':'not-sent',null,code(error));
      else if(record&&!terminal.has(record.state)){
        if(!this.host.accepting()&&record.state==='ready'&&!invoked){/* Sealed and definitely not dispatched: startup can send this exact body. */}
        else if(signal.aborted||!this.host.accepting())this.host.store.nativeDeliveries.interrupt(runId);else this.host.store.nativeDeliveries.reject(runId,code(error));}
    }finally{try{if(mediaAccess&&mediaId&&media?.settleReply){const state=this.host.store.nativeDeliveries.get(runId)?.state;try{
        const pending=this.host.store.nativeDeliveries.recoveryView(runId,true,this.deliveryCounts(runId));
        if(pending.available&&pending.phase==='sending')this.host.store.appendExecutionEvent(runId,'native.delivery.media-pending',{manifestId:mediaId,reason:'known-unsent-parts'});
        else media.settleReply(mediaAccess,mediaId,state==='sent'?'sent':state==='uncertain'||state==='partial'?'unknown':'blocked');
      }catch{this.host.store.nativeDeliveries.mediaSettlementPending(runId,mediaId);}}}
      finally{if(mediaAccess)media?.releaseReply?.(mediaAccess);mediaAccess?.release();release();if(recovery&&this.host.accepting()&&!this.host.signal.aborted)this.host.store.nativeDeliveries.settleRecovery(runId,recovery.requestId,recoveryError);this.host.flush();}}
    const status=this.host.store.nativeDeliveries.get(runId);if(item&&notify&&status&&['rejected','interrupted','not-sent'].includes(status.state))await withUsageContext({runId,phase:'feedback'},()=>this.feedback(item,runId));
    return this.status(runId);
  }
  private async feedback(_item:PendingMessage,runId:string){
    try{await this.statusNotice(runId);}catch{/* A durable claim, if created, remains authoritative. No alternate sender. */}
  }
}
