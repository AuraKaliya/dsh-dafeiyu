import {API_VERSION} from '@dafeiyu/contracts';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@dafeiyu/core';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { messageMainText,ResourceProofSchema } from '@dafeiyu/contracts';
import type { ActionCapability,Conversation,ExecutionContext,ResourceProof } from '@dafeiyu/contracts';
import { QQ_STICKER_PROVIDER,StickerMetadataSchema } from './sticker-store.js';
import type { QqStickerStore } from './sticker-store.js';

export const QQ_STICKER_ACTIONS=['qq_sticker_list','qq_sticker_collect','qq_sticker_use','qq_sticker_manage'] as const;
const requestId=z.string().regex(/^[a-zA-Z0-9._:-]{1,100}$/),digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const collectSchema=StickerMetadataSchema.extend({exposureId:z.uuid()});
const useSchema=z.strictObject({id:z.uuid().nullable(),requestId,expectedVersion:z.number().int().nonnegative()});
const listSchema=z.strictObject({query:z.string().max(100).default('')});
const catalogProof=z.strictObject({kind:z.literal('catalog'),entries:z.array(z.strictObject({id:z.uuid(),version:z.number().int().positive()})).max(40)});
interface Host {agentId:string;botId:string;ownerId:string;store:QqStickerStore;allowed(scene:Conversation):boolean}
/** Local selection/collection only. Core binds the target, final reply and delivery authority. */
export class QqStickers {
  private readonly handle:ReturnType<Context['dafeiyu']['registerExtension']>;
  private readonly unregister:()=>void;
  private closed=false;
  constructor(private readonly ctx:Context,private readonly host:Host){
    this.handle=ctx.dafeiyu.registerExtension({protocolVersion:API_VERSION,id:QQ_STICKER_PROVIDER,version:'1',agentId:host.agentId,requires:['media.assets.v1','memory.capability-observation.v1','execution.resource-scope.v1'],provides:['qq.stickers.v1'],lifecycleReady:()=>!this.closed,
      resourceProofs:{current:proof=>this.current(proof),epoch:()=>this.closed?'closed':host.store.epoch()},actions:this.actions()});
    try{this.unregister=ctx.dafeiyu.registerMediaProvider({id:QQ_STICKER_PROVIDER,describe:key=>{const description=host.store.describe(key);return description&&this.current(description.origin)?description:null;},open:async(key,range,signal)=>{
      signal.throwIfAborted();if(range)throw new Error('STICKER_RANGE_UNSUPPORTED');const {data,description}=host.store.open(key);if(!this.current(description.origin))throw new Error('STICKER_SOURCE_STALE');
      return {bytes:data.length,mime:description.mimeHint,stream:(async function*(){signal.throwIfAborted();yield data;})()};
    }});}catch(error){this.handle.dispose();throw error;}
  }
  private current(raw:ResourceProof){try{const proof=ResourceProofSchema.parse(raw);if(this.closed||proof.provider!==QQ_STICKER_PROVIDER||!this.host.allowed(proof.scene))return false;
    if(!proof.key.startsWith('catalog:'))return this.host.store.current(proof);
    const detail=catalogProof.parse(proof.detail);return proof.version===1&&proof.hash===digest(detail)&&proof.key==='catalog:'+proof.hash&&JSON.stringify(proof.roots)===JSON.stringify(detail.entries.map(row=>'qq-sticker:'+row.id))&&detail.entries.every(entry=>{const row=this.host.store.get(entry.id);return row.version===entry.version&&!row.body.deleted&&(row.body.scope==='global'||digest(row.body.scene)===digest(proof.scene));});
  }catch{return false;}}
  private target(context:ExecutionContext){this.ctx.dafeiyu.executionAuthority(context,QQ_STICKER_PROVIDER);const {target}=this.ctx.dafeiyu.quoteReplySource(context,QQ_STICKER_PROVIDER);
    if(target.channel!=='qq'||target.account!==this.host.botId||!this.host.allowed(target))throw new Error('STICKER_TARGET_DENIED');return target;}
  private list(context:ExecutionContext,raw:unknown){const target=this.target(context),input=listSchema.parse(raw),stickers=this.host.store.list(target,input.query).map(row=>({...row,...(row.enabled?{source:this.host.store.lease(row.id,target,'preview:'+digest([row.id,row.version,target])).ref}:{})}));while(stickers.length&&JSON.stringify({stickers}).length>7800)stickers.pop();if(!stickers.length)return {stickers,coverage:'本地库未找到可用候选；可自主挑选当前会话中已看过、适合作为表情的图片收录。'};
    const detail=catalogProof.parse({kind:'catalog',entries:stickers.map(row=>({id:row.id,version:row.version}))}),hash=digest(detail),text=JSON.stringify({stickers}),observation=this.ctx.dafeiyu.recordCapabilityObservation(context,QQ_STICKER_PROVIDER,{
      requestId:'catalog:'+digest([context.runId,context.operationId,hash]),proof:{provider:QQ_STICKER_PROVIDER,scene:target,key:'catalog:'+hash,hash,version:1,roots:detail.entries.map(row=>'qq-sticker:'+row.id),detail},text,occurredAt:new Date().toISOString(),coverage:['名称、标签和描述来自收录记录；发送前仍核对原字节与库版本。'],counts:{received:stickers.length,processed:stickers.length}});
    return {stickers,observation};
  }
  private async collect(context:ExecutionContext,raw:unknown){const input=collectSchema.parse(raw),access=this.ctx.dafeiyu.personaAccess(context,QQ_STICKER_PROVIDER,'local-write'),original=await this.ctx.dafeiyu.originalImage(context,QQ_STICKER_PROVIDER,input.exposureId);
    if(original.source.ref.provider!=='qq-media'||!this.host.allowed(original.source.origin.scene))throw new Error('QQ_IMAGE_SOURCE_REQUIRED');
    const detail=z.object({messageId:z.string().min(1).max(80),sender:z.string().min(1).max(80)}).parse(original.source.origin.detail);access.guard();
    return this.host.store.collect(original.source.origin.scene,detail,StickerMetadataSchema.parse({name:input.name,description:input.description,tags:input.tags}),original.data,original.mime);
  }
  private async use(context:ExecutionContext,raw:unknown){const input=useSchema.parse(raw),target=this.target(context);let parts:unknown[]=[];
    if(input.id){const source=this.host.store.lease(input.id,target,digest([context.runId,input.requestId])),asset=await this.ctx.dafeiyu.acquireMedia(context,QQ_STICKER_PROVIDER,{requestId:'sticker:'+digest([context.runId,input.requestId]),source:source.ref});
      this.host.store.bind(source.ref.key,asset);parts=[{kind:'asset',asset,as:'image'}];}
    return this.ctx.dafeiyu.prepareReplyMedia(context,QQ_STICKER_PROVIDER,{requestId:input.requestId,expectedVersion:input.expectedVersion,parts});
  }
  private manage(context:ExecutionContext){this.ctx.dafeiyu.executionAuthority(context,QQ_STICKER_PROVIDER);if(context.origin.kind!=='message')throw new Error('OWNER_COMMAND_REQUIRED');
    const item=this.ctx.dafeiyu.journal.get(context.origin.inboundId),scene=item.message.conversation;
    if(scene.channel!=='qq'||scene.account!==this.host.botId||item.message.sender.id!==this.host.ownerId||!this.host.allowed(scene)||this.ctx.dafeiyu.journal.messageRecalled({agentId:this.host.agentId,route:item.route},item.message.id))throw new Error('OWNER_COMMAND_REQUIRED');
    const text=messageMainText(item.message).trim(),listing=/^表情管理[：:]\s*列表(?:\s+([^\r\n]+))?$/u.exec(text);
    if(listing){if(scene.kind!=='private'||scene.id!==this.host.ownerId)throw new Error('OWNER_PRIVATE_REQUIRED');return {entries:this.host.store.managementList(listing[1]?.trim()),coverage:'至多200项；可在列表后附名称关键词筛选。'};}
    const match=/^表情管理[：:]\s*(通用|停用|启用|删除|改名|标签)\s+([^\r\n]+)$/u.exec(text);
    if(!match)throw new Error('OWNER_COMMAND_REQUIRED');const [,action,argument]=match,split=argument!.split(/\s*=>\s*/u);if(split.length>(['改名','标签'].includes(action!)?2:1)||(['改名','标签'].includes(action!)&&split.length!==2))throw new Error('OWNER_COMMAND_REQUIRED');
    const commands={通用:'global',停用:'disable',启用:'enable',删除:'delete',改名:'rename',标签:'tags'} as const;
    const access=this.ctx.dafeiyu.personaAccess(context,QQ_STICKER_PROVIDER,'local-write');access.guard();const row=this.host.store.manage(split[0]!.trim(),commands[action as keyof typeof commands],split[1]?.trim());return {id:row.id,version:row.version,name:row.name,scope:row.scope,enabled:row.enabled,deleted:row.deleted};
  }
  private actions():ActionCapability[]{const make=(id:string,description:string,inputSchema:z.ZodType,write:boolean,work:(context:ExecutionContext,input:unknown)=>unknown|Promise<unknown>):ActionCapability=>({id,version:'1',description,inputSchema,outputSchema:z.json(),effects:write?'local-write':'read',execute:async(input,context)=>{
    try{const data=z.json().parse(await work(context,input)),observed=z.object({observation:z.object({source:z.object({id:z.string(),scopeKey:z.string(),version:z.number(),contentHash:z.string()})})}).safeParse(data);
      return {status:'succeeded',effects:write?'confirmed':'none',completeness:'complete',data,sources:observed.success?[observed.data.observation.source]:[],receipts:[]};
    }catch(error){const code=error instanceof z.ZodError?'INVALID_INPUT':error instanceof Error&&/^[A-Z0-9_]{1,100}$/.test(error.message)?error.message:'STICKER_OPERATION_FAILED';
      if(write&&!['INVALID_INPUT','STICKER_SCOPE_DENIED','STICKER_NOT_FOUND','STICKER_SOURCE_STALE','STICKER_TARGET_DENIED','QQ_IMAGE_SOURCE_REQUIRED','OWNER_COMMAND_REQUIRED','OWNER_PRIVATE_REQUIRED','STICKER_NAME_AMBIGUOUS','STICKER_LIBRARY_FULL','STICKER_FORMAT_UNSUPPORTED','IMAGE_OBSERVATION_REQUIRED','OBSERVATION_NOT_EXPOSED','SCOPE_DENIED','RESOURCE_SCOPE_DENIED','SOURCE_STALE','MEDIA_SOURCE_STALE','MEDIA_NOT_CONFIGURED','MEDIA_DRAFT_FROZEN','HISTORY_UNTRACKED','IDEMPOTENCY_CONFLICT','VERSION_CONFLICT'].includes(code))throw new Error(code);
      return {status:'failed',effects:'none',completeness:'unknown',data:null,sources:[],receipts:[],errorCode:code};}
  }});
    return [make(QQ_STICKER_ACTIONS[0],'检索本地表情库，返回本会话可用与主人设为通用的候选；结合名称、描述、标签自主挑选，必要时用返回图片源实际读图。不需要每轮都发。',listSchema,false,(c,i)=>this.list(c,i)),
      make(QQ_STICKER_ACTIONS[1],'自主挑选已经dafeiyu_media_read(mode:image)实际看过的QQ图片收录为表情。只收适合反复表达情绪的表情图，不自动收私人照片、聊天截图、文档截图。传实际exposureId、名称、内容描述与适用场景标签。保存原图／GIF；默认仅来源会话可用，去重且长期保存。',collectSchema,true,(c,i)=>this.collect(c,i)),
      make(QQ_STICKER_ACTIONS[2],'选择一个本地表情作为本轮回复（尚未发送），可配最终文字，也可最终正文为空只发表情。id取列表；null取消。expectedVersion首次0，后续用currentVersion。只用库内原图，GIF保留动画，不拼接下载链接。文本延迟规则保持不变。',useSchema,true,(c,i)=>this.use(c,i)),
      make(QQ_STICKER_ACTIONS[3],'仅执行主人本条原文的管理命令：私聊表情管理：列表（可附名称关键词）；表情管理：通用/停用/启用/删除 名称或ID；表情管理：改名 名称或ID => 新名称；表情管理：标签 名称或ID => 标签1,标签2。不能替他决定提升通用或删除。同名不猜。',z.strictObject({}),true,c=>this.manage(c))];
  }
  close(){if(this.closed)return;this.closed=true;this.unregister();this.handle.dispose();}
}
