import { Context } from '@deepseek-ai/cordis';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import SessionStore from '@deepseek-ai/dsh-session';
import Projection from '@deepseek-ai/dsh-session-projection';
import * as Persistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import Prompt from '@deepseek-ai/dsh-system-prompt';
import Tools from '@deepseek-ai/dsh-tools';
import LlmRuntime,{LlmAdapter,ToolCallId} from '@deepseek-ai/dsh-llm';
import type { GenerateOptions,LlmResolvedModelInfo,StreamChunk } from '@deepseek-ai/dsh-llm';
import { randomUUID } from 'node:crypto';

export class FixtureAdapter extends LlmAdapter {
  readonly requests:GenerateOptions[]=[];
  constructor(readonly respond:(request:GenerateOptions,call:number)=>AsyncIterable<StreamChunk>){super();}
  override async resolveModel(provider:string,model:string):Promise<LlmResolvedModelInfo>{return {provider,id:model,name:model,
    systemPromptUpdate:'in-history',toolUpdate:'in-history',inputModalities:['text','image'],defaultMaxTokens:2048,context:{contextWindow:65536}};}
  override async *stream(request:GenerateOptions){request.signal?.throwIfAborted();this.requests.push(request);yield* this.respond(request,this.requests.length);}
}
export async function* textResponse(text:string):AsyncIterable<StreamChunk>{
  yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text};
  yield {type:'block-end',index:0,block:{type:'text',text}};yield {type:'finish',reason:{kind:'stop'}};
}
export async function* toolResponse(name:string,args:unknown):AsyncIterable<StreamChunk>{
  const id=ToolCallId(randomUUID()),argumentsJson=JSON.stringify(args);
  yield {type:'block-start',index:0,blockType:'tool-call'};
  yield {type:'tool-call-delta',index:0,id,name,argumentsDelta:argumentsJson};
  yield {type:'block-end',index:0,block:{type:'tool-call',id,name,arguments:argumentsJson}};
  yield {type:'finish',reason:{kind:'tool-calls'}};
}
export async function sdkFixture(root:string,adapter:FixtureAdapter){
  const ctx=new Context();
  await ctx.plugin(LlmRuntime);await ctx.plugin(SessionStore);await ctx.plugin(Projection);await ctx.plugin(Prompt);
  await ctx.plugin(Tools);await ctx.plugin(AgentRegistry);await ctx.plugin(Persistence,{root,compression:'none'});
  await ctx.plugin(AgentLoop,{agents:[]});ctx.llm.registerAdapter(['fixture'],adapter);
  return ctx;
}
