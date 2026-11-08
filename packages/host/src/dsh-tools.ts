import {API_VERSION} from '@dafeiyu/contracts';
import type { Context } from '@deepseek-ai/cordis';
import { z } from 'zod';
import { DSH_TOOL_ACTIONS,DshToolCallSchema,DshResultReadSchema,DshResultReadBatchSchema,ResourceProofSchema } from '@dafeiyu/contracts';
import type { DshToolsPort,ActionCapability,ResourceProof,Json,Conversation,ExecutionContext,ActionOutcome } from '@dafeiyu/contracts';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DshResultStore } from './dsh-result-store.js';
import {DshCatalogQuerySchema,catalogView} from './dsh-catalog-view.js';
import {VerifiedJsonCache,publishJson} from './verified-json-cache.js';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const execution=z.object({isError:z.boolean().optional(),effect:z.enum(['none','confirmed','unknown']).optional()});
const detailSchema=z.object({operationId:z.uuid(),taskId:z.uuid(),textHash:z.string()});
const savedProofSchema=z.object({proof:ResourceProofSchema,page:z.json()});
const batchSchema=z.object({kind:z.literal('archived-result-batch'),items:z.array(z.object({status:z.string(),page:z.unknown().optional()}))});
const resultIdSchema=z.object({resultId:z.uuid()});
const errorCode=(e:unknown)=>e instanceof Error&&/^[A-Z0-9_]{1,100}$/.test(e.message)?e.message:'DSH_RESULT_PROCESSING_FAILED';

