import { Context } from '@deepseek-ai/cordis';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import SessionStore from '@deepseek-ai/dsh-session';
import Projection from '@deepseek-ai/dsh-session-projection';
import * as Persistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import Query from '@deepseek-ai/dsh-session-query-sqlite';
import Prompt from '@deepseek-ai/dsh-system-prompt';
import Tools from '@deepseek-ai/dsh-tools';
import LlmRuntime,{LlmAdapter,ReasoningEffortId} from '@deepseek-ai/dsh-llm';
import type { GenerateOptions,StreamChunk,LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm';
import Credentials from '@deepseek-ai/dsh-credentials-local';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import * as DeepSeek from '@deepseek-ai/dsh-llm-deepseek-api-key';
import * as Core from '@dafeiyu/core';
import * as Memory from '@dafeiyu/memory';
import * as Timeline from '@dafeiyu/timeline';
import * as QQ from '@dafeiyu/channel-qq';
import * as Simulator from '@dafeiyu/channel-simulator';
import { ExecutionRequestSchema } from '@dafeiyu/contracts';
import { readFileSync,existsSync,writeFileSync,renameSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { parseDocument } from 'yaml';
import { z } from 'zod';
import { loadHostConfig,assertPaths,pluginConfig } from './configuration.js';
import type { PreparedHostConfig } from './configuration.js';
import { inspectHost,bindMigratedProfile,packageVersion } from './profile.js';
import { claim } from './coordination.js';
import type { HostLease } from './coordination.js';

const importedHome=process.env.DSH_HOME;
export type HostPhase='created'|'inspected'|'opening'|'binding'|'recovering'|'ready'|'degraded'|'draining'|'failed'|'stopped';
export interface HostRuntimeOptions {
  readonly mode?:'daemon'|'single-run';readonly coordination?:string;
  readonly signal?:AbortSignal;
  /** Program-only test seam, forbidden for formal or real-provider profiles. */
  readonly adapter?:LlmAdapter;
  readonly onPhase?:(phase:HostPhase,host:ManagedHost)=>void;
  readonly onModelCall?:(call:{provider:string;model:string;purpose:string;status:'started'|'completed'|'failed'})=>void;
}
export interface PluginHealth {id:string;required:boolean;state:'configured'|'starting'|'ready'|'degraded'|'disabled'|'not-configured'|'failed'|'stopped';version:string|null;code:string|null}
export interface HostSnapshot {schemaVersion:1;profileId:string;agentId:string;instanceId:string;pid:number;at:string;configHash:string;foundationHash:string;
  phase:HostPhase;mode:'daemon'|'single-run';accepting:boolean;error:string|null;plugins:PluginHealth[];features:string[];
  services:{memory:ReturnType<Memory.MemoryService['runtimeHealth']>|null;qq:{state:string;groupSync:string;groupError:string|null;effectiveGroups:number;lastGroupSync:string|null;capabilities:boolean;delivery:{plans:number;pending:number;unknown:number}}|null};
  counts:{activeRuns:number;queuedRuns:number;queuedRoutes:number;pendingMessages:number;outbox:number};schemas:{journal:2;memory:9;runtime:2};}
export interface HostRunResult {taskId:string;runId:string;state:string;error:string|null;result:string|null}
class FixedModel extends LlmAdapter {
  constructor(private readonly response:string){super();}
  override async resolveModel(provider:string,model:string):Promise<LlmResolvedModelInfo>{return {provider,id:model,name:model,systemPromptUpdate:'in-history',toolUpdate:'in-history',reasoning:{efforts:[{id:ReasoningEffortId('max'),name:'Max'}]}};}
  override async *stream(options:GenerateOptions):AsyncIterable<StreamChunk>{options.signal?.throwIfAborted();yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text:this.response};yield {type:'block-end',index:0,block:{type:'text',text:this.response}};yield {type:'finish',reason:{kind:'stop'}};}
}
const stableCode=(error:unknown,fallback='HOST_FAILED')=>error instanceof Error&&/^[A-Z][A-Z0-9_]{0,99}$/.test(error.message)?error.message:fallback;
const hashFile=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
const delay=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));

