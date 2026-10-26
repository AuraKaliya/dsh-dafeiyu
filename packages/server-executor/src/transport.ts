import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { ChildMessageSchema,ParentMessageSchema,ExecutorToolNameSchema,executorError } from './protocol.js';
import type { ExecutorIpcEndpoint,ExecutorRoute,ParentMessage,ExecutorToolRecord } from './protocol.js';
import { ExecutorBudgetBroker } from './budget.js';
import type { ExecutionBudgetPort } from './budget.js';

export interface ExecutorParentOptions {
  endpoint:ExecutorIpcEndpoint;port:ExecutionBudgetPort;jobId:string;nonce:string;profileHash:string;route:ExecutorRoute;authorizationId:string;deadline:number;
  guard:()=>void;onReady?:()=>Promise<void>;onStop?:(code:string)=>void;handshakeTimeoutMs?:number;allowedTools?:readonly string[];
}

/** A live parent grant and its unique ledger stay in this process. The child only receives one-call permits. */
export class ExecutorParentTransport {
  readonly signal:AbortSignal;
  readonly budget:ExecutorBudgetBroker;
  private readonly abort=new AbortController();
  private readonly options:ExecutorParentOptions;
  private readonly binding:Extract<ParentMessage,{type:'bind'}>;
  private readonly unsubscribe:()=>void;
  private readonly timer:ReturnType<typeof setTimeout>;
  private readonly monitor:ReturnType<typeof setInterval>;
  private readonly readyPromise:Promise<void>;
  private resolveReady!:()=>void;
  private rejectReady!:(error:Error)=>void;
  private phase:'online'|'binding'|'activating'|'ready'|'done'|'closed'='online';
  private closing:Promise<void>|undefined;
  private graceful=false;
  private readonly allowedTools:Set<string>;
  private readonly tools=new Map<string,ExecutorToolRecord>();
  constructor(options:ExecutorParentOptions){
    this.options=options;this.signal=this.abort.signal;
    this.allowedTools=new Set(z.array(ExecutorToolNameSchema).max(128).parse(options.allowedTools??[]));
    const binding=ParentMessageSchema.parse({version:1,type:'bind',jobId:options.jobId,nonce:options.nonce,profileHash:options.profileHash,deadline:options.deadline,route:options.route});
    if(binding.type!=='bind')throw new Error('EXECUTOR_BINDING_MISMATCH');this.binding=binding;
    const timeout=z.number().int().positive().max(60000).parse(options.handshakeTimeoutMs??10000);
    this.budget=new ExecutorBudgetBroker(options);
    this.readyPromise=new Promise((resolve,reject)=>{this.resolveReady=resolve;this.rejectReady=reject;});void this.readyPromise.catch(()=>{});
    this.unsubscribe=options.endpoint.subscribe(raw=>{void this.receive(raw).catch(error=>this.stop(executorError(error)));},()=>{
      if(!this.graceful)this.stop('EXECUTOR_CHILD_DISCONNECTED');else void this.close('EXECUTOR_CHILD_FINISHED').catch(()=>{});
    });
    this.timer=setTimeout(()=>this.stop('EXECUTOR_HANDSHAKE_TIMEOUT'),timeout);
    this.monitor=setInterval(()=>{if(this.phase==='closed'||this.graceful)return;try{options.guard();if(Date.now()>=binding.deadline)throw new Error('EXECUTOR_DEADLINE');}catch(error){this.stop(executorError(error,'EXECUTOR_AUTHORITY_REVOKED'));}},100);
  }
  private async send(body:ParentMessage):Promise<void>{await this.options.endpoint.send(ParentMessageSchema.parse(body));}
  private envelope(){return {version:1 as const,jobId:this.binding.jobId,nonce:this.binding.nonce};}
  private async receive(raw:unknown):Promise<void>{
    const parsed=ChildMessageSchema.safeParse(raw);if(!parsed.success)throw new Error('EXECUTOR_IPC_PROTOCOL');const message=parsed.data;
    if(this.phase==='closed')throw new Error('EXECUTOR_IPC_CLOSED');
    if(message.type==='online'){
      if(this.phase!=='online'||message.profileHash!==this.binding.profileHash)throw new Error('EXECUTOR_BINDING_MISMATCH');
      this.options.guard();if(Date.now()>=this.binding.deadline)throw new Error('EXECUTOR_DEADLINE');this.phase='binding';await this.send(this.binding);return;
    }
    if(message.jobId!==this.binding.jobId||message.nonce!==this.binding.nonce)throw new Error('EXECUTOR_BINDING_MISMATCH');
    if(message.type==='ready'){
      if(this.phase!=='binding'||message.profileHash!==this.binding.profileHash)throw new Error('EXECUTOR_BINDING_MISMATCH');
      this.phase='activating';this.options.guard();await this.options.onReady?.();this.options.guard();this.signal.throwIfAborted();this.phase='ready';clearTimeout(this.timer);await this.send({...this.envelope(),type:'active'});this.resolveReady();return;
    }
    if(this.phase!=='ready')throw new Error('EXECUTOR_NOT_READY');
    if(message.type==='done'){
      if(!this.budget.idle||[...this.tools.values()].some(record=>record.state==='admitted'||record.state==='unknown'))throw new Error('EXECUTOR_ACCOUNTING_PENDING');this.graceful=true;this.phase='done';
      await this.send({...this.envelope(),type:'finished',callId:message.callId});return;
    }
    if(message.type==='tool-admit'){
      const tool=message.tool;this.options.guard();if(Date.now()>=this.binding.deadline)throw new Error('EXECUTOR_DEADLINE');
      if(!this.allowedTools.has(tool.name))throw new Error('EXECUTOR_TOOL_DENIED');if(this.tools.has(tool.callId))throw new Error('EXECUTOR_TOOL_REPLAY');
      const permitId=randomUUID();this.tools.set(tool.callId,{call:tool,permitId,state:'admitted'});await this.send({...this.envelope(),type:'tool-permitted',callId:tool.callId,permitId});return;
    }
    if(message.type==='tool-finish'){
      const receipt=message.receipt,record=this.tools.get(receipt.callId);if(!record||record.permitId!==receipt.permitId)throw new Error('EXECUTOR_TOOL_PERMIT_MISMATCH');
      if(record.state!=='admitted'&&record.state!==receipt.state)throw new Error('EXECUTOR_TOOL_RESULT_CONFLICT');record.state=receipt.state;
      await this.send({...this.envelope(),type:'tool-recorded',callId:receipt.callId});if(receipt.state==='unknown')this.stop('EXECUTOR_TOOL_RESULT_UNKNOWN');return;
    }
    const callId=message.type==='reserve'?message.call.callId:message.settlement.callId;
    try{
      if(message.type==='reserve'){const permit=await this.budget.reserve(message.call);this.signal.throwIfAborted();await this.send({...this.envelope(),type:'reserved',callId,permit});}
      else {const result=await this.budget.settle(message.settlement);await this.send({...this.envelope(),type:'settled',callId,...result});if(result.unknown)this.stop('EXECUTOR_USAGE_UNKNOWN');}
    }catch(error){const code=executorError(error,'EXECUTOR_BUDGET_FAILED');await this.send({...this.envelope(),type:'denied',callId,code}).catch(()=>{});throw new Error(code);}
  }
  private stop(code:string):void{if(this.phase==='closed')return;try{this.options.onStop?.(code);}catch{/* Observers do not change the accounting outcome. */}void this.close(code).catch(()=>{});}
  ready():Promise<void>{return this.readyPromise;}
  get finished():boolean{return this.graceful;}
  toolSnapshot():readonly ExecutorToolRecord[]{return structuredClone([...this.tools.values()]);}
  close(code='EXECUTOR_PARENT_CLOSED'):Promise<void>{
    if(this.closing)return this.closing;this.phase='closed';this.abort.abort(new Error(code));this.rejectReady(new Error(code));clearTimeout(this.timer);clearInterval(this.monitor);this.unsubscribe();
    for(const record of this.tools.values())if(record.state==='admitted')record.state='unknown';
    this.closing=(async()=>{if(!this.graceful)await this.send({...this.envelope(),type:'cancel',code}).catch(()=>{});
      try{await this.budget.close(code);}finally{this.options.endpoint.disconnect();}})();return this.closing;
  }
}
