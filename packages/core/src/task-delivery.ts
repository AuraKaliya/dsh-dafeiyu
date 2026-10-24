import type { ChannelCapability,ContextItem,Conversation,PendingMessage,PersonaSnapshot,TaskExpressionProvider } from '@dafeiyu/contracts';
import { ContextItemSchema,DeliveryMaterialSchema,conversationKey } from '@dafeiyu/contracts';
import { z } from 'zod';
import type { Journal } from '@dafeiyu/journal';
import type { ContextCoordinator } from './context.js';
import type { DshRuntime } from './runtime.js';
import { DeliveryStore,deliveryDigest } from './delivery-store.js';
import type { DeliveryBinding } from './delivery-store.js';
import { CORE_VERSION } from './version.js';

export interface DeliveryChannel {identity:object;id:string;version:string;capability:ChannelCapability;signal:AbortSignal}
interface DeliveryHost {
  agentId:string;journal:Journal;contexts:ContextCoordinator;runtime:DshRuntime;signal:AbortSignal;turnTimeoutMs:number;deliveryTimeoutMs:number;
  assertOpen():void;persona():PersonaSnapshot;model():unknown;provider():TaskExpressionProvider|undefined;
  sourceTracking():boolean;
  channel(item:PendingMessage):DeliveryChannel|null;
  enqueue<T>(route:string,work:()=>Promise<T>):Promise<T>;
}
type Submit={requestId:string;jobId:string;target:Conversation};
const outcome=z.discriminatedUnion('status',[z.object({status:z.literal('sent'),receiptId:z.string().min(1).max(256)}),z.object({status:z.literal('not-sent')}),z.object({status:z.literal('unknown')})]);