/** One local profile, one DSH owner. CLI bootstrap binds DSH_HOME before loading this module. */
export class ManagedHost {
  readonly ctx=new Context();
  readonly config:PreparedHostConfig;
  readonly mode:'daemon'|'single-run';
  private phase:HostPhase='created';private error:string|null=null;private lease:HostLease|undefined;
  private instanceId='00000000-0000-4000-8000-000000000000';
  private timer:ReturnType<typeof setInterval>|undefined;private closing:Promise<void>|undefined;
  private coreValue:Core.DafeiyuService|undefined;private memoryValue:Memory.MemoryService|undefined;private qqValue:QQ.QqChannel|undefined;
  private credentials:{file:string;hash:string}|undefined;
  private health:PluginHealth[];
  private readonly jobs=new Set<Promise<HostRunResult>>();
  private finishClose!:()=>void;
  private readonly finished=new Promise<void>(resolve=>{this.finishClose=resolve;});
  private constructor(config:PreparedHostConfig,private readonly options:HostRuntimeOptions){this.config=config;this.mode=options.mode??'daemon';
    this.health=config.plugins.map(p=>({id:p.id,required:p.required,state:p.enabled?'configured':'disabled',version:packageVersion(p.id),code:null}));
    for(const id of ['activity','media','bilibili'])this.health.push({id,required:false,state:'not-configured',version:null,code:null});}
  get core(){if(!this.coreValue)throw new Error('HOST_NOT_OPEN');return this.coreValue;}
  static async start(config:PreparedHostConfig,options:HostRuntimeOptions={}):Promise<ManagedHost>{
    const expected=resolve(config.paths.core,'dsh-home');if(!importedHome||resolve(importedHome)!==expected||!process.env.DSH_HOME||resolve(process.env.DSH_HOME)!==expected)throw new Error('HOST_DSH_HOME_NOT_BOUND_BEFORE_IMPORT');
    if(options.adapter&&(config.config.persona.kind!=='test'||!pluginConfig(config,'model-scripted')))throw new Error('HOST_TEST_ADAPTER_FORBIDDEN');
    const host=new ManagedHost(config,options);try{await host.open();return host;}catch(error){host.error=options.signal?.aborted?'HOST_START_CANCELLED':stableCode(error);host.phase='failed';await host.close('startup-failed').catch(()=>{});throw new Error(host.error);}}
  private mark(phase:HostPhase){this.options.signal?.throwIfAborted();this.phase=phase;this.options.onPhase?.(phase,this);}
  private plugin(id:string,state:PluginHealth['state'],code:string|null=null){const health=this.health.find(p=>p.id===id);if(health){health.state=state;health.code=code;}}
  private async open(){
    const check=inspectHost(this.config,this.options.coordination);if(!check.ready)throw new Error(check.codes[0]??'HOST_INSPECTION_FAILED');this.mark('inspected');
    this.lease=claim(this.config.resources,{profileId:this.config.config.profileId,agentId:this.config.config.agent.id},this.options.coordination);
    this.instanceId=this.lease.owner.instanceId;
    const second=inspectHost(this.config,this.options.coordination,this.lease.owner.instanceId);if(!second.ready)throw new Error(second.codes[0]??'HOST_INSPECTION_FAILED');
    if(loadHostConfig(this.config.file).hash!==this.config.hash)throw new Error('HOST_CONFIG_CHANGED');assertPaths(this.config);bindMigratedProfile(this.config);this.mark('opening');
    const ctx=this.ctx;await ctx.plugin(LlmRuntime);await ctx.plugin(SessionStore);await ctx.plugin(Projection);await ctx.plugin(Prompt);await ctx.plugin(Tools);await ctx.plugin(AgentRegistry);
    await ctx.plugin(Persistence,{root:this.config.paths.sessions,compression:'none'});await ctx.plugin(AgentLoop,{agents:[]});
    const deepseek=pluginConfig(this.config,'model-deepseek'),scripted=pluginConfig(this.config,'model-scripted');
    if(deepseek){const doc=parseDocument(readFileSync(deepseek.credentialStore,'utf8'),{logLevel:'silent'});if(doc.errors.length||doc.get('version')!==1)throw new Error('HOST_CREDENTIAL_STORE_UNSUPPORTED');
      this.credentials={file:deepseek.credentialStore,hash:hashFile(deepseek.credentialStore)};await ctx.plugin(Credentials,{path:deepseek.credentialStore,watch:false});
      if(!(await ctx.credentials.describe(credentialRef(deepseek.credentialName))).configured)throw new Error('HOST_CREDENTIAL_REFERENCE_MISSING');
      await ctx.plugin(DeepSeek,{baseURL:deepseek.baseURL,apiKeyEnv:deepseek.credentialName});this.plugin('model-deepseek','ready');
    }else if(scripted){ctx.llm.registerAdapter(['local-test'],this.options.adapter??new FixedModel(scripted.response));this.plugin('model-scripted','ready');}
    const observe=this.options.onModelCall;ctx.on('llm/stream',async function*(options,next){const call={provider:options.provider??'',model:options.model??'',purpose:options.purpose??'task'};observe?.({...call,status:'started'});let okay=true;
      try{for await(const chunk of next()){if(chunk.type==='finish'&&['error','aborted','max-tokens'].includes(chunk.reason.kind))okay=false;yield chunk;}observe?.({...call,status:okay?'completed':'failed'});}catch(error){observe?.({...call,status:'failed'});throw error;}});
    const route=this.config.config.modelRoutes.chat,modelInfo=await ctx.llm.resolveModelInfo(route.provider,route.model,this.options.signal);
    if(route.reasoningEffort&&!modelInfo.reasoning?.efforts.some(e=>e.id===route.reasoningEffort))throw new Error('HOST_REASONING_ROUTE_UNSUPPORTED');
    await ctx.plugin(Query,{path:this.config.paths.query,openAt:'first-search'});
    const {compactionInputTokens:inputTokens,...context}=this.config.config.context;
    await ctx.plugin(Core,{agentId:this.config.config.agent.id,dataDir:this.config.paths.core,personaFile:this.config.paths.foundation,...route,lifecycleMode:'managed',turnTimeoutMs:this.config.config.runtime.turnTimeoutMs,
      context:{...context,regions:{...context.regions,'memory:growth':{...this.config.config.persona.growthRegion,required:false}}}});this.coreValue=ctx.dafeiyu;
    this.mark('binding');const timeline=pluginConfig(this.config,'timeline');if(timeline){await ctx.plugin(Timeline,{agentId:this.config.config.agent.id,...timeline});this.plugin('timeline','ready');}
    const memory=pluginConfig(this.config,'memory');if(memory){await ctx.plugin(Memory,{agentId:this.config.config.agent.id,dataDir:this.config.paths.memory,lifecycleMode:'managed',...memory,...(inputTokens?{compaction:{inputTokens}}:{})});this.memoryValue=ctx.dafeiyuMemory;this.plugin('memory','ready');
      this.core.configureExecution({profileId:this.config.config.profileId,policies:this.config.config.authorityPolicies,createStore:false,maxPendingRuns:this.config.config.runtime.maxPendingRuns,maxConcurrentRuns:this.config.config.runtime.maxConcurrentRuns});}
    const simulator=pluginConfig(this.config,'channel-simulator');if(simulator){await ctx.plugin(Simulator,{agentId:this.config.config.agent.id,...simulator});this.plugin('channel-simulator',this.mode==='single-run'?'disabled':'ready');}
    const qq=pluginConfig(this.config,'channel-qq');if(qq&&this.mode==='daemon'){
      if(!existsSync(qq.tokenFile)){if(this.health.find(p=>p.id==='channel-qq')?.required)throw new Error('HOST_QQ_CREDENTIAL_FILE_MISSING');this.plugin('channel-qq','degraded','HOST_QQ_CREDENTIAL_FILE_MISSING');}
      else{await ctx.plugin(QQ,{agentId:this.config.config.agent.id,dataDir:this.config.paths.channels['channel-qq']!,lifecycleMode:'managed',...qq});this.qqValue=ctx.dafeiyuQQ;this.qqValue.holdIngress();this.plugin('channel-qq','starting');}
    }else if(qq)this.plugin('channel-qq','disabled','HOST_SINGLE_RUN');
    const producerActive=(producer:string)=>producer==='channel-qq'?!!this.qqValue:producer==='channel-simulator'?!!simulator&&this.mode==='daemon':true;
    if(this.config.config.authorityPolicies.filter(policy=>policy.producers.some(producerActive)).some(policy=>policy.actions.some(action=>!this.core.capabilityManifest().actions.some(actual=>actual.id===action))))throw new Error('HOST_POLICY_ACTION_UNAVAILABLE');
    this.mark('recovering');this.memoryValue?.recover();this.memoryValue?.activate();if(memory)await this.core.recoverExecutions();this.core.recover();
    const resume={resumeMessages:this.mode==='daemon',resumeExecutions:this.mode==='daemon'};if(this.mode==='single-run')this.memoryValue?.stopBackground();
    this.core.activate({deferWork:true,...resume});
    if(this.qqValue){await this.qqValue.start();const deadline=Date.now()+6000;while(this.qqValue.getStatus().state==='starting'&&Date.now()<deadline)await delay(20);
      const state=this.qqValue.getStatus();if(state.state!=='online'){if(this.health.find(p=>p.id==='channel-qq')?.required)throw new Error('HOST_REQUIRED_QQ_UNAVAILABLE');
        this.qqValue.quiesce();await this.qqValue.close();this.qqValue=undefined;this.plugin('channel-qq','degraded',state.error??'HOST_QQ_UNAVAILABLE');}else this.qqHealth();}
    this.options.signal?.throwIfAborted();this.core.activate(resume);this.qqValue?.releaseIngress();this.mark(this.health.some(p=>p.state==='degraded')?'degraded':'ready');
    this.publish();this.timer=setInterval(()=>{try{this.refresh();this.publish();}catch(error){this.error=stableCode(error,'HOST_DIAGNOSTICS_FAILED');void this.close('diagnostics-failed').catch(()=>{});}},this.config.config.diagnostics.snapshotIntervalMs);if(this.mode==='single-run')this.timer.unref();
  }
  private refresh(){if(!['ready','degraded'].includes(this.phase))return;const qq=this.qqValue?.getStatus();if(qq&&qq.state!=='online'){
      if(this.health.find(p=>p.id==='channel-qq')?.required){this.error='HOST_REQUIRED_QQ_UNAVAILABLE';this.core.quiesce();void this.close('required-channel-failed').catch(()=>{});return;}this.plugin('channel-qq','degraded',qq.error??'HOST_QQ_UNAVAILABLE');}else if(qq)this.qqHealth();
    if(!this.core.accepting){this.error='HOST_CORE_UNAVAILABLE';void this.close('core-unavailable').catch(()=>{});return;}
    if(this.memoryValue?.runtimeHealth().analysis.state==='failed')this.plugin('memory','degraded','HOST_ANALYSIS_WORKER_FAILED');
    this.phase=this.health.some(p=>p.state==='degraded')?'degraded':'ready';}
  private qqHealth(){const status=this.qqValue?.getStatus().groupSync;if(!status)return;
    if(status.enabled&&(status.state!=='current'||status.error))this.plugin('channel-qq','degraded',status.error??'GROUP_SYNC_UNAVAILABLE');else this.plugin('channel-qq','ready');}
  private outbox(){let count=0;for(const [file,tables] of [[join(this.config.paths.core,'runtime.sqlite'),['runtime_outbox']],[join(this.config.paths.core,'delivery.sqlite'),['events']],
    [join(this.config.paths.memory,'memory.sqlite'),['outbox','persona_outbox','execution_memory_outbox']],[join(this.config.paths.memory,'analysis.sqlite'),['audit_outbox']],
    [join(this.config.paths.memory,'working.sqlite'),['outbox']],[join(this.config.paths.memory,'feedback.sqlite'),['outbox']]] as const){
    if(!existsSync(file))continue;const db=new DatabaseSync(file,{readOnly:true});try{for(const table of tables)if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))count+=Number(db.prepare(`SELECT count(*) AS n FROM ${table} WHERE delivered=0`).get()?.n);}finally{db.close();}}return count;}
  snapshot():HostSnapshot{const core=this.coreValue?.getStatus(),qq=this.qqValue?.getStatus();return {schemaVersion:1,profileId:this.config.config.profileId,agentId:this.config.config.agent.id,instanceId:this.instanceId,pid:process.pid,at:new Date().toISOString(),configHash:this.config.hash,foundationHash:this.config.foundation.hash,
      phase:this.phase,mode:this.mode,accepting:['ready','degraded'].includes(this.phase)&&!!this.coreValue?.accepting,error:this.error,plugins:this.health.map(p=>({...p})),features:this.coreValue?.capabilityManifest().features??[],
      services:{memory:this.memoryValue?.runtimeHealth()??null,qq:qq?{state:qq.state,groupSync:qq.groupSync.state,groupError:qq.groupSync.error,effectiveGroups:qq.groupSync.effectiveIds.length,lastGroupSync:qq.groupSync.lastSuccessAt,capabilities:qq.capabilities.registered,delivery:qq.delivery}:null},
      counts:{activeRuns:core?.execution?.active??0,queuedRuns:core?.execution?.queued??0,queuedRoutes:core?.queuedRoutes??0,pendingMessages:core?.messages.filter(m=>['accepted','processing','reply-ready','sending'].includes(m.state)).length??0,outbox:this.lease?this.outbox():0},schemas:{journal:2,memory:9,runtime:2}};}
  publish(){if(!this.lease)return;const file=join(this.config.paths.core,'host-status.json'),temp=file+'.'+randomUUID()+'.tmp';writeFileSync(temp,JSON.stringify(this.snapshot(),null,2)+'\n',{flag:'wx'});renameSync(temp,file);}
  run(raw:unknown):Promise<HostRunResult>{if(!['ready','degraded'].includes(this.phase))throw new Error('HOST_NOT_READY');if(!this.memoryValue)throw new Error('HOST_TASK_REPOSITORY_REQUIRED');
    const work=this.performRun(raw).finally(()=>this.jobs.delete(work));this.jobs.add(work);return work;}
  private async performRun(raw:unknown):Promise<HostRunResult>{const request=ExecutionRequestSchema.parse(raw),port=this.core.executionProducer('host-cli');
    const accepted=port.submitTask(request,'taskId'in request?port.openTask(request.taskId):undefined);await this.core.whenIdle();const status=port.status(accepted.run),text=await port.readResult(accepted.run);this.publish();return {taskId:accepted.task.id,runId:accepted.run.id,state:status.state,error:status.error,result:text};}
  whenClosed():Promise<void>{return this.finished;}
  close(_reason='requested'):Promise<void>{if(this.closing)return this.closing;this.closing=this.shutdown().finally(()=>this.finishClose());return this.closing;}
  private async shutdown(){
    if(this.timer)clearInterval(this.timer);this.timer=undefined;const failed=!!this.error;this.phase='draining';this.coreValue?.quiesce();this.qqValue?.quiesce();this.memoryValue?.stopBackground();
    let drained=false;const settled=Promise.allSettled([this.coreValue?.whenIdle(),this.memoryValue?.whenIdle(),this.qqValue?.whenIdle(),...this.jobs]).then(results=>{drained=true;if(results.some(r=>r.status==='rejected'))this.error??='HOST_DRAIN_FAILED';});
    let deadline:ReturnType<typeof setTimeout>|undefined;await Promise.race([settled,new Promise<void>(resolve=>{deadline=setTimeout(resolve,this.config.config.runtime.shutdownGraceMs);})]);if(deadline)clearTimeout(deadline);
    if(!drained){this.coreValue?.cancelRunning();this.memoryValue?.cancelRunning();this.error??='HOST_DRAIN_CANCELLED';await settled;}
    let disposed=false;try{await this.qqValue?.close();await this.memoryValue?.close();await this.coreValue?.close();await this.ctx.fiber.dispose();disposed=true;
      if(this.credentials&&hashFile(this.credentials.file)!==this.credentials.hash)this.error??='HOST_CREDENTIAL_STORE_CHANGED';
      for(const item of this.health)if(['ready','starting','configured'].includes(item.state))item.state='stopped';this.phase=failed||this.error&&this.error!=='HOST_DRAIN_CANCELLED'?'failed':'stopped';this.publish();
    }catch(error){this.error??=stableCode(error,'HOST_CLOSE_FAILED');this.phase='failed';try{await this.ctx.fiber.dispose();disposed=true;}finally{this.publish();}throw new Error(this.error);}
    finally{if(disposed){this.lease?.release();this.lease=undefined;}}
  }
}
