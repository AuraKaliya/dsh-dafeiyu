import { spawn } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { InstallationSettings } from './settings.js';

export type CapabilityState='pending'|'starting'|'waiting-login'|'ready'|'failed'|'stopped'|'disabled';
export interface CapabilityStatus {
  readonly id:string;
  readonly state:CapabilityState;
  readonly owned:boolean;
  readonly pid:number|null;
  readonly code:string|null;
  readonly message:string|null;
}
export interface CapabilityDependencies {
  readonly fetch?:typeof fetch;
  readonly spawn?:(command:string,args:readonly string[],options:SpawnOptions)=>ChildProcess;
  readonly sleep?:(ms:number)=>Promise<void>;
}
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const abortableSleep=(ms:number,signal:AbortSignal|undefined)=>new Promise<void>((resolve,reject)=>{
  if(signal?.aborted)return reject(new Error('ONEBOT_WAIT_CANCELLED'));
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);
  const abort=()=>{clearTimeout(timer);reject(new Error('ONEBOT_WAIT_CANCELLED'));};
  signal?.addEventListener('abort',abort,{once:true});
});
const aborted=(signal:AbortSignal|undefined)=>signal?.aborted===true;

/**
 * QQ capability lifecycle. It reuses an already-running OneBot, or starts the
 * configured OneBot service and optionally attaches the configured QQ account.
 * Wait loops are cancellable; only a service this instance started is stopped
 * later, and late callbacks from an older service process cannot overwrite the
 * current status.
 */