/** One terminal transport attempt per intent. No uncertain or unsent intent is replayed. */
export class TaskDelivery {
  private readonly store:DeliveryStore;
  private readonly active=new Map<string,{item:ContextItem;guard:()=>void}>();
  private unregister:(()=>void)|undefined;
  constructor(file:string,private readonly host:DeliveryHost,deferRecovery=false){this.store=new DeliveryStore(file,host.agentId,host.journal,deferRecovery);}
  recover(){this.store.recover();}
  private context(){if(this.unregister)return;
    this.unregister=this.host.contexts.register('task-delivery',CORE_VERSION,[{id:'material',kind:'evidence',
      prepare:async request=>{const scope=this.host.contexts.scopeFor(request),entry=this.active.get(scope.route);if(!entry)return [];entry.guard();return [entry.item];},
      validate:(request,item)=>{try{const scope=this.host.contexts.scopeFor(request),entry=this.active.get(scope.route);if(!entry)return false;entry.guard();return JSON.stringify(ContextItemSchema.parse(entry.item))===JSON.stringify(item);}catch{return false;}}}]);
  }
  status(taskId:string,id:string){this.host.assertOpen();return this.store.status(taskId,id);}
  async submit(taskId:string,input:Submit,signal:AbortSignal,authority:()=>void){
    this.host.assertOpen();authority();const duplicate=this.store.find(taskId,input);if(duplicate)return this.store.status(taskId,duplicate.id);
    if(!this.host.sourceTracking())throw new Error('delivery_source_tracking_required');
    const provider=this.host.provider();if(!provider)throw new Error('Delivery expression provider unavailable');
    const material=DeliveryMaterialSchema.parse(provider.deliveryMaterial(this.host.agentId,taskId,input.jobId,input.target));
    const item=this.host.journal.get(material.inboundId),channel=this.host.channel(item),persona=this.host.persona();
    if(!channel||channel.capability.taskDelivery!=='simulated')throw new Error('Task delivery requires an explicitly simulated channel');
    if(this.host.journal.latestMessageId(item.route)!==material.inboundId)throw new Error('delivery_late_result');
    if(!['delivered','failed'].includes(item.state))throw new Error('delivery_question_not_settled');
    const binding:DeliveryBinding={material,route:item.route,sessionId:item.sessionId,extensionId:channel.id,extensionVersion:channel.version,personaVersion:persona.version,modelHash:deliveryDigest(this.host.model())};
    if(material.jobId!==input.jobId||conversationKey(this.host.agentId,material.target)!==item.route||conversationKey(this.host.agentId,input.target)!==item.route||input.target.channel!==channel.capability.channel||input.target.account!==channel.capability.account)throw new Error('delivery_target_mismatch');
    const record=this.store.create(taskId,input,binding);this.store.flush();
    return this.host.enqueue(item.route,()=>this.execute(record.id,taskId,item,binding,provider,channel,persona,signal,authority));
  }
  private async execute(id:string,taskId:string,item:PendingMessage,binding:DeliveryBinding,provider:TaskExpressionProvider,channel:DeliveryChannel,persona:PersonaSnapshot,signal:AbortSignal,authority:()=>void){
    let invoked=false;
    const waiting=AbortSignal.any([signal,this.host.signal,channel.signal,AbortSignal.timeout(this.host.turnTimeoutMs)]);
    const guard=()=>{this.host.assertOpen();authority();waiting.throwIfAborted();
      if(!this.host.sourceTracking())throw new Error('delivery_source_tracking_required');
      if(this.host.provider()!==provider||this.host.channel(item)?.identity!==channel.identity||this.host.persona().version!==binding.personaVersion||deliveryDigest(this.host.model())!==binding.modelHash)throw new Error('delivery_authority_changed');
      const current=this.host.journal.get(item.id);
      if(current.route!==binding.route||current.sessionId!==binding.sessionId||this.host.journal.latestMessageId(item.route)!==binding.material.inboundId)throw new Error('delivery_late_result');
      const material=DeliveryMaterialSchema.parse(provider.deliveryMaterial(this.host.agentId,taskId,binding.material.jobId,binding.material.target));
      if(deliveryDigest(material)!==deliveryDigest(binding.material))throw new Error('delivery_source_changed');
    };
    try{
      guard();if(this.store.get(id).state!=='rendering')return this.store.status(taskId,id);this.context();
      const contextItem:ContextItem={id,version:binding.material.sourceStamp,text:JSON.stringify({purpose:'仅用于当前目标会话的人格整理；尚未发送',question:binding.material.question,draft:binding.material.draft,evidence:binding.material.evidence}),
        expiresAt:binding.material.expiresAt,sources:[{ref:`dafeiyu:delivery:${id}`,version:'1',hash:binding.material.sourceStamp}]};
      this.active.set(item.route,{item:contextItem,guard});
      await this.host.runtime.run(item,persona,[],waiting,channel.capability.description,{
        id,guard,finalize:async(result,runtimeGuard)=>{
          guard();runtimeGuard();
          await provider.verifyDelivery(this.host.agentId,taskId,binding.material.jobId,binding.material.target,result.text,waiting,()=>{guard();runtimeGuard();});
          guard();runtimeGuard();this.store.ready(id,result.text,result.sources);
          guard();runtimeGuard();const body=this.store.verifyCredential(id);
          this.store.transition(id,'ready','sending');guard();runtimeGuard();
          const transportSignal=AbortSignal.any([waiting,AbortSignal.timeout(this.host.deliveryTimeoutMs)]);
          let onAbort:()=>void=()=>{};
          const aborted=new Promise<never>((_,reject)=>{onAbort=()=>reject(new Error('delivery_unknown'));transportSignal.addEventListener('abort',onAbort,{once:true});if(transportSignal.aborted)onAbort();});
          void aborted.catch(()=>{});
          let resultState:z.infer<typeof outcome>;
          try{
            transportSignal.throwIfAborted();guard();runtimeGuard();invoked=true;
            const transmission=channel.capability.deliver(Object.freeze({id:`task-delivery:${id}`,conversation:Object.freeze({...binding.material.target}),sourceMessageId:item.message.id,text:body}),transportSignal);
            resultState=outcome.parse(await Promise.race([transmission,aborted]));
          }catch{if(!invoked)throw new Error('delivery_pre_dispatch_rejected');resultState={status:'unknown'};}finally{transportSignal.removeEventListener('abort',onAbort);}
          this.store.transition(id,'sending',resultState.status==='sent'?'sent':resultState.status==='not-sent'?'not-sent':'uncertain',resultState.status==='sent'?resultState.receiptId:undefined);
        },
      });
    }catch{
      const state=this.store.get(id).state;
      if(['rendering','ready','sending'].includes(state))this.store.transition(id,state,invoked?'uncertain':'rejected');
    }finally{this.active.delete(item.route);}
    return this.store.status(taskId,id);
  }
  close(){this.unregister?.();this.store.close();}
}
