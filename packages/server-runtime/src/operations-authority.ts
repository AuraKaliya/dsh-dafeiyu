import type { WindowsHostProof } from '@dafeiyu/server-executor/windows-process';
import type { ExecutorPermit } from '@dafeiyu/server-executor/protocol';
import type { FundingBinding,FundingMode } from './funding-config.js';
import { fundingCheck } from './funding-config.js';
import { OperationsFundingStore } from './funding-store.js';
import type { FundingProcessState,FundingSnapshot } from './funding-store.js';
import { runtimeCode } from './types.js';
import type { ModelBudgetAuthority,ModelBudgetRequest,ModelBudgetSettlement } from './types.js';

export interface FundingClock {now():number;monotonic():number}
export interface OperationsAuthorityOptions {
  readonly mode?:FundingMode;
  /** Program-only fictional test hooks; forbidden for an operations-purpose window. */
  readonly clock?:FundingClock;
  readonly processState?:(pid:number)=>FundingProcessState;
}
function actualProcessState(pid:number):FundingProcessState {
  try{process.kill(pid,0);return 'alive';}catch(error){return error&&typeof error==='object'&&'code'in error&&error.code==='ESRCH'?'absent':'unknown';}
}
const realClock:FundingClock={now:()=>Date.now(),monotonic:()=>performance.now()};

