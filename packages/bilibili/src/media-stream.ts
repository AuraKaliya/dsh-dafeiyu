import type {HttpResponse} from './http.js';

export interface TransferResult {readonly bytes:number;readonly code:string|null;readonly cancelled:boolean}
/** Header wait, stalled body and total transfer are separate clocks. Consumer processing is not network idleness. */
export class MediaTransferDeadline {
  private readonly controller=new AbortController();
  readonly signal:AbortSignal;
  private idle:ReturnType<typeof globalThis.setTimeout>|undefined;
  private readonly total:ReturnType<typeof globalThis.setTimeout>;
  constructor(private readonly caller:AbortSignal,headerMs:number,private readonly idleMs:number,totalMs:number){
    this.signal=AbortSignal.any([caller,this.controller.signal]);this.arm(headerMs,'BILI_MEDIA_HEADERS_TIMEOUT');
    this.total=globalThis.setTimeout(()=>this.controller.abort(new Error('BILI_MEDIA_TOTAL_TIMEOUT')),totalMs);this.total.unref?.();
  }
  private arm(ms:number,code:string){if(this.idle)clearTimeout(this.idle);this.idle=globalThis.setTimeout(()=>this.controller.abort(new Error(code)),ms);this.idle.unref?.();}
  close(){if(this.idle)clearTimeout(this.idle);clearTimeout(this.total);}
  private async next(iterator:AsyncIterator<Uint8Array>){this.signal.throwIfAborted();this.arm(this.idleMs,'BILI_MEDIA_IDLE_TIMEOUT');
    let rejectAbort:()=>void=()=>{};
    const stopped=new Promise<never>((_done,reject)=>{rejectAbort=()=>reject(this.signal.reason);this.signal.addEventListener('abort',rejectAbort,{once:true});if(this.signal.aborted)rejectAbort();});
    try{return await Promise.race([iterator.next(),stopped]);}finally{if(this.idle)clearTimeout(this.idle);this.signal.removeEventListener('abort',rejectAbort);}
  }
  failure(error:unknown){if(this.caller.aborted)return 'BILI_CANCELLED';const timeout=this.controller.signal.reason;
    if(timeout instanceof Error)return timeout.message;
    if(error instanceof Error&&/^BILI_[A-Z0-9_]{1,80}$/.test(error.message))return error.message;
    const system=error&&typeof error==='object'&&'code'in error?error.code:null;
    return typeof system==='string'&&/^[A-Z][A-Z0-9_]{1,60}$/.test(system)?'BILI_HTTP_'+system:'BILI_MEDIA_STREAM_FAILED';
  }
  body(response:HttpResponse,settle:(result:TransferResult)=>void):HttpResponse{
    if(this.idle)clearTimeout(this.idle);const deadline=this,iterator=response.body[Symbol.asyncIterator]();
    const body=(async function*(){let bytes=0;
      try{while(true){const value=await deadline.next(iterator);if(value.done)break;bytes+=value.value.byteLength;yield value.value;}
        settle({bytes,code:null,cancelled:false});
      }catch(error){const code=deadline.failure(error);settle({bytes,code,cancelled:deadline.caller.aborted});throw new Error(code);}
      finally{deadline.close();response.close();void Promise.resolve(iterator.return?.()).catch(()=>{});}
    })();
    return {...response,body,close:()=>{deadline.close();response.close();}};
  }
}
