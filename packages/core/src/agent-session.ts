import type { Context } from '@deepseek-ai/cordis';
import type { Agent,AgentOptions } from '@deepseek-ai/dsh-agent';
import type { UserMessage } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import type {} from '@deepseek-ai/dsh-session-persistence';
import type {} from '@deepseek-ai/dsh-compaction/types';
import { createHash } from 'node:crypto';
import type { RunResultRef } from './runtime-store.js';
import {z} from 'zod';
import {setTimeout as wait} from 'node:timers/promises';
const visibleFailure=z.object({kind:z.literal('error'),error:z.object({message:z.string(),code:z.string().optional(),status:z.number().int().optional()})});
const contextFailures:Readonly<Record<string,string>>={'Required context exceeds budget':'REQUIRED_CONTEXT_CAPACITY','Required context unavailable':'REQUIRED_CONTEXT_UNAVAILABLE','Required context stale':'SOURCE_STALE',
  'Required context contributor missing':'REQUIRED_CONTEXT_PROVIDER_MISSING','Context request budget exceeded':'CONTEXT_REQUEST_CAPACITY'};
export function safeRunFailure(message:string):string{if(message.startsWith('unsupported JSON schema:'))return 'TOOL_SCHEMA_UNSUPPORTED';return contextFailures[message]??(['TOOL_SCHEMA_UNSUPPORTED','SOURCE_VALIDATION_FAILED','SOURCE_STALE','PERSISTENCE_FAILED','MODEL_INCOMPLETE','DELIVERY_RENDER_TIMEOUT','SESSION_COMPACTION_ACTIVE',
  'CONTEXT_REQUEST_CAPACITY','MODEL_CONTEXT_CAPACITY','PERSONA_CONTEXT_CAPACITY','REQUIRED_CONTEXT_CAPACITY','REQUIRED_CONTEXT_UNAVAILABLE','REQUIRED_CONTEXT_PROVIDER_MISSING','NATIVE_CONTEXT_SNAPSHOT_MISMATCH','CONTEXT_PREPARE_TIMEOUT',
  'INVALID_MODEL_STREAM','INVALID_MODEL_ARGUMENTS','MODEL_PERSISTENCE_POLICY_UNSUPPORTED','PRIVATE_INPUT_REJECTED'].includes(message)||/^MODEL_[A-Z0-9_]{1,64}$/.test(message)?message:'MODEL_INCOMPLETE');}
/** Preserve a provider's machine-readable failure without returning its potentially private message. */
export function turnFailureCode(value:unknown):string {
  const parsed=visibleFailure.safeParse(value);if(!parsed.success)return 'MODEL_INCOMPLETE';
  const {message,code,status}=parsed.data.error,local=safeRunFailure(message);
  if(local!=='MODEL_INCOMPLETE')return local;
  if(code&&['CONTEXT_LENGTH_EXCEEDED','MAX_CONTEXT_LENGTH','CONTEXT_WINDOW_EXCEEDED','INPUT_TOO_LONG'].includes(code))return 'MODEL_CONTEXT_CAPACITY';
  if(status!==undefined&&status>=400&&status<600)return `MODEL_HTTP_${status}`;
  if(code&&/^[A-Z][A-Z0-9_]{0,57}$/.test(code))return safeRunFailure(code)!=='MODEL_INCOMPLETE'?code:code.startsWith('MODEL_')?code:`MODEL_${code}`;
  return 'MODEL_INCOMPLETE';
}

