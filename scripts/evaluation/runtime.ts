import { Context } from '@deepseek-ai/cordis';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import SessionStore from '@deepseek-ai/dsh-session';
import Projection from '@deepseek-ai/dsh-session-projection';
import * as Persistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import Query from '@deepseek-ai/dsh-session-query-sqlite';
import Prompt from '@deepseek-ai/dsh-system-prompt';
import Tools from '@deepseek-ai/dsh-tools';
import LlmRuntime,{LlmAdapter,ToolCallId} from '@deepseek-ai/dsh-llm';
import type { GenerateOptions,LlmResolvedModelInfo,StreamChunk } from '@deepseek-ai/dsh-llm';
import * as Core from '@dafeiyu/core';
import * as Memory from '@dafeiyu/memory';
import * as Timeline from '@dafeiyu/timeline';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { ExtensionV3,HostConfig } from '@dafeiyu/contracts';
import type { EvaluationLedger } from './ledger.ts';
import { installEvaluationBilling } from './billing.ts';
export const evaluationText=(text:string):StreamChunk[]=>[{type:'block-start',index:0,blockType:'text'},{type:'text-delta',index:0,text},{type:'block-end',index:0,block:{type:'text',text}},{type:'finish',reason:{kind:'stop'}}];
export function evaluationCall(name:string,args:object):StreamChunk[]{const id=ToolCallId('evaluation-'+randomUUID());return [{type:'block-start',index:0,blockType:'tool-call'},{type:'tool-call-delta',index:0,id,name,argumentsDelta:JSON.stringify(args)},{type:'block-end',index:0,block:{type:'tool-call',id,name,arguments:JSON.stringify(args)}},{type:'finish',reason:{kind:'tool-calls'}}];}
export const PERSONA_ACTIONS=['dafeiyu_persona_status','dafeiyu_persona_propose','dafeiyu_persona_review','dafeiyu_persona_trial_select','dafeiyu_persona_adoption_review','dafeiyu_persona_publish','dafeiyu_persona_select','dafeiyu_persona_withdraw'];
export const EXECUTION_ACTIONS=['dafeiyu_execution_source_open','dafeiyu_execution_contribute','dafeiyu_execution_select','dafeiyu_execution_source_state','dafeiyu_task_object','dafeiyu_task_intent'];
export type EvaluationResponse=(options:GenerateOptions)=>StreamChunk[]|Promise<StreamChunk[]>;
export const PRIVATE_STREAM_SENTINEL='EVALUATION_SYNTHETIC_REASONING_MUST_NOT_PERSIST';
/** A test backend with no credentials or network. Token numbers below are synthetic counters, not a real bill. */
export class EvaluationScriptedAdapter extends LlmAdapter {
  response:EvaluationResponse;readonly requests:GenerateOptions[]=[];
  constructor(response:EvaluationResponse){super();this.response=response;}
  override async resolveModel(provider:string,id:string):Promise<LlmResolvedModelInfo>{return {provider,id,name:id,context:{contextWindow:65536},defaultMaxTokens:8192,systemPromptUpdate:'in-history',toolUpdate:'in-history'};}
  override async *stream(options:GenerateOptions):AsyncIterable<StreamChunk>{options.signal?.throwIfAborted();this.requests.push(options);
    const chunks=String(options.sessionId).startsWith('dafeiyu-assessment-')?evaluationText(JSON.stringify({goalStatus:'uncertain',summary:'离线传输测试的固定阶段评价，仅验证程序流程。',evidenceIds:[],limitations:['未作真实模型语义验收'],unfinished:[],next:'deliver'})):await this.response(options);
    yield {type:'block-start',index:100,blockType:'reasoning'};yield {type:'reasoning-delta',index:100,text:PRIVATE_STREAM_SENTINEL};yield {type:'block-end',index:100,block:{type:'reasoning',text:PRIVATE_STREAM_SENTINEL}};
    for(const chunk of chunks){options.signal?.throwIfAborted();if(chunk.type==='finish'){yield {type:'usage',usage:{inputTokens:Math.ceil(Buffer.byteLength(JSON.stringify(options.messages))/4),outputTokens:Math.ceil(Buffer.byteLength(JSON.stringify(chunks))/4)}};yield {...chunk,replayState:{response:PRIVATE_STREAM_SENTINEL}};}else yield chunk;}}
}
export async function openEvaluationRuntime(options:{root:string;foundationFile:string;ledger:EvaluationLedger;attemptId:string;response:EvaluationResponse;create?:boolean;compaction?:Memory.Config['compaction'];
  extension?:(ctx:Context)=>Omit<ExtensionV3,'protocolVersion'|'agentId'>;policies?:HostConfig['authorityPolicies'];beforeActivate?:(ctx:Context)=>Promise<void>}){
  if(options.ledger.config.mode!=='offline')throw new Error('EVALUATION_OFFLINE_RUNTIME_ONLY');if(options.create===false&&['core/runtime.sqlite','memory/memory.sqlite'].some(file=>!existsSync(join(options.root,file))))throw new Error('EVALUATION_BASELINE_INCOMPLETE');
  const ctx=new Context(),adapter=new EvaluationScriptedAdapter(options.response);let handle:ReturnType<Core.DafeiyuService['registerExtensionV3']>|undefined;
  try{await ctx.plugin(LlmRuntime);await ctx.plugin(SessionStore);await ctx.plugin(Projection);await ctx.plugin(Prompt);await ctx.plugin(Tools);await ctx.plugin(AgentRegistry);await ctx.plugin(Persistence,{root:join(options.root,'sessions'),compression:'none'});await ctx.plugin(AgentLoop,{agents:[]});await ctx.plugin(Query,{path:join(options.root,'query.sqlite'),openAt:'never'});ctx.llm.registerAdapter(['local-test'],adapter);
    installEvaluationBilling(ctx,options.ledger,{provider:'local-test',model:'scripted',contextWindow:65536,maxRequestBytes:1000000},()=>options.attemptId);
    await ctx.plugin(Core,{agentId:'dafeiyu',dataDir:join(options.root,'core'),personaFile:options.foundationFile,provider:'local-test',model:'scripted',lifecycleMode:'managed',turnTimeoutMs:30000});await ctx.plugin(Timeline,{agentId:'dafeiyu',execution:true});await ctx.plugin(Memory,{agentId:'dafeiyu',dataDir:join(options.root,'memory'),lifecycleMode:'managed',sourceTracking:true,...(options.compaction?{compaction:options.compaction}:{})});
    const extension=options.extension?.(ctx);ctx.dafeiyu.configureExecution({profileId:'evaluation',createStore:options.create!==false,policies:options.policies??[{id:'case',producers:['evaluation'],actions:[...(extension?.actions?.map(a=>a.id)??[]),...PERSONA_ACTIONS,...EXECUTION_ACTIONS],allowLocalWrite:true}]});if(extension)handle=ctx.dafeiyu.registerExtensionV3({protocolVersion:3,agentId:'dafeiyu',...extension});await options.beforeActivate?.(ctx);
    ctx.dafeiyuMemory.recover();ctx.dafeiyuMemory.activate();await ctx.dafeiyu.recoverExecutions();ctx.dafeiyu.recover();ctx.dafeiyu.activate();let closed=false;
    return {ctx,adapter,core:ctx.dafeiyu,memory:ctx.dafeiyuMemory,port:ctx.dafeiyu.executionProducer('evaluation'),close:async()=>{if(closed)return;closed=true;ctx.dafeiyu.quiesce();await ctx.dafeiyu.whenIdle();try{await ctx.dafeiyuMemory.close();await ctx.dafeiyu.close();}finally{handle?.dispose();await ctx.fiber.dispose();}}};
  }catch(e){handle?.dispose();await ctx.fiber.dispose();throw e;}
}
export type EvaluationRuntime=Awaited<ReturnType<typeof openEvaluationRuntime>>;
