import {spawn} from 'node:child_process';
import type {ChildProcess} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import type {Context} from '@deepseek-ai/cordis';
import {readInstallationSettings} from './settings.js';
import {managementJson} from '@dafeiyu/contracts';
import type {Json,ManagementActivitySnapshot,ManagementControlResult,ManagementLifecycleState,ManagementOperationDisposition,ManagementOperationSnapshot,ManagementRuntimeAction,ManagementRuntimePhase,ManagementRuntimeSnapshot} from '@dafeiyu/contracts';
import {OneBotCapability} from './onebot-capability.js';
import type {CapabilityStatus} from './onebot-capability.js';

/** Initial bounded retry sequence for recoverable dependency or startup failures. */
export const ONEBOT_RETRY_DELAYS_MS=[2_000,5_000,15_000,30_000,60_000] as const;
const RETRYABLE=new Set(['ONEBOT_NOT_RUNNING','ONEBOT_LOGIN_REQUIRED','ONEBOT_ACCOUNT_NOT_ATTACHED','ONEBOT_NOT_READY','ONEBOT_HTTP_ERROR','ONEBOT_SERVICE_EXITED','INSTALL_PROCESS_EXITED','MANAGEMENT_PROCESS_EXITED']);
const isRetryable=(code:string):boolean=>RETRYABLE.has(code);
const errorCode=(error:unknown):string=>error instanceof Error&&/^[A-Z][A-Z0-9_]{0,99}$/.test(error.message)?error.message:'INSTALL_START_FAILED';
type TimerHandle=unknown;
interface TimerPort {setTimeout:(work:()=>void,ms:number)=>TimerHandle;clearTimeout:(handle:TimerHandle)=>void}
const defaultTimers:TimerPort={setTimeout:(work,ms)=>{const handle=setTimeout(work,ms);handle.unref();return handle;},clearTimeout:handle=>{clearTimeout(handle as ReturnType<typeof setTimeout>);}};

export interface ManagementRuntimeDependencies {
  /** Replace child creation in tests; defaults to this process's node with the installation entry point. */
  readonly spawnInstance?:(input:{settingsFile:string;nodePath:string;env:NodeJS.ProcessEnv})=>ChildProcess;
  readonly importBridge?:()=>Promise<{attachDshBridge:(ctx:Context,child:ChildProcess,settingsFile:string)=>()=>Promise<void>}>;
  readonly fetchImpl?:typeof fetch;
  readonly sleep?:(ms:number)=>Promise<void>;
  readonly retryDelaysMs?:readonly number[];
  readonly controlWaitMs?:number;
  readonly startTimeoutMs?:number;
  readonly stopTimeoutMs?:number;
  readonly killTimeoutMs?:number;
  readonly healthTimeoutMs?:number;
  readonly timers?:TimerPort;
}
export interface ManagementControlOptions {readonly wait?:boolean;readonly operationId?:string;readonly signal?:AbortSignal;readonly automatic?:boolean}

interface Operation {
  readonly id:string;
  readonly action:'start'|'stop'|'restart';
  readonly at:string;
  readonly automatic:boolean;
  readonly controller:AbortController;
  readonly done:Promise<void>;
  disposition:ManagementOperationDisposition;
  code:string|null;
  settled:boolean;
  settle:(disposition:ManagementOperationDisposition,code:string|null)=>void;
}
interface ReadyWaiter {resolve:()=>void;reject:(error:Error)=>void;timer:TimerHandle}

/**
 * One lifecycle controller for automatic startup, manual start, restart and retry.
 * A request returns a receipt and an operation id; `status` is the only source of truth.
 * Child callbacks, retry timers and IPC replies are bound to their generation.
 */
