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

/**
 * QQ capability lifecycle. It reuses an already-running OneBot, or starts the
 * configured OneBot service and optionally attaches the configured QQ account.
 */
export class OneBotCapability {
  private child:ChildProcess|undefined;
  private owned=false;
  private current:CapabilityStatus={id:'qq',state:'pending',owned:false,pid:null,code:null,message:null};
  private readonly fetchImpl:typeof fetch;
  private readonly spawnImpl:(command:string,args:readonly string[],options:SpawnOptions)=>ChildProcess;
  private readonly sleepImpl:(ms:number)=>Promise<void>;
  constructor(private readonly settings:InstallationSettings['qq'],deps:CapabilityDependencies={}){
    this.fetchImpl=deps.fetch??fetch;
    this.spawnImpl=deps.spawn??((command,args,options)=>spawn(command,[...args],options));
    this.sleepImpl=deps.sleep??sleep;
  }
  status():CapabilityStatus{return {...this.current};}
  private report(state:CapabilityState,code:string|null=null,message:string|null=null){
    this.current={id:'qq',state,owned:this.owned,pid:this.child?.pid??null,code,message};
  }
  private async probe():Promise<boolean>{
    let token:string;
    try{token=readFileSync(this.settings.tokenFile,'utf8').trim();}catch{return false;}
    if(!token)return false;
    try{
      const response=await this.fetchImpl(`${this.settings.httpURL.replace(/\/+$/,'')}/get_login_info`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(3_000)});
      if(!response.ok)return false;
      const value=await response.json() as {status?:unknown;data?:{user_id?:unknown}};
      return value.status==='ok'&&String(value.data?.user_id)===this.settings.botId;
    }catch{return false;}
  }
  private async startService():Promise<void>{
    const service=this.settings.service;
    if(!service)throw new Error('ONEBOT_NOT_RUNNING');
    this.report('starting');
    try{
      this.child=this.spawnImpl(service.command,service.args,{cwd:service.cwd??dirname(service.command),env:{...process.env,...service.env},windowsHide:true,stdio:'ignore'});
    }catch{this.report('failed','ONEBOT_SERVICE_START_FAILED','OneBot 服务无法启动');throw new Error('ONEBOT_SERVICE_START_FAILED');}
    this.owned=true;
    this.child.once('exit',()=>{this.child=undefined;if(this.current.state!=='stopped')this.report('failed','ONEBOT_SERVICE_EXITED','OneBot 服务已退出');});
    this.child.once('error',()=>{this.child=undefined;this.report('failed','ONEBOT_SERVICE_START_FAILED','OneBot 服务启动失败');});
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
  private async attach():Promise<boolean>{
    const webui=this.settings.service?.webui;
    if(!webui)return false;
    const password=this.password();
    if(!password)return false;
    try{
      const login=await this.fetchImpl(`${webui.url.replace(/\/+$/,'')}/api/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password}),signal:AbortSignal.timeout(5_000)});
      if(!login.ok)return false;
      const auth=await login.json() as {success?:unknown;token?:unknown};
      if(auth.success!==true||typeof auth.token!=='string')return false;
      const headers={Authorization:`Bearer ${auth.token}`};
      const processes=await this.fetchImpl(`${webui.url.replace(/\/+$/,'')}/api/processes`,{headers,signal:AbortSignal.timeout(5_000)});
      if(!processes.ok)return false;
      const body=await processes.json() as {list?:Array<{pid?:unknown;connected?:unknown;account?:{uin?:unknown}}>};
      const account=(body.list??[]).find(item=>String(item.account?.uin)===this.settings.botId);
      if(!account||typeof account.pid!=='number')return false;
      if(account.connected)return true;
      const attach=await this.fetchImpl(`${webui.url.replace(/\/+$/,'')}/api/processes/${account.pid}/load`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(20_000)});
      if(!attach.ok)return false;
      const result=await attach.json() as {success?:unknown};
      return result.success===true;
    }catch{return false;}
  }
  async ensureReady():Promise<void>{
    if(await this.probe()){this.owned=false;this.report('ready');return;}
    if(!this.settings.service){this.report('waiting-login','ONEBOT_NOT_RUNNING','OneBot 未运行；请启动 SnowLuma/OneBot 后重试');throw new Error('ONEBOT_NOT_RUNNING');}
    if(!this.child){await this.startService();}
    const timeout=this.settings.service.startTimeoutMs;
    let attached=false;
    const deadline=Date.now()+timeout;
    while(Date.now()<deadline){
      if(await this.probe()){this.report('ready');return;}
      if(this.current.state==='failed')throw new Error('ONEBOT_SERVICE_EXITED');
      if(!attached)attached=await this.attach();
      await this.sleepImpl(500);
    }
    this.report('waiting-login',attached?'ONEBOT_LOGIN_REQUIRED':'ONEBOT_ACCOUNT_NOT_ATTACHED',attached?'OneBot 已启动，等待机器人登录':'OneBot 已启动，等待在 SnowLuma 登录并连接机器人');
    throw new Error(attached?'ONEBOT_LOGIN_REQUIRED':'ONEBOT_ACCOUNT_NOT_ATTACHED');
  }
  async stop():Promise<void>{
    const child=this.child;
    this.child=undefined;
    if(this.owned&&child?.pid){
      this.owned=false;
      await new Promise<void>(resolve=>{
        if(process.platform==='win32'){
          try{const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.once('close',()=>resolve());killer.once('error',()=>resolve());}catch{resolve();}
        }else{try{child.kill();}catch{/* already gone */}resolve();}
      });
    }
    this.owned=false;
    this.report('stopped');
  }
}
