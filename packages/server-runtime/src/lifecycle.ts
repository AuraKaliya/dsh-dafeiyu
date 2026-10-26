import type { SharedModelBudget } from './shared-budget.js';

/** Owns only the borrowed runtime's teardown order; it never closes an authorization/ledger. */
export class RuntimeResourceLifetime {
  private readonly budget:SharedModelBudget;
  private readonly closeProof:()=>Promise<void>;
  private readonly isHostDisposed:()=>boolean;
  private readonly timeoutMs:number;
  private closing:Promise<void>|undefined;
  private closed=false;
  constructor(options:{budget:SharedModelBudget;closeProof:()=>Promise<void>;isHostDisposed:()=>boolean;timeoutMs:number}){
    this.budget=options.budget;this.closeProof=options.closeProof;this.isHostDisposed=options.isHostDisposed;this.timeoutMs=options.timeoutMs;
    if(!Number.isSafeInteger(this.timeoutMs)||this.timeoutMs<1||this.timeoutMs>3600000)throw new Error('RUNTIME_DRAIN_TIMEOUT_INVALID');
  }
  close(host?:{close(reason?:string):Promise<void>}):Promise<void> {
    if(this.closed)return Promise.resolve();if(this.closing)return this.closing;
    this.closing=this.drain(host).then(()=>{this.closed=true;},error=>{this.closing=undefined;throw error;});return this.closing;
  }
  private async drain(host?:{close(reason?:string):Promise<void>}):Promise<void> {
    this.budget.quiesce();
    if(host){
      let timer:ReturnType<typeof setTimeout>|undefined;
      try{await Promise.race([host.close('budget-runtime-close'),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{this.budget.cancel('RUNTIME_HOST_DRAIN_TIMEOUT');reject(new Error('RUNTIME_HOST_NOT_DRAINED'));},this.timeoutMs);})]);}
      finally{if(timer)clearTimeout(timer);}
    }
    if(!this.isHostDisposed()){this.budget.cancel('RUNTIME_HOST_NOT_DISPOSED');throw new Error('RUNTIME_HOST_NOT_DISPOSED');}
    await this.budget.whenIdle(this.timeoutMs);
    // On a failed/unconfirmed drain this point is deliberately never reached.
    await this.closeProof();
  }
}
