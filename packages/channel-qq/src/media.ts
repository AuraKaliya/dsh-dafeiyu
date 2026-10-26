import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';
import { ConversationSchema,MediaAttachmentSchema,ResourceProofSchema,PersonaSourceRefSchema } from '@dafeiyu/contracts';
import type { Conversation,ExecutionContextV3,MediaAttachment,ResourceProof } from '@dafeiyu/contracts';
import { QqMediaReader,QqMediaConfigSchema } from './media-reader.js';
import { QQ_MEDIA_PROVIDER } from './media-store.js';
import type { QqStore } from './store.js';
import type { OneBot } from './onebot.js';

export const QQ_MEDIA_ACTIONS=['qq_media_list'] as const;
const listSchema=z.strictObject({messageId:z.string().min(1).max(80).optional(),target:ConversationSchema.optional()});
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
interface Host {agentId:string;store:QqStore;api:OneBot;settings:z.output<typeof QqMediaConfigSchema>;allowed(scene:Conversation):boolean;available():boolean;sourceEpoch():string;rejectIdentity():void}
export class QqMedia {
  private readonly handle:ReturnType<Context['dafeiyu']['registerExtensionV3']>;
  private readonly unregister:()=>void;
  private readonly controller=new AbortController();
  constructor(private readonly ctx:Context,private readonly host:Host){
    const reader=new QqMediaReader(host.settings);this.handle=ctx.dafeiyu.registerExtensionV3({protocolVersion:3,id:QQ_MEDIA_PROVIDER,agentId:host.agentId,version:'1',requires:['media.assets.v1','execution.resource-scope.v1'],provides:['qq.media.v1'],lifecycleReady:()=>!this.controller.signal.aborted,
      resourceProofs:{current:p=>this.current(p),epoch:()=>JSON.stringify([this.controller.signal.aborted,host.store.media.epoch(),host.sourceEpoch()])},actions:[{id:QQ_MEDIA_ACTIONS[0],version:'1',description:'列出本会话实际接收消息的媒体引用，默认当前触发消息；元信息不表示已经看过。阅读和选择记忆使用dafeiyu_media_read/select。',inputSchema:listSchema,outputSchema:z.json(),effects:'read',execute:async(input,context)=>{
        try{const data=z.json().parse(this.list(context,input)),observed=z.object({observation:z.object({source:PersonaSourceRefSchema})}).safeParse(data),source=observed.success?observed.data.observation.source:null;
          return {status:'succeeded',effects:'none',completeness:'partial',data,sources:source?[{id:source.id,scopeKey:source.scopeKey,version:source.version,contentHash:source.contentHash}]:[],receipts:[]};}catch(error){return {status:'failed',effects:'none',completeness:'unknown',data:null,sources:[],receipts:[],errorCode:error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'QQ_MEDIA_UNAVAILABLE'};}}}]});
    try{this.unregister=ctx.dafeiyu.registerMediaProvider({id:QQ_MEDIA_PROVIDER,describe:key=>{try{const description=host.store.media.reference(key);return this.current(description.origin)?description:null;}catch{return null;}},open:async(key,range,signal)=>{
      const source=host.store.media.reference(key),guard=()=>{if(!this.current(source.origin))throw new Error('QQ_MEDIA_SOURCE_STALE');if(!host.available())throw new Error('CHANNEL_UNAVAILABLE');};guard();
      const api={call:host.api.call.bind(host.api),verify:async(s?:AbortSignal)=>{try{await host.api.verify(s);}catch(error){if(error instanceof Error&&error.message==='ACCOUNT_MISMATCH')host.rejectIdentity();throw error;}}};
      try{return await reader.resolve(api,source.kind,host.store.media.locator(key),range,AbortSignal.any([signal,this.controller.signal]),guard);}
      catch(error){if(error instanceof Error&&error.message==='ACCOUNT_MISMATCH')host.rejectIdentity();throw error;}
    }});}catch(error){this.handle.dispose();throw error;}
  }
  private current(proof:ResourceProof){if(this.controller.signal.aborted||proof.provider!==QQ_MEDIA_PROVIDER||!this.host.allowed(proof.scene))return false;
    if(proof.key.startsWith('list:')){const detail=z.strictObject({kind:z.literal('media-list'),messageId:z.string().max(80),parts:z.array(ResourceProofSchema).max(8)}).safeParse(proof.detail);
      if(!detail.success||proof.version!==1||proof.key!=='list:'+digest(proof.detail)||proof.hash!==digest(proof.detail)||digest(proof.roots)!==digest([`qq:${proof.scene.account}:${proof.scene.kind}:${proof.scene.id}:message:${detail.data.messageId}`]))return false;
      return digest(this.host.store.media.list(proof.scene,detail.data.messageId).map(d=>d.origin))===digest(detail.data.parts)&&detail.data.parts.every(p=>this.host.store.media.current(p));}
    return this.host.store.media.current(proof);}
  remember(scene:Conversation,messageId:string,sender:string,envelope:unknown,parts:readonly {type:string;data:Record<string,unknown>}[],positionOffset=0):{attachments:MediaAttachment[];positions:Set<number>}{
    if(!this.host.allowed(scene)||!this.host.available())throw new Error('TARGET_NOT_ALLOWED');const ids=this.host.store.media.remember(scene,messageId,sender,createHash('sha256').update(JSON.stringify(envelope)).digest('hex'),parts,positionOffset),descriptions=ids.map(id=>this.host.store.media.describe(id));this.host.store.media.prune();
    return {attachments:descriptions.map(d=>MediaAttachmentSchema.parse({schemaVersion:1,source:d.ref,kind:d.kind,name:d.name})),positions:new Set(descriptions.map(d=>z.object({position:z.number()}).parse(d.origin.detail).position))};
  }
  private list(context:ExecutionContextV3,raw:unknown){this.ctx.dafeiyu.executionAuthority(context,QQ_MEDIA_PROVIDER);const input=listSchema.parse(raw);
    const inbound=context.origin.kind==='message'?this.ctx.dafeiyu.journal.get(context.origin.inboundId):null;
    const target=input.target??inbound?.message.conversation;if(!target)throw new Error('RESOURCE_TARGET_REQUIRED');this.ctx.dafeiyu.authorizeCapabilityResource(context,QQ_MEDIA_PROVIDER,target);
    if(!this.host.allowed(target)||this.controller.signal.aborted)throw new Error('TARGET_NOT_ALLOWED');const messageId=input.messageId??inbound?.message.id;if(!messageId)throw new Error('MESSAGE_REQUIRED');
    const data={target,messageId,media:this.host.store.media.list(target,messageId),coverage:'仅实际收到的至多8个媒体段；未取得内容，不包含离线历史'};
    if(!data.media.length)return data;const detail={kind:'media-list',messageId,parts:data.media.map(d=>d.origin)},hash=digest(detail);
    const observation=this.ctx.dafeiyu.recordCapabilityObservation(context,QQ_MEDIA_PROVIDER,{requestId:'list:'+digest([context.runId,context.operationId,hash]),proof:{provider:QQ_MEDIA_PROVIDER,scene:target,key:'list:'+hash,version:1,hash,roots:[`qq:${target.account}:${target.kind}:${target.id}:message:${messageId}`],detail},
      text:JSON.stringify(data),occurredAt:new Date().toISOString(),coverage:['只曝光媒体元信息，未处理任何媒体正文'],counts:{received:data.media.length,processed:0}});
    return {...data,observation};
  }
  close(){if(this.controller.signal.aborted)return;this.controller.abort();this.unregister();this.handle.dispose();}
}
