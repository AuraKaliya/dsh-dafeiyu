import type { Context } from '@deepseek-ai/cordis';
import type { AgentOptions } from '@deepseek-ai/dsh-agent';
import { NativeExpressionPacketSchema,NativeVerificationFeedbackSchema,ContextItemSchema,conversationKey,qqVisibleText,redactJson } from '@dafeiyu/contracts';
import type { NativeExpressionAccess,NativeExpressionPort,PendingMessage,TaskResultAnchor,ContextItem,ContextRequest,MediaPort,MediaReplyAccess,MediaReplyAuthority,Reply } from '@dafeiyu/contracts';
import type { ContextCoordinator } from './context.js';
import type { RuntimeStore } from './runtime-store.js';
import type { DeliveryChannel } from './delivery-channel.js';
import { nativeDeliveryHash } from './native-delivery-store.js';
import { renderTaskResult,renderPublicProgress } from './target-renderer.js';
import type {DeliveryRepair} from './target-renderer.js';
import { readPersistedResult } from './agent-session.js';
import { z } from 'zod';
export const NATIVE_RENDER_ATTEMPTS=2;
interface Host {ctx:Context;store:RuntimeStore;contexts:ContextCoordinator;cwd:string;signal:AbortSignal;timeoutMs:number;sendTimeoutMs:number;
  feedbackSource(runId:string):{item:PendingMessage;taskId:string;state:string;error:string|null;operations:readonly {state:string;status:string|null;effects:string|null}[]}|null;
  describe(runId:string):{item:PendingMessage;anchor:TaskResultAnchor;autoDeliver:boolean|undefined}|null;
  access(runId:string):Promise<NativeExpressionAccess>;expression():NativeExpressionPort|undefined;
  persona(item:PendingMessage,id:string,signal:AbortSignal,guard:()=>void):{text:string;foundationHash:string;stamp:string;items:readonly ContextItem[];guard():void};
  model():AgentOptions;channel(item:PendingMessage):DeliveryChannel|null;accepting():boolean;flush():void;
  enqueue<T>(route:string,work:()=>Promise<T>):Promise<T>;acquire():Promise<()=>void>;
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
      const status=this.host.store.nativeDeliveries.status(row.runId);if(status&&terminal.has(row.state)&&row.state!=='sent'){
        const item=ContextItemSchema.parse({id:`native-status:${row.id}`,version:String(row.version),text:JSON.stringify({kind:'task-delivery-status',...status,note:'程序交付事实；不包含结果正文，不能由运行结束推断已送达。'}),expiresAt:'9999-12-31T23:59:59.999Z',sources:[{ref:`dafeiyu:native-status:${row.id}`,version:String(row.version),hash:nativeDeliveryHash(status)}]});
        views.set(item.id,{hash:nativeDeliveryHash(item),guard:()=>{this.host.contexts.scopeFor(request);if(nativeDeliveryHash(this.host.store.nativeDeliveries.status(row.runId))!==nativeDeliveryHash(status))throw new Error('SOURCE_STALE');}});items.push(item);continue;}
      const provider=this.host.expression();if(!provider?.ready()||!row.material)continue;const access=await this.host.access(row.runId);request.signal.throwIfAborted();const packet=provider.open(access,row.material.packetId,'context');
      const guard=()=>{this.host.contexts.scopeFor(request);if(this.host.expression()!==provider||this.host.store.nativeDeliveries.get(row.runId)?.state!=='sent')throw new Error('SOURCE_STALE');access.guard();if(provider.open(access,packet.id,'context').sourceStamp!==row.material!.sourceStamp)throw new Error('SOURCE_STALE');};guard();
      const body=this.host.store.nativeDeliveries.verifyCredential(row.runId),characters=Array.from(body),excerpt=characters.slice(0,1000).join('');
      const item=ContextItemSchema.parse({id:`native-result:${row.id}`,version:row.credential!,text:JSON.stringify({kind:'delivered-task-result',note:'此前已确认发到当前会话的任务回答；只是已发表内容，不是新的独立世界证据。',text:excerpt,coverage:{start:0,end:Math.min(1000,characters.length),total:characters.length,complete:characters.length<=1000}}),expiresAt:'9999-12-31T23:59:59.999Z',sources:[{ref:`dafeiyu:native-result:${row.id}`,version:String(row.version),hash:nativeDeliveryHash(body)}]});
      views.set(item.id,{hash:nativeDeliveryHash(item),guard});items.push(item);
    }catch{/* Invalid or unavailable sources cannot fall back to the old body. */}}
    return items;
  }
  request(runId:string,automatic=false){const description=this.host.describe(runId);if(!description){if(automatic)return Promise.resolve(null);throw new Error('RESULT_UNAVAILABLE');}
    if(automatic&&!description.autoDeliver)return Promise.resolve(null);if(!automatic&&!this.host.accepting())throw new Error('HOST_NOT_READY');
    const record=this.host.store.nativeDeliveries.create(description.anchor);this.host.flush();
    const pending=this.active.get(runId);if(pending)return pending;if(terminal.has(record.state)||!this.host.accepting())return Promise.resolve(this.host.store.nativeDeliveries.status(runId));
    const work=this.execute(runId,description.item,automatic).finally(()=>this.active.delete(runId));this.active.set(runId,work);return work;
  }
  activate(){for(const runId of this.host.store.nativeDeliveryCandidates())if(this.host.describe(runId)?.autoDeliver)void this.request(runId,true).catch(()=>{});}
  async whenIdle(){while(this.active.size||this.notices.size)await Promise.allSettled([...this.active.values(),...this.notices.values()]);}
  get pending(){return this.active.size+this.notices.size;}
  progress(runId:string):Promise<import('@dafeiyu/contracts').Json>{const existing=this.notices.get(runId);if(existing)return existing;const work=this.statusNotice(runId).finally(()=>this.notices.delete(runId));this.notices.set(runId,work);return work;}
  private async statusNotice(runId:string):Promise<import('@dafeiyu/contracts').Json>{
    const source=this.host.feedbackSource(runId);if(!source||this.host.signal.aborted)return {status:'not-sent',code:'STATUS_SOURCE_UNAVAILABLE'};
    const channel=this.host.channel(source.item);if(!channel)return {status:'not-sent',code:'STATUS_CHANNEL_UNAVAILABLE'};
    const signal=AbortSignal.any([this.host.signal,channel.signal,AbortSignal.timeout(this.host.ctx.dafeiyu.phaseTimeouts().feedback)]);
    const guard=()=>{signal.throwIfAborted();const current=this.host.feedbackSource(runId);if(!current||current.state!==source.state||this.host.channel(source.item)?.identity!==channel.identity)throw new Error('SOURCE_STALE');};
    try{guard();const persona=this.host.persona(source.item,runId,signal,guard),result=await renderPublicProgress(this.host.ctx,this.host.model(),this.host.cwd,runId,persona.text,persona.items,
      {target:source.item.message.conversation,taskId:source.taskId,runId,inboundId:source.item.id,question:'向原会话说明本次工作当前有必要了解的状态。',taskState:source.state,evidence:[{id:'STATE',kind:'reported',text:JSON.stringify({state:source.state,error:source.error,operations:source.operations,scope:'program-status-only',note:'仅是程序状态，不包含工具正文，也不代表目标满足。'})}]},signal,()=>{guard();persona.guard();},32000);
      const receipt=await this.host.enqueue(source.item.route,async()=>{guard();persona.guard();return channel.capability.deliver({id:'task-status:'+runId,conversation:source.item.message.conversation,sourceMessageId:source.item.message.id,text:result.text},signal,()=>{guard();persona.guard();});});
      this.host.store.appendExecutionEvent(runId,'task.feedback',{status:receipt.status});this.host.flush();return z.json().parse(receipt);
    }catch{return {status:'not-sent',code:'STATUS_NOT_SENT'};}
  }
  close(){this.unregister();}
  private async execute(runId:string,item:PendingMessage,notify:boolean){const release=await this.host.acquire(),deadlineAt=performance.now()+this.host.timeoutMs;let invoked=false,signal=AbortSignal.any([this.host.signal,AbortSignal.timeout(this.host.timeoutMs)]),mediaAccess:MediaReplyAccess|undefined,mediaId:string|undefined,media:MediaPort|undefined;
    try{let record=this.host.store.nativeDeliveries.get(runId)!;if(terminal.has(record.state))return this.host.store.nativeDeliveries.status(runId);
      const access=await this.host.access(runId),provider=this.host.expression(),channel=this.host.channel(item);
      if(!provider?.ready()||!channel?.capability.deliverTaskResult)throw new Error('DEPENDENCY_UNAVAILABLE');
      const sendTaskResult=channel.capability.deliverTaskResult.bind(channel.capability);
      signal=AbortSignal.any([signal,channel.signal,...(provider.signal?[provider.signal]:[])]);
      if(nativeDeliveryHash(record.anchor)!==nativeDeliveryHash(access.anchor)||conversationKey(access.execution.view.scope.agentId,access.anchor.target)!==item.route)throw new Error('DELIVERY_BINDING_CONFLICT');
      const packet=NativeExpressionPacketSchema.parse(record.material?provider.open(access,record.material.packetId):provider.prepare(access));
      if(nativeDeliveryHash(packet.anchor)!==nativeDeliveryHash(record.anchor))throw new Error('DELIVERY_BINDING_CONFLICT');
      const guardMaterial=()=>{signal.throwIfAborted();access.guard();if(this.host.expression()!==provider||!provider.ready()||this.host.channel(item)?.identity!==channel.identity)throw new Error('DEPENDENCY_UNAVAILABLE');
        if(provider.open(access,packet.id).sourceStamp!==packet.sourceStamp||Date.parse(record.anchor.expiresAt)<=Date.now())throw new Error('SOURCE_STALE');};
      const persona=this.host.persona(item,record.id,signal,guardMaterial),model=this.host.model(),material={packetId:packet.id,sourceStamp:packet.sourceStamp,foundationHash:persona.foundationHash,personaHash:persona.stamp,modelHash:nativeDeliveryHash(model),...(packet.media?{mediaStamp:packet.media.sourceStamp}:{})};
      const guard=()=>{persona.guard();if(nativeDeliveryHash(this.host.model())!==material.modelHash)throw new Error('SOURCE_STALE');};guard();
      if(record.state==='accepted'){
        this.host.store.nativeDeliveries.start(runId,material);this.host.flush();
        const completed=this.host.store.get(runId);
        if(packet.resultIncluded&&['completed','waiting'].includes(completed.state)&&completed.result){
          const text=await readPersistedResult(this.host.ctx,completed.result);guard();
          this.host.store.appendExecutionEvent(runId,'task.stage',{phase:'source-admission',expression:'main-agent'});
          this.host.store.nativeDeliveries.rendered(runId,completed.result);this.host.store.nativeDeliveries.approve(runId,text);this.host.flush();
        }else{
        let repair:DeliveryRepair|undefined;
        for(let attempt=0;attempt<NATIVE_RENDER_ATTEMPTS;attempt++){
          this.host.store.appendExecutionEvent(runId,'task.stage',{phase:'rendering',attempt,deadlineAt:new Date(Date.now()+this.host.ctx.dafeiyu.phaseTimeouts().render).toISOString()});this.host.flush();
          const rendered=await renderTaskResult(this.host.ctx,model,this.host.cwd,record.id,persona.text,persona.items,packet,signal,guard,access.requestMaxBytes,repair);guard();
          this.host.store.nativeDeliveries.candidate(runId,rendered.resultRef);this.host.flush();
          this.host.store.appendExecutionEvent(runId,'task.stage',{phase:'verification',attempt,deadlineAt:new Date(Date.now()+this.host.ctx.dafeiyu.phaseTimeouts().verification).toISOString()});this.host.flush();
          try{await provider.verify(access,packet.id,['qq','local-owner'].includes(record.anchor.target.channel)?(qqVisibleText(rendered.text)||rendered.text):rendered.text,signal,guard);}
          catch(error){const feedback=NativeVerificationFeedbackSchema.safeParse(error instanceof Error&&error.message==='delivery_unfaithful'?error.cause:null);
            if(!feedback.success)throw error;const safe=redactJson(z.json().parse(feedback.data));
            this.host.store.appendExecutionEvent(runId,'native.delivery.verification-rejected',{attempt,renderRef:rendered.resultRef,feedback:safe.value});this.host.flush();
            if(attempt+1>=NATIVE_RENDER_ATTEMPTS||safe.redacted)throw error;guard();
            repair={previousAnswer:rendered.text,issues:feedback.data.issues};this.host.store.nativeDeliveries.repair(runId);this.host.flush();continue;}
          guard();this.host.store.nativeDeliveries.rendered(runId,rendered.resultRef);this.host.store.nativeDeliveries.approve(runId,rendered.text);this.host.flush();break;
        }
        }
      }
      record=this.host.store.nativeDeliveries.get(runId)!;if(record.state!=='ready'||nativeDeliveryHash(record.material)!==nativeDeliveryHash(material)||!record.renderRef)throw new Error('SOURCE_STALE');
      const body=this.host.store.nativeDeliveries.verifyCredential(runId);if(await readPersistedResult(this.host.ctx,record.renderRef)!==body)throw new Error('DELIVERY_BODY_MISMATCH');guard();
      const reply=Object.freeze({id:`native-delivery:${record.id}`,conversation:Object.freeze({...record.anchor.target}),sourceMessageId:item.message.id,text:body,taskResult:record.anchor});
      let result:z.infer<typeof resultSchema>;
      if(packet.media){media=this.host.media();if(!media?.ready()||!media.replyDraft||!media.finalizeReply||!media.readReplyPart||!media.validateReply||!media.settleReply||channel.capability.mediaDelivery!=='parts-v1'||!channel.capability.deliverMedia)throw new Error('MEDIA_DELIVERY_NOT_CONFIGURED');
        const sendMedia=channel.capability.deliverMedia.bind(channel.capability);
        const draft=media.replyDraft(runId);if(!draft||draft.id!==packet.media.draftId||draft.version!==packet.media.draftVersion)throw new Error('MEDIA_DRAFT_AUTHORITY_MISMATCH');mediaAccess=await this.host.mediaAccess(draft.authority,reply,signal);
        const manifest=await media.finalizeReply(mediaAccess);if(!manifest)throw new Error('MEDIA_DRAFT_AUTHORITY_MISMATCH');mediaId=manifest.id;const authorized=()=>{guard();mediaAccess!.guard();if(this.host.media()!==media)throw new Error('SOURCE_STALE');media!.validateReply!(mediaAccess!,manifest.id);};authorized();
        result=await this.host.enqueue(item.route,async()=>{const sending=AbortSignal.any([signal,AbortSignal.timeout(this.host.sendTimeoutMs)]),check=()=>{sending.throwIfAborted();authorized();};check();this.host.store.nativeDeliveries.sending(runId);this.host.flush();invoked=true;
          return resultSchema.parse(await sendMedia(structuredClone({...reply,media:manifest}),sending,check,position=>{check();return media!.readReplyPart!(mediaAccess!,manifest.id,position);}));});
      }else{result=await this.host.enqueue(item.route,async()=>{
        const writeBudget=new AbortController(),sending=AbortSignal.any([signal,writeBudget.signal]),check=()=>{sending.throwIfAborted();guard();};let timer:ReturnType<typeof setTimeout>|undefined,remaining=this.host.sendTimeoutMs,active=false;
        const begin=()=>{check();if(active||remaining<=0||deadlineAt-performance.now()<remaining)throw new Error('DELIVERY_BUDGET_EXHAUSTED');
          if(!invoked){this.host.store.nativeDeliveries.sending(runId);this.host.flush();}if(deadlineAt-performance.now()<remaining)throw new Error('DELIVERY_BUDGET_EXHAUSTED');
          const started=performance.now();timer=setTimeout(()=>writeBudget.abort(new DOMException('Task result write timed out','TimeoutError')),remaining);active=true;invoked=true;let ended=false;
          return ()=>{if(ended)return;ended=true;if(timer)clearTimeout(timer);timer=undefined;remaining=Math.max(0,remaining-(performance.now()-started));active=false;};};
        this.host.store.appendExecutionEvent(runId,'native.delivery.preflight',{deferredWriteBudget:true,writeTimeoutMs:this.host.sendTimeoutMs});this.host.flush();
        try{const outcome=resultSchema.parse(await sendTaskResult(reply,record.anchor,sending,check,begin));
          if(!invoked&&outcome.status!=='not-sent'){if(this.host.store.nativeDeliveries.get(runId)?.state==='ready')this.host.store.nativeDeliveries.sending(runId);this.host.flush();invoked=true;throw new Error('DELIVERY_DISPATCH_NOT_NOTIFIED');}return outcome;
        }finally{if(timer)clearTimeout(timer);}
      });}
      if(!invoked&&result.status==='not-sent'&&this.host.store.nativeDeliveries.get(runId)?.state==='ready')this.host.store.nativeDeliveries.notSentBeforeDispatch(runId,result.code);
      else this.host.store.nativeDeliveries.finish(runId,result.status==='sent'?'sent':result.status==='not-sent'?'not-sent':result.code==='PARTIAL_DELIVERY'?'partial':'uncertain',result.status==='sent'?result.receiptId:null,result.status==='sent'?null:result.code);
    }catch(error){const record=this.host.store.nativeDeliveries.get(runId);if(record?.state==='sending')this.host.store.nativeDeliveries.finish(runId,invoked?'uncertain':'not-sent',null,code(error));
      else if(record&&!terminal.has(record.state)){if(signal.aborted)this.host.store.nativeDeliveries.interrupt(runId);else this.host.store.nativeDeliveries.reject(runId,code(error));}
    }finally{try{if(mediaAccess&&mediaId&&media?.settleReply){const state=this.host.store.nativeDeliveries.get(runId)?.state;try{media.settleReply(mediaAccess,mediaId,state==='sent'?'sent':state==='uncertain'||state==='partial'?'unknown':'blocked');}catch{this.host.store.nativeDeliveries.mediaSettlementPending(runId,mediaId);}}}
      finally{if(mediaAccess)media?.releaseReply?.(mediaAccess);mediaAccess?.release();release();this.host.flush();}}
    const status=this.host.store.nativeDeliveries.get(runId);if(notify&&status&&['rejected','interrupted','not-sent'].includes(status.state))await this.feedback(item,runId);
    return this.host.store.nativeDeliveries.status(runId);
  }
  private async feedback(item:PendingMessage,runId:string){
    if(this.host.signal.aborted||!this.host.accepting())return;
    const row=this.host.store.nativeDeliveries.get(runId),channel=this.host.channel(item);if(!row||!channel||row.error==='SOURCE_STALE')return;const sendAttempted=this.host.store.nativeDeliveries.sendAttempted(runId);
    const signal=AbortSignal.any([this.host.signal,channel.signal,AbortSignal.timeout(30000)]);
    const guard=()=>{signal.throwIfAborted();const description=this.host.describe(runId);if(!description||description.item.id!==item.id||this.host.channel(item)?.identity!==channel.identity||this.host.store.nativeDeliveries.get(runId)?.version!==row.version)throw new Error('SOURCE_STALE');};
    try{guard();const persona=this.host.persona(item,row.id,signal,guard),message=await renderPublicProgress(this.host.ctx,this.host.model(),this.host.cwd,row.id,persona.text,persona.items,
      {target:row.anchor.target,taskId:row.anchor.taskId,runId,inboundId:item.id,question:'向原会话说明本次任务的实际交付状态及当前限制。',taskState:row.state,
        evidence:[{id:'STATUS',kind:'reported',text:JSON.stringify({state:row.state,error:row.error,resultWasSent:false,sendAttempted,workPreserved:true,
          phase:sendAttempted?'transport':row.error?.startsWith('DELIVERY_VERIFICATION_')||row.error==='DELIVERY_UNFAITHFUL'?'verification':'pre-send',
          note:sendAttempted?'发送渠道确认未送达；内部工作保留。仅说明状态，不复述草稿。':'回复在发送前被拒绝或中断，未尝试发送，不能描述为已发送但回执不明。须先解决核验或准备失败并重新核验，不能建议直接重发未核验草稿。内部工作保留；仅说明状态，不复述草稿。'})}]},signal,()=>{guard();persona.guard();},32000);
      const receipt=await this.host.enqueue(item.route,async()=>{guard();persona.guard();return channel.capability.deliver({id:'native-status:'+row.id,conversation:row.anchor.target,sourceMessageId:item.message.id,text:message.text},signal,()=>{guard();persona.guard();});});
      this.host.store.appendExecutionEvent(runId,'native.delivery.feedback',{status:receipt.status});this.host.flush();
    }catch{/* The original delivery state remains authoritative; never resend its rejected body. */}
  }
}