/** The two execution origins share DSH ownership, flush and final-message rules. */
export async function openAgentSession(ctx:Context,id:string,model:AgentOptions,cwd:string,setup:(scope:Context)=>void){
  const sessionId=SessionId(id);
  const configure=(scope:Context)=>{
    setup(scope);
    let attemptKey='',retries=0;
    scope.on('agent/request-error',async(payload,next)=>{
      const key=payload.turn+':'+payload.step;if(key!==attemptKey){attemptKey=key;retries=0;}
      const transient=['TRANSPORT','CONNECTION_ERROR','NETWORK_ERROR','TIMEOUT','MESSAGES_IDLE'].includes(payload.failure.code)
        ||[429,502,503,504].includes(payload.failure.status??0);
      if(!transient||retries>=2)return next();
      await wait(750*2**retries++,undefined,{signal:payload.signal});
      return {kind:'retry' as const};
    });
    scope.on('agent/request',async({agent,signal},next)=>{
      const request=await next(),info=await ctx.llm.resolveModelInfo(request.provider,request.model,signal);
      const window=Math.min(ctx.dafeiyu?.contextBudget().maxTokens??1000000,info.context?.contextWindow??1000000);
      const wanted=model.maxTokens??Math.min(info.defaultMaxTokens??32768,Math.max(2048,Math.floor(window/50)));
      const meter=scope.get('tokenMeter'),messages=agent.session.deriveMessages();
      const estimate=messages.reduce((sum,message)=>sum+(meter?meter.estimateMessage(message):Math.ceil(JSON.stringify(message.content).length/3)),0);
      return {...request,maxTokens:Math.min(wanted,Math.max(Math.min(wanted,2048),window-estimate))};
    });
  };
  return await ctx.sessionPersistence.stat(sessionId)
    ?ctx.agents.resume({resumeSessionId:sessionId,agentOptions:model,setup:configure})
    :ctx.agents.create({sessionId,meta:{cwd},agentOptions:model,setup:configure});
}
export async function runAgentTurn(ctx:Context,agent:Agent,input:UserMessage,signal:AbortSignal,afterIdle:()=>void=()=>{},allowEmpty:()=>boolean=()=>false){
  if(agent.status!=='idle')throw new Error('SESSION_BUSY');
  const compacting=new Set<string>();
  for(const event of agent.session.snapshotEvents()){
    // DSH's recovery boundary abandons unfinished scopes from the prior process.
    if(event.type==='session/end-seed')compacting.clear();
    if(event.type==='compaction/start')compacting.add(event.data.compactionId);
    if(event.type==='compaction/end')compacting.delete(event.data.compactionId);
  }
  if(compacting.size)throw new Error('SESSION_COMPACTION_ACTIVE');
  signal.throwIfAborted();const before=agent.session.snapshotEvents().length;
  const abort=()=>agent.cancel({kind:'hook',reason:'Dafeiyu run cancelled'});
  signal.addEventListener('abort',abort,{once:true});
  try{
    agent.followup(input);await agent.whenIdle();afterIdle();
    if(!await ctx.sessions.flush(agent.session))throw new Error('PERSISTENCE_FAILED');
    signal.throwIfAborted();const events=agent.session.snapshotEvents().slice(before);
    const ended=events.findLast(event=>event.type==='turn/end');
    if(!ended||ended.type!=='turn/end'||ended.data.reason.kind!=='completed')throw new Error(ended?.type==='turn/end'?turnFailureCode(ended.data.reason):'MODEL_INCOMPLETE');
    const output=events.findLast(event=>event.type==='assistant/message'&&!event.data.interrupted&&event.data.turn===ended.data.turn);
    if(!output||output.type!=='assistant/message')throw new Error('MODEL_INCOMPLETE');
    const text=output.data.message.content.filter(block=>block.type==='text').map(block=>block.text).join('\n').trim();
    if(!text&&!allowEmpty())throw new Error('MODEL_INCOMPLETE');
    return {text,events,messageSeq:output.seq,turnEndSeq:ended.seq};
  }finally{signal.removeEventListener('abort',abort);}
}
export async function readPersistedResult(ctx:Context,ref:RunResultRef):Promise<string>{
  const reader=await ctx.sessionPersistence.open(SessionId(ref.sessionId),'read');
  try{const {events}=await reader.read(ref.messageSeq,ref.turnEndSeq-ref.messageSeq+1),message=events.find(event=>event.seq===ref.messageSeq),end=events.find(event=>event.seq===ref.turnEndSeq);
    if(message?.type!=='assistant/message'||message.data.interrupted||end?.type!=='turn/end'||end.data.reason.kind!=='completed'||message.data.turn!==end.data.turn)throw new Error('RESULT_BINDING_CONFLICT');
    const text=message.data.message.content.filter(block=>block.type==='text').map(block=>block.text).join('\n').trim();
    if(createHash('sha256').update(text).digest('hex')!==ref.textHash)throw new Error('RESULT_BINDING_CONFLICT');return text;
  }finally{await reader.close();}
}
