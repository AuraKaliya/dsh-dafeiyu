import type { Context } from '@deepseek-ai/cordis';
import { z } from 'zod';
import { DSH_TOOL_ACTIONS,DshToolCallSchema,ResourceProofSchema } from '@dafeiyu/contracts';
import type { DshToolsPort,ActionCapabilityV3,ResourceProof,Json,Conversation } from '@dafeiyu/contracts';
import { createHash } from 'node:crypto';
import { mkdirSync,writeFileSync,readFileSync } from 'node:fs';
import { join } from 'node:path';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** A tool dispatch port, never a second planner or a command-language parser. */
export function bindDshTools(ctx:Context,agentId:string,port:DshToolsPort,receiptDirectory:string){
  mkdirSync(receiptDirectory,{recursive:true});
  const file=(id:string)=>join(receiptDirectory,z.uuid().parse(id)+'.json');
  const current=(raw:ResourceProof)=>{try{const proof=ResourceProofSchema.parse(raw),detail=z.object({operationId:z.uuid(),taskId:z.uuid(),textHash:z.string()}).parse(proof.detail),saved=z.object({proof:ResourceProofSchema,page:z.json()}).parse(JSON.parse(readFileSync(file(detail.operationId),'utf8')));
    return proof.provider==='dsh-tools'&&hash(proof)===hash(saved.proof)&&hash(saved.page)===detail.textHash;}catch{return false;}};
  const actions:ActionCapabilityV3[]=[{
    id:DSH_TOOL_ACTIONS[0],version:'1',effects:'read',requiresTask:true,
    description:'发现当前DSH基座实际可用的工具及精确参数。先查目录，再用dsh_tool_call直接调用；由你决定步骤，无额外执行器模型。唤醒统一使用dafeiyu_activity_plan，不另建DSH定时任务。',
    inputSchema:z.strictObject({}),outputSchema:z.json(),execute:async(_input,context)=>{ctx.dafeiyu.executionAuthority(context,'dsh-tools');const data=await port.catalog(context.signal);ctx.dafeiyu.executionAuthority(context,'dsh-tools');return {status:'succeeded',effects:'none',completeness:'complete',data:z.json().parse(data),sources:[],receipts:[]};},
  },{
    id:DSH_TOOL_ACTIONS[1],version:'1',effects:'external-write',requiresTask:true,
    description:'直接调用DSH已有工具，参数严格取自dsh_tool_list。需真实主人任务或既有授权活动唤醒；保留DSH执行策略和取消信号。不要用通用工具绕过QQ群助手、账号对象限制、记忆管理或单一唤醒机制；不猜测执行成功。修改自身插件由宿主在本轮结果交付、空闲后接管。',
    inputSchema:DshToolCallSchema,outputSchema:z.json(),execute:async(raw,context)=>{
      const authority=ctx.dafeiyu.authorizeExternalTask(context,'dsh-tools');authority.guard();
      const call=DshToolCallSchema.parse(raw);let result:Json;try{result=await port.execute(call,authority,context.signal);}catch(error){if(error instanceof Error&&['DSH_CATALOG_CHANGED','DSH_TOOL_ARGUMENTS_INVALID','DSH_AUTHORITY_INVALID','PRIVATE_INPUT_REJECTED','DSH_PLUGIN_CHANGE_PENDING'].includes(error.message))return {status:'failed',effects:'none',completeness:'unknown',data:null,sources:[],receipts:[],errorCode:error.message};throw error;}authority.guard();
      const failed=z.object({isError:z.literal(true)}).safeParse(result).success;
      const page:Json=JSON.stringify(result).length<=7000?result:{isError:failed,preview:JSON.stringify(result).slice(0,6000),omitted:true,note:'仅前6000字预览，未返回的部分未知；用原工具分页或读取结果文件。'};
      let data:Json=page,sources:{id:string;scopeKey:string;version:number;contentHash:string}[]=[];
      let scene:Conversation|undefined;try{scene=ctx.dafeiyu.quoteReplySource(context,'dsh-tools').target;}catch(error){if(!(error instanceof Error&&error.message==='MESSAGE_REQUIRED'))throw error;}
      if(scene){
        const detail={operationId:context.operationId,taskId:context.taskId!,textHash:hash(page)},proof:ResourceProof={provider:'dsh-tools',scene,key:'operation:'+context.operationId,version:1,hash:hash(detail),roots:['dsh-operation:'+context.operationId],detail};
        writeFileSync(file(context.operationId),JSON.stringify({proof,page}),{flag:'wx'});
        const observation=ctx.dafeiyu.recordCapabilityObservation(context,'dsh-tools',{requestId:context.operationId,proof,text:JSON.stringify(page),occurredAt:new Date().toISOString(),coverage:['DSH真实工具返回，仅供原始主人会话整理；工具报告不担保外部内容真实','未调用额外规划模型'],counts:{received:1,processed:1}});
        data=z.json().parse({page,observation});sources=[{id:observation.source.id,scopeKey:observation.source.scopeKey,version:observation.source.version,contentHash:observation.source.contentHash}];
      }
      const effect=z.object({effect:z.enum(['none','confirmed','unknown'])}).safeParse(result);
      return {status:failed?'failed':'succeeded',effects:effect.success?effect.data.effect:failed?'unknown':'confirmed',completeness:'complete',data,sources,receipts:[],...(failed?{errorCode:'DSH_TOOL_FAILED'}:{})};
    },
  }];
  return ctx.dafeiyu.registerExtensionV3({protocolVersion:3,id:'dsh-tools',version:'1',agentId,provides:['dsh.tools.v1'],requires:['execution.task.v1','memory.capability-observation.v1'],actions,resourceProofs:{current,epoch:()=>'',targetView:(proof,view,target,scope)=>{
    if(!current(proof)||hash(proof.scene)!==hash(target)||scope.kind!=='task')return null;const detail=z.object({taskId:z.string(),operationId:z.uuid()}).parse(proof.detail),saved=z.object({page:z.json()}).parse(JSON.parse(readFileSync(file(detail.operationId),'utf8')));
    return scope.taskId===detail.taskId&&view===JSON.stringify(saved.page)?{kind:'reported',stamp:hash([proof,view,target,scope])}:null;
  }}});
}
