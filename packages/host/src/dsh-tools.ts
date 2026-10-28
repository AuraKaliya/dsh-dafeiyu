import {API_VERSION} from '@dafeiyu/contracts';
import type { Context } from '@deepseek-ai/cordis';
import { z } from 'zod';
import { DSH_TOOL_ACTIONS,DshToolCallSchema,DshResultReadSchema,ResourceProofSchema } from '@dafeiyu/contracts';
import type { DshToolsPort,ActionCapability,ResourceProof,Json,Conversation,ExecutionContext,ActionOutcome } from '@dafeiyu/contracts';
import { createHash } from 'node:crypto';
import { mkdirSync,writeFileSync,readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DshResultStore } from './dsh-result-store.js';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const execution=z.object({isError:z.boolean().optional(),effect:z.enum(['none','confirmed','unknown']).optional()});
const errorCode=(e:unknown)=>e instanceof Error&&/^[A-Z0-9_]{1,100}$/.test(e.message)?e.message:'DSH_RESULT_PROCESSING_FAILED';

/** DSH executes once. Result reads are separate, scoped observations of immutable sanitized material. */
export function bindDshTools(ctx:Context,agentId:string,port:DshToolsPort,receiptDirectory:string){
  mkdirSync(receiptDirectory,{recursive:true});const results=new DshResultStore(receiptDirectory);
  const file=(id:string)=>join(receiptDirectory,z.uuid().parse(id)+'.json');
  const current=(raw:ResourceProof)=>{try{const proof=ResourceProofSchema.parse(raw),detail=z.object({operationId:z.uuid(),taskId:z.uuid(),textHash:z.string()}).parse(proof.detail),saved=z.object({proof:ResourceProofSchema,page:z.json()}).parse(JSON.parse(readFileSync(file(detail.operationId),'utf8')));
    return proof.provider==='dsh-tools'&&hash(proof)===hash(saved.proof)&&hash(saved.page)===detail.textHash;}catch{return false;}};
  const scene=(context:ExecutionContext):Conversation|null=>{try{return ctx.dafeiyu.quoteReplySource(context,'dsh-tools').target;}catch(e){if(e instanceof Error&&e.message==='MESSAGE_REQUIRED')return null;throw e;}};
  const observe=(context:ExecutionContext,target:Conversation|null,page:Json,receiptId:string,effect:ActionOutcome['effects'],failed=false):ActionOutcome=>{
    let data:Json=page,sources:ActionOutcome['sources']=[];
    const processing=z.object({processing:z.object({state:z.enum(['failed','unavailable']),code:z.string()})}).safeParse(page);
    try{if(target){const detail={operationId:context.operationId,taskId:context.taskId!,textHash:hash(page)},proof:ResourceProof={provider:'dsh-tools',scene:target,key:'operation:'+context.operationId,version:1,hash:hash(detail),roots:['dsh-operation:'+receiptId],detail};
      writeFileSync(file(context.operationId),JSON.stringify({proof,page}),{flag:'wx'});
      const observation=ctx.dafeiyu.recordCapabilityObservation(context,'dsh-tools',{requestId:context.operationId,proof,text:JSON.stringify(page),occurredAt:new Date().toISOString(),coverage:['DSH真实工具返回；仅覆盖本页实际内容，子结果须通过提供的读取入口继续','工具报告不是外部事实真实性担保'],counts:{received:1,processed:processing.success?0:1}});
      data=z.json().parse({page,observation});const ref=observation.source;sources=[{id:ref.id,scopeKey:ref.scopeKey,version:ref.version,contentHash:ref.contentHash}];}
      return {status:processing.success?'partial':failed?'failed':'succeeded',effects:effect,completeness:processing.success?'unknown':'complete',data,sources,receipts:[{kind:'dsh-operation',id:receiptId}],...(processing.success?{errorCode:processing.data.processing.code}:failed?{errorCode:'DSH_TOOL_FAILED'}:{})};
    }catch(e){return {status:'partial',effects:effect,completeness:'unknown',data:{execution:{receiptId,effect,failed},processing:{state:'failed',code:errorCode(e)},resultId:receiptId},sources:[],receipts:[{kind:'dsh-operation',id:receiptId}],errorCode:errorCode(e)};}
  };
  const actions:ActionCapability[]=[{
    id:DSH_TOOL_ACTIONS[0],version:'1',effects:'read',scope:'any',
    description:'查看当前执行环境的实际能力、精确参数与可用说明。目录有版本，环境变化后重新取得当前声明。',
    inputSchema:z.strictObject({}),outputSchema:z.json(),execute:async(_input,context)=>{ctx.dafeiyu.executionAuthority(context,'dsh-tools');try{const data=await port.catalog(context.signal,context.taskId??undefined);ctx.dafeiyu.executionAuthority(context,'dsh-tools');return {status:'succeeded',effects:'none',completeness:'complete',data:z.json().parse({...data,availability:{catalog:'available',dependencies:'not-probed',execution:context.taskId?'check-task-authority':'requires-authorized-task'}}),sources:[],receipts:[]};}
      catch(error){return {status:'failed',effects:'none',completeness:'unknown',data:{stage:'catalog',dispatched:false,next:'refresh-or-wait'},sources:[],receipts:[],errorCode:errorCode(error)};}},
  },{
    id:DSH_TOOL_ACTIONS[1],version:'1',effects:'external-write',scope:'task',
    description:'按当前能力声明直接执行操作。真实任务来源和DSH策略由程序检查；返回执行事实、结果引用及可继续读取的视图。',
    inputSchema:DshToolCallSchema,outputSchema:z.json(),execute:async(raw,context)=>{
      const authority=ctx.dafeiyu.authorizeExternalTask(context,'dsh-tools');authority.guard();
      const call=DshToolCallSchema.parse(raw);let result:Json;try{result=await port.execute(call,authority,context.signal);}catch(e){if(e instanceof Error&&['DSH_CATALOG_CHANGED','DSH_TOOL_ARGUMENTS_INVALID','DSH_AUTHORITY_INVALID','PRIVATE_INPUT_REJECTED','DSH_PLUGIN_CHANGE_PENDING','DSH_SKILL_NOT_AVAILABLE'].includes(e.message))return {status:'failed',effects:'none',completeness:'unknown',data:{stage:'admission',dispatched:false,next:e.message==='DSH_CATALOG_CHANGED'?'refresh-capabilities':e.message==='DSH_TOOL_ARGUMENTS_INVALID'?'correct-arguments':'choose-alternative-or-wait'},sources:[],receipts:[],errorCode:e.message};
        if(e instanceof Error&&e.message==='DSH_BRIDGE_UNAVAILABLE')return {status:'failed',effects:'none',completeness:'unknown',data:{stage:'transport',dispatched:false,next:'wait-for-connection'},sources:[],receipts:[],errorCode:e.message};
        return {status:'unknown',effects:'unknown',completeness:'unknown',data:{stage:'execution',dispatched:null,next:'verify-before-any-retry',operationId:context.operationId},sources:[],receipts:[],errorCode:errorCode(e)};}
      const fact=execution.safeParse(result),failed=fact.success&&fact.data.isError===true,effect=fact.success?fact.data.effect??(failed?'unknown':'confirmed'):'unknown';
      const receipts=[{kind:'dsh-operation',id:context.operationId}];
      try{const target=scene(context);results.save(context.operationId,context.taskId!,target,result);authority.guard();
        return observe(context,target,results.read(context.taskId!,target,DshResultReadSchema.parse({resultId:context.operationId})),context.operationId,effect,failed);
      }catch(e){return {status:'partial',effects:effect,completeness:'unknown',data:{resultId:context.operationId,execution:{receiptId:context.operationId,effect,failed},processing:{state:'failed',code:errorCode(e)}},sources:[],receipts,errorCode:errorCode(e)};}
    },
  },{
    id:DSH_TOOL_ACTIONS[2],version:'1',effects:'read',scope:'task',
    description:'继续读取本Task的已有结果，不重新执行原工具。path与offset来自结果中的read/next入口；返回完整JSON值、明确的文字区间或子节点入口。',
    inputSchema:DshResultReadSchema,outputSchema:z.json(),execute:async(raw,context)=>{ctx.dafeiyu.executionAuthority(context,'dsh-tools');const input=DshResultReadSchema.parse(raw),target=scene(context);
      try{return observe(context,target,results.read(context.taskId!,target,input),input.resultId,'none');}catch(e){return {status:'failed',effects:'none',completeness:'unknown',data:null,sources:[],receipts:[],errorCode:errorCode(e)};}}
  }];
  const handle=ctx.dafeiyu.registerExtension({protocolVersion:API_VERSION,id:'dsh-tools',version:'1',agentId,provides:['dsh.tools.v1','dsh.results.v1'],requires:['execution.task.v1','memory.capability-observation.v1'],actions,
    resourceProofs:{current,epoch:()=>'',targetView:(proof,view,target,scope)=>{
    if(!current(proof)||hash(proof.scene)!==hash(target)||scope.kind!=='task')return null;const detail=z.object({taskId:z.string(),operationId:z.uuid()}).parse(proof.detail),saved=z.object({page:z.json()}).parse(JSON.parse(readFileSync(file(detail.operationId),'utf8')));
    return scope.taskId===detail.taskId&&view===JSON.stringify(saved.page)?{kind:'reported',stamp:hash([proof,view,target,scope])}:null;
  }}});
  try{const release=ctx.dafeiyu.bindHarnessCatalog(port);return {...handle,dispose:()=>{release();handle.dispose();}};}catch(error){handle.dispose();throw error;}
}
