import { createHash,randomUUID } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-llm';
import type { StreamChunk } from '@deepseek-ai/dsh-llm';
import { normalizeExecutorUsage } from '@dafeiyu/server-executor/protocol';
import type { ExecutorSettlement,ExecutorUsage } from '@dafeiyu/server-executor/protocol';
import { SharedModelBudget } from './shared-budget.js';
import type { CallLease } from './call-gate.js';
import { RuntimeIdentitySchema,runtimeCode } from './types.js';

const installed=new WeakSet<object>();
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
/** Race an actual in-flight read against the per-call cancel signal (timeout or explicit cancel). */
export function raceCall<T>(operation:Promise<T>,signal:AbortSignal):Promise<T>{
  signal.throwIfAborted();
  return new Promise<T>((resolve,reject)=>{
    const onAbort=()=>reject(new Error('RUNTIME_CALL_CANCELLED'));
    signal.addEventListener('abort',onAbort,{once:true});
    operation.then(value=>{signal.removeEventListener('abort',onAbort);resolve(value);},
      error=>{signal.removeEventListener('abort',onAbort);reject(error);});
  });
}

/**
 * A generator blocked inside next() queues return() behind that read. Bound cleanup so
 * settlement and the call gate are not held by a transport that ignores cancellation.
 */
export async function closeIterator(iterator:AsyncIterator<unknown>|undefined,timeoutMs=250):Promise<void>{
  if(!iterator?.return)return;
  let closing:Promise<unknown>;
  try{closing=Promise.resolve(iterator.return());}catch{return;}
  closing.catch(()=>{});
  await Promise.race([closing,new Promise<void>(resolve=>{const timer=setTimeout(resolve,Math.max(1,timeoutMs));timer.unref();})]);
}
export interface ParentModelAdmissionOptions {
  readonly profileId:string;
  readonly maximumCallMs:number;
  /** Cancels the actual owners' work controllers, including isolated analysis contexts. */
  readonly cancelActive:(code:string)=>void;
  /** Optional call-level lease; absent keeps the gate FIFO. */
  readonly leaseFor?:(request:{readonly purpose?:string;readonly sessionId?:string})=>CallLease|undefined;
  readonly guard?:()=>void;
}

/** Await before Core activation: a provider's oversized default must fail startup, not the first user Run. */
export async function validateParentModelAdmission(ctx:Context,budget:SharedModelBudget,signal?:AbortSignal):Promise<void> {
  signal?.throwIfAborted();budget.assertReady();const route=budget.route;
  const model=await ctx.llm.resolveModelInfo(route.provider,route.model,signal),output=model.defaultMaxTokens??model.context?.contextWindow;
  if(model.context?.contextWindow!==route.contextWindow||output===undefined||!Number.isSafeInteger(output)||output<1||output>route.maxOutputTokens)throw new Error('RUNTIME_PROVIDER_DEFAULT_MISMATCH');
  if(route.reasoningEffort===null?model.reasoning?.defaultEffort!==undefined:!model.reasoning?.efforts.some(effort=>effort.id===route.reasoningEffort))throw new Error('RUNTIME_PROVIDER_REASONING_MISMATCH');
  signal?.throwIfAborted();budget.assertReady();
}

