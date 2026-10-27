import type { Context } from '@deepseek-ai/cordis';
import type { ChildProcess } from 'node:child_process';
import type { AgentHandle } from '@deepseek-ai/dsh-agent';
import { SessionId } from '@deepseek-ai/dsh-session';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import type {} from '@deepseek-ai/dsh-tools';
import type {} from '@deepseek-ai/dsh-session-persistence';
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools';
import { createHash,randomUUID } from 'node:crypto';
import { dirname,join } from 'node:path';
import { DeferredPluginChanges } from './deferred-plugins.js';
import { readInstallationSettings } from './settings.js';
import {readBiliBrowser} from './bili-browser.js';
import { z } from 'zod';
import { DshBridgeRequestSchema,DshToolCatalogSchema,ExternalTaskAuthorizationSchema,DshCapabilityChangeSchema,redactJson } from '@dafeiyu/contracts';
import type { DshToolCatalog,Json } from '@dafeiyu/contracts';

interface Presets {mount(scope:Context,id:string):Promise<{id:string}>}
interface Permissions {set(session:AgentHandle['agent']['session'],id:string):void}
declare module '@deepseek-ai/dsh-session' {interface SessionEventMap {'plugin:dafeiyu/dsh-dispatch':{schemaVersion:1;runId:string;operationId:string;tool:string;source:Json};'plugin:dafeiyu/dsh-completed':{schemaVersion:1;runId:string;operationId:string;tool:string;isError:boolean;effect:'none'|'confirmed'|'unknown'}}}
// These have dedicated Dafeiyu owners, or would escape the authenticated QQ source.
const excluded=/^(?:schedule_|bili_|learn_|(?:send_message|interrupt_agent|list_agents|subagent|subagent_fork|workflow|ask_user_question|exit_plan_mode|voice_listen|voice_speak|dsh_browser_auth|dsh_browser_replay|create_goal|update_goal|get_goal)$)/;
const excludedSkill=(name:string)=>/^(?:bilibili|bili[-_].*)$/i.test(name);
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const readTools=new Set(['read','glob','grep','read_image','web_search','web_fetch','read_page','x_search','load_workspace_dependencies','voice_status','voice_transcribe','dsh_browser_snapshot','dsh_browser_a11y','dsh_browser_challenge','dsh_browser_content','dsh_browser_get_value','dsh_browser_list_tabs','dsh_browser_session','dsh_browser_history','dsh_browser_visited','list_mcp_resources','list_mcp_resource_templates','read_mcp_resource','cordis_inspect_list','cordis_inspect_query','job_output','job_list']);
const code=(error:unknown)=>error instanceof Error&&/^[A-Z0-9_]{1,100}$/.test(error.message)?error.message:'DSH_TOOL_FAILED';

