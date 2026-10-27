import type { Context } from '@deepseek-ai/cordis';
import type { ChildProcess } from 'node:child_process';
import type { AgentHandle } from '@deepseek-ai/dsh-agent';
import { SessionId } from '@deepseek-ai/dsh-session';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import type {} from '@deepseek-ai/dsh-tools';
import type {} from '@deepseek-ai/dsh-session-persistence';
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools';
import { createHash } from 'node:crypto';
import { dirname,join } from 'node:path';
import { DeferredPluginChanges } from './deferred-plugins.js';
import { readInstallationSettings } from './settings.js';
import { z } from 'zod';
import { DshBridgeRequestSchema,DshToolCatalogSchema,ExternalTaskAuthorizationSchema,redactJson } from '@dafeiyu/contracts';
import type { DshToolCatalog,Json } from '@dafeiyu/contracts';

interface Presets {mount(scope:Context,id:string):Promise<{id:string}>}
interface Permissions {set(session:AgentHandle['agent']['session'],id:string):void}
declare module '@deepseek-ai/dsh-session' {interface SessionEventMap {'plugin:dafeiyu/dsh-dispatch':{schemaVersion:1;runId:string;operationId:string;tool:string;source:Json}}}
// These have dedicated Dafeiyu owners, or would escape the authenticated QQ source.
const excluded=/^(?:schedule_|bili_|learn_|(?:send_message|interrupt_agent|list_agents|subagent|subagent_fork|workflow|ask_user_question|exit_plan_mode|voice_listen|voice_speak|dsh_browser_auth|dsh_browser_replay|create_goal|update_goal|get_goal)$)/;
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
  const catalog=(h:AgentHandle):DshToolCatalog=>{
    const tools=ctx.tools.schemas(h.agent).filter(tool=>!excluded.test(tool.name));
    return DshToolCatalogSchema.parse({version:hash(tools),tools,pluginChanges:changes.status()});
  };
  const receive=(raw:unknown)=>{
    const validation=z.object({type:z.literal('dsh.update-authority-result'),id:z.uuid(),valid:z.boolean()}).safeParse(raw);if(validation.success){validations.get(validation.data.id)?.(validation.data.valid);validations.delete(validation.data.id);return;}
    const idle=z.object({type:z.literal('dsh.idle'),idle:z.literal(true)}).safeParse(raw);if(idle.success&&!closed){void changes.idle(validate).catch(()=>ctx.logger.warn('DSH_PLUGIN_CHANGE_RECORD_FAILED'));return;}
    const parsed=DshBridgeRequestSchema.safeParse(raw);if(!parsed.success||closed)return;const message=parsed.data;
    if(message.type==='dsh.cancel'){controllers.get(message.id)?.abort();return;}
    if(controllers.has(message.id))return;const controller=new AbortController();controllers.set(message.id,controller);
    const work=(async()=>{try{
      if(message.type==='dsh.catalog'){send(message.id,z.json().parse(catalog(await handle('catalog'))));return;}
      const authorization=ExternalTaskAuthorizationSchema.parse(message.authorization);
      if(authorization.action.owner!=='dsh-tools'||authorization.action.id!=='dsh_tool_call'||authorization.source.kind==='owner-message'&&(authorization.source.senderId!==settings.qq.ownerId||authorization.source.conversation.account!==settings.qq.botId))throw new Error('DSH_AUTHORITY_INVALID');
      const h=await handle(authorization.taskId),current=catalog(h),tool=current.tools.find(tool=>tool.name===message.call.name);
      if(!tool||message.call.catalogVersion!==current.version)throw new Error('DSH_CATALOG_CHANGED');
      const args:unknown=JSON.parse(message.call.argumentsJson);if(validateJsonSchemaValue(tool.parameters,args).length)throw new Error('DSH_TOOL_ARGUMENTS_INVALID');controller.signal.throwIfAborted();
      const management=z.object({action:z.string()}).safeParse(args);
      if(tool.name==='plugin_manager'&&management.success&&!management.data.action.startsWith('list_')){
        const row=changes.enqueue(authorization,z.json().parse(args));send(message.id,{isError:false,value:{queued:true,updateId:row.id,state:row.state,note:'宿主会在本轮QQ反馈与任务交付完成、确认空闲和来源仍有效后，通过DSH插件管理器执行。当前尚未安装成功；不直接覆盖运行插件。'}});return;
      }
      // The source and operation are recorded before dispatch. ToolRuntime retains all DSH policy hooks.
      h.agent.session.append('plugin:dafeiyu/dsh-dispatch',{schemaVersion:1,runId:authorization.runId,operationId:authorization.operationId,tool:tool.name,source:z.json().parse(authorization.source)});
      const result=await ctx.agents.withInitiator(h.agent,()=>ctx.tools.execute({callId:ToolCallId(message.id),name:tool.name,arguments:args,agent:h.agent,signal:controller.signal}));
      const readOnly=readTools.has(tool.name)||tool.name==='plugin_manager'&&management.success&&management.data.action.startsWith('list_');
      const projected=redactJson(z.json().parse(result.isError?{isError:true,effect:readOnly?'none':'unknown',content:result.content}:{isError:false,effect:readOnly?'none':'confirmed',value:result.value,content:result.content})).value;
      // The Core action result budget is 128 KiB, shared with provenance and metadata.
      const value=Buffer.byteLength(JSON.stringify(projected))<=100000?projected:{isError:result.isError,omitted:true,reason:'DSH_RESULT_TOO_LARGE',note:'工具已结束；完整内容留在DSH工具自身的结果或文件中，请通过原工具分页读取。'};
      await ctx.sessions.flush(h.agent.session);send(message.id,value);
    }catch(error){send(message.id,null,code(error));}finally{controllers.delete(message.id);}})();
    jobs.add(work);void work.finally(()=>jobs.delete(work));
  };
  child.on('message',receive);
  return async()=>{closed=true;child.off('message',receive);controllers.forEach(controller=>controller.abort());await Promise.allSettled([...jobs]);for(const [key,item] of handles){if(updating.has(key))continue;const h=await item.catch(()=>null);await h?.dispose();}for(const finish of validations.values())finish(false);validations.clear();};
}