/** One already initialized operations window. Opening it never creates or increases money. */
export class OperationsModelBudgetAuthority implements ModelBudgetAuthority {
  readonly kind:'operations'|'offline-test';readonly authorizationId:string;readonly route:ModelBudgetAuthority['route'];
  private readonly store:OperationsFundingStore;private readonly nonce:string;private readonly clock:FundingClock;
  private readonly openedMonotonic:number;private readonly initialRemaining:number;private lastMonotonic:number;private closed=false;
  private readonly stoppedListeners=new Set<(code:string)=>void>();private stopped:string|undefined;private timer:ReturnType<typeof setTimeout>|undefined;
  private constructor(store:OperationsFundingStore,nonce:string,clock:FundingClock,openedMonotonic:number,remaining:number){
    this.store=store;this.nonce=nonce;this.clock=clock;this.openedMonotonic=openedMonotonic;this.lastMonotonic=openedMonotonic;this.initialRemaining=remaining;
    this.kind=store.mode==='operations'?'operations':'offline-test';this.authorizationId=store.binding.fundingId;this.route=store.binding.route;
    this.schedule(remaining);
  }
  static openExisting(binding:FundingBinding,options:OperationsAuthorityOptions={}):OperationsModelBudgetAuthority {
    const mode=options.mode??'operations';fundingCheck(mode!=='operations'||options.clock===undefined&&options.processState===undefined,'FUNDING_TEST_HOOK_FORBIDDEN');
    const clock=options.clock??realClock,mono=clock.monotonic(),now=clock.now();fundingCheck(Number.isFinite(mono)&&mono>=0,'FUNDING_MONOTONIC_INVALID');
    const store=OperationsFundingStore.openExisting(binding,{mode});
    let nonce:string|undefined;
    try{nonce=store.claimLease(now,options.processState??actualProcessState);const remaining=store.remainingMs(nonce,now);return new OperationsModelBudgetAuthority(store,nonce,clock,mono,remaining);}
    catch(error){if(nonce)try{store.releaseLease(nonce,now);}catch{/* A changed or unconfirmed lease is retained. */}store.close();throw error;}
  }
  private open(){fundingCheck(!this.closed,'FUNDING_CLOSED');}
  onStop(listener:(code:string)=>void):()=>void {this.stoppedListeners.add(listener);if(this.stopped)listener(this.stopped);return ()=>{this.stoppedListeners.delete(listener);};}
  private stop(code:string):void {
    if(this.stopped)return;this.stopped=code;if(this.timer)clearTimeout(this.timer);this.timer=undefined;
    for(const listener of this.stoppedListeners){try{listener(code);}catch{/* Every bound runtime must still receive the stop. */}}
  }
  private terminal(error:unknown):void {
    const code=runtimeCode(error,'FUNDING_AUTHORITY_FAILED');
    if(['FUNDING_EXPIRED','FUNDING_CLOCK_MOVED_BACKWARDS','FUNDING_MONOTONIC_MOVED_BACKWARDS','FUNDING_UNKNOWN_COST','FUNDING_EXHAUSTED','FUNDING_FILE_CHANGED','FUNDING_ROOT_CHANGED','FUNDING_RECEIPT_MISMATCH','FUNDING_DATABASE_REPLACED','FUNDING_EVIDENCE_CHANGED','FUNDING_LEASE_CHANGED','FUNDING_AUTHORITY_FAILED'].includes(code))this.stop(code);
  }
  private financialStop():void {
    const state=this.store.snapshot().balance;
    if(state.unknownCalls)this.stop('FUNDING_UNKNOWN_COST');
    else if(state.reservedCalls===0&&BigInt(state.remainingMicroCny)===0n)this.stop('FUNDING_EXHAUSTED');
  }
  private schedule(remaining:number):void {
    if(this.timer)clearTimeout(this.timer);if(this.closed||this.stopped)return;
    this.timer=setTimeout(()=>{this.timer=undefined;try{const next=this.observeTime();this.financialStop();this.schedule(next);}catch(error){this.terminal(error);}},Math.max(1,Math.min(2147483647,Math.ceil(remaining))));
    this.timer.unref();
  }
  private observeTime():number {
    this.open();const mono=this.clock.monotonic(),now=this.clock.now();
    if(!Number.isFinite(mono)||mono<this.lastMonotonic){
      try{this.store.observeClock(this.nonce,now,0,'FUNDING_MONOTONIC_MOVED_BACKWARDS');}catch(error){this.terminal(error);throw error;}
      throw new Error('FUNDING_MONOTONIC_MOVED_BACKWARDS');
    }
    this.lastMonotonic=mono;
    const ceiling=Math.max(0,Math.floor(this.initialRemaining-(mono-this.openedMonotonic)));
    try{return this.store.observeClock(this.nonce,now,ceiling);}catch(error){this.terminal(error);throw error;}
  }
  guard():void {
    this.remainingMs();if(this.stopped)throw new Error(this.stopped);
    try{this.store.guardLease(this.nonce,this.clock.now());}catch(error){this.terminal(error);throw error;}
  }
  remainingMs():number {
    const remaining=this.observeTime();this.financialStop();if(this.stopped)throw new Error(this.stopped);this.schedule(remaining);return remaining;
  }
  /** Only the fixed launcher supplies its newly obtained real parentProof. JSON input is not this program capability. */
  activate(parentProof:WindowsHostProof):void {this.guard();this.store.activateLease(this.nonce,parentProof,this.clock.now());}
  async reserve(input:ModelBudgetRequest,signal:AbortSignal):Promise<ExecutorPermit> {
    signal.throwIfAborted();const remaining=this.remainingMs(),now=this.clock.now();this.guard();signal.throwIfAborted();
    try{return this.store.reserve(this.nonce,{...input,deadline:Math.min(input.deadline,now+remaining)},now);}catch(error){this.terminal(error);throw error;}
  }
  async settle(input:ModelBudgetSettlement):Promise<{unknown:boolean}>{
    this.open();try{this.observeTime();}catch{/* Persistent deadline/clock stops must never reject owed accounting. */}
    const result=this.store.settle(this.nonce,input,this.clock.now());this.financialStop();return result;
  }
  snapshot():FundingSnapshot {this.open();return this.store.snapshot();}
  /** Call only after Host, outstanding accounting and proof helper have drained. Held calls keep the lease. */
  close():void {if(this.closed)return;try{this.observeTime();}catch{/* Clock stops remain durable, but closing an idle lease is still allowed. */}
    this.store.releaseLease(this.nonce,this.clock.now());this.store.close();this.closed=true;if(this.timer)clearTimeout(this.timer);this.timer=undefined;this.stoppedListeners.clear();}
}
