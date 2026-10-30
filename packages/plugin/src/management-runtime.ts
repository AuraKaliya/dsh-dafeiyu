import {spawn} from 'node:child_process';
import type {ChildProcess} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import type {Context} from '@deepseek-ai/cordis';
import {readInstallationSettings} from './settings.js';
import {managementJson} from '@dafeiyu/contracts';
import type {Json} from '@dafeiyu/contracts';

export const ONEBOT_RETRY_DELAYS_MS=[2_000,5_000,15_000,30_000,60_000] as const;

/** Verify the exact bot account before starting a Host that treats QQ as required. */
export async function waitForOneBot(settings:{qq:{botId:string;tokenFile:string;httpURL:string}},options:{timeoutMs?:number;fetchImpl?:typeof fetch}={}):Promise<void>{
  const deadline=Date.now()+(options.timeoutMs??30_000),fetchImpl=options.fetchImpl??fetch;
  if(!existsSync(settings.qq.tokenFile))throw new Error('ONEBOT_TOKEN_UNAVAILABLE');
  const token=readFileSync(settings.qq.tokenFile,'utf8').trim();
  if(!token)throw new Error('ONEBOT_TOKEN_UNAVAILABLE');
  const url=`${settings.qq.httpURL.replace(/\/+$/,'')}/get_login_info`;
  let last='ONEBOT_NOT_READY';
  while(Date.now()<deadline){
    try{
      const response=await fetchImpl(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(3_000)});
      if(response.ok){
        const value=await response.json() as {status?:unknown;data?:{user_id?:unknown}};
        if(value.status==='ok'&&String(value.data?.user_id)===settings.qq.botId)return;
        last='ONEBOT_IDENTITY_MISMATCH';
      }else last='ONEBOT_HTTP_ERROR';
    }catch(error){last=error instanceof Error&&/^ONEBOT_/.test(error.message)?error.message:'ONEBOT_NOT_READY';}
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  throw new Error(last);
}

/** Parent remains available while the isolated Agent is stopped or failed. */
export class ManagementRuntime {
  private child:ChildProcess|undefined;private bridgeClose:(()=>Promise<void>)|undefined;private closed:Promise<void>=Promise.resolve();
  private pending=new Map<string,{resolve:(value:Json)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  private state='stopped';private code:string|null=null;private busy=false;private disposed=false;
  private retryTimer:ReturnType<typeof setTimeout>|undefined;private retryAttempt=0;
  constructor(private readonly ctx:Context,private readonly config:{settingsFile:string;nodePath:string}){}
  status(){return {state:this.state,code:this.code,pid:this.child?.pid??null,retryAttempt:this.retryAttempt};}
  async control(action:'start'|'stop'|'restart'|'status'){if(action==='status')return this.child&&this.state==='running'?{...this.status(),host:await this.call('runtime','status',null)}:this.status();
    if(this.disposed||this.busy)throw new Error('MANAGEMENT_RUNTIME_BUSY');this.busy=true;try{if(action!=='start')await this.stop();if(action!=='stop'){try{await this.start();}catch(error){this.code=error instanceof Error&&/^[A-Z][A-Z0-9_]{0,99}$/.test(error.message)?error.message:'INSTALL_START_FAILED';this.scheduleRetry();}}return this.status();}finally{this.busy=false;}}
  private scheduleRetry(){if(this.disposed||this.state==='stopping'||this.retryTimer||this.retryAttempt>=ONEBOT_RETRY_DELAYS_MS.length)return;
    const delay=ONEBOT_RETRY_DELAYS_MS[this.retryAttempt++]!;this.state='failed';this.retryTimer=setTimeout(()=>{this.retryTimer=undefined;void this.start().catch(()=>this.scheduleRetry());},delay);this.retryTimer.unref();}
  private async start(){if(this.child)throw new Error('MANAGEMENT_ALREADY_STARTED');const settings=readInstallationSettings(this.config.settingsFile);this.state='starting';this.code=null;
    await waitForOneBot(settings);
    const bridge=settings.dshTools?await import('./bridge-parent.js'):null;
    const child=spawn(this.config.nodePath,[fileURLToPath(new URL('../bin/dafeiyu.mjs',import.meta.url)),'start','--settings',this.config.settingsFile],{windowsHide:true,env:{...process.env,DAFEIYU_DSH_BRIDGE:settings.dshTools?'1':''},stdio:['ignore','ignore','ignore','ipc']});this.child=child;
    this.closed=new Promise(resolve=>{let ended=false;const finish=()=>{if(ended)return;ended=true;if(this.state!=='stopping'){this.state='failed';this.code??='INSTALL_PROCESS_EXITED';}else this.state='stopped';this.child=undefined;for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(new Error('MANAGEMENT_PROCESS_CLOSED'));}this.pending.clear();resolve();if(this.state==='failed')this.scheduleRetry();};child.once('close',finish);child.once('error',()=>{this.code='INSTALL_NODE_UNAVAILABLE';finish();});});
    child.on('message',(raw:unknown)=>{if(!raw||typeof raw!=='object')return;const value=raw as Record<string,unknown>;
      if(value.type==='management.result'&&typeof value.id==='string'){const pending=this.pending.get(value.id);if(!pending)return;this.pending.delete(value.id);clearTimeout(pending.timer);if(value.ok===true)pending.resolve(managementJson(value.value));else pending.reject(new Error(typeof value.code==='string'&&/^[A-Z_0-9]{1,100}$/.test(value.code)?value.code:'MANAGEMENT_OPERATION_FAILED'));return;}
      if(value.code==='INSTALL_READY'){this.state='running';this.retryAttempt=0;}else if(typeof value.code==='string'&&/^[A-Z_0-9]{1,100}$/.test(value.code)&&value.code!=='INSTALL_STOPPED')this.code=value.code;});
    try{this.bridgeClose=bridge?bridge.attachDshBridge(this.ctx,child,this.config.settingsFile):undefined;}catch(error){await this.stop();throw error;}}
  private async stop(){if(this.retryTimer){clearTimeout(this.retryTimer);this.retryTimer=undefined;}this.retryAttempt=0;const child=this.child;if(child){this.state='stopping';if(child.connected)child.send({type:'stop'});let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([this.closed,new Promise<void>(resolve=>{timer=setTimeout(resolve,40000);})]);if(this.child){child.kill();await this.closed;}}finally{if(timer)clearTimeout(timer);}}
    await this.bridgeClose?.();this.bridgeClose=undefined;}
  call(module:string,action:string,input:Json):Promise<Json>{const child=this.child;if(!child?.connected||this.state!=='running')return Promise.reject(new Error('MANAGEMENT_RUNTIME_OFFLINE'));
    const id=randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('MANAGEMENT_RESULT_UNKNOWN'));},15000);this.pending.set(id,{resolve,reject,timer});child.send({type:'management.request',id,module,action,input},error=>{if(error){clearTimeout(timer);this.pending.delete(id);reject(new Error('MANAGEMENT_SEND_FAILED'));}});});}
  async dispose(){this.disposed=true;if(this.retryTimer){clearTimeout(this.retryTimer);this.retryTimer=undefined;}await this.stop();}
}
