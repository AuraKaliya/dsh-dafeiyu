import { randomUUID } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-tools';
import type { ExecutorChildBudgetClient } from './child.js';
import type { ExecutorToolReceipt } from './protocol.js';
import { executorHash } from './types.js';

/** Runs inside the dedicated official ToolRuntime, including nested dispatches; no parameter/result text crosses IPC. */
export function installHeadlessToolGuard(ctx:Context,client:ExecutorChildBudgetClient,allowedTools:readonly string[],guard:()=>void):()=>void{
  const allowed=new Set(allowedTools),denied=()=>{try{guard();client.signal.throwIfAborted();return undefined;}catch{return 'EXECUTOR_CHILD_AUTHORITY_CLOSED';}};
  const monotonic=ctx.tools.guard(exec=>denied()??(allowed.has(exec.name)?undefined:'EXECUTOR_TOOL_DENIED'));
  const dispatch=ctx.on('tools/execute',async(exec,next)=>{
    guard();client.signal.throwIfAborted();exec.signal.throwIfAborted();if(!allowed.has(exec.name))throw new Error('EXECUTOR_TOOL_DENIED');
    const callId=randomUUID(),permitId=await client.authorizeTool({callId,name:exec.name,sourceCallHash:executorHash({callId:exec.callId,rootCallId:exec.rootCallId}),sessionHash:executorHash(String(exec.agent?.session.id??'')),argumentsHash:executorHash(exec.arguments)});
    exec.signal=AbortSignal.any([exec.signal,client.signal]);let state:ExecutorToolReceipt['state']='unknown';
    try{exec.signal.throwIfAborted();const result=await next();state=result.isError?(exec.signal.aborted?'aborted':'error'):'completed';return result;}
    catch(error){state=exec.signal.aborted?'aborted':'unknown';throw error;}
    finally{await client.finishTool({callId,permitId,state});}
  },{global:true});
  return ()=>{dispatch();monotonic();};
}