/** The official frozen request and prepared adapter binding are preserved; next() is invoked once. */
export function installParentModelAdmission(ctx:Context,budget:SharedModelBudget,options:ParentModelAdmissionOptions):()=>void {
  const profileId=RuntimeIdentitySchema.parse(options.profileId);
  if(!Number.isSafeInteger(options.maximumCallMs)||options.maximumCallMs<1||options.maximumCallMs>3600000)throw new Error('RUNTIME_CALL_TIMEOUT_INVALID');
  // Cordis may return a new traced proxy for each ctx.llm read. The public application root
  // is stable across those proxies and child contexts; this listener is application-global.
  const application=ctx.root;
  if(installed.has(application))throw new Error('RUNTIME_MODEL_ADMISSION_ALREADY_INSTALLED');
  budget.assertReady();options.guard?.();installed.add(application);
  const removeCancellation=budget.onInterrupt(options.cancelActive);
  const remove=ctx.on('llm/stream',async function*(request,next):AsyncIterable<StreamChunk>{
    request.signal?.throwIfAborted();options.guard?.();
    if(!request.signal)throw new Error('RUNTIME_MODEL_SIGNAL_REQUIRED');
    const route=budget.route;
    if(request.provider!==route.provider||request.model!==route.model)throw new Error('RUNTIME_ROUTE_CHANGED');
    const model=await ctx.llm.resolveModelInfo(request.provider,request.model,request.signal);
    const output=request.maxTokens??model.defaultMaxTokens??route.contextWindow,effort=request.reasoningEffort??model.reasoning?.defaultEffort??null;
    if(model.context?.contextWindow!==route.contextWindow||effort!==route.reasoningEffort||!Number.isSafeInteger(output)||output<1||output>route.maxOutputTokens)throw new Error('RUNTIME_ROUTE_CHANGED');
    const body=JSON.stringify({provider:request.provider,model:request.model,system:request.system??null,messages:request.messages,tools:request.tools??[],maxTokens:output,purpose:request.purpose??null,reasoningEffort:effort,temperature:request.temperature??null,stop:request.stop??null});
    const bytes=Buffer.byteLength(body);if(bytes>route.maxRequestBytes)throw new Error('RUNTIME_REQUEST_TOO_LARGE');
    const callId=randomUUID(),started=Date.now(),owner={kind:'host' as const,profileId};
    const leaseRequest={...(request.purpose!==undefined?{purpose:request.purpose}:{}),...(request.sessionId!==undefined?{sessionId:String(request.sessionId)}:{})};
    const permit=await budget.reserve({authorizationId:budget.authorizationId,owner,deadline:started+options.maximumCallMs,callId,provider:request.provider,model:request.model,
      reasoningEffort:effort,requestHash:hash(body),sessionHash:hash(String(request.sessionId??'')),inputBound:route.contextWindow,outputBound:output,requestBytes:bytes,purpose:request.purpose??'task'},request.signal,options.leaseFor?.(leaseRequest));
    let usage:ExecutorUsage|null=null,finish:ExecutorSettlement['finish']='interrupted',error:string|null=null,complete=false,invalid=false;
    let iterator:AsyncIterator<StreamChunk>|undefined,drained=false;
    const callSignal=budget.callSignal(callId);
    try{
      request.signal.throwIfAborted();callSignal.throwIfAborted();options.guard?.();
      iterator=budget.dispatchStep(callId,()=>next()[Symbol.asyncIterator]());
      while(true){
        // Race the actual in-flight read, not just a pre-step check: a timeout may fire while
        // iterator.next() is blocked. The finally block closes the iterator and settles.
        const item=await raceCall(budget.dispatchStep(callId,()=>iterator!.next()),callSignal);
        if(item.done){drained=true;break;}
        const chunk=item.value;
        if(chunk.type==='usage'){try{usage=normalizeExecutorUsage(chunk.usage);}catch{usage=null;invalid=true;error='RUNTIME_USAGE_INVALID';}}
        if(chunk.type==='finish'){complete=true;finish=chunk.reason.kind;if(finish==='error'||finish==='aborted')error='RUNTIME_MODEL_FAILED';}
        yield chunk;
      }
    }catch(caught){error??=runtimeCode(caught,'RUNTIME_STREAM_FAILED');throw new Error(error);}
    finally{
      try{if(!drained)await closeIterator(iterator);}
      finally{
        if(!complete||invalid||finish==='error'||finish==='aborted')usage=null;
        await budget.settle({authorizationId:budget.authorizationId,owner,callId,reservationId:permit.reservationId,usage,finish,durationMs:Math.max(0,Date.now()-started),error});
      }
    }
  },{global:true});
  let disposed=false;
  const dispose=()=>{if(disposed)return;disposed=true;budget.quiesce('RUNTIME_HOST_DISPOSED');remove();removeCancellation();installed.delete(application);};
  ctx.effect(()=>dispose,'dafeiyu.server-runtime.model-admission');return dispose;
}