/** DSH executes once. Result reads are separate, scoped observations of immutable sanitized material. */
export function bindDshTools(ctx:Context,agentId:string,port:DshToolsPort,receiptDirectory:string){
  mkdirSync(receiptDirectory,{recursive:true});const results=new DshResultStore(receiptDirectory);
  const proofs=new VerifiedJsonCache(raw=>{const saved=savedProofSchema.parse(raw),batch=batchSchema.safeParse(saved.page),pages=batch.success?batch.data.items.filter(item=>item.status==='ok').map(item=>item.page):[saved.page];
    return {...saved,proofHash:hash(saved.proof),pageHash:hash(saved.page),resultIds:pages.map(page=>resultIdSchema.parse(page).resultId)};});
  const file=(id:string)=>join(receiptDirectory,z.uuid().parse(id)+'.json');
  const current=(raw:ResourceProof)=>{try{const proof=ResourceProofSchema.parse(raw),detail=detailSchema.parse(proof.detail),saved=proofs.get(file(detail.operationId));
    return proof.provider==='dsh-tools'&&hash(proof)===saved.proofHash&&saved.pageHash===detail.textHash
      &&saved.resultIds.every(id=>results.available(detail.taskId,proof.scene,id));}catch{return false;}};
  const scene=(context:ExecutionContext):Conversation|null=>{try{return ctx.dafeiyu.quoteReplySource(context,'dsh-tools').target;}catch(e){if(e instanceof Error&&e.message==='MESSAGE_REQUIRED')return null;throw e;}};
  const observe=(context:ExecutionContext,target:Conversation|null,page:Json,receiptId:string,effect:ActionOutcome['effects'],failed=false):ActionOutcome=>{
    let data:Json=page,sources:ActionOutcome['sources']=[];
    const processing=z.object({processing:z.object({state:z.enum(['failed','unavailable']),code:z.string()})}).safeParse(page);
    try{if(target){const detail={operationId:context.operationId,taskId:context.taskId!,textHash:hash(page)},proof:ResourceProof={provider:'dsh-tools',scene:target,key:'operation:'+context.operationId,version:1,hash:hash(detail),roots:['dsh-operation:'+receiptId],detail};
      publishJson(file(context.operationId),{proof,page});
      const observation=ctx.dafeiyu.recordCapabilityObservation(context,'dsh-tools',{requestId:context.operationId,proof,text:JSON.stringify(page),occurredAt:new Date().toISOString(),coverage:['DSH真实工具返回；仅覆盖本页实际内容，子结果须通过提供的读取入口继续','工具报告不是外部事实真实性担保'],counts:{received:1,processed:processing.success?0:1}});
      data=z.json().parse({page,observation});const ref=observation.source;sources=[{id:ref.id,scopeKey:ref.scopeKey,version:ref.version,contentHash:ref.contentHash}];}
      return {status:processing.success?'partial':failed?'failed':'succeeded',effects:effect,completeness:processing.success?'unknown':'complete',data,sources,receipts:[{kind:'dsh-operation',id:receiptId}],...(processing.success?{errorCode:processing.data.processing.code}:failed?{errorCode:'DSH_TOOL_FAILED'}:{})};
    }catch(e){return {status:'partial',effects:effect,completeness:'unknown',data:{execution:{receiptId,effect,failed},processing:{state:'failed',code:errorCode(e)},resultId:receiptId},sources:[],receipts:[{kind:'dsh-operation',id:receiptId}],errorCode:errorCode(e)};}
  };
  const actions:ActionCapability[]=[{
    id:DSH_TOOL_ACTIONS[3],version:'1',effects:'read',scope:'task',
    description:'在当前任务中执行宿主明确允许的只读工具。先查目录参数，用 glob/grep 等定位相关文件与范围，再按宿主实际参数读取必要正文和版本；已有归档优先 dsh_result_read 或 dsh_result_read_batch 回查。目录、路径和字段名不是正文证据。不能执行 shell、写文件或安装插件。',
    inputSchema:DshToolCallSchema,outputSchema:z.json(),execute:async(raw,context)=>{
      ctx.dafeiyu.executionAuthority(context,'dsh-tools');
      if(!port.read)return {status:'failed',effects:'none',completeness:'unknown',data:{dispatched:false},sources:[],receipts:[],errorCode:'DSH_READ_UNAVAILABLE'};
      try{const result=await port.read(DshToolCallSchema.parse(raw),{agentId,taskId:context.taskId!,runId:context.runId,operationId:context.operationId,intentVersion:context.intentVersion},context.signal);
        ctx.dafeiyu.executionAuthority(context,'dsh-tools');const target=scene(context);results.save(context.operationId,context.taskId!,target,result);
        return observe(context,target,results.read(context.taskId!,target,DshResultReadSchema.parse({resultId:context.operationId})),context.operationId,'none',execution.safeParse(result).data?.isError===true);
      }catch(error){return {status:'failed',effects:'none',completeness:'unknown',data:{stage:'read',next:'inspect-error-before-retry'},sources:[],receipts:[],errorCode:errorCode(error)};}
    },
  },{
    id:DSH_TOOL_ACTIONS[0],version:'1',effects:'read',scope:'any',
    description:'只查询DSH实际工具目录，不执行检查。用户只是询问有哪些工具时可直接回答目录；用户要求检查消息、日志、源码或修复时，应先通过当前任务入口受理，再在任务内用文件读取/搜索工具取得实际证据，不能列完目录就结束。query筛选、name查看参数、按next续页；没有专用QQ工具不等于不能检查本地插件。认证主人可见当前实例的检查路径，路径本身不代表已读。',
    inputSchema:DshCatalogQuerySchema,outputSchema:z.json(),execute:async(input,context)=>{ctx.dafeiyu.executionAuthority(context,'dsh-tools');try{
      const catalog=await port.catalog(context.signal,context.taskId??undefined),owner=ctx.dafeiyu.isOwnerExecution?.(context,'dsh-tools')??false,{environment:_environment,...publicCatalog}=catalog;
      const data=catalogView(owner?catalog:publicCatalog,DshCatalogQuerySchema.parse(input));ctx.dafeiyu.executionAuthority(context,'dsh-tools');
      const entry=context.origin.kind==='message'&&context.origin.conversation.channel==='qq'?'qq_task_submit':context.origin.kind==='message'&&context.origin.conversation.channel==='local-owner'?'local_owner_task_submit':null;
      return {status:'succeeded',effects:'none',completeness:'partial',data:z.json().parse({...z.record(z.string(),z.json()).parse(data),availability:{catalog:'available',dependencies:'not-probed',execution:context.taskId?'check-task-authority':'requires-authorized-task'},
        handoff:{requiredForActualInspection:context.taskId===null,entry,ownerAuthorized:owner,source:'current-authenticated-message',note:'只列目录不能履行检查请求。受理后用本任务已经取得的QQ原文、@字段和发送回执作为消息证据；用DSH文件读取/搜索核对当前实例状态与相关源码即可，不必重复转储数据库。脚本输出乱码不能推翻已有的有效QQ证据。没有专用QQ宿主工具不等于无法检查。'}}),sources:[],receipts:[]};}
      catch(error){return {status:'failed',effects:'none',completeness:'unknown',data:{stage:'catalog',dispatched:false,next:'refresh-or-wait'},sources:[],receipts:[],errorCode:errorCode(error)};}},
  },{
    id:DSH_TOOL_ACTIONS[1],version:'1',effects:'external-write',scope:'task',
    description:'按当前能力声明执行操作；检查文件和源码优先用读取、搜索工具。真实任务来源和DSH策略由程序检查。成功回执只表示工具已返回，命令还需核对exitCode、timedOut和stderr；非零退出不能证明检查成功，不原样重复失败脚本。用dsh_result_read续读已有结果。',
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
    description:'继续读取本Task的已有结果，不重新执行原工具。path与offset来自read/next/unread入口；路径、字段名和数组大小不是正文。coverage.complete=false时必须读取与问题有关的子节点后才能说已检查内容；大文件按页读，不必重新执行读取命令。',
    inputSchema:DshResultReadSchema,outputSchema:z.json(),execute:async(raw,context)=>{ctx.dafeiyu.executionAuthority(context,'dsh-tools');const input=DshResultReadSchema.parse(raw),target=scene(context);
      try{return observe(context,target,results.read(context.taskId!,target,input),input.resultId,'none');}catch(e){return {status:'failed',effects:'none',completeness:'unknown',data:null,sources:[],receipts:[],errorCode:errorCode(e)};}}
  },{
    id:DSH_TOOL_ACTIONS[4],version:'1',effects:'read',scope:'task',inputSchema:DshResultReadBatchSchema,outputSchema:z.json(),
    description:'一次回查本Task最多8个相关归档页（各页limit之和最多12000），可组合不同结果或同结果的字段/范围，不重新执行宿主工具。沿先前read/next/unread入口提供参数；每页错误、原执行回执和coverage分别保留，complete只说明这些回查是否成功，不表示全文读完。',
    execute:async(raw,context)=>{
      const guard=()=>{context.signal.throwIfAborted();ctx.dafeiyu.executionAuthority(context,'dsh-tools');};guard();const target=scene(context);
      try{const page=results.readBatch(context.taskId!,target,DshResultReadBatchSchema.parse(raw),guard),outcome=observe(context,target,page,context.operationId,'none');
        const complete=z.object({complete:z.boolean()}).parse(page).complete;return complete?outcome:{...outcome,status:'partial',completeness:'partial',errorCode:'DSH_RESULT_BATCH_PARTIAL'};
      }catch(error){return {status:'failed',effects:'none',completeness:'unknown',data:null,sources:[],receipts:[],errorCode:errorCode(error)};}
    }
  }];
  const handle=ctx.dafeiyu.registerExtension({protocolVersion:API_VERSION,id:'dsh-tools',version:'1',agentId,provides:['dsh.tools.v1','dsh.results.v1'],requires:['execution.task.v1','memory.capability-observation.v1'],actions,
    resourceProofs:{current,epoch:()=>'',targetView:(proof,view,target,scope)=>{
    if(!current(proof)||hash(proof.scene)!==hash(target)||scope.kind!=='task')return null;const detail=detailSchema.parse(proof.detail),saved=proofs.get(file(detail.operationId));
    return scope.taskId===detail.taskId&&view===JSON.stringify(saved.page)?{kind:'reported',stamp:hash([proof,view,target,scope])}:null;
  }}});
  try{const release=ctx.dafeiyu.bindHarnessCatalog(port);return {...handle,dispose:()=>{release();handle.dispose();}};}catch(error){handle.dispose();throw error;}
}
