import type { Context } from '@deepseek-ai/cordis';
import { z } from 'zod';
import { MessageTaskSubmitSchema,MessageTaskStatusSchema,MessageTaskControlSchema,ConversationSchema } from '@dafeiyu/contracts';
import type { ActionCapabilityV3,ExecutionContextV3,InboundMessage,MediaVoiceEvidence,Conversation } from '@dafeiyu/contracts';

export const QQ_TASK_ACTIONS=['qq_task_submit','qq_task_status','qq_task_control'] as const;
export const QqTasksConfigSchema=z.strictObject({enabled:z.boolean().default(false),deliverResults:z.boolean().default(true),policyId:z.string().regex(/^[a-z][a-z0-9._-]{0,79}$/).default('qq-task'),explorationResources:z.array(ConversationSchema).max(32).optional(),expressionPolicy:z.strictObject({id:z.string().regex(/^[a-zA-Z0-9._:-]{1,120}$/),version:z.number().int().positive()}).optional()});
export function qqTaskDirective(message:Pick<InboundMessage,'mainText'>,names:readonly string[]=[]):{kind:'submit'|'cancel'|'revise'|'resolve'|'none';text:string}{
  let text=message.mainText?.trim()??'';
  for(const name of [...names].sort((a,b)=>b.length-a.length)){const prefix=text.startsWith('@'+name)?'@'+name:text.startsWith(name)?name:null;if(prefix){text=text.slice(prefix.length).replace(/^[\s，,：:！!。]+/u,'');break;}}
  if(!text||/^[>“「『"'`]/u.test(text))return {kind:'none',text:''};
  const command=/^(取消任务|修改任务|确认继续任务)(?:[：:\s]+([\s\S]*))?$/u.exec(text);if(command)return {kind:command[1]==='取消任务'?'cancel':command[1]==='修改任务'?'revise':'resolve',text:(command[2]??'').trim()};
  const submit=/^(?:任务[：:\s]+|请你|请|帮我|麻烦你)([\s\S]+)$/u.exec(text);return submit?.[1]?.trim()?{kind:'submit',text:submit[1].trim()}:{kind:'none',text:''};
}
export class QqTaskCapabilities {
  private readonly handle:ReturnType<Context['dafeiyu']['registerExtensionV3']>;
  private readonly unbind:()=>void;
  private closed=false;
  constructor(private readonly ctx:Context,config:{agentId:string;botId:string;ownerId:string;policyId:string;naturalNames:readonly string[];deliverResults:boolean;voiceDirectives?:boolean;explorationResources?:readonly Conversation[];expressionPolicy?:{id:string;version:number}}){
    const current=(message:InboundMessage,evidence:MediaVoiceEvidence)=>!this.closed&&message.sender.id===config.ownerId&&message.conversation.channel==='qq'&&message.conversation.account===config.botId&&!message.mainText?.trim()
      &&evidence.origin.provider==='qq-media'&&JSON.stringify(message.conversation)===JSON.stringify(evidence.origin.scene)
      &&z.object({messageId:z.literal(message.id),sender:z.literal(config.ownerId)}).safeParse(evidence.origin.detail).success
      &&message.media?.some(m=>m.kind==='audio'&&m.source.provider===evidence.source.provider&&m.source.key===evidence.source.key)===true&&ctx.dafeiyu.mediaVoiceCurrent(evidence);
    this.handle=ctx.dafeiyu.registerExtensionV3({protocolVersion:3,id:'qq-tasks',version:'1',agentId:config.agentId,requires:['execution.message-task.v1','memory.execution.v1',...(config.voiceDirectives?['media.assets.v1']:[]),...(config.deliverResults?['memory.native-expression.v1','delivery.task-result.v1']:[])],provides:['qq.tasks.v1'],lifecycleReady:()=>!this.closed,actions:this.actions()});
    try{this.unbind=ctx.dafeiyu.bindMessageTasks({id:'qq-tasks',pluginId:'qq-tasks',channelExtensionId:'channel-qq',channel:'qq',account:config.botId,ownerId:config.ownerId,policyId:config.policyId,version:'1',autoDeliver:config.deliverResults,...(config.explorationResources?.length?{explorationResources:config.explorationResources}:{}),...(config.expressionPolicy?{expressionPolicy:config.expressionPolicy}:{}),classify:message=>qqTaskDirective(message,config.naturalNames),active:()=>!this.closed,
      ...(config.voiceDirectives?{voice:{version:'qq-record-asr-v1',current,resolve:(context:ExecutionContextV3,message:InboundMessage,id:string)=>{const result=ctx.dafeiyu.mediaVoiceEvidence(context,'qq-tasks',id);if(!current(message,result.evidence))throw new Error('VOICE_MESSAGE_MISMATCH');return result;}}}:{})});}
    catch(error){this.handle.dispose();throw error;}
  }
  private actions():ActionCapabilityV3[]{const make=(id:string,description:string,inputSchema:z.ZodType,write:boolean,work:(context:ExecutionContextV3,raw:unknown)=>unknown):ActionCapabilityV3=>({id,description,version:'1',inputSchema,outputSchema:z.json(),effects:write?'local-write':'read',
    execute:async(raw,context)=>{try{return {status:'succeeded',effects:write?'confirmed':'none',completeness:'complete',data:z.json().parse(work(context,raw)),sources:[],receipts:[]};}
      catch(error){const code=error instanceof z.ZodError?'INVALID_INPUT':error instanceof Error?error.message.toUpperCase():'';if(!['INVALID_INPUT','SCOPE_DENIED','MESSAGE_REQUIRED','TASK_DIRECTIVE_REQUIRED','IDEMPOTENCY_CONFLICT','SOURCE_STALE','CAPACITY_EXCEEDED','DEPENDENCY_UNAVAILABLE','PRIVATE_INPUT_REJECTED','VERSION_CONFLICT','TASK_VERSION_CONFLICT','RUN_NOT_QUIESCENT','OPERATION_UNCERTAIN','CONTROL_SUPERSEDED','TASK_NOT_ACTIVE','VOICE_DIRECTIVES_NOT_CONFIGURED','VOICE_MESSAGE_MISMATCH','MEDIA_VOICE_NOT_CONFIGURED','MEDIA_VOICE_INCOMPLETE','MEDIA_VOICE_INELIGIBLE','MEDIA_VOICE_SOURCE_NOT_WHOLE','MEDIA_VOICE_TRANSCRIPT_INVALID','MEDIA_SOURCE_STALE','OBSERVATION_NOT_EXPOSED'].includes(code))throw error;
        return {status:'failed',effects:'none',completeness:'unknown',data:null,sources:[],receipts:[],errorCode:code};}}});
    return [make('qq_task_submit','受理当前真实QQ消息触发的任务。explicit-task仅限主人明确指示，不传goal。文字优先；开启语音任务时可传当前record完整读取后的voiceExposureId，由程序取得转写。self-exploration填写自己的goal，不能冒充主人。受理不表示已执行或交付。',MessageTaskSubmitSchema,true,(context,input)=>this.ctx.dafeiyu.submitMessageTask(context,'qq-tasks',input)),
      make('qq_task_status','查看本会话发起任务的状态、原目标、动机和异议类别，不读取内部结果或异议私有正文。',MessageTaskStatusSchema,false,(context,input)=>this.ctx.dafeiyu.messageTaskStatus(context,'qq-tasks',input)),
      make('qq_task_control','依据主人当前真实文字或已启用的完整record语音取消、修改任务或解决异议。expectedVersion是taskVersion；voiceExposureId只能引用本条语音的已读证据。指示须明确为“取消任务：…”“修改任务：…”或“确认继续任务：…”，不接受模型改写目标。',MessageTaskControlSchema,true,(context,input)=>this.ctx.dafeiyu.controlMessageTask(context,'qq-tasks',input))];
  }
  close(){if(this.closed)return;this.closed=true;this.unbind();this.handle.dispose();}
}
