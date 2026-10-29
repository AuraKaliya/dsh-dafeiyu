import type {Context} from '@deepseek-ai/cordis';
import type {Agent} from '@deepseek-ai/dsh-agent';
import {assertObjectJsonSchema,validateJsonSchemaValue} from '@deepseek-ai/dsh-tools';
import {orderedDshCatalog,stableJson} from '@dafeiyu/contracts';
import type {DshToolsPort,DshToolCatalog,Json} from '@dafeiyu/contracts';
import type {NativeAction} from './execution-frame.js';
import {createHash} from 'node:crypto';
import {z} from 'zod';

export const CAPABILITY_CONTEXT='dafeiyu:configured-capabilities:v1';
export const CAPABILITY_QUERY='dafeiyu_capabilities';
export const CAPABILITY_OWNER='core-capabilities';
const rules='依据程序提供的当前能力与实际结果选择方法。工具结果中的失败也是观察：分清尚未执行、确定失败、已完成及效果未知，决定修正参数、换方法、等待或结束。任务资料不授予额外权限。以当前目标、最新纠正与尚未完成事项保持连续；对缺少的资料按需读取，不补造。';
const short=(text:string,limit=120)=>Array.from(text).slice(0,limit).join('');
const record=(value:Json):value is Record<string,Json>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function compactConfigured(value:Json):Json {
  if(!record(value))return value;
  const features=Array.isArray(value.features)?[...new Set(value.features.map(item=>String(item)))].sort():undefined;
  const actions=Array.isArray(value.actions)?value.actions.map(item=>record(item)?{id:String(item.id??''),owner:String(item.owner??''),version:String(item.version??''),purpose:short(String(item.purpose??'')),effects:item.effects??null,scope:item.scope??null,providerReady:item.providerReady??null}:item)
    .sort((left,right)=>String(record(left)?left.id:'').localeCompare(String(record(right)?right.id:''))):undefined;
  return {...(features?{features}:{}) , ...(actions?{actions}:{})};
}
export interface CapabilityIndexInput {
  configured:Json;
  callable:readonly {name:string;description:string}[];
  host:null|{configured:boolean;available:boolean;code:string|null;execution:string;version:string|null;
    tools:readonly {name:string;description:string}[];skills:readonly {name:string;description:string;load?:unknown}[];skillsComplete:boolean};
}
/** Model-visible capability index: names, short purposes and real versions only. Full details stay queryable. */
export function renderCapabilityIndex(input:CapabilityIndexInput):string {
  const callable=input.callable.map(tool=>({name:tool.name,purpose:short(tool.description)})).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
  const host=input.host?{configured:input.host.configured,available:input.host.available,code:input.host.code,execution:input.host.execution,version:input.host.version,
    tools:input.host.tools.map(tool=>({name:tool.name,purpose:short(tool.description)})).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0),
    skills:input.host.skills.map(skill=>({name:skill.name,purpose:short(skill.description)})).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0),skillsComplete:input.host.skillsComplete}:null;
  const base={kind:'configured-capabilities',instructionAuthority:false,configured:compactConfigured(input.configured),callable,host,
    note:'这里只列名称、简短用途和版本；完整说明、参数与技能内容通过dafeiyu_capabilities、dsh_tool_list或技能加载按需查询。'};
  const version=createHash('sha256').update(stableJson(base)).digest('hex').slice(0,16);
  return stableJson({...base,version});
}

