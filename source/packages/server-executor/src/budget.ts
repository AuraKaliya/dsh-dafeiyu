import { ExecutorCallSchema,ExecutorPermitSchema,ExecutorSettlementSchema,ExecutorRouteSchema,executorError } from './protocol.js';
import type { ExecutorCall,ExecutorPermit,ExecutorSettlement,ExecutorRoute } from './protocol.js';
import { z } from 'zod';
import { executorHash } from './types.js';

export interface ExecutionBudgetRequest extends ExecutorCall {readonly authorizationId:string;readonly jobId:string;readonly deadline:number}
/** The injected parent owns prices, total balance, lease and original clock. This module owns none of them. */
export interface ExecutionBudgetPort {
  reserve(input:ExecutionBudgetRequest,signal:AbortSignal):Promise<ExecutorPermit>;
  settle(input:ExecutorSettlement&{readonly authorizationId:string;readonly jobId:string},signal:AbortSignal):Promise<{unknown:boolean}>;
}
export interface ExecutorBudgetRecord {readonly call:ExecutorCall;readonly permit:ExecutorPermit;state:'reserved'|'settled'|'unknown';settlement:ExecutorSettlement|null;accountingError:string|null}
export class ExecutorBudgetBroker {
  private readonly port:ExecutionBudgetPort;
  private readonly route:ExecutorRoute;
  private readonly guard:()=>void;
  private readonly authorizationId:string;
  private readonly jobId:string;
  private readonly deadline:number;
  private readonly lifetime=new AbortController();
  private readonly records=new Map<string,ExecutorBudgetRecord>();
  private readonly seen=new Set<string>();
  private readonly pending=new Set<Promise<unknown>>();
  private readonly settlements=new Map<string,{hash:string;promise:Promise<{unknown:boolean}>}>();
  private busy=false;
  private closing:Promise<void>|undefined;
  constructor(options:{port:ExecutionBudgetPort;route:ExecutorRoute;guard:()=>void;authorizationId:string;jobId:string;deadline:number}){
    if(typeof options.port?.reserve!=='function'||typeof options.port.settle!=='function')throw new Error('EXECUTOR_BUDGET_REQUIRED');
    this.port=options.port;this.route=ExecutorRouteSchema.parse(options.route);this.guard=options.guard;
    this.authorizationId=z.string().regex(/^[a-zA-Z0-9._:-]{1,120}$/).parse(options.authorizationId);this.jobId=z.uuid().parse(options.jobId);this.deadline=z.number().int().positive().safe().parse(options.deadline);
  }
  private track<T>(operation:Promise<T>):Promise<T>{this.pending.add(operation);void operation.then(()=>this.pending.delete(operation),()=>this.pending.delete(operation));return operation;}
  reserve(raw:ExecutorCall):Promise<ExecutorPermit>{return this.track(this.admit(raw));}
  private async admit(raw:ExecutorCall):Promise<ExecutorPermit>{
    const call=ExecutorCallSchema.parse(raw);if(this.closing||this.lifetime.signal.aborted)throw new Error('EXECUTOR_BUDGET_CLOSED');this.guard();if(Date.now()>=this.deadline)throw new Error('EXECUTOR_DEADLINE');
    if(call.provider!==this.route.provider||call.model!==this.route.model||call.reasoningEffort!==this.route.reasoningEffort||call.inputBound!==this.route.contextWindow||call.outputBound>this.route.maxOutputTokens||call.requestBytes>this.route.maxRequestBytes)throw new Error('EXECUTOR_ROUTE_CHANGED');
    if(this.seen.has(call.callId))throw new Error('EXECUTOR_CALL_REPLAY');if(this.busy)throw new Error('EXECUTOR_CALL_INFLIGHT');this.seen.add(call.callId);this.busy=true;
    try{const permit=ExecutorPermitSchema.parse(await this.port.reserve({...call,authorizationId:this.authorizationId,jobId:this.jobId,deadline:this.deadline},this.lifetime.signal));
      if([...this.records.values()].some(record=>record.permit.reservationId===permit.reservationId))throw new Error('EXECUTOR_RESERVATION_REUSED');
      this.records.set(call.callId,{call,permit,state:'reserved',settlement:null,accountingError:null});
      if(this.closing||this.lifetime.signal.aborted)throw new Error('EXECUTOR_BUDGET_CLOSED');this.guard();if(Date.now()>=this.deadline)throw new Error('EXECUTOR_DEADLINE');return permit;
    }catch(error){this.lifetime.abort(new Error(executorError(error,'EXECUTOR_ADMISSION_FAILED')));if(!this.records.has(call.callId))this.busy=false;throw error;}
  }
  settle(raw:ExecutorSettlement):Promise<{unknown:boolean}>{
    const input=ExecutorSettlementSchema.parse(raw),hash=executorHash({...input,usage:['error','aborted','interrupted'].includes(input.finish)?null:input.usage}),old=this.settlements.get(input.callId);
    if(old){if(old.hash!==hash)return Promise.reject(new Error('EXECUTOR_SETTLEMENT_CONFLICT'));return old.promise;}
    const promise=this.track(this.complete(input));this.settlements.set(input.callId,{hash,promise});return promise;
  }
  private async complete(raw:ExecutorSettlement):Promise<{unknown:boolean}>{
    const input=ExecutorSettlementSchema.parse(raw),record=this.records.get(input.callId);if(!record||record.permit.reservationId!==input.reservationId)throw new Error('EXECUTOR_RESERVATION_MISMATCH');
    const settlement=ExecutorSettlementSchema.parse({...input,usage:['error','aborted','interrupted'].includes(input.finish)?null:input.usage});
    if(record.settlement){if(executorHash(record.settlement)!==executorHash(settlement))throw new Error('EXECUTOR_SETTLEMENT_CONFLICT');return {unknown:record.state==='unknown'};}
    // Revoked task authority stops new calls, but must not stop accounting for an already dispatched call.
    let accounted:{unknown:boolean};try{accounted=z.strictObject({unknown:z.boolean()}).parse(await this.port.settle({...settlement,authorizationId:this.authorizationId,jobId:this.jobId},new AbortController().signal));}
    catch(error){record.settlement=settlement;record.state='unknown';record.accountingError=executorError(error,'EXECUTOR_ACCOUNTING_UNCERTAIN');this.lifetime.abort(new Error(record.accountingError));throw new Error(record.accountingError);}
    record.settlement=settlement;record.state=accounted.unknown||settlement.usage===null||settlement.usage.inputTokens>record.call.inputBound||settlement.usage.outputTokens>record.call.outputBound?'unknown':'settled';this.busy=false;
    if(record.state==='unknown')this.lifetime.abort(new Error('EXECUTOR_USAGE_UNKNOWN'));return {unknown:record.state==='unknown'};
  }
  snapshot():readonly ExecutorBudgetRecord[]{return structuredClone([...this.records.values()]);}
  get idle():boolean{return !this.busy&&this.pending.size===0&&!this.lifetime.signal.aborted&&[...this.records.values()].every(record=>record.state==='settled');}
  close(code='EXECUTOR_CHILD_DISCONNECTED'):Promise<void>{
    if(this.closing)return this.closing;this.lifetime.abort(new Error(code));this.closing=(async()=>{
      await Promise.allSettled([...this.pending]);
      for(const record of this.records.values())if(record.state==='reserved')await this.complete({callId:record.call.callId,reservationId:record.permit.reservationId,usage:null,finish:'interrupted',durationMs:0,error:executorError(new Error(code))});
    })();return this.closing;
  }
}
