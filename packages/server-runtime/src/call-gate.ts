interface Waiter {
  readonly resolve:(release:()=>void)=>void;
  readonly reject:(error:Error)=>void;
  readonly signal:AbortSignal;
  readonly deadline:number;
  readonly lease:CallLease;
  readonly enqueuedAt:number;
  readonly cleanup:()=>void;
}

export type CallClass='interactive'|'owner-task'|'delivery'|'background'|'autonomy';

/** Caller-supplied priority class for one model call. Never a numeric priority from a model. */
export interface CallLease {
  readonly class:CallClass;
  /** Stable work item for diagnostics and scoped cancellation. */
  readonly workItemId?:string;
  /** Program-issued Run identity for scoped cancellation. */
  readonly runId?:string;
}

export interface ModelCallGateOptions {
  /** Waiting time after which a lower class catches up by one rank. */
  readonly agingMs?:number;
  readonly now?:()=>number;
}

const RANK:Record<CallClass,number>={interactive:0,'owner-task':1,delivery:2,background:3,autonomy:4};
const DEFAULT_LEASE:CallLease={class:'background'};

/**
 * One actual call at a time. A job/Run never owns this queue across tool execution.
 * With no lease supplied, every waiter has the same class and the gate stays FIFO.
 */
export class ModelCallGate {
  private readonly queue:Waiter[]=[];
  private readonly idleWaiters=new Set<()=>void>();
  private readonly agingMs:number;
  private readonly now:()=>number;
  private busy=false;
  private closed:string|undefined;

  constructor(options:ModelCallGateOptions={}){
    this.agingMs=Math.max(1,options.agingMs??5_000);
    this.now=options.now??Date.now;
  }

  acquire(signal:AbortSignal,deadline:number,lease:CallLease=DEFAULT_LEASE):Promise<()=>void> {
    signal.throwIfAborted();
    if(this.closed)return Promise.reject(new Error(this.closed));
    if(deadline<=Date.now())return Promise.reject(new Error('RUNTIME_CALL_DEADLINE'));
    return new Promise((resolve,reject)=>{
      let timer:ReturnType<typeof setTimeout>|undefined;
      const cancel=(code:string)=>{const index=this.queue.indexOf(waiter);if(index<0)return;this.queue.splice(index,1);waiter.cleanup();reject(new Error(code));this.pump();};
      const aborted=()=>cancel('RUNTIME_CALL_CANCELLED');
      const waiter:Waiter={resolve,reject,signal,deadline,lease,enqueuedAt:this.now(),cleanup:()=>{if(timer)clearTimeout(timer);signal.removeEventListener('abort',aborted);}};
      timer=setTimeout(()=>cancel('RUNTIME_CALL_DEADLINE'),Math.min(2147483647,Math.max(1,deadline-Date.now())));
      signal.addEventListener('abort',aborted,{once:true});this.queue.push(waiter);
      if(signal.aborted)aborted();else this.pump();
    });
  }

  private score(item:Waiter):number {
    return RANK[item.lease.class]-Math.floor(Math.max(0,this.now()-item.enqueuedAt)/this.agingMs);
  }

  private pump():void {
    if(this.busy)return;
    // Deadline/cancellation removal happens before ordering, so an expired waiter
    // never wins a slot over a live one.
    for(let index=this.queue.length-1;index>=0;index--){
      const item=this.queue[index]!;
      if(!item.signal.aborted&&item.deadline>Date.now())continue;
      this.queue.splice(index,1);item.cleanup();
      item.reject(new Error(item.signal.aborted?'RUNTIME_CALL_CANCELLED':'RUNTIME_CALL_DEADLINE'));
    }
    if(!this.queue.length){for(const ready of this.idleWaiters)ready();this.idleWaiters.clear();return;}
    let best=0,bestScore=this.score(this.queue[0]!);
    for(let index=1;index<this.queue.length;index++){
      const item=this.queue[index]!,value=this.score(item);
      if(value<bestScore||(value===bestScore&&item.enqueuedAt<this.queue[best]!.enqueuedAt)){best=index;bestScore=value;}
    }
    const item=this.queue.splice(best,1)[0]!;
    item.cleanup();
    this.busy=true;
    let released=false;
    item.resolve(()=>{if(released)return;released=true;this.busy=false;this.pump();});
  }

  close(code='RUNTIME_ADMISSION_CLOSED'):void {
    this.closed??=code;
    for(const item of this.queue.splice(0)){item.cleanup();item.reject(new Error(this.closed));}
    this.pump();
  }

  get idle():boolean{return !this.busy&&this.queue.length===0;}
  get pending():number{return this.queue.length+(this.busy?1:0);}
  get stopped():string|null{return this.closed??null;}

  async whenIdle(timeoutMs:number):Promise<void> {
    if(this.idle)return;
    if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1)throw new Error('RUNTIME_DRAIN_TIMEOUT_INVALID');
    await new Promise<void>((resolve,reject)=>{
      const done=()=>{clearTimeout(timer);this.idleWaiters.delete(done);resolve();};
      const timer=setTimeout(()=>{this.idleWaiters.delete(done);reject(new Error('RUNTIME_ACCOUNTING_NOT_DRAINED'));},timeoutMs);
      this.idleWaiters.add(done);if(this.idle)done();
    });
  }
}
