import { resolve } from 'node:path';
import * as Core from '@dafeiyu/core';
import * as Timeline from '@dafeiyu/timeline';
import * as Memory from '@dafeiyu/memory';
import { probeHost } from './phase1-probe-fixture.js';
import { ScriptedModel,textReply } from './harness.js';
import type { Response } from './harness.js';
import type { ExtensionV3,Conversation } from '@dafeiyu/contracts';
import type { Context } from '@deepseek-ai/cordis';

export async function executionHarness(root:string,response:Response=()=>textReply('内部任务已完成'),extension?:Omit<ExtensionV3,'protocolVersion'|'agentId'>,create=true,options:{timelineExecution?:boolean;personaActions?:boolean;executionActions?:boolean;compaction?:Memory.Config['compaction'];context?:Core.Config['context'];sourceTracking?:boolean;maintenance?:Memory.Config['maintenance'];extraActions?:string[];extraProducers?:string[];resources?:Conversation[];maxConcurrentRuns?:number;turnTimeoutMs?:number;beforeActivate?:(ctx:Context)=>Promise<void>}={}){
  const adapter=new ScriptedModel(response),host=await probeHost(root,adapter),{ctx}=host;
  try{
    await ctx.plugin(Core,{agentId:'dafeiyu',dataDir:resolve(root,'core'),personaFile:resolve('profiles/persona.test.md'),provider:'local-test',model:'scripted',lifecycleMode:'managed',turnTimeoutMs:options.turnTimeoutMs??10000,...(options.context?{context:options.context}:{})});
    await ctx.plugin(Timeline,{agentId:'dafeiyu',execution:options.timelineExecution??false});
    await ctx.plugin(Memory,{agentId:'dafeiyu',dataDir:resolve(root,'memory'),lifecycleMode:'managed',sourceTracking:options.sourceTracking??false,...(options.compaction?{compaction:options.compaction}:{}),...(options.maintenance?{maintenance:options.maintenance}:{})});
    const extensionHandle=extension?ctx.dafeiyu.registerExtensionV3({...extension,protocolVersion:3,agentId:'dafeiyu'}):undefined;
    const personaActions=options.personaActions?['dafeiyu_persona_status','dafeiyu_persona_propose','dafeiyu_persona_review','dafeiyu_persona_trial_select','dafeiyu_persona_adoption_review','dafeiyu_persona_publish','dafeiyu_persona_select','dafeiyu_persona_withdraw']:[];
    const executionActions=options.executionActions?['dafeiyu_execution_source_open','dafeiyu_execution_contribute','dafeiyu_execution_select','dafeiyu_execution_source_state','dafeiyu_execution_contribution_state','dafeiyu_task_object','dafeiyu_task_intent']:[];
    ctx.dafeiyu.configureExecution({profileId:'test',createStore:create,...(options.maxConcurrentRuns?{maxConcurrentRuns:options.maxConcurrentRuns}:{}),policies:[{id:'test-policy',producers:['local-test','wake-test',...(options.extraProducers??[])],actions:[...(extension?.actions?.map(a=>a.id)??[]),...(options.timelineExecution?['dafeiyu_execution_events']:[]),...personaActions,...executionActions,...(options.extraActions??[])],allowLocalWrite:true,sourceRules:[],resources:options.resources??[]},
      {id:'conversation',producers:['channel-simulator'],actions:extension?.actions?.map(a=>a.id)??[],allowLocalWrite:true,sourceRules:[]}]});
    await options.beforeActivate?.(ctx);
    ctx.dafeiyuMemory.recover();ctx.dafeiyuMemory.activate();await ctx.dafeiyu.recoverExecutions();ctx.dafeiyu.recover();ctx.dafeiyu.activate();
    return {ctx,core:ctx.dafeiyu,memory:ctx.dafeiyuMemory,adapter,extensionHandle,port:ctx.dafeiyu.executionProducer('local-test'),
      close:async()=>{ctx.dafeiyu.quiesce();try{await ctx.dafeiyu.whenIdle();}finally{try{await ctx.dafeiyu.close();}finally{await host.close();}}}};
  }catch(error){await host.close();throw error;}
}
