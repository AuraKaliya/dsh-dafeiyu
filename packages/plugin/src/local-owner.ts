import type {Context} from '@deepseek-ai/cordis';
import type {} from '@dafeiyu/core';
import type {} from '@dafeiyu/qq';
import {MessageInstructionSubmitSchema} from '@dafeiyu/contracts';
import {mkdirSync,readdirSync,readFileSync,writeFileSync,existsSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {z} from 'zod';
import type {InstallationSettings} from './settings.js';

export const LocalOwnerRequestSchema=z.strictObject({schemaVersion:z.literal(1),id:z.uuid(),issuedAt:z.iso.datetime(),botId:z.string(),ownerId:z.string(),text:z.string().trim().min(1).max(2000)});
/** Explicitly enabled, administrator-owned local ingress. It never fabricates a QQ incoming message. */
export function attachLocalOwnerControl(ctx:Context,settings:InstallationSettings,agentId:string){
  if(!settings.localOwnerControl)return ()=>{};
  const directory=join(settings.dataDir,'local-owner-control');mkdirSync(directory,{recursive:true});let closed=false;
  const handle=ctx.dafeiyu.registerExtensionV3({protocolVersion:3,id:'local-owner-tasks',version:'1',agentId,requires:['execution.message-task.v1'],provides:['channel.local-owner.v1'],lifecycleReady:()=>!closed,
    actions:[{id:'local_owner_task_submit',version:'1',description:'受理本地主人通过受控文件明确下达的当前任务。来源是本机委托，不是QQ来信；结果由人格整理核验后投递到已配置主人QQ。',inputSchema:MessageInstructionSubmitSchema,outputSchema:z.json(),effects:'local-write',
      execute:async(input,context)=>({status:'succeeded',effects:'confirmed',completeness:'complete',data:z.json().parse(ctx.dafeiyu.submitMessageTask(context,'local-owner-tasks',{...MessageInstructionSubmitSchema.parse(input),kind:'explicit-task'})),sources:[],receipts:[]})}],
    channels:[{channel:'local-owner',account:settings.qq.botId,deliveryValidation:'per-segment',description:'本机管理员代表主人提交的新指示；并非收到一条QQ消息。用local_owner_task_submit受理。回复与结果将实际发送到配置中的主人QQ，任务执行与结果核验沿用正常流程。',
      deliver:(reply,signal,authority)=>ctx.dafeiyuQQ.deliverLocalOwner(reply,signal,authority),deliverTaskResult:(reply,_anchor,signal,authority)=>ctx.dafeiyuQQ.deliverLocalOwner(reply,signal,authority)}]});
  const unbind=ctx.dafeiyu.bindMessageTasks({id:'local-owner-tasks',pluginId:'local-owner-tasks',channelExtensionId:'local-owner-tasks',channel:'local-owner',account:settings.qq.botId,ownerId:settings.qq.ownerId,policyId:'local-owner-task',version:'1',autoDeliver:true,
    active:()=>!closed,classify:message=>({kind:'submit',text:message.mainText??message.text})});
  const tick=()=>{if(closed||!ctx.dafeiyu.accepting)return;
    for(const name of readdirSync(directory).filter(name=>/^[a-f0-9-]{36}\.request\.json$/.test(name)).slice(0,100)){
      const key=name.slice(0,36),receipt=join(directory,key+'.receipt.json');if(existsSync(receipt))continue;
      try{const file=join(directory,name),stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16000)throw new Error('LOCAL_OWNER_REQUEST_INVALID');
        const value=LocalOwnerRequestSchema.parse(JSON.parse(readFileSync(file,'utf8')));
        if(value.id!==key||value.botId!==settings.qq.botId||value.ownerId!==settings.qq.ownerId)throw new Error('LOCAL_OWNER_IDENTITY_MISMATCH');
        const age=Date.now()-Date.parse(value.issuedAt);if(age< -60000||age>3600000)throw new Error('LOCAL_OWNER_REQUEST_EXPIRED');
        const accepted=handle.ingest!({id:'local-owner:'+value.id,occurredAt:value.issuedAt,conversation:{channel:'local-owner',account:settings.qq.botId,kind:'private',id:settings.qq.ownerId},sender:{id:settings.qq.ownerId,displayName:'主人（本机明确委托）'},text:value.text,mainText:value.text});
        writeFileSync(receipt,JSON.stringify({at:new Date().toISOString(),source:'local-owner-file',...accepted}),{flag:'wx'});
      }catch(error){if(existsSync(receipt))continue;writeFileSync(receipt,JSON.stringify({at:new Date().toISOString(),source:'local-owner-file',error:error instanceof Error&&/^LOCAL_OWNER_[A-Z_]+$/.test(error.message)?error.message:'LOCAL_OWNER_REQUEST_REJECTED'}),{flag:'wx'});}
    }
  };
  const timer=setInterval(tick,1500);tick();return ()=>{closed=true;clearInterval(timer);unbind();handle.dispose();};
}
