import { Context } from '@deepseek-ai/cordis';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import SessionStore from '@deepseek-ai/dsh-session';
import Projection from '@deepseek-ai/dsh-session-projection';
import * as Persistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import Query from '@deepseek-ai/dsh-session-query-sqlite';
import Prompt from '@deepseek-ai/dsh-system-prompt';
import Tools from '@deepseek-ai/dsh-tools';
import LlmRuntime,{LlmAdapter,assertUsableApiKey} from '@deepseek-ai/dsh-llm';
import type { GenerateOptions,PreparedAdapterCall,StreamChunk } from '@deepseek-ai/dsh-llm';
import Credentials from '@deepseek-ai/dsh-credentials-local';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { DeepSeekAdapter,resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek';
import { getOrCreateAnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id';
import * as Core from '@dafeiyu/core';
import * as Memory from '@dafeiyu/memory';
import * as Timeline from '@dafeiyu/timeline';
import type { ExtensionV3,HostConfig } from '@dafeiyu/contracts';
import { readFileSync,existsSync } from 'node:fs';
import { join,resolve,relative,isAbsolute,sep } from 'node:path';
import { homedir } from 'node:os';
import { parseDocument } from 'yaml';
import type { EvaluationLedger } from './ledger.ts';
import { installEvaluationBilling } from './billing.ts';
import { readRealAuthorization } from './authorization.ts';
import { PERSONA_ACTIONS,EXECUTION_ACTIONS } from './runtime.ts';
import { sha256 } from './catalog.ts';

export interface ObservedRequest {purpose:string;text:string;reasoningEffort:string|null}
export function visibleRequestText(options:GenerateOptions){return JSON.stringify({system:options.system??'',messages:options.messages},(key,value:unknown)=>['replayState','reasoning_content'].includes(key)||value&&typeof value==='object'&&'type'in value&&value.type==='reasoning'?undefined:value);}
/** Only transport cancellation changes; the model input and all semantic options remain untouched. */
export class DeadlineAdapter extends LlmAdapter {
  private readonly delegate:LlmAdapter;private readonly remaining:()=>number;private readonly requestMs:number;private readonly observe:(options:GenerateOptions)=>void;
  constructor(delegate:LlmAdapter,remaining:()=>number,requestMs:number,observe:(options:GenerateOptions)=>void){super();this.delegate=delegate;this.remaining=remaining;this.requestMs=requestMs;this.observe=observe;}
  override providerInfo(provider:string){return this.delegate.providerInfo(provider);}
  override providerRetryPolicy(provider:string){return this.delegate.providerRetryPolicy(provider);}
  override resolveModel(provider:string,model:string,signal?:AbortSignal){return this.delegate.resolveModel(provider,model,signal);}
  override async prepareCall(provider:string,model:string,signal?:AbortSignal):Promise<PreparedAdapterCall>{const prepared=await this.delegate.prepareCall(provider,model,signal);return {model:prepared.model,stream:options=>this.guarded(prepared,options)};}
  override async *stream(options:GenerateOptions):AsyncIterable<StreamChunk>{const prepared=await this.prepareCall(options.provider,options.model,options.signal);yield* prepared.stream(options);}
  private async *guarded(prepared:PreparedAdapterCall,options:GenerateOptions):AsyncIterable<StreamChunk>{const remaining=this.remaining();if(remaining<=0)throw new Error('EVALUATION_TIME_EXHAUSTED');const signal=AbortSignal.any([...(options.signal?[options.signal]:[]),AbortSignal.timeout(Math.max(1,Math.floor(Math.min(this.requestMs,remaining))))]);this.observe(options);for await(const chunk of prepared.stream({...options,signal})){signal.throwIfAborted();yield chunk;}}
}

export async function openRealEvaluationRuntime(options:{repository:string;campaignRoot:string;root:string;foundationFile:string;ledger:EvaluationLedger;attemptId:string;create?:boolean;compaction?:Memory.Config['compaction'];caseDeadline?:number;extension?:(ctx:Context)=>Omit<ExtensionV3,'protocolVersion'|'agentId'>;policies?:HostConfig['authorityPolicies'];beforeActivate?:(ctx:Context)=>Promise<void>;testBackend?:LlmAdapter}){
  const {authorization:a,hash}=readRealAuthorization(options.repository);
  if(options.ledger.config.mode!=='real'||options.ledger.config.executionBounds?.authorizationHash!==hash||options.ledger.config.budget.maximumMicroCny!==a.maximumMicroCny)throw new Error('EVALUATION_REAL_AUTHORIZATION_REQUIRED');
  options.ledger.remainingExecutionMs();
  if(options.testBackend&&!process.env.DAFEIYU_TEST_RUN)throw new Error('EVALUATION_TEST_BACKEND_DENIED');
  if(!options.testBackend){const root=resolve(options.campaignRoot),home=process.env.DSH_HOME?resolve(process.env.DSH_HOME):'',delta=relative(root,home);if(!home||!delta||delta==='..'||delta.startsWith('..'+sep)||isAbsolute(delta))throw new Error('EVALUATION_ISOLATED_HOME_REQUIRED');}
  if(options.create===false&&['core/runtime.sqlite','memory/memory.sqlite'].some(file=>!existsSync(join(options.root,file))))throw new Error('EVALUATION_BASELINE_INCOMPLETE');
  const ctx=new Context(),requests:ObservedRequest[]=[],credentialFile=join(homedir(),'.dsh','.credentials.yaml');let credentialHash:string|undefined,handle:ReturnType<Core.DafeiyuService['registerExtensionV3']>|undefined;
  try{
    await ctx.plugin(LlmRuntime);await ctx.plugin(SessionStore);await ctx.plugin(Projection);await ctx.plugin(Prompt);await ctx.plugin(Tools);await ctx.plugin(AgentRegistry);await ctx.plugin(Persistence,{root:join(options.root,'sessions'),compression:'none'});await ctx.plugin(AgentLoop,{agents:[]});await ctx.plugin(Query,{path:join(options.root,'query.sqlite'),openAt:'never'});
    let backend=options.testBackend;
    if(!backend){const doc=parseDocument(readFileSync(credentialFile,'utf8'),{logLevel:'silent'});if(doc.errors.length||doc.get('version')!==1)throw new Error('EVALUATION_CREDENTIAL_SCHEMA_INVALID');credentialHash=sha256(readFileSync(credentialFile));await ctx.plugin(Credentials,{path:credentialFile,watch:false});const ref=credentialRef('DEEPSEEK_API_KEY');if(!(await ctx.credentials.describe(ref)).configured)throw new Error('EVALUATION_CREDENTIAL_MISSING');
      const connection=resolveAdapterOptions({baseURL:a.endpoint,thinking:'enabled',reasoningEffort:a.reasoningEffort,maxTokens:a.maximumOutputTokens,streamIdleTimeoutMs:a.streamIdleTimeoutMs,retryPolicy:{mode:'normal',maxRetries:0}});
      backend=new DeepSeekAdapter({options:()=>connection,providerName:'DeepSeek',admit:(_connection,model)=>{if(model!==a.model)throw new Error('EVALUATION_ROUTE_CHANGED');},resolveAuth:async()=>{if(sha256(readFileSync(credentialFile))!==credentialHash)throw new Error('EVALUATION_CREDENTIAL_CHANGED');const hit=await ctx.credentials.resolve(ref);if(!hit)throw new Error('EVALUATION_CREDENTIAL_MISSING');return {headers:{'x-api-key':assertUsableApiKey(hit.value,'evaluation',ref)}};},resolveUserId:()=>getOrCreateAnonymousUserId(),prepareExtensions:async()=>({fields:{},accept:async()=>{}})});
    }
    const remaining=()=>Math.min(options.ledger.remainingExecutionMs(),(options.caseDeadline??Number.POSITIVE_INFINITY)-Date.now());
    ctx.llm.registerAdapter([a.provider],new DeadlineAdapter(backend,remaining,a.requestTimeoutMs,request=>requests.push({purpose:request.purpose??'task',text:visibleRequestText(request),reasoningEffort:request.reasoningEffort??null})));
    installEvaluationBilling(ctx,options.ledger,{provider:a.provider,model:a.model,contextWindow:a.contextWindow,maxRequestBytes:1000000,reasoningEffort:a.reasoningEffort,maxOutputTokens:a.maximumOutputTokens},()=>options.attemptId);
    await ctx.plugin(Core,{agentId:'dafeiyu',dataDir:join(options.root,'core'),personaFile:options.foundationFile,provider:a.provider,model:a.model,reasoningEffort:a.reasoningEffort,lifecycleMode:'managed',turnTimeoutMs:240000});await ctx.plugin(Timeline,{agentId:'dafeiyu',execution:true});await ctx.plugin(Memory,{agentId:'dafeiyu',dataDir:join(options.root,'memory'),lifecycleMode:'managed',sourceTracking:true,...(options.compaction?{compaction:options.compaction}:{})});
    const extension=options.extension?.(ctx);ctx.dafeiyu.configureExecution({profileId:'evaluation-real',createStore:options.create!==false,policies:options.policies??[{id:'case',producers:['evaluation'],actions:[...(extension?.actions?.map(action=>action.id)??[]),...PERSONA_ACTIONS,...EXECUTION_ACTIONS],allowLocalWrite:true}]});if(extension)handle=ctx.dafeiyu.registerExtensionV3({protocolVersion:3,agentId:'dafeiyu',...extension});await options.beforeActivate?.(ctx);
    ctx.dafeiyuMemory.recover();ctx.dafeiyuMemory.activate();await ctx.dafeiyu.recoverExecutions();ctx.dafeiyu.recover();ctx.dafeiyu.activate();let closed=false;
    return {ctx,requests,core:ctx.dafeiyu,memory:ctx.dafeiyuMemory,port:ctx.dafeiyu.executionProducer('evaluation'),modelClass:options.testBackend?'transport-test' as const:'real' as const,close:async()=>{if(closed)return;closed=true;ctx.dafeiyu.quiesce();await ctx.dafeiyu.whenIdle();try{await ctx.dafeiyuMemory.close();await ctx.dafeiyu.close();}finally{handle?.dispose();await ctx.fiber.dispose();if(credentialHash&&sha256(readFileSync(credentialFile))!==credentialHash)throw new Error('EVALUATION_CREDENTIAL_CHANGED');}}};
  }catch(error){handle?.dispose();await ctx.fiber.dispose();throw error;}
}
export type RealEvaluationRuntime=Awaited<ReturnType<typeof openRealEvaluationRuntime>>;
