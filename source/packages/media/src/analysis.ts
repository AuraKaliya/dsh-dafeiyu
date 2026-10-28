import { Context } from '@deepseek-ai/cordis';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import SessionStore,{SessionId} from '@deepseek-ai/dsh-session';
import Projection from '@deepseek-ai/dsh-session-projection';
import * as Persistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import Prompt from '@deepseek-ai/dsh-system-prompt';
import Tools from '@deepseek-ai/dsh-tools';
import LlmRuntime,{LlmAdapter,createUserMessage,ReasoningEffortId} from '@deepseek-ai/dsh-llm';
import type { GenerateOptions,StreamChunk } from '@deepseek-ai/dsh-llm';
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
import { randomUUID } from 'node:crypto';
import { ScopedImages } from './images.js';
import {abortable} from './files.js';

export interface MediaModelRoute {provider:string;model:string;reasoningEffort?:string}
class MediaTransport extends LlmAdapter {
  constructor(private readonly host:Context,private readonly session:string,private readonly images:ScopedImages,private readonly lease:string|undefined,private readonly guard:()=>void,private readonly signal:AbortSignal){super();}
  override resolveModel(provider:string,model:string,signal?:AbortSignal){return this.host.llm.resolveModelInfo(provider,model,signal);}
  override async *stream(options:GenerateOptions):AsyncIterable<StreamChunk>{
    this.guard();if(options.sessionId!==this.session||options.tools?.length)throw new Error('MEDIA_ANALYSIS_SCOPE_DENIED');
    const signal=AbortSignal.any([this.signal,...(options.signal?[options.signal]:[])]),iterator=this.host.llm.stream({...options,signal})[Symbol.asyncIterator](),visible=new Map<number,number>();let bytes=0;
    try{while(true){signal.throwIfAborted();this.guard();const next=await abortable(this.lease?this.images.run(this.lease,()=>iterator.next()):iterator.next(),signal);if(next.done)break;signal.throwIfAborted();this.guard();const chunk=next.value;
      if(chunk.type==='block-start'){if(chunk.blockType==='tool-call')throw new Error('MEDIA_ANALYSIS_TOOL_DENIED');if(chunk.blockType!=='text')continue;const index=visible.size;visible.set(chunk.index,index);yield {...chunk,index};}
      else if(chunk.type==='text-delta'||chunk.type==='block-end'){const index=visible.get(chunk.index);if(index===undefined)continue;
        if(chunk.type==='text-delta'){bytes+=Buffer.byteLength(chunk.text);if(bytes>32000)throw new Error('MEDIA_ANALYSIS_OUTPUT_LIMIT');}
        else if(chunk.block.type!=='text'||Buffer.byteLength(chunk.block.text)>32000)throw new Error('MEDIA_ANALYSIS_INVALID');yield {...chunk,index};}
      else if(chunk.type==='usage')yield chunk;
      else if(chunk.type==='finish')yield {type:'finish',reason:chunk.reason.kind==='error'||chunk.reason.kind==='aborted'?{kind:chunk.reason.kind,failure:{message:'Media analysis did not complete',code:'MEDIA_ANALYSIS_FAILED'}}:chunk.reason};
    }}finally{const closing=iterator.return?.();if(signal.aborted)void closing?.catch(()=>{});else await closing;}
  }
}
/** DSH owns the only model loop. Each read gets an isolated session and ephemeral image lease. */
export class MediaAnalysis {
  constructor(private readonly host:Context,private readonly images:ScopedImages,private readonly directory:string){}
  async run<T>(job:{route:MediaModelRoute;instructions:string;input:unknown;refs?:readonly ImageAttachmentRef[];lease?:string;guard:()=>void;parse:(value:unknown)=>T},signal:AbortSignal):Promise<T>{
    signal.throwIfAborted();job.guard();
    const model=await this.host.llm.resolveModelInfo(job.route.provider,job.route.model,signal);
    if(job.refs?.length&&!model.inputModalities?.includes('image'))throw new Error('MEDIA_IMAGE_MODEL_UNAVAILABLE');
    const ctx=new Context(),sessionId=SessionId('media-analysis-'+randomUUID());
    try{await ctx.plugin(LlmRuntime);await ctx.plugin(SessionStore);await ctx.plugin(Projection);await ctx.plugin(Prompt);await ctx.plugin(Tools);await ctx.plugin(AgentRegistry);
      await ctx.plugin(Persistence,{root:this.directory,compression:'none'});await ctx.plugin(AgentLoop,{agents:[]});
      ctx.llm.registerAdapter([job.route.provider],new MediaTransport(this.host,sessionId,this.images,job.lease,job.guard,signal));
      const handle=await ctx.agents.create({sessionId,meta:{cwd:this.directory},agentOptions:{provider:job.route.provider,model:job.route.model,maxTokens:Math.min(8192,model.defaultMaxTokens??8192),...(job.route.reasoningEffort?{reasoningEffort:ReasoningEffortId(job.route.reasoningEffort)}:{})},setup:scope=>{
        scope.systemPrompt.section({name:'media-analysis',order:0,complete:true,interpolate:false,text:job.instructions});scope.tools.presentAs('native');scope.tools.restrict({allow:[]});}});
      const agent=handle.agent,abort=()=>agent.cancel({kind:'hook',reason:'Media analysis cancelled'});signal.addEventListener('abort',abort,{once:true});
      try{signal.throwIfAborted();job.guard();agent.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text:JSON.stringify(job.input)},...(job.refs??[]).map(attachment=>({type:'image' as const,attachment}))]}));await agent.whenIdle();
        signal.throwIfAborted();job.guard();if(!await ctx.sessions.flush(agent.session))throw new Error('MEDIA_CHECKPOINT_UNAVAILABLE');
        const events=agent.session.snapshotEvents(),end=events.findLast(e=>e.type==='turn/end');if(!end||end.type!=='turn/end'||end.data.reason.kind!=='completed')throw new Error('MEDIA_ANALYSIS_FAILED');
        const message=events.findLast(e=>e.type==='assistant/message'&&!e.data.interrupted&&e.data.turn===end.data.turn);if(!message||message.type!=='assistant/message')throw new Error('MEDIA_ANALYSIS_FAILED');
        let text=message.data.message.content.filter(b=>b.type==='text').map(b=>b.text).join('\n').trim();if(Buffer.byteLength(text)>32000)throw new Error('MEDIA_ANALYSIS_OUTPUT_LIMIT');
        const fence=/^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(text);if(fence)text=fence[1]!;try{return job.parse(JSON.parse(text));}catch{throw new Error('MEDIA_ANALYSIS_INVALID');}
      }catch(error){if(signal.aborted)throw new Error(signal.reason instanceof Error&&signal.reason.name==='TimeoutError'?'MEDIA_ANALYSIS_TIMEOUT':'MEDIA_CANCELLED');throw error;}
      finally{signal.removeEventListener('abort',abort);await handle.dispose();}
    }finally{await ctx.fiber.dispose();}
  }
}
