import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import * as Timeline from '@dafeiyu/timeline';
import * as Memory from '@dafeiyu/memory';
import Query from '@deepseek-ai/dsh-session-query-sqlite';
import { CapabilitySelectionSchema,ConversationSchema } from '@dafeiyu/contracts';
import type { Conversation,ExecutionContext,PersonaSourceRef } from '@dafeiyu/contracts';
import { harness, textReply } from './harness.js';
import type { Response } from './harness.js';
import { testTempDir as tmpdir } from './test-temp.js';

export const capabilityScene:Conversation={channel:'simulator',account:'local',kind:'local',id:'a'};
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function capabilityFixture(){
  const root=await mkdtemp(join(tmpdir(),'dafeiyu-capability-')),state={version:1,valid:true,throwSelect:false,reads:0};
  let response:Response=()=>textReply('完成'),source:PersonaSourceRef|undefined,captured:ExecutionContext|undefined;
  let readHook:(context:ExecutionContext)=>void=()=>{};
  const h=await harness(root,request=>response(request),undefined,10000,undefined,undefined,true);
  await h.ctx.plugin(Query,{path:join(root,'query.sqlite'),openAt:'never'});
  await h.ctx.plugin(Timeline,{agentId:'dafeiyu'});const memory=await h.ctx.plugin(Memory,{agentId:'dafeiyu',dataDir:join(root,'memory'),});
  const page={messages:[{id:'M1',text:'QQ_RAW_VIEW_SENTINEL：这是一份尚未核实的虚构观察。'}],limitations:['文字样本，不代表媒体理解']};
  const view=JSON.stringify(page),receipts:Record<string,unknown>[]=[];
  const fail=(error:unknown)=>{const code=error instanceof Error?error.message:'FAILED';if(code==='SIMULATED_STORAGE_UNKNOWN')throw error;return {status:'failed' as const,effects:'none' as const,completeness:'unknown' as const,data:null,sources:[],receipts:[],errorCode:/^[A-Z_]+$/.test(code)?code:'OBSERVATION_FAILED'};};
  const handle=h.core.registerExtension({protocolVersion:4,id:'fixture-observer',version:'1',agentId:'dafeiyu',resourceProofs:{current:proof=>state.valid&&proof.version===state.version,epoch:()=>JSON.stringify(state)},actions:[
    {id:'qq_browse',version:'1',description:'读取虚构能力资料',inputSchema:z.strictObject({requestId:z.string(),scene:ConversationSchema.optional()}),outputSchema:z.json(),effects:'read',
      execute:async(raw,context)=>{try{captured=context;const input=z.object({requestId:z.string(),scene:ConversationSchema.optional()}).parse(raw),scene=input.scene??h.core.capabilityResources(context,'fixture-observer')[0]!;
        h.core.authorizeCapabilityResource(context,'fixture-observer',scene);readHook(context);state.reads++;
        const result=h.core.recordCapabilityObservation(context,'fixture-observer',{requestId:input.requestId,proof:{provider:'fixture-observer',scene,key:'fixture-message',version:state.version,hash:hash(page),roots:['fixture:message:M1'],detail:{id:'M1'}},text:view,
          occurredAt:'2026-10-25T00:00:00.000Z',counts:{received:1,processed:1},coverage:['fictional-text']});source=result.source;
        return {status:'succeeded',effects:'none',completeness:'complete',data:z.json().parse({page,observation:result}),sources:[{id:source.id,scopeKey:source.scopeKey,version:source.version,contentHash:source.contentHash}],receipts:[]};
      }catch(error){return fail(error);}}},
    {id:'qq_observe_select',version:'1',description:'选择虚构观察',inputSchema:CapabilitySelectionSchema,outputSchema:z.json(),effects:'local-write',
      execute:async(input,context)=>{try{if(state.throwSelect)throw new Error('SIMULATED_STORAGE_UNKNOWN');const receipt=h.core.selectCapabilityObservation(context,'fixture-observer',h.core.capabilityResources(context,'fixture-observer')[0]!,input,view);receipts.push(receipt);
        return {status:'succeeded',effects:'confirmed',completeness:'complete',data:z.json().parse(receipt),sources:[],receipts:[]};}catch(error){return fail(error);}}},
  ]});
  h.core.configureExecution({profileId:'capability-fixture',createStore:true,policies:[{id:'conversation',producers:['channel-simulator'],actions:['qq_browse','qq_observe_select',...["dafeiyu_memory_record","dafeiyu_memory_revise","dafeiyu_memory_delete","dafeiyu_memory_restore","dafeiyu_memory_search","dafeiyu_memory_open","dafeiyu_memory_deleted_search","dafeiyu_memory_deleted_open"]],allowLocalWrite:true,resources:[capabilityScene]},
    {id:'native',producers:['fixture-native'],actions:['qq_browse','qq_observe_select'],allowLocalWrite:true,resources:[capabilityScene]}]});
  h.ctx.dafeiyuMemory.recover();h.ctx.dafeiyuMemory.activate();await h.core.recoverExecutions();h.core.recover();h.core.activate();
  return {...h,root,state,page,view,receipts,source:()=>source!,captured:()=>captured!,setResponse:(next:Response)=>{response=next;},setReadHook:(next:typeof readHook)=>{readHook=next;},unload:()=>handle.dispose(),
    chat:async(room='a',text='按需读取虚构资料')=>{const receipt=h.simulator.send(room,text,{id:crypto.randomUUID()});await h.core.whenIdle();return h.core.journal.get(receipt.id);},
    close:async()=>{await h.core.whenIdle();handle.dispose();await memory.dispose();await h.close();}};
}
