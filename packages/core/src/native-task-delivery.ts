import type { Context } from '@deepseek-ai/cordis';
import type { AgentOptions } from '@deepseek-ai/dsh-agent';
import { NativeExpressionPacketSchema,ContextItemSchema,conversationKey } from '@dafeiyu/contracts';
import type { NativeExpressionAccess,NativeExpressionPort,PendingMessage,TaskResultAnchor,ContextItem,ContextRequest } from '@dafeiyu/contracts';
import type { ContextCoordinator } from './context.js';
import type { RuntimeStore } from './runtime-store.js';
import type { DeliveryChannel } from './task-delivery.js';
import { nativeDeliveryHash } from './native-delivery-store.js';
import { renderTaskResult } from './target-renderer.js';
import { readPersistedResult } from './agent-session.js';
import { z } from 'zod';
interface Host {ctx:Context;store:RuntimeStore;contexts:ContextCoordinator;cwd:string;signal:AbortSignal;timeoutMs:number;
  describe(runId:string):{item:PendingMessage;anchor:TaskResultAnchor;autoDeliver:boolean|undefined}|null;
  access(runId:string):Promise<NativeExpressionAccess>;expression():NativeExpressionPort|undefined;
  persona(item:PendingMessage,id:string,signal:AbortSignal,guard:()=>void):{text:string;foundationHash:string;stamp:string;items:readonly ContextItem[];guard():void};
  model():AgentOptions;channel(item:PendingMessage):DeliveryChannel|null;accepting():boolean;flush():void;
  enqueue<T>(route:string,work:()=>Promise<T>):Promise<T>;acquire():Promise<()=>void>;
}
const codes=new Set(['SOURCE_STALE','DEPENDENCY_UNAVAILABLE','DELIVERY_BINDING_CONFLICT','DELIVERY_RENDER_ALREADY_EXISTS','DELIVERY_TOOLS_FORBIDDEN','DELIVERY_CAPACITY','MODEL_INCOMPLETE','PERSISTENCE_FAILED','DELIVERY_CREDENTIAL_INVALID','DELIVERY_BODY_MISMATCH','NATIVE_EXPRESSION_NO_PUBLIC_MATERIAL','NATIVE_EXPRESSION_UNAVAILABLE','NATIVE_EXPRESSION_CAPACITY','PRIVATE_INPUT_REJECTED','DELIVERY_UNFAITHFUL','DELIVERY_VERIFICATION_INCOMPLETE']);
const code=(error:unknown)=>error instanceof Error&&codes.has(error.message.toUpperCase())?error.message.toUpperCase():'NATIVE_DELIVERY_FAILED';
const resultSchema=z.discriminatedUnion('status',[z.object({status:z.literal('sent'),receiptId:z.string().min(1).max(256)}),z.object({status:z.literal('not-sent'),code:z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/)}),z.object({status:z.literal('unknown'),code:z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/)})]);
const terminal=new Set(['sent','not-sent','partial','uncertain','rejected','interrupted']);
/** One intent per completed native Run, a clean persona turn, verification, then anchored transport. */
export class NativeTaskDelivery {
  private readonly active=new Map<string,Promise<ReturnType<RuntimeStore['nativeDeliveries']['status']>>>();
  private readonly views=new WeakMap<ContextRequest,Map<string,{hash:string;guard:()=>void}>>();
  private readonly unregister:()=>void;
  constructor(private readonly host:Host){this.unregister=host.contexts.register('native-task-results','1',[{id:'delivered-results',kind:'evidence',prepare:request=>this.context(request),validate:(request,item)=>{
    try{host.contexts.scopeFor(request);const view=this.views.get(request)?.get(item.id);if(!view||view.hash!==nativeDeliveryHash(item))return false;view.guard();return true;}catch{return false;}}}]);}
  private async context(request:ContextRequest){const scope=this.host.contexts.scopeFor(request),views=new Map<string,{hash:string;guard:()=>void}>(),items:ContextItem[]=[];this.views.set(request,views);
    // These are program effect receipts, not inferences from the old result they may have invalidated.
    const conversationRun=this.host.store.findRequest('conversation',scope.traceId)?.runId;
    if(conversationRun)for(const operation of this.host.store.operations(conversationRun).filter(op=>op.plugin==='qq-tasks'&&op.action==='qq_task_control'&&op.outcome).slice(-8).reverse()){
      const result=operation.outcome!,data=z.object({taskId:z.uuid(),action:z.enum(['cancel','revise','resolve']),taskVersion:z.number(),intentVersion:z.number(),taskState:z.string(),runId:z.uuid()}).safeParse(result.data);
      const item=ContextItemSchema.parse({id:`task-control:${operation.id}`,version:'1',text:JSON.stringify({kind:'task-control-receipt',status:result.status,effects:result.effects,data:data.success?data.data:null,code:result.errorCode??null,note:'核心保存的本轮任务控制回执。效果未知时不得当成未执行并重复写入。'}),expiresAt:'9999-12-31T23:59:59.999Z',sources:[{ref:`dafeiyu:operation:${operation.id}`,version:'1',hash:nativeDeliveryHash(result)}]});
      views.set(item.id,{hash:nativeDeliveryHash(item),guard:()=>{this.host.contexts.scopeFor(request);if(nativeDeliveryHash(this.host.store.operation(operation.id).outcome)!==nativeDeliveryHash(result))throw new Error('SOURCE_STALE');}});items.push(item);
    }
    const rows=this.host.store.nativeDeliveries.recent(request.conversation).filter(row=>conversationKey(scope.agentId,row.anchor.target)===scope.route);
    for(const row of rows){try{const provider=this.host.expression();if(!provider?.ready()||!row.material)continue;const access=await this.host.access(row.runId);request.signal.throwIfAborted();const packet=provider.open(access,row.material.packetId,'context');
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
    const work=this.host.enqueue(description.item.route,()=>this.execute(runId,description.item)).finally(()=>this.active.delete(runId));this.active.set(runId,work);return work;
  }
  activate(){for(const runId of this.host.store.nativeDeliveryCandidates())if(this.host.describe(runId)?.autoDeliver)void this.request(runId,true).catch(()=>{});}
  async whenIdle(){while(this.active.size)await Promise.allSettled([...this.active.values()]);}
  get pending(){return this.active.size;}
  close(){this.unregister();}
  private async execute(runId:string,item:PendingMessage){const release=await this.host.acquire();let invoked=false,signal=AbortSignal.any([this.host.signal,AbortSignal.timeout(this.host.timeoutMs)]);
    try{let record=this.host.store.nativeDeliveries.get(runId)!;if(terminal.has(record.state))return this.host.store.nativeDeliveries.status(runId);
      const access=await this.host.access(runId),provider=this.host.expression(),channel=this.host.channel(item);
      if(!provider?.ready()||!channel?.capability.deliverTaskResult)throw new Error('DEPENDENCY_UNAVAILABLE');
      signal=AbortSignal.any([signal,channel.signal,...(provider.signal?[provider.signal]:[])]);
      if(nativeDeliveryHash(record.anchor)!==nativeDeliveryHash(access.anchor)||conversationKey(access.execution.view.scope.agentId,access.anchor.target)!==item.route)throw new Error('DELIVERY_BINDING_CONFLICT');
      const packet=NativeExpressionPacketSchema.parse(record.material?provider.open(access,record.material.packetId):provider.prepare(access));
      if(nativeDeliveryHash(packet.anchor)!==nativeDeliveryHash(record.anchor))throw new Error('DELIVERY_BINDING_CONFLICT');
      const guardMaterial=()=>{signal.throwIfAborted();access.guard();if(this.host.expression()!==provider||!provider.ready()||this.host.channel(item)?.identity!==channel.identity)throw new Error('DEPENDENCY_UNAVAILABLE');
        if(provider.open(access,packet.id).sourceStamp!==packet.sourceStamp||Date.parse(record.anchor.expiresAt)<=Date.now())throw new Error('SOURCE_STALE');};
      const persona=this.host.persona(item,record.id,signal,guardMaterial),model=this.host.model(),material={packetId:packet.id,sourceStamp:packet.sourceStamp,foundationHash:persona.foundationHash,personaHash:persona.stamp,modelHash:nativeDeliveryHash(model)};
      const guard=()=>{guardMaterial();persona.guard();if(nativeDeliveryHash(this.host.model())!==material.modelHash)throw new Error('SOURCE_STALE');};guard();
      if(record.state==='accepted'){
        this.host.store.nativeDeliveries.start(runId,material);this.host.flush();
        const rendered=await renderTaskResult(this.host.ctx,model,this.host.cwd,record.id,persona.text,persona.items,packet,signal,guard,access.requestMaxBytes);guard();
        this.host.store.nativeDeliveries.rendered(runId,rendered.resultRef);this.host.flush();
        await provider.verify(access,packet.id,rendered.text,signal,guard);guard();this.host.store.nativeDeliveries.approve(runId,rendered.text);this.host.flush();
      }
      record=this.host.store.nativeDeliveries.get(runId)!;if(record.state!=='ready'||nativeDeliveryHash(record.material)!==nativeDeliveryHash(material)||!record.renderRef)throw new Error('SOURCE_STALE');
      const body=this.host.store.nativeDeliveries.verifyCredential(runId);if(await readPersistedResult(this.host.ctx,record.renderRef)!==body)throw new Error('DELIVERY_BODY_MISMATCH');guard();
      this.host.store.nativeDeliveries.sending(runId);this.host.flush();guard();invoked=true;
      const result=resultSchema.parse(await channel.capability.deliverTaskResult(Object.freeze({id:`native-delivery:${record.id}`,conversation:Object.freeze({...record.anchor.target}),sourceMessageId:item.message.id,text:body}),record.anchor,signal,guard));
      this.host.store.nativeDeliveries.finish(runId,result.status==='sent'?'sent':result.status==='not-sent'?'not-sent':result.code==='PARTIAL_DELIVERY'?'partial':'uncertain',result.status==='sent'?result.receiptId:null,result.status==='sent'?null:result.code);
    }catch(error){const record=this.host.store.nativeDeliveries.get(runId);if(record?.state==='sending')this.host.store.nativeDeliveries.finish(runId,invoked?'uncertain':'not-sent',null,code(error));
      else if(record&&!terminal.has(record.state)){if(signal.aborted)this.host.store.nativeDeliveries.interrupt(runId);else this.host.store.nativeDeliveries.reject(runId,code(error));}
    }finally{release();this.host.flush();}
    return this.host.store.nativeDeliveries.status(runId);
  }
}
