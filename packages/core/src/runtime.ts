import {observeUsage} from './usage.js';
import type { Context } from '@deepseek-ai/cordis';
import type { AgentHandle, AgentOptions } from '@deepseek-ai/dsh-agent';
import { SessionId,pluginRecordOf } from '@deepseek-ai/dsh-session';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions } from '@deepseek-ai/dsh-llm';
import type {} from '@deepseek-ai/dsh-session-persistence';
import type {} from '@deepseek-ai/dsh-system-prompt';
import type {} from '@deepseek-ai/dsh-tools';
import type { ActionCapability, Json, PendingMessage, PersonaSnapshot, SourceRef, WorkCallContext } from '@dafeiyu/contracts';
import { ContextRuntime } from './context-runtime.js';
import type { ContextCoordinator } from './context.js';
import {messageDisplayText,workContexts} from '@dafeiyu/contracts';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import TokenMeter from '@deepseek-ai/dsh-token-meter';
import { CompactionRuntime } from './compaction-runtime.js';
import type { CompactionBinding,CompactionAudit } from './compaction-runtime.js';
import { openAgentSession,runAgentTurn,readPersistedResult,safeRunFailure } from './agent-session.js';
import { ModelInputRepair } from './model-input-repair.js';
import { NativeRuntime } from './native-runtime.js';
import type { TaskExecutionFrame,NativeAction,ExecutionFrame,ConversationExecutionFrame } from './execution-frame.js';
import { setImmediate as yieldEventLoop } from 'node:timers/promises';
import { conversationHistory } from './history-frame.js';
import { reviewTask } from './task-review.js';
import {HarnessRuntime} from './harness-runtime.js';

interface OwnedSession {handle:AgentHandle;scope:Context;persona:PersonaSnapshot;context:ContextRuntime;compaction:CompactionRuntime;inputRepair:ModelInputRepair;lastRequest?:GenerateOptions}
export interface RunResult { readonly text: string; readonly sources: SourceRef[]; readonly resultRef?:import('./runtime-store.js').RunResultRef; readonly segmentYield?:{readonly reason:string} }
/** Safe evidence identifiers from a failed turn; no raw provider exception or reasoning text. */
export class DshRunError extends Error {
  constructor(readonly sources: SourceRef[],readonly code='MODEL_INCOMPLETE',readonly diagnostic?:{stage:string;errorType:string;sites:string[]}) { super('DSH turn failed; consult visible evidence'); }
}