/** Official Tools dispatch in a preset-bound DSH Agent. This Agent never calls a model. */
export function attachDshBridge(ctx:Context,child:ChildProcess,settingsFile:string){
  const handles=new Map<string,Promise<AgentHandle>>(),controllers=new Map<string,AbortController>(),jobs=new Set<Promise<void>>();
  let closed=false;
  const owner=ctx.root,settings=readInstallationSettings(settingsFile),validations=new Map<string,(value:boolean)=>void>(),updating=new Set<string>();
  const changes=new DeferredPluginChanges(join(settings.dataDir,'dsh-plugin-changes'),async row=>{
    const h=await handle(row.authorization.taskId);updating.add(row.authorization.taskId);
    try{const result=await owner.agents.withInitiator(h.agent,()=>owner.tools.execute({callId:ToolCallId(row.id),name:'plugin_manager',arguments:row.arguments,agent:h.agent,signal:new AbortController().signal}));
      if(result.isError)return {application:'failed',code:'DSH_PLUGIN_CHANGE_FAILED'};
      return typeof result.value==='string'?z.json().parse(JSON.parse(result.value)):result.value;
    }finally{updating.delete(row.authorization.taskId);if(closed){handles.delete(row.authorization.taskId);await h.dispose();}}
  });
  const validate=async(row:import('./deferred-plugins.js').DeferredPluginChange)=>{
    if(closed||!child.connected)return false;
    return new Promise<boolean>(resolve=>{const timer=setTimeout(()=>{validations.delete(row.id);resolve(false);},10000);validations.set(row.id,value=>{clearTimeout(timer);resolve(value);});child.send({type:'dsh.validate-update',id:row.id,authorization:row.authorization});});
  };
  const send=(id:string,value:Json,error?:string)=>{if(child.connected)child.send({type:'dsh.result',id,value,...(error?{error}:{})},()=>{});};
  const handle=async(key:string)=>{
    let promise=handles.get(key);if(!promise){promise=(async()=>{
      const presets=ctx.get('agentPresets') as Presets|undefined,permission=ctx.get('permissionPresets') as Permissions|undefined;
      if(!presets||!permission)throw new Error('DSH_STANDARD_COMPOSITION_UNAVAILABLE');
      const sessionId=SessionId('dafeiyu-tools-'+hash([settingsFile,key]));
      const setup=async(scope:Context,agent:AgentHandle['agent'])=>{await presets.mount(scope,'cordis');scope.tools.presentAs('native');permission.set(agent.session,'danger-full-access');};
      return await owner.sessionPersistence.stat(sessionId)?owner.agents.resume({resumeSessionId:sessionId,setup}):owner.agents.create({sessionId,meta:{cwd:dirname(settings.dataDir),agentPreset:'cordis'},setup});
    })();handles.set(key,promise);promise.catch(()=>handles.delete(key));}return promise;
  };
  const catalog=async(h:AgentHandle,signal:AbortSignal,taskId?:string):Promise<DshToolCatalog>=>{
    const tools=ctx.tools.schemas(h.agent).filter(tool=>!excluded.test(tool.name));
    const registry=ctx.get('skills') as {snapshot(input:{scope:AgentHandle['agent'];cwd:string;signal:AbortSignal}):Promise<unknown>}|undefined;
    const snapshot=registry&&tools.some(tool=>tool.name==='skill')?z.object({skills:z.array(z.object({name:z.string(),description:z.string(),invocation:z.object({modelInvocable:z.boolean()})})),complete:z.boolean()}).parse(await registry.snapshot({scope:h.agent,cwd:dirname(settings.dataDir),signal})):null;
    const skills=snapshot?.skills.filter(item=>item.invocation.modelInvocable&&!excludedSkill(item.name)).map(item=>({name:item.name,description:item.description,load:{name:'skill',arguments:{name:item.name}}}));
    const directories=ctx.get('workingDirectory') as {ensure(agent:AgentHandle['agent'],signal:AbortSignal):Promise<string>}|undefined;
    const workingDirectory=directories?await directories.ensure(h.agent,signal):dirname(settings.dataDir),environment={workingDirectory,developmentDirectory:join(dirname(settings.dataDir),'development',taskId??'shared'),platform:process.platform};
    return DshToolCatalogSchema.parse({version:hash({tools,skills:skills??null,workingDirectory}),tools,environment,...(skills?{skills,skillsComplete:snapshot?.complete}:{}),pluginChanges:changes.status()});
  };
  const announced=new Set<string>(),lastAttempt=new Map<string,number>();
  const notifyChanges=async()=>{for(const row of changes.notifications()){
    const current=await catalog(await handle(row.authorization.taskId),AbortSignal.timeout(10000),row.authorization.taskId),key=hash([row.id,row.state,current.version]);if(announced.has(key)||Date.now()-(lastAttempt.get(key)??0)<5000||closed||!child.connected)continue;
    const change=DshCapabilityChangeSchema.parse({id:row.id,state:row.state,authorization:row.authorization,catalogVersion:current.version,toolNames:current.tools.map(tool=>tool.name),runtimeReloaded:row.hostPid!==null&&row.hostPid!==process.pid});
    child.send({type:'dsh.capability-change',change,key});lastAttempt.set(key,Date.now());
  }};
  const receive=(raw:unknown)=>{
    const acknowledgement=z.object({type:z.literal('dsh.capability-change-ack'),key:z.string().length(64)}).safeParse(raw);if(acknowledgement.success){if(lastAttempt.has(acknowledgement.data.key))announced.add(acknowledgement.data.key);return;}
    const validation=z.object({type:z.literal('dsh.update-authority-result'),id:z.uuid(),valid:z.boolean()}).safeParse(raw);if(validation.success){validations.get(validation.data.id)?.(validation.data.valid);validations.delete(validation.data.id);return;}
    const idle=z.object({type:z.literal('dsh.idle'),idle:z.literal(true)}).safeParse(raw);if(idle.success&&!closed){const work=(async()=>{await changes.idle(validate);await notifyChanges();})();jobs.add(work);void work.catch(()=>ctx.logger.warn('DSH_PLUGIN_CHANGE_RECORD_FAILED')).finally(()=>jobs.delete(work));return;}
    const parsed=DshBridgeRequestSchema.safeParse(raw);if(!parsed.success||closed)return;const message=parsed.data;
    if(message.type==='dsh.cancel'){controllers.get(message.id)?.abort();return;}
    if(controllers.has(message.id))return;const controller=new AbortController();controllers.set(message.id,controller);
    const work=(async()=>{try{
      if(message.type==='dsh.catalog'){send(message.id,z.json().parse(await catalog(await handle(message.taskId??'catalog'),controller.signal,message.taskId)));return;}
      if(message.type==='dsh.bili-read'){
        if(!settings.bilibili?.capabilities||!settings.bilibili.browser)throw new Error('BILI_BROWSER_NOT_CONFIGURED');
        const h=await handle('bili:'+message.request.taskId);
        const value=await readBiliBrowser(message.request,settings.bilibili.browser.expectedUid,async(name,args,signal)=>{
          if(!['dsh_browser_open','dsh_browser_execute','dsh_browser_scroll'].includes(name))throw new Error('BILI_BROWSER_ACTION_DENIED');
          const result=await owner.agents.withInitiator(h.agent,()=>owner.tools.execute({callId:ToolCallId(randomUUID()),name,arguments:args,agent:h.agent,signal}));
          if(result.isError)throw new Error('BILI_BROWSER_READ_FAILED');return result.value;
        },controller.signal);send(message.id,z.json().parse(value));return;
      }
      const authorization=ExternalTaskAuthorizationSchema.parse(message.authorization);
      if(authorization.action.owner!=='dsh-tools'||authorization.action.id!=='dsh_tool_call'||authorization.source.kind==='owner-message'&&(authorization.source.senderId!==settings.qq.ownerId||authorization.source.conversation.account!==settings.qq.botId))throw new Error('DSH_AUTHORITY_INVALID');
      const h=await handle(authorization.taskId),current=await catalog(h,controller.signal,authorization.taskId),tool=current.tools.find(tool=>tool.name===message.call.name);
      if(!tool||message.call.catalogVersion!==current.version)throw new Error('DSH_CATALOG_CHANGED');
      const args:unknown=JSON.parse(message.call.argumentsJson);if(validateJsonSchemaValue(tool.parameters,args).length)throw new Error('DSH_TOOL_ARGUMENTS_INVALID');controller.signal.throwIfAborted();
      if(tool.name==='skill'){const skill=z.object({name:z.string()}).safeParse(args);if(skill.success&&excludedSkill(skill.data.name))throw new Error('DSH_SKILL_NOT_AVAILABLE');}
      const management=z.object({action:z.string()}).safeParse(args);
      if(tool.name==='plugin_manager'&&management.success&&!management.data.action.startsWith('list_')){
        const row=changes.enqueue(authorization,z.json().parse(args),current.version);send(message.id,{isError:false,effect:'confirmed',handoff:{kind:'plugin-change',id:row.id,taskId:authorization.taskId,runId:authorization.runId,catalogVersion:current.version},value:{queued:true,updateId:row.id,state:row.state,note:'变更已持久交接，尚未安装。程序在检查点和必要反馈完成、空闲且来源有效时使用DSH安装器；加载后核对实际能力再恢复任务。'}});return;
      }
      // The source and operation are recorded before dispatch. ToolRuntime retains all DSH policy hooks.
      h.agent.session.append('plugin:dafeiyu/dsh-dispatch',{schemaVersion:1,runId:authorization.runId,operationId:authorization.operationId,tool:tool.name,source:z.json().parse(authorization.source)});
      const result=await ctx.agents.withInitiator(h.agent,()=>ctx.tools.execute({callId:ToolCallId(message.id),name:tool.name,arguments:args,agent:h.agent,signal:controller.signal}));
      const readOnly=readTools.has(tool.name)||tool.name==='plugin_manager'&&management.success&&management.data.action.startsWith('list_');
      const fact={schemaVersion:1 as const,runId:authorization.runId,operationId:authorization.operationId,tool:tool.name,isError:result.isError,effect:readOnly?'none' as const:result.isError?'unknown' as const:'confirmed' as const};
      let value:Json;try{
        h.agent.session.append('plugin:dafeiyu/dsh-completed',fact);if(!await ctx.sessions.flush(h.agent.session))throw new Error('DSH_RECEIPT_FLUSH_FAILED');
        const projected=redactJson(z.json().parse({isError:fact.isError,effect:fact.effect,value:result.value===undefined?result.content:result.value})).value;
        value=Buffer.byteLength(JSON.stringify(projected))<=4*1024*1024?projected:{isError:fact.isError,effect:fact.effect,value:null,processing:{state:'unavailable',code:'DSH_RESULT_STORAGE_LIMIT'}};
      }catch{value={isError:fact.isError,effect:fact.effect,value:null,processing:{state:'failed',code:'DSH_RESULT_PROJECTION_FAILED'}};}
      send(message.id,value);
    }catch(error){send(message.id,null,code(error));}finally{controllers.delete(message.id);}})();
    jobs.add(work);void work.finally(()=>jobs.delete(work));
  };
  child.on('message',receive);
  return async()=>{closed=true;child.off('message',receive);controllers.forEach(controller=>controller.abort());await Promise.allSettled([...jobs]);for(const [key,item] of handles){if(updating.has(key))continue;const h=await item.catch(()=>null);await h?.dispose();}for(const finish of validations.values())finish(false);validations.clear();};
}