export class ManagementRuntime {
  private child:ChildProcess|undefined;
  private childGeneration=0;
  private generation=0;
  private bridgeClose:(()=>Promise<void>)|undefined;
  private lastExitCode:string|null=null;
  private readonly readyWaiters=new Map<number,ReadyWaiter>();
  private readonly closeWaiters=new Map<number,Set<(closed:boolean)=>void>>();
  private readonly pending=new Map<string,{resolve:(value:Json)=>void;reject:(error:Error)=>void;timer:TimerHandle}>();
  private state:ManagementLifecycleState='stopped';
  private phase:ManagementRuntimePhase='idle';
  private code:string|null=null;
  private codeAt:string|null=null;
  private startedAt:string|null=null;
  private readyAt:string|null=null;
  private checkedAt:string|null=null;
  private instance:'absent'|'starting'|'unconfirmed'|'ready'='absent';
  private disposed=false;
  private disposePromise:Promise<void>|undefined;
  private operation:Operation|undefined;
  private readonly operations=new Map<string,Operation>();
  private retryTimer:TimerHandle|undefined;
  private retryAttempt=0;
  private nextRetryAt:number|null=null;
  private capability:OneBotCapability|undefined;
  private capabilityStatus:CapabilityStatus={id:'qq',state:'pending',owned:false,pid:null,code:null,message:null};
  private readonly history:{code:string;at:string;phase:ManagementRuntimePhase}[]=[];
  private healthProbe:Promise<boolean>|undefined;
  private readonly deps:Required<Pick<ManagementRuntimeDependencies,'fetchImpl'|'retryDelaysMs'|'controlWaitMs'|'startTimeoutMs'|'stopTimeoutMs'|'killTimeoutMs'|'healthTimeoutMs'|'timers'>>;
  private readonly sleepImpl:(ms:number)=>Promise<void>;
  constructor(private readonly ctx:Context,private readonly config:{settingsFile:string;nodePath:string},private readonly dependencies:ManagementRuntimeDependencies={}){
    this.deps={fetchImpl:dependencies.fetchImpl??fetch,retryDelaysMs:dependencies.retryDelaysMs??ONEBOT_RETRY_DELAYS_MS,controlWaitMs:dependencies.controlWaitMs??1_500,
      startTimeoutMs:dependencies.startTimeoutMs??90_000,stopTimeoutMs:dependencies.stopTimeoutMs??40_000,killTimeoutMs:dependencies.killTimeoutMs??10_000,healthTimeoutMs:dependencies.healthTimeoutMs??3_000,timers:dependencies.timers??defaultTimers};
    this.sleepImpl=dependencies.sleep??(ms=>new Promise<void>(resolve=>{const timer=setTimeout(resolve,ms);timer.unref();}));
  }
  private iso():string{return new Date().toISOString();}
  status():ManagementRuntimeSnapshot {
    let activity:ManagementActivitySnapshot|null=null;
    try{const settings=readInstallationSettings(this.config.settingsFile);activity={enabled:settings.activity.enabled,exploration:settings.activity.exploration,maintenance:settings.activity.maintenance,plans:settings.activity.plans};}catch{/* configuration is reported separately */}
    const activityCapability:CapabilityStatus|undefined=activity?{id:'activity',state:activity.enabled?'pending':'disabled',owned:false,pid:null,code:activity.enabled?null:'ACTIVITY_DISABLED_BY_USER',message:activity.enabled?'自主活动已启用，等待 Host 就绪':'自主活动已由配置关闭'}:undefined;
    const operation=this.operationSnapshot();
    return {state:this.state,phase:this.phase,operationId:this.operation&&!this.operation.settled?this.operation.id:null,operation,generation:this.childGeneration,pid:this.child?.pid??null,
      code:this.code,codeAt:this.codeAt,retryAttempt:this.retryAttempt,retry:{attempt:this.retryAttempt,nextAt:this.nextRetryAt===null?null:new Date(this.nextRetryAt).toISOString()},
      checkedAt:this.checkedAt,startedAt:this.startedAt,readyAt:this.readyAt,instance:this.instance,error:this.code===null?null:{code:this.code,at:this.codeAt??this.iso()},
      history:[...this.history],
      capabilities:[this.capabilityStatus,...(activityCapability?[activityCapability]:[])],activity};
  }
  private operationSnapshot():ManagementOperationSnapshot|null{
    const operation=this.operation;
    if(!operation)return null;
    if(operation.settled&&Date.now()-Date.parse(operation.at)>300_000&&this.state!=='stopping')return null;
    return {id:operation.id,action:operation.action,disposition:operation.disposition,at:operation.at,code:operation.code};
  }
  async control(action:ManagementRuntimeAction,options:ManagementControlOptions={}):Promise<ManagementControlResult>{
    if(action==='status')return this.inspect();
    if(this.disposed)throw new Error('MANAGEMENT_RUNTIME_DISPOSED');
    const prior=options.operationId?this.operations.get(options.operationId):undefined;
    if(prior){
      if(prior.action!==action)return this.receipt(action,'rejected','MANAGEMENT_OPERATION_CONFLICT',prior.id,false);
      return this.finish(prior,options);
    }
    if(action==='start')return this.startRequest(options);
    if(action==='stop')return this.stopRequest(options);
    return this.restartRequest(options);
  }
  private receipt(action:ManagementRuntimeAction,disposition:ManagementOperationDisposition,code:string|null,operationId:string|null,accepted:boolean,host:Json|null=null,hostCode:string|null=null):ManagementControlResult{
    return {...this.status(),action,accepted,disposition,operationId,host,hostCode,...(code===null?{}:{rejectCode:code})};
  }
  private async finish(operation:Operation,options:ManagementControlOptions):Promise<ManagementControlResult>{
    if(options.wait)await operation.done;
    else await Promise.race([operation.done,this.sleepImpl(this.deps.controlWaitMs)]);
    const disposition=operation.settled?operation.disposition:'accepted';
    return this.receipt(operation.action,disposition,operation.settled?operation.code:null,operation.id,true);
  }
  private async startRequest(options:ManagementControlOptions):Promise<ManagementControlResult>{
    const active=this.operation;
    if(active&&!active.settled){
      if(active.action==='stop')return this.receipt('start','rejected','MANAGEMENT_STOPPING',active.id,false);
      return this.receipt('start','accepted',null,active.id,true);
    }
    if(this.child&&this.state==='running'&&this.instance==='ready')return this.receipt('start','completed',null,null,true);
    if(this.child){
      const recovered=await this.reconcile();
      if(recovered)return this.receipt('start','completed',null,null,true);
      this.fail('MANAGEMENT_START_UNCONFIRMED');
      return this.receipt('start','accepted','MANAGEMENT_START_UNCONFIRMED',null,true);
    }
    const operation=this.beginOperation('start',options.automatic??false,options.operationId);
    this.linkSignal(operation,options.signal);
    if(!options.automatic)this.retryAttempt=0;
    this.prepareStart();
    void this.runStart(operation);
    return this.finish(operation,options);
  }
  private async stopRequest(options:ManagementControlOptions):Promise<ManagementControlResult>{
    const active=this.operation;
    if(active&&!active.settled&&active.action==='stop')return this.finish(active,options);
    if(active&&!active.settled)active.controller.abort();
    this.clearRetry();this.retryAttempt=0;
    const operation=this.beginOperation('stop',options.automatic??false,options.operationId);
    this.linkSignal(operation,options.signal);
    void this.runStop(operation,active?.done);
    return this.finish(operation,options);
  }
  private async restartRequest(options:ManagementControlOptions):Promise<ManagementControlResult>{
    const active=this.operation;
    if(active&&!active.settled){
      if(active.action==='restart')return this.finish(active,options);
      if(active.action==='stop')return this.receipt('restart','rejected','MANAGEMENT_STOPPING',active.id,false);
      active.controller.abort();
    }
    const operation=this.beginOperation('restart',options.automatic??false,options.operationId);
    this.linkSignal(operation,options.signal);
    void this.runRestart(operation,active?.done);
    return this.finish(operation,options);
  }
  private beginOperation(action:'start'|'stop'|'restart',automatic:boolean,id?:string):Operation{
    const at=this.iso();
    let resolveDone:()=>void=()=>{};
    const done=new Promise<void>(resolve=>{resolveDone=resolve;});
    const operation:Operation={id:id??randomUUID(),action,at,automatic,controller:new AbortController(),done,disposition:'accepted',code:null,settled:false,
      settle:(disposition,code)=>{if(operation.settled)return;operation.disposition=disposition;operation.code=code;operation.settled=true;resolveDone();}};
    this.operations.set(operation.id,operation);
    while(this.operations.size>8){const first=this.operations.keys().next().value;if(first===undefined)break;this.operations.delete(first);}
    this.operation=operation;
    return operation;
  }
  private linkSignal(operation:Operation,signal?:AbortSignal):void{
    if(!signal)return;
    if(signal.aborted){operation.controller.abort();return;}
    const abort=()=>operation.controller.abort();signal.addEventListener('abort',abort,{once:true});
    void operation.done.then(()=>signal.removeEventListener('abort',abort));
  }
  private checkAbort(operation:Operation):void{
    if(operation.controller.signal.aborted||this.disposed)throw new Error('MANAGEMENT_OPERATION_CANCELLED');
  }
  private prepareStart(){this.clearRetry();this.code=null;this.codeAt=null;this.state='starting';this.phase='configuration';this.checkedAt=this.iso();}
  private async runStart(operation:Operation):Promise<void>{
    try{await this.startUp(operation);operation.settle('completed',null);}
    catch(error){await this.settleStartFailure(operation,error);}
  }
  private async runRestart(operation:Operation,previous?:Promise<void>):Promise<void>{
    try{
      await previous;this.checkAbort(operation);
      await this.shutDown(operation);
      this.checkAbort(operation);
      this.prepareStart();
      await this.startUp(operation);
      operation.settle('completed',null);
    }catch(error){await this.settleStartFailure(operation,error);}
  }
  private async runStop(operation:Operation,previous?:Promise<void>):Promise<void>{
    try{await previous;await this.shutDown(operation);operation.settle('completed',null);}
    catch(error){const code=errorCode(error);this.fail(code);operation.settle('failed',code);}
  }
  private async settleStartFailure(operation:Operation,error:unknown):Promise<void>{
    if(operation.controller.signal.aborted){
      try{await this.shutDown(operation);}catch(cleanup){operation.settle('failed',errorCode(cleanup));return;}
      operation.settle('failed','MANAGEMENT_OPERATION_CANCELLED');
      return;
    }
    const code=errorCode(error);
    if(code==='MANAGEMENT_START_TIMEOUT'){
      // The child exists; the result is not confirmed yet. Never respawn to "retry" it.
      this.state='starting';this.instance='unconfirmed';this.phase='process';this.fail(code);
      operation.settle('accepted',code);
      return;
    }
    operation.settle('failed',code);
    if(this.state!=='waiting')this.state=this.capability?.status().state==='waiting-login'?'waiting':'failed';
    this.fail(code);
    if(!this.child&&isRetryable(code))this.scheduleRetry();
  }
  private fail(code:string):void{
    this.code=code;this.codeAt=this.iso();this.checkedAt=this.codeAt;
    const last=this.history[this.history.length-1];
    if(!last||last.code!==code||last.phase!==this.phase){this.history.push({code,at:this.codeAt,phase:this.phase});if(this.history.length>8)this.history.shift();}
  }
  private async startUp(operation:Operation):Promise<void>{
    const settings=readInstallationSettings(this.config.settingsFile);
    this.checkAbort(operation);
    this.phase='qq';
    this.capability??=new OneBotCapability(settings.qq,{fetch:this.deps.fetchImpl,sleep:this.sleepImpl});
    try{await this.capability.ensureReady(operation.controller.signal);}
    catch(error){this.capabilityStatus=this.capability.status();if(this.capabilityStatus.state==='waiting-login')this.state='waiting';throw error;}
    this.capabilityStatus=this.capability.status();
    this.checkAbort(operation);
    this.phase='bridge';
    const bridge=settings.dshTools?await (this.dependencies.importBridge??(()=>import('./bridge-parent.js')))():null;
    this.checkAbort(operation);
    this.phase='process';
    const generation=++this.generation;
    const child=(this.dependencies.spawnInstance??(input=>spawn(input.nodePath,[fileURLToPath(new URL('../bin/dafeiyu.mjs',import.meta.url)),'start','--settings',input.settingsFile],{windowsHide:true,env:input.env,stdio:['ignore','ignore','ignore','ipc']})))({settingsFile:this.config.settingsFile,nodePath:this.config.nodePath,env:{...process.env,DAFEIYU_DSH_BRIDGE:settings.dshTools?'1':''}});
    this.child=child;this.childGeneration=generation;this.instance='starting';this.startedAt=this.iso();this.lastExitCode=null;
    this.attachChild(child,generation);
    try{if(bridge)this.bridgeClose=bridge.attachDshBridge(this.ctx,child,this.config.settingsFile);}catch(error){await this.shutDown(operation).catch(()=>{});throw error;}
    if(operation.controller.signal.aborted){await this.shutDown(operation).catch(()=>{});throw new Error('MANAGEMENT_OPERATION_CANCELLED');}
    await this.waitReady(generation,operation);
    this.markReady(generation);
  }
  private async shutDown(operation:Operation):Promise<void>{
    this.state='stopping';this.phase='stopping';this.instance=this.child?'unconfirmed':'absent';this.checkedAt=this.iso();
    let unconfirmed=false;
    const child=this.child,generation=this.childGeneration;
    if(child){
      const closed=this.waitClosed(generation,this.deps.stopTimeoutMs);
      try{if(child.connected)child.send({type:'stop'});}catch{/* the child may already be gone */}
      if(!await closed){
        if(this.child&&this.childGeneration===generation){try{child.kill();}catch{/* reported below */}await this.waitClosed(generation,this.deps.killTimeoutMs);}
      }
      if(this.child&&this.childGeneration===generation)unconfirmed=true;
    }
    await this.releaseCapability();
    await this.releaseBridge();
    if(unconfirmed){this.state='failed';this.instance='unconfirmed';this.fail('MANAGEMENT_STOP_UNCONFIRMED');throw new Error('MANAGEMENT_STOP_UNCONFIRMED');}
    this.resetStopped();
  }
  private async releaseCapability():Promise<void>{
    const capability=this.capability;this.capability=undefined;
    try{await capability?.stop();}catch{/* cleanup never masks the lifecycle result */}
    this.capabilityStatus={id:'qq',state:'stopped',owned:false,pid:null,code:null,message:null};
  }
  private async releaseBridge():Promise<void>{
    const close=this.bridgeClose;this.bridgeClose=undefined;
    if(close)try{await close();}catch{/* cleanup independently */}
  }
  private resetStopped():void{
    this.state='stopped';this.phase='stopped';this.code=null;this.codeAt=null;this.instance=this.child?'unconfirmed':'absent';this.checkedAt=this.iso();this.readyAt=null;
    this.clearRetry();this.retryAttempt=0;
  }
  private attachChild(child:ChildProcess,generation:number):void{
    child.on('message',(raw:unknown)=>{this.onChildMessage(raw,generation);});
    child.once('error',()=>{if(this.childGeneration===generation)this.lastExitCode='INSTALL_NODE_UNAVAILABLE';});
    child.once('close',()=>{this.onChildClose(generation);});
  }
  private onChildMessage(raw:unknown,generation:number):void{
    if(!raw||typeof raw!=='object'||generation!==this.childGeneration||!this.child)return;
    const value=raw as Record<string,unknown>;
    if(value.type==='management.result'&&typeof value.id==='string'){
      const pending=this.pending.get(value.id);if(!pending)return;this.pending.delete(value.id);this.deps.timers.clearTimeout(pending.timer);
      if(value.ok===true)pending.resolve(managementJson(value.value));else pending.reject(new Error(typeof value.code==='string'&&/^[A-Z_0-9]{1,100}$/.test(value.code)?value.code:'MANAGEMENT_OPERATION_FAILED'));
      return;
    }
    if(value.code==='INSTALL_READY'&&this.state!=='stopping'&&!this.disposed&&!this.operation?.controller.signal.aborted){
      const waiter=this.readyWaiters.get(generation);
      this.markReady(generation);
      if(waiter){this.readyWaiters.delete(generation);this.deps.timers.clearTimeout(waiter.timer);waiter.resolve();}
    }else if(this.instance!=='ready'&&typeof value.code==='string'&&value.code!=='INSTALL_READY'&&value.code!=='INSTALL_STOPPED'&&/^[A-Z][A-Z0-9_]{0,99}$/.test(value.code)){
      this.lastExitCode=value.code;
    }
  }
  private onChildClose(generation:number):void{
    const waiter=this.readyWaiters.get(generation);
    if(waiter){this.readyWaiters.delete(generation);this.deps.timers.clearTimeout(waiter.timer);waiter.reject(new Error(this.lastExitCode??'MANAGEMENT_PROCESS_EXITED'));}
    for(const resolve of this.closeWaiters.get(generation)??[])resolve(true);
    this.closeWaiters.delete(generation);
    if(this.childGeneration!==generation)return;
    const stopping=this.state==='stopping';
    this.child=undefined;this.instance='absent';
    this.rejectPending(new Error('MANAGEMENT_PROCESS_CLOSED'));
    void this.releaseBridge();
    if(stopping){this.resetStopped();return;}
    this.state='failed';
    const code=this.lastExitCode??'INSTALL_PROCESS_EXITED';
    this.fail(code);
    if(isRetryable(code))this.scheduleRetry();
  }
  private markReady(generation:number):void{
    if(this.childGeneration!==generation||!this.child||this.state==='stopping'||this.disposed||this.operation?.controller.signal.aborted)return;
    this.state='running';this.phase='ready';this.instance='ready';this.code=null;this.codeAt=null;this.readyAt=this.iso();this.checkedAt=this.readyAt;this.retryAttempt=0;this.clearRetry();
  }
  private waitReady(generation:number,operation:Operation):Promise<void>{
    return new Promise((resolve,reject)=>{
      if(operation.controller.signal.aborted||this.childGeneration!==generation)return reject(new Error('MANAGEMENT_OPERATION_CANCELLED'));
      if(this.instance==='ready'&&this.state==='running')return resolve();
      let settled=false;
      const finish=(error?:Error)=>{
        if(settled)return;settled=true;
        const waiter=this.readyWaiters.get(generation);
        if(waiter){this.readyWaiters.delete(generation);this.deps.timers.clearTimeout(waiter.timer);}
        operation.controller.signal.removeEventListener('abort',onAbort);
        if(error)reject(error);else resolve();
      };
      const onAbort=()=>finish(new Error('MANAGEMENT_OPERATION_CANCELLED'));
      const timer=this.deps.timers.setTimeout(()=>finish(new Error('MANAGEMENT_START_TIMEOUT')),this.deps.startTimeoutMs);
      this.readyWaiters.set(generation,{resolve:()=>finish(),reject:(error)=>finish(error),timer});
      operation.controller.signal.addEventListener('abort',onAbort,{once:true});
    });
  }
  private waitClosed(generation:number,timeoutMs:number):Promise<boolean>{
    if(!this.child||this.childGeneration!==generation)return Promise.resolve(true);
    return new Promise<boolean>(resolve=>{
      let settled=false;
      const waiters=this.closeWaiters.get(generation)??new Set<(closed:boolean)=>void>();
      const finish=(closed:boolean)=>{
        if(settled)return;settled=true;this.deps.timers.clearTimeout(timer);waiters.delete(finish);resolve(closed);
      };
      const timer=this.deps.timers.setTimeout(()=>finish(false),timeoutMs);
      waiters.add(finish);this.closeWaiters.set(generation,waiters);
    });
  }
  private async reconcile():Promise<boolean>{
    const child=this.child;if(!child?.connected)return false;
    if(this.healthProbe)return this.healthProbe;
    this.healthProbe=(async()=>{
      const generation=this.childGeneration;
      try{
        const value=await this.sendCall('runtime','status',null,this.deps.healthTimeoutMs);
        if(this.childGeneration!==generation||!this.child||this.state==='stopping'||this.disposed||this.operation?.controller.signal.aborted)return false;
        const phase=(value as {phase?:unknown}).phase;
        this.checkedAt=this.iso();
        if(typeof phase==='string'&&['ready','degraded'].includes(phase)){
          this.markReady(generation);
          const waiter=this.readyWaiters.get(generation);
          if(waiter){this.readyWaiters.delete(generation);this.deps.timers.clearTimeout(waiter.timer);waiter.resolve();}
          return true;
        }
        this.instance='unconfirmed';
        return false;
      }catch{
        if(this.child)this.instance='unconfirmed';
        this.checkedAt=this.iso();
        return false;
      }finally{this.healthProbe=undefined;}
    })();
    return this.healthProbe;
  }
  private async inspect():Promise<ManagementControlResult>{
    if(this.child&&this.instance!=='ready')await this.reconcile();
    let host:Json|null=null,hostCode:string|null=null;
    if(this.child?.connected&&this.instance==='ready'){
      try{host=managementJson(await this.sendCall('runtime','status',null,this.deps.healthTimeoutMs));}catch(error){hostCode=errorCode(error);}
    }
    this.checkedAt=this.iso();
    return this.receipt('status',hostCode===null?'completed':'failed',null,null,true,host,hostCode);
  }
  private scheduleRetry():void{
    if(this.disposed||this.child||this.state==='stopping'||this.state==='stopped'||this.retryTimer!==undefined||this.retryAttempt>=this.deps.retryDelaysMs.length)return;
    const delay=this.deps.retryDelaysMs[this.retryAttempt++]!;this.nextRetryAt=Date.now()+delay;
    this.retryTimer=this.deps.timers.setTimeout(()=>{
      this.retryTimer=undefined;this.nextRetryAt=null;
      if(this.disposed||this.child||this.state==='stopping')return;
      void this.startRequest({automatic:true,wait:true}).catch(()=>{});
    },delay);
  }
  private clearRetry():void{
    if(this.retryTimer!==undefined){this.deps.timers.clearTimeout(this.retryTimer);this.retryTimer=undefined;}
    this.nextRetryAt=null;
  }
  private rejectPending(error:Error):void{
    for(const pending of this.pending.values()){this.deps.timers.clearTimeout(pending.timer);pending.reject(error);}
    this.pending.clear();
  }
  private sendCall(module:string,action:string,input:Json,timeoutMs:number):Promise<Json>{
    const child=this.child;
    if(!child?.connected)return Promise.reject(new Error('MANAGEMENT_RUNTIME_OFFLINE'));
    const id=randomUUID();
    return new Promise<Json>((resolve,reject)=>{
      const timer=this.deps.timers.setTimeout(()=>{this.pending.delete(id);reject(new Error('MANAGEMENT_RESULT_UNKNOWN'));},timeoutMs);
      this.pending.set(id,{resolve,reject,timer});
      try{child.send({type:'management.request',id,module,action,input},error=>{if(error){this.deps.timers.clearTimeout(timer);this.pending.delete(id);reject(new Error('MANAGEMENT_SEND_FAILED'));}});}
      catch{this.deps.timers.clearTimeout(timer);this.pending.delete(id);reject(new Error('MANAGEMENT_SEND_FAILED'));}
    });
  }
  /** While the management snapshot may be stale, a live IPC channel still serves module queries. */
  call(module:string,action:string,input:Json):Promise<Json>{
    if(!this.child?.connected||this.state==='stopped'||this.state==='stopping')return Promise.reject(new Error('MANAGEMENT_RUNTIME_OFFLINE'));
    return this.sendCall(module,action,input,15_000);
  }
  dispose():Promise<void>{
    if(this.disposePromise)return this.disposePromise;
    this.disposed=true;this.clearRetry();this.retryAttempt=0;
    this.disposePromise=(async()=>{
      const active=this.operation;
      if(active&&!active.settled){active.controller.abort();await active.done;}
      await this.stopRequest({wait:true}).catch(()=>{});
    })().finally(()=>{this.rejectPending(new Error('MANAGEMENT_RUNTIME_DISPOSED'));});
    return this.disposePromise;
  }
}