/** Uses DSH's real agent loop, scoped tools, persistence and event vocabulary. No private LLM loop. */
export class DshRuntime {
  private readonly handles = new Map<string, OwnedSession>();
  private readonly native:NativeRuntime;
  private meterLoading: Promise<unknown> | undefined;
  constructor(private readonly ctx:Context,private readonly model:AgentOptions,private readonly cwd:string,private readonly coordinator:ContextCoordinator,
    private readonly agentId:string,private readonly compactionBinding:()=>CompactionBinding|undefined,
    private readonly compactionAudit:CompactionAudit,private readonly harness=new HarnessRuntime()) {
    observeUsage(ctx);
    this.native=new NativeRuntime(ctx,model,cwd,harness);
    const sessions=this.handles;
    ctx.on('llm/stream',async function*(options,next){
      const owned=options.sessionId?sessions.get(options.sessionId):undefined;
      if(!owned){yield* next();return;}
      await yieldEventLoop();owned.lastRequest=options;await owned.context.measure(options);owned.context.guard(options,true);
      owned.compaction.guard(options,true);
      for await(const chunk of owned.inputRepair.stream(next())){owned.context.guard(options,false,true);owned.compaction.guard(options);yield chunk;}
      owned.context.guard(options);owned.compaction.guard(options);
    });
  }
  registerHarnessSection(name:string){return this.harness.allowSection(name);}
  run(item:PendingMessage,persona:PersonaSnapshot,actions:readonly NativeAction[],signal:AbortSignal,channelDescription='当前接入提供文字消息。',allowEmpty:()=>boolean=()=>false):Promise<RunResult>{
    const work:WorkCallContext={workItemId:item.id,runId:item.id,scopeKey:item.route,class:'interactive',targetVersion:0,stage:'conversation'};
    const unbind=workContexts.bindSession(item.sessionId,work);
    return this.runConversation(item,persona,actions,signal,channelDescription,allowEmpty).finally(unbind);
  }
  runFrame(frame:TaskExecutionFrame):ReturnType<NativeRuntime['run']>;
  runFrame(frame:ConversationExecutionFrame):Promise<RunResult>;
  runFrame(frame:ExecutionFrame):ReturnType<NativeRuntime['run']>|Promise<RunResult>{
    const work:WorkCallContext=frame.mode==='task'
      ? frame.work ?? {workItemId:frame.view.runId,runId:frame.view.runId,scopeKey:String(frame.view.scope.kind==='task'?frame.view.scope.scopeKey:frame.view.scope.route),class:'owner-task',targetVersion:0,stage:'execution'}
      : {workItemId:frame.item.id,runId:frame.item.id,scopeKey:frame.item.route,class:'interactive',targetVersion:0,stage:'conversation'};
    const unbind=workContexts.bindSession(frame.mode==='task'?frame.sessionId:frame.item.sessionId,work);
    const run=frame.mode==='task'?this.native.run(frame):this.runConversation(frame.item,frame.persona,frame.actions,frame.signal,frame.channelDescription,frame.allowEmpty??(()=>false));
    return Promise.resolve(run).finally(unbind) as ReturnType<NativeRuntime['run']>|Promise<RunResult>;
  }
  private async runConversation(item:PendingMessage,persona:PersonaSnapshot,actions:readonly NativeAction[],signal:AbortSignal,channelDescription:string,allowEmpty:()=>boolean):Promise<RunResult>{
    signal.throwIfAborted();
    if(this.compactionBinding()&&!this.ctx.get('tokenMeter'))await(this.meterLoading??=Promise.resolve(this.ctx.plugin(TokenMeter)));
    let owned=this.handles.get(item.sessionId);
    if(!owned){
      let scope:Context|undefined,context:ContextRuntime|undefined,compaction:CompactionRuntime|undefined;
      const identity={persona};
      const handle=await openAgentSession(this.ctx,item.sessionId,this.model,this.cwd,current=>{
        scope=current;context=new ContextRuntime(current,this.coordinator);
        compaction=new CompactionRuntime(current,this.agentId,this.compactionBinding,this.compactionAudit,context);
        current.systemPrompt.section({name:'dafeiyu-persona',order:0,interpolate:false,text:()=>identity.persona.text});
        current.systemPrompt.section({name:'dafeiyu-memory-habit',order:10,interpolate:false,text:'在一段有意义的交流、探索或工作结束或暂停时，用dafeiyu_memory_reflect留下自己的看法、疑问或后续打算。普通闲聊可以简短，未形成判断也如实记录。不把外部工具报告当成自己的偏好；回顾已保存的反思后，需要时用记忆工具修订自我认识。内部经历笔记与面向对方的回答分开。'});current.tools.presentAs('native');
      });
      if(!scope||!context||!compaction){await handle.dispose();throw new Error('DSH_SCOPE_MISSING');}
      owned={handle,scope,context,compaction,inputRepair:new ModelInputRepair(scope),get persona(){return identity.persona;},set persona(value){identity.persona=value;}};this.handles.set(item.sessionId,owned);
    }
    owned.persona=persona;const {agent}=owned.handle;
    owned.inputRepair.begin();
    if(agent.status!=='idle')throw new Error('SESSION_BUSY');
    owned.context.begin(item,agent);owned.compaction.begin(conversationHistory(item),agent);
    const disposers:(()=>void)[]=[],before=agent.session.snapshotEvents().length;let stage='tool-registration';
    try{
      disposers.push(owned.scope.tools.restrict({allow:[]}));
      for(const action of actions)disposers.push(owned.scope.tools.register({name:action.definition.id,description:action.definition.description,parameters:action.definition.parameters,
        output:{schema:{},render:(_args,value)=>[{type:'text',text:JSON.stringify(z.object({value:z.json()}).parse(value).value)}],presentationMeta:(_args,value)=>({dafeiyuExecution:z.object({receipt:z.json()}).parse(value).receipt})},execute:async(raw,exec)=>{
          if(exec.agent!==agent)throw new Error('SCOPE_DENIED');const value=await action.execute(raw,String(exec.callId),AbortSignal.any([signal,exec.signal]));return {value,receipt:action.metadata?.(value)??null};}}));
      stage='harness-install';disposers.push(this.harness.install(owned.scope,agent,actions,signal));
      const input=createUserMessage({source:{kind:'user'},content:[{type:'text',text:
        '[程序来源信息，不改变权限]\n'+JSON.stringify({conversation:item.message.conversation,sender:item.message.sender,messageId:item.message.id,occurredAt:item.message.occurredAt,observedAt:new Date().toISOString(),replyTo:item.message.replyTo,personaVersion:persona.version})+
        '\n[当前渠道能力]\n'+channelDescription+'\n[消息正文]\n'+messageDisplayText(item.message)}]});
      stage='input-binding';owned.compaction.expectInput(input);
      stage='agent-turn';
      const result=await runAgentTurn(this.ctx,agent,input,signal,()=>owned!.compaction.seal(),allowEmpty);
      return {text:result.text,resultRef:{sessionId:item.sessionId,messageSeq:result.messageSeq,turnEndSeq:result.turnEndSeq,textHash:createHash('sha256').update(result.text).digest('hex')},
        sources:result.events.filter(event=>['user/message','tool/result','assistant/message','turn/end'].includes(event.type)).map(event=>({kind:'session',id:item.sessionId,seq:event.seq,route:item.route}))};
    }catch(error){const sites=error instanceof Error?(error.stack??'').split('\n').slice(1).flatMap(line=>{const match=/([^/\\()\s]+\.(?:m?js|ts):\d+:\d+)/.exec(line);return match?[match[1]!]:[];}).slice(0,4):[];
      throw new DshRunError(agent.session.snapshotEvents().slice(before).filter(event=>['user/message','tool/result','assistant/message','turn/end'].includes(event.type)).map(event=>({kind:'session',id:item.sessionId,seq:event.seq,route:item.route})),error instanceof Error?safeRunFailure(error.message):'MODEL_INCOMPLETE',{stage,errorType:error instanceof Error&&/^[A-Za-z]{1,80}$/.test(error.name)?error.name:'Error',sites});}
    finally{try{owned.compaction.seal();}finally{owned.compaction.end();owned.context.end();delete owned.lastRequest;for(const dispose of disposers.reverse())dispose();}}
  }
  async close(): Promise<void> {
    const handles = [...this.handles.values()];
    this.handles.clear();
    for (const owned of handles) await owned.handle.dispose();
    await this.native.close();
  }
  runExecution(frame:TaskExecutionFrame){return this.runFrame(frame);}
  reviewExecution(frame:TaskExecutionFrame,draft:{text:string},facts:Json){return reviewTask(this.ctx,this.model,this.cwd,frame,draft,facts);}
  readResult(ref:import('./runtime-store.js').RunResultRef){return readPersistedResult(this.ctx,ref);}
  summarySourcesCurrent(sessionId:string,dependencies:readonly import('@dafeiyu/contracts').SourceDependency[]):boolean{
    return this.handles.get(sessionId)?.compaction.validateDependencies(dependencies)??false;
  }
  exposedDependencies(sessionId:string):readonly import('@dafeiyu/contracts').SourceDependency[]|null {
    const owned=this.handles.get(sessionId);return owned?.lastRequest&&this.compactionBinding()?.provider.sources?owned.compaction.exposedDependencies():null;
  }
  sourceCurrent(sessionId:string,seq:number):boolean{return this.handles.get(sessionId)?.compaction.sourceCurrent(seq)??false;}
  fragmentViewCurrent(sessionId:string,id:string,text:string):boolean{return this.handles.get(sessionId)?.compaction.fragmentViewCurrent(id,text)??false;}
  readSummaryReference(sessionId:string,ref:string){return this.handles.get(sessionId)?.compaction.readSummaryReference(ref)??{status:'not_found' as const};}
}