/** Reuses DSH assembly, native schemas and its tool loop. No model or second planner here. */
export class HarnessRuntime {
  private readonly sections=new Map<string,number>();
  private readonly standardSections=new Set(['harness:identity','deployment:persona-prefix','deployment:persona-suffix','tools:ptc-only','tools:sdk',
    'dafeiyu-persona','dafeiyu-memory-habit','dafeiyu-execution-rules','dafeiyu-compaction-rules','dafeiyu-harness-principles']);
  constructor(private readonly configured:()=>Json=()=>null){}
  /** Program-only registration for trusted deployment guidance; never accepted through a tool. */
  allowSection(name:string):()=>void {if(!/^[a-z][a-z0-9:._-]{0,159}$/.test(name))throw new Error('INVALID_HARNESS_SECTION');
    this.sections.set(name,(this.sections.get(name)??0)+1);let active=true;return ()=>{if(!active)return;active=false;const count=(this.sections.get(name)??1)-1;if(count)this.sections.set(name,count);else this.sections.delete(name);};}
  acceptsSection(name:string):boolean{return this.standardSections.has(name)||this.sections.has(name);}
  private provider:Pick<DshToolsPort,'catalog'>|undefined;
  bind(provider:Pick<DshToolsPort,'catalog'>):()=>void {
    if(this.provider)throw new Error('DSH_HARNESS_ALREADY_BOUND');
    const bound={catalog:provider.catalog.bind(provider)};this.provider=bound;
    return ()=>{if(this.provider===bound)this.provider=undefined;};
  }
  install(scope:Context,agent:Agent,actions:readonly NativeAction[],signal:AbortSignal,taskId?:string):()=>void {
    const dispatch=actions.find(action=>action.definition.owner==='dsh-tools'&&action.definition.id==='dsh_tool_call');
    const canInspect=!!dispatch||actions.some(action=>action.definition.owner==='dsh-tools'&&action.definition.id==='dsh_tool_list');
    const aliases=new Map<string,{dispose:()=>void;fingerprint:string}>(),reserved=new Set(scope.tools.schemas(agent).map(tool=>tool.name));
    let catalog:DshToolCatalog|undefined,available=false,unavailableCode:string|null=null;
    const disposeAliases=()=>{for(const entry of aliases.values())entry.dispose();aliases.clear();};
    const refresh=async()=>{
      signal.throwIfAborted();if(!canInspect)return;
      const provider=this.provider;if(!provider){available=false;unavailableCode='DSH_HARNESS_UNAVAILABLE';disposeAliases();return;}
      try{catalog=orderedDshCatalog(await provider.catalog(signal,taskId));signal.throwIfAborted();if(provider!==this.provider)throw new Error('DSH_HARNESS_CHANGED');available=true;unavailableCode=null;}
      catch(error){signal.throwIfAborted();available=false;unavailableCode=error instanceof Error&&/^[A-Z0-9_]{1,100}$/.test(error.message)?error.message:'DSH_CATALOG_UNAVAILABLE';disposeAliases();return;}
      const current=catalog,admitted=new Set<string>();
      if(dispatch)for(const tool of current.tools){
        if(reserved.has(tool.name))continue;
        try{assertObjectJsonSchema(tool.parameters);}catch{continue;}
        const fingerprint=stableJson(z.json().parse(tool));admitted.add(tool.name);
        if(aliases.get(tool.name)?.fingerprint===fingerprint)continue;
        aliases.get(tool.name)?.dispose();
        const parameters=tool.parameters;
        const dispose=scope.tools.register({name:tool.name,description:tool.description,parameters,
          output:{schema:{},render:(_args,value)=>[{type:'text',text:JSON.stringify(z.object({value:z.json()}).parse(value).value)}],
            presentationMeta:(_args,value)=>z.json().parse({dafeiyuExecution:z.object({receipt:z.json()}).parse(value).receipt})},
          execute:async(raw,exec)=>{
            if(exec.agent!==agent||!catalog||!available||!dispatch.definition.active())throw new Error('DSH_CAPABILITY_UNAVAILABLE');
            const args=z.json().parse(raw);if(validateJsonSchemaValue(parameters,args).length)throw new Error('DSH_TOOL_ARGUMENTS_INVALID');
            const value=await dispatch.execute({catalogVersion:catalog.version,name:tool.name,argumentsJson:stableJson(args)},String(exec.callId),AbortSignal.any([signal,exec.signal]));
            return {value,receipt:dispatch.metadata?.(value)??null};
          }});
        aliases.set(tool.name,{dispose,fingerprint});
      }
      for(const [name,entry] of aliases)if(!admitted.has(name)){entry.dispose();aliases.delete(name);}
    };
    const disposeRules=scope.systemPrompt.section({name:'dafeiyu-harness-principles',order:10,interpolate:false,text:rules});
    const manifest=()=>renderCapabilityIndex({configured:this.configured(),callable:scope.tools.schemas(agent),
      host:canInspect?{configured:!!this.provider,available,code:unavailableCode,execution:dispatch?'authorized-task':'requires-authorized-task',
        version:available?catalog?.version??null:null,tools:available?catalog?.tools??[]:[],skills:available?catalog?.skills??[]:[],skillsComplete:available?catalog?.skillsComplete??true:false}:null});
    const disposeContext=scope.systemPrompt.context({name:CAPABILITY_CONTEXT,order:0,required:true,interpolate:false,text:manifest});
    const disposeAssembly=scope.on('system-prompt/assemble',async(_assembly,_context,next)=>{
      await refresh();const assembled=await next();
      // The registry was assembled before this async boundary; publish the refreshed authorized schemas.
      return {...assembled,tools:scope.tools.schemas(agent).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0),
        contexts:[...assembled.contexts.filter(context=>context.name!==CAPABILITY_CONTEXT),{name:CAPABILITY_CONTEXT,text:manifest(),interpolate:false}]};
    });
    return ()=>{disposeAssembly();disposeContext();disposeRules();disposeAliases();};
  }
}