export class OneBotCapability {
  private child:ChildProcess|undefined;
  private owned=false;
  private generation=0;
  private current:CapabilityStatus={id:'qq',state:'pending',owned:false,pid:null,code:null,message:null};
  private readonly fetchImpl:typeof fetch;
  private readonly spawnImpl:(command:string,args:readonly string[],options:SpawnOptions)=>ChildProcess;
  private readonly sleepImpl:(ms:number,signal?:AbortSignal)=>Promise<void>;
  constructor(private readonly settings:InstallationSettings['qq'],deps:CapabilityDependencies={}){
    this.fetchImpl=deps.fetch??fetch;
    this.spawnImpl=deps.spawn??((command,args,options)=>spawn(command,[...args],options));
    this.sleepImpl=deps.sleep??((ms,signal)=>signal?abortableSleep(ms,signal):sleep(ms));
  }
  status():CapabilityStatus{return {...this.current};}
  private report(state:CapabilityState,code:string|null=null,message:string|null=null){
    this.current={id:'qq',state,owned:this.owned,pid:this.child?.pid??null,code,message};
  }
  private async probe(signal?:AbortSignal):Promise<boolean>{
    let token:string;
    try{token=readFileSync(this.settings.tokenFile,'utf8').trim();}catch{return false;}
    if(!token)return false;
    try{
      const timeout=AbortSignal.timeout(3_000);
      const response=await this.fetchImpl(`${this.settings.httpURL.replace(/\/+$/,'')}/get_login_info`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:'{}',signal:signal?AbortSignal.any([signal,timeout]):timeout});
      if(!response.ok)return false;
      const value=await response.json() as {status?:unknown;data?:{user_id?:unknown}};
      return value.status==='ok'&&String(value.data?.user_id)===this.settings.botId;
    }catch{return false;}
  }
  private async startService():Promise<void>{
    const service=this.settings.service;
    if(!service)throw new Error('ONEBOT_NOT_RUNNING');
    this.report('starting');
    const generation=++this.generation;
    let child:ChildProcess;
    try{
      child=this.spawnImpl(service.command,service.args,{cwd:service.cwd??dirname(service.command),env:{...process.env,...service.env},windowsHide:true,stdio:'ignore'});
    }catch{this.report('failed','ONEBOT_SERVICE_START_FAILED','OneBot 服务无法启动');throw new Error('ONEBOT_SERVICE_START_FAILED');}
    this.child=child;this.owned=true;
    child.once('exit',()=>{if(this.generation!==generation||this.child!==child)return;this.child=undefined;this.owned=false;if(this.current.state!=='stopped')this.report('failed','ONEBOT_SERVICE_EXITED','OneBot 服务已退出');});
    child.once('error',()=>{if(this.generation!==generation||this.child!==child)return;this.child=undefined;this.owned=false;this.report('failed','ONEBOT_SERVICE_START_FAILED','OneBot 服务启动失败');});
  }
  private password():string|null{
    const file=this.settings.service?.webui?.passwordFile;
    if(!file)return null;
    try{
      const raw=readFileSync(file,'utf8').trim();
      try{const value=JSON.parse(raw) as {webui?:unknown;password?:unknown};if(typeof value.webui==='string'&&value.webui)return value.webui;if(typeof value.password==='string'&&value.password)return value.password;}catch{/* plain text password file */}
      return raw||null;
    }catch{return null;}
  }
  private async attach(signal?:AbortSignal):Promise<boolean>{
    const webui=this.settings.service?.webui;
    if(!webui)return false;
    const password=this.password();
    if(!password)return false;
    const timeout=(ms:number)=>signal?AbortSignal.any([signal,AbortSignal.timeout(ms)]):AbortSignal.timeout(ms);
    try{
      const login=await this.fetchImpl(`${webui.url.replace(/\/+$/,'')}/api/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password}),signal:timeout(5_000)});
      if(!login.ok)return false;
      const auth=await login.json() as {success?:unknown;token?:unknown};
      if(auth.success!==true||typeof auth.token!=='string')return false;
      const headers={Authorization:`Bearer ${auth.token}`};
      const processes=await this.fetchImpl(`${webui.url.replace(/\/+$/,'')}/api/processes`,{headers,signal:timeout(5_000)});
      if(!processes.ok)return false;
      const body=await processes.json() as {list?:Array<{pid?:unknown;connected?:unknown;account?:{uin?:unknown}}>};
      const account=(body.list??[]).find(item=>String(item.account?.uin)===this.settings.botId);
      if(!account||typeof account.pid!=='number')return false;
      if(account.connected)return true;
      if(aborted(signal))return false;
      const attachCall=await this.fetchImpl(`${webui.url.replace(/\/+$/,'')}/api/processes/${account.pid}/load`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}',signal:timeout(20_000)});
      if(!attachCall.ok)return false;
      const result=await attachCall.json() as {success?:unknown};
      return result.success===true;
    }catch{return false;}
  }
  async ensureReady(signal?:AbortSignal):Promise<void>{
    if(aborted(signal))throw new Error('ONEBOT_WAIT_CANCELLED');
    if(await this.probe(signal)){this.owned=false;this.report('ready');return;}
    if(aborted(signal))throw new Error('ONEBOT_WAIT_CANCELLED');
    if(!this.settings.service){this.report('waiting-login','ONEBOT_NOT_RUNNING','OneBot 未运行；请启动 SnowLuma/OneBot 后重试');throw new Error('ONEBOT_NOT_RUNNING');}
    if(!this.child){await this.startService();}
    const timeout=this.settings.service.startTimeoutMs;
    let attached=false;
    const deadline=Date.now()+timeout;
    while(Date.now()<deadline){
      if(aborted(signal))throw new Error('ONEBOT_WAIT_CANCELLED');
      if(await this.probe(signal)){this.report('ready');return;}
      if(aborted(signal))throw new Error('ONEBOT_WAIT_CANCELLED');
      if(this.current.state==='failed')throw new Error('ONEBOT_SERVICE_EXITED');
      if(!attached)attached=await this.attach(signal);
      if(aborted(signal))throw new Error('ONEBOT_WAIT_CANCELLED');
      await this.sleepImpl(500,signal);
    }
    if(aborted(signal))throw new Error('ONEBOT_WAIT_CANCELLED');
    this.report('waiting-login',attached?'ONEBOT_LOGIN_REQUIRED':'ONEBOT_ACCOUNT_NOT_ATTACHED',attached?'OneBot 已启动，等待机器人登录':'OneBot 已启动，等待在 SnowLuma 登录并连接机器人');
    throw new Error(attached?'ONEBOT_LOGIN_REQUIRED':'ONEBOT_ACCOUNT_NOT_ATTACHED');
  }
  async stop():Promise<void>{
    this.generation++;
    const child=this.child,owned=this.owned;
    this.child=undefined;this.owned=false;
    if(owned&&child?.pid){
      await new Promise<void>(resolve=>{
        if(process.platform==='win32'){
          try{const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.once('close',()=>resolve());killer.once('error',()=>resolve());}catch{resolve();}
        }else{try{child.kill();}catch{/* already gone */}resolve();}
      });
    }
    this.report('stopped');
  }
}
