import { readFileSync,statSync,existsSync } from 'node:fs';
import { dirname,resolve,join } from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';
import { HostConfigSchema,dependencyOrder,redactJson } from '@dafeiyu/contracts';
import type { HostConfig } from '@dafeiyu/contracts';
import { MemoryPluginConfigSchema } from '@dafeiyu/memory';
import { QqPluginConfigSchema, QQ_ACTIONS, QQ_TASK_ACTIONS } from '@dafeiyu/channel-qq';
import { TimelinePluginConfigSchema } from '@dafeiyu/timeline';
import { runtimeHash } from '@dafeiyu/core/runtime-store';
import { readFoundation } from '@dafeiyu/core';
import { physicalPath,resource,overlap,pathIdentity,within } from './paths.js';
import type { HostResource } from './paths.js';

const endpoint=z.url().refine(raw=>{const url=new URL(raw);return (url.protocol==='https:'||url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname))&&!url.username&&!url.password&&!url.search&&!url.hash;});
export const DeepSeekConfigSchema=z.strictObject({credentialStore:z.string().min(1).default(join(homedir(),'.dsh','.credentials.yaml')),credentialName:z.literal('DEEPSEEK_API_KEY').default('DEEPSEEK_API_KEY'),baseURL:endpoint.default('https://api.deepseek.com/anthropic')});
export const ScriptedConfigSchema=z.strictObject({response:z.string().trim().min(1).max(8000).default('这是本机虚构样例；模拟模型已完成任务。')});
export const TimelineConfigSchema=TimelinePluginConfigSchema;
export const SimulatorConfigSchema=z.strictObject({account:z.string().min(1).max(100).default('local-test')});
export const pluginSchemas={timeline:TimelineConfigSchema,memory:MemoryPluginConfigSchema,'channel-qq':QqPluginConfigSchema,'channel-simulator':SimulatorConfigSchema,'model-deepseek':DeepSeekConfigSchema,'model-scripted':ScriptedConfigSchema} as const;
export type PluginId=keyof typeof pluginSchemas;
export interface PreparedPlugin {readonly id:PluginId;readonly enabled:boolean;readonly required:boolean;readonly requires:readonly string[];readonly config:Record<string,unknown>}
export interface PreparedHostConfig {
  readonly file:string;readonly config:HostConfig;readonly hash:string;readonly foundation:{hash:string;identity:string};
  readonly paths:{core:string;memory:string;sessions:string;query:string;channels:Readonly<Record<string,string>>;foundation:string};
  readonly plugins:readonly PreparedPlugin[];readonly order:readonly string[];readonly resources:readonly HostResource[];
  readonly declarations:readonly {path:string;identity:string}[];
}
function readJSON(file:string){const stat=statSync(file);if(!stat.isFile()||stat.size>262144)throw new Error('HOST_CONFIG_INVALID');return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(readFileSync(file))) as unknown;}
function freeze(value:unknown):void{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}}
export function assertPaths(prepared:PreparedHostConfig){if(prepared.declarations.some(value=>pathIdentity(value.path)!==value.identity))throw new Error('HOST_PATH_CHANGED');}
export function loadHostConfig(input:string):PreparedHostConfig{
  try{
    const file=physicalPath(input),base=dirname(file),config=HostConfigSchema.parse(readJSON(file));
    if(redactJson(z.json().parse(config)).redacted)throw new Error('HOST_PRIVATE_CONFIG_REJECTED');
    const resolvePath=(path:string)=>physicalPath(resolve(base,path));
    const paths={core:resolvePath(config.paths.core),memory:resolvePath(config.paths.memory),sessions:resolvePath(config.paths.sessions),query:resolvePath(config.paths.query),
      channels:Object.fromEntries(Object.entries(config.paths.channels).map(([id,path])=>[id,resolvePath(path)])),foundation:resolvePath(config.persona.fixedFile)};
    if(Object.keys(paths.channels).some(id=>id!=='channel-qq'))throw new Error('HOST_UNKNOWN_CHANNEL_STORAGE');
    const resources=[resource(paths.core,'directory'),resource(paths.memory,'directory'),resource(paths.sessions,'directory'),resource(paths.query,'file'),...Object.values(paths.channels).map(path=>resource(path,'directory'))];
    if(resources.some((a,index)=>resources.slice(index+1).some(b=>overlap(a,b))))throw new Error('HOST_PATH_OVERLAP');
    if(resources.some(item=>within(file,item.path)||within(paths.foundation,item.path)))throw new Error('HOST_CONFIG_INSIDE_DATA');
    const plugins:PreparedPlugin[]=config.plugins.map(plugin=>{if(!Object.hasOwn(pluginSchemas,plugin.id))throw new Error('HOST_UNKNOWN_PLUGIN');const id=plugin.id as PluginId;
      const parsed:Record<string,unknown>=pluginSchemas[id].parse(plugin.config);
      if(id==='model-deepseek')parsed.credentialStore=resolvePath(String(parsed.credentialStore));
      if(id==='channel-qq'){
        parsed.tokenFile=resolvePath(String(parsed.tokenFile));if(plugin.enabled&&!paths.channels['channel-qq'])throw new Error('HOST_CHANNEL_PATH_REQUIRED');
        for(const key of ['httpURL','wsURL'] as const){const url=new URL(String(parsed[key]));if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||url.search||url.hash||url.protocol!==(key==='httpURL'?'http:':'ws:'))throw new Error('HOST_QQ_LOOPBACK_REQUIRED');}}
      if(id==='memory'&&parsed.retrieval){const retrieval=z.record(z.string(),z.unknown()).parse(parsed.retrieval);for(const key of ['python','modelDir','serviceFile','pythonPackages','profileFile'])if(typeof retrieval[key]==='string')retrieval[key]=resolvePath(retrieval[key]);parsed.retrieval=retrieval;}
      return {id,enabled:plugin.enabled,required:plugin.required,requires:plugin.requires,config:parsed};});
    if(plugins.some(p=>p.required&&!p.enabled))throw new Error('HOST_REQUIRED_PLUGIN_DISABLED');
    const enabled=plugins.filter(p=>p.enabled),models=enabled.filter(p=>p.id.startsWith('model-'));
    if(models.length!==1)throw new Error('HOST_MODEL_PROVIDER_REQUIRED');
    if(config.modelRoutes.chat.provider!==(models[0]!.id==='model-deepseek'?'deepseek-official':'local-test'))throw new Error('HOST_MODEL_ROUTE_MISMATCH');
    if(models[0]!.id==='model-scripted'&&(config.persona.kind!=='test'||config.modelRoutes.chat.model!=='scripted'))throw new Error('HOST_TEST_MODEL_REQUIRES_TEST_PROFILE');
    const hasMemory=enabled.some(p=>p.id==='memory');
    if(!hasMemory&&enabled.some(p=>p.id==='timeline'&&p.config.execution===true))throw new Error('HOST_TASK_REPOSITORY_REQUIRED');
    if(config.context.compactionInputTokens!==undefined&&!hasMemory)throw new Error('HOST_COMPACTION_REQUIRES_MEMORY');
    const memory=enabled.find(p=>p.id==='memory');if(memory?.config.compaction&&config.context.compactionInputTokens!==undefined)throw new Error('HOST_DUPLICATE_COMPACTION_CONFIG');
    const qq=enabled.find(p=>p.id==='channel-qq'),qqCapabilities=qq&&QqPluginConfigSchema.parse(qq.config).capabilities.enabled;
    if(qqCapabilities){if(!memory)throw new Error('HOST_QQ_MEMORY_REQUIRED');
      if(!memory.config.sourceTracking&&!memory.config.compaction&&config.context.compactionInputTokens===undefined)throw new Error('HOST_QQ_SOURCE_TRACKING_REQUIRED');
      const policy=config.authorityPolicies.find(policy=>policy.id==='conversation'&&policy.producers.includes('channel-qq'));
      if(!policy||!policy.allowLocalWrite||QQ_ACTIONS.some(action=>!policy.actions.includes(action)))throw new Error('HOST_QQ_CAPABILITY_POLICY_REQUIRED');
    }
    const qqTasks=qq&&QqPluginConfigSchema.parse(qq.config).tasks;
    if(qqTasks?.enabled){if(!qqCapabilities)throw new Error('HOST_QQ_TASK_DEPENDENCY_REQUIRED');
      const conversation=config.authorityPolicies.find(policy=>policy.id==='conversation'&&policy.producers.includes('channel-qq'));
      const native=config.authorityPolicies.find(policy=>policy.id===qqTasks.policyId&&policy.producers.includes('qq-tasks'));
      if(!conversation||QQ_TASK_ACTIONS.some(action=>!conversation.actions.includes(action))||!native?.allowLocalWrite||['dafeiyu_task_intent','dafeiyu_task_object'].some(action=>!native.actions.includes(action)))throw new Error('HOST_QQ_TASK_POLICY_REQUIRED');
    }
    if(config.context.regions['memory:growth'])throw new Error('HOST_GROWTH_CONFIG_CONFLICT');
    if(!hasMemory&&config.authorityPolicies.length)throw new Error('HOST_TASK_REPOSITORY_REQUIRED');
    const descriptors=[{id:'core',provides:['core.registration.v1','lifecycle.managed.v1','context.conversation.v1'],requires:['llm.route.v1']},
      ...enabled.map(plugin=>({id:plugin.id,provides:plugin.id.startsWith('model-')?['llm.route.v1']:plugin.id==='timeline'?['timeline.history.v1']:plugin.id==='memory'?['task.repository.v1','memory.execution.v1','persona.stage-state.v1','persona.growth-selection.v1','continuity.checkpoint.v1','task.intent.v1','memory.capability-observation.v1','memory.native-expression.v1']:[`channel.${plugin.id==='channel-qq'?'qq':'simulator'}.v1`],
        requires:[...(plugin.id.startsWith('model-')?[]:['core.registration.v1']),...(plugin.id==='memory'?['timeline.history.v1']:[]),...(plugin.id==='channel-qq'&&qqCapabilities?['memory.capability-observation.v1','execution.resource-scope.v1']:[]),...(plugin.id==='channel-qq'&&qqTasks?.enabled?['execution.message-task.v1']:[]),...plugin.requires]})),
      ...(hasMemory?[{id:'core-execution',provides:['execution.task.v1','execution.wake-ingress.v1','context.task.v1','execution.resource-scope.v1','execution.message-task.v1'],requires:['task.repository.v1']}]:[])];
    const order=dependencyOrder(descriptors);const foundation=readFoundation(paths.foundation);
    const declared=[file,...[config.paths.core,config.paths.memory,config.paths.sessions,config.paths.query,...Object.values(config.paths.channels),config.persona.fixedFile].map(path=>resolve(base,path))];
    const prepared:PreparedHostConfig={file,config,hash:runtimeHash({config,paths,plugins}),foundation:{hash:foundation.version,identity:foundation.fileIdentity},paths,plugins,order,resources,
      declarations:declared.map(path=>({path,identity:pathIdentity(path)}))};freeze(prepared);return prepared;
  }catch(error){if(error instanceof Error&&/^HOST_[A-Z0-9_]+$/.test(error.message))throw error;if(error instanceof Error&&error.message==='FOUNDATION_INVALID')throw new Error('HOST_FOUNDATION_INVALID');if(error instanceof Error&&/^DEPENDENCY_[A-Z0-9_]+$/.test(error.message))throw new Error('HOST_'+error.message);throw new Error('HOST_CONFIG_INVALID');}
}
export function pluginConfig<P extends PluginId>(prepared:PreparedHostConfig,id:P):z.output<(typeof pluginSchemas)[P]>|undefined{
  // The key selects both the schema and the result; TypeScript cannot retain that generic correlation.
  const plugin=prepared.plugins.find(plugin=>plugin.id===id&&plugin.enabled);return plugin?pluginSchemas[id].parse(plugin.config) as z.output<(typeof pluginSchemas)[P]>:undefined;
}
