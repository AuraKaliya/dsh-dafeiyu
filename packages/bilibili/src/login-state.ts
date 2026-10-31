import {lstatSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {NumberIdSchema} from './config.js';

const CredentialFileSchema=z.strictObject({
  uid:NumberIdSchema,
  SESSDATA:z.string().min(1).max(4096).regex(/^[^;\s\x00-\x1f\x7f]+$/),
  bili_jct:z.string().regex(/^[a-fA-F0-9]{32}$/).optional(),
  buvid3:z.string().max(200).regex(/^[a-zA-Z0-9_-]+$/).optional(),
});
export type CredentialValue=z.infer<typeof CredentialFileSchema>;
/** A credential snapshot is complete and immutable; only its fingerprint leaves this module. */
export interface CredentialSnapshot {readonly uid:string;readonly fingerprint:string;readonly generation:number;readonly cookie:string;readonly value:CredentialValue}
export type CredentialRead={state:'not-configured'}|{state:'invalid';code:string}|{state:'ready';snapshot:CredentialSnapshot};
export interface BiliIdentity {readonly uid:string;readonly fingerprint:string;readonly at:number;readonly expiresAt:number;readonly nav:unknown}
export type IdentityVerify=(snapshot:CredentialSnapshot,signal:AbortSignal,permit?:string)=>Promise<unknown>;
export interface CredentialStatus {
  readonly configured:boolean;readonly credentialState:'not-configured'|'invalid'|'ready';readonly expectedUid:string|null;readonly uid:string|null;
  readonly engine:'unverified'|'verifying'|'verified'|'expired'|'mismatch'|'interrupted';
  readonly verifiedUid:string|null;readonly verifiedAt:string|null;readonly expiresAt:string|null;readonly credentialGeneration:number;
  readonly lastResult:{at:string;kind:'success'|'failure';code:string|null;uid:string|null}|null;
  readonly note:string;
}
interface Inflight {fingerprint:string;controller:AbortController;waiters:number;settled:boolean;promise:Promise<BiliIdentity>}
const NETWORK_CODES=new Set(['BILI_HTTP_FAILED','BILI_BACKOFF','BILI_DIAGNOSTIC_REQUIRED','BILI_CANCELLED','BILI_HEADERS_FAILED','BILI_RESPONSE_LIMIT']);
const codeOf=(error:unknown,fallback='BILI_REQUEST_FAILED'):string=>error instanceof Error&&/^[A-Z][A-Z0-9_]{0,99}$/.test(error.message)?error.message:fallback;

/**
 * Credential snapshot and login verification cache shared by every HTTP entry.
 * Cache identity is the expected UID plus a normalized content fingerprint, so
 * reformatting the JSON does not masquerade as a new login. Only one check runs
 * per credential generation; callers share it while keeping their own cancellation.
 */
export class BiliCredentials {
  private currentFingerprint:string|null=null;
  private currentGeneration=0;
  private verified:BiliIdentity|null=null;
  private inflight:Inflight|null=null;
  private lastKnownState:'unverified'|'verified'|'expired'|'mismatch'|'interrupted'='unverified';
  private lastResult:{at:number;kind:'success'|'failure';code:string|null;uid:string|null}|null=null;
  constructor(private readonly setting:{file:string;expectedUid:string}|undefined,private readonly options:{now?:()=>number;ttlMs?:number}={}){}
  private now():number{return (this.options.now??Date.now)();}
  private get ttlMs():number{return this.options.ttlMs??300_000;}
  /** Read the whole file once; a replaced or reformatted file yields a new fingerprint only when content changes. */
  read():CredentialRead{
    const setting=this.setting;
    if(!setting)return {state:'not-configured'};
    try{
      if(!/^[a-zA-Z]:[\\/][^:\x00]+$/.test(setting.file))throw new Error('BILI_SESSION_INVALID');
      const info=lstatSync(setting.file);
      if(!info.isFile()||info.isSymbolicLink()||info.size>16384)throw new Error('BILI_SESSION_INVALID');
      const bytes=readFileSync(setting.file);
      if(bytes.length>16384)throw new Error('BILI_SESSION_INVALID');
      let raw:unknown;try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new Error('BILI_SESSION_INVALID');}
      const value=CredentialFileSchema.parse(raw);
      if(value.uid!==setting.expectedUid)throw new Error('BILI_ACCOUNT_MISMATCH');
      const fingerprint=createHash('sha256').update(JSON.stringify({uid:value.uid,SESSDATA:value.SESSDATA,bili_jct:value.bili_jct??null,buvid3:value.buvid3??null})).digest('hex');
      if(this.currentFingerprint!==fingerprint){
        this.currentFingerprint=fingerprint;this.currentGeneration++;this.verified=null;this.lastKnownState='unverified';
        const inflight=this.inflight;if(inflight){this.inflight=null;inflight.controller.abort();}
      }
      const snapshot:CredentialSnapshot={uid:value.uid,fingerprint,generation:this.currentGeneration,cookie:'SESSDATA='+value.SESSDATA+(value.buvid3?'; buvid3='+value.buvid3:''),value};
      return {state:'ready',snapshot};
    }catch(error){return {state:'invalid',code:codeOf(error,'BILI_SESSION_INVALID')};}
  }
  /** Reject a result produced under a credential snapshot that is no longer current. */
  assertCurrent(snapshot:CredentialSnapshot):void{
    if(this.currentFingerprint!==snapshot.fingerprint||snapshot.generation!==this.currentGeneration)throw new Error('BILI_SESSION_CHANGED');
  }
  private cached(snapshot:CredentialSnapshot):BiliIdentity|null{
    const verified=this.verified;
    if(!verified||verified.fingerprint!==snapshot.fingerprint||verified.uid!==snapshot.uid)return null;
    return this.now()<verified.expiresAt?verified:null;
  }
  identity(snapshot:CredentialSnapshot,verify:IdentityVerify,caller:AbortSignal,options:{force?:boolean;permit?:string}={}):Promise<BiliIdentity>{
    const cached=options.force?null:this.cached(snapshot);
    if(cached)return Promise.resolve(cached);
    const existing=this.inflight;
    if(existing&&existing.fingerprint===snapshot.fingerprint&&!existing.settled)return this.join(existing,caller);
    if(existing&&!existing.settled){this.inflight=null;existing.controller.abort();}
    const controller=new AbortController();
    const entry:Inflight={fingerprint:snapshot.fingerprint,controller,waiters:1,settled:false,promise:Promise.resolve() as unknown as Promise<BiliIdentity>};
    this.inflight=entry;
    entry.promise=this.runVerification(snapshot,verify,controller.signal,options.permit).then(identity=>{
      entry.settled=true;if(this.inflight===entry)this.inflight=null;return identity;
    },error=>{
      entry.settled=true;if(this.inflight===entry)this.inflight=null;throw error;
    });
    void entry.promise.catch(()=>{});
    return this.join(entry,caller);
  }
  private join(entry:Inflight,signal:AbortSignal):Promise<BiliIdentity>{
    entry.waiters++;
    return new Promise<BiliIdentity>((resolve,reject)=>{
      let released=false;
      const release=()=>{if(released)return;released=true;entry.waiters--;if(entry.waiters<=0&&!entry.settled&&this.inflight===entry)entry.controller.abort();};
      if(signal.aborted){release();return reject(new Error('BILI_CANCELLED'));}
      const abort=()=>{signal.removeEventListener('abort',abort);release();reject(new Error('BILI_CANCELLED'));};
      signal.addEventListener('abort',abort,{once:true});
      entry.promise.then(value=>{signal.removeEventListener('abort',abort);release();resolve(value);},error=>{signal.removeEventListener('abort',abort);release();reject(error);});
    });
  }
  private async runVerification(snapshot:CredentialSnapshot,verify:IdentityVerify,signal:AbortSignal,permit?:string):Promise<BiliIdentity>{
    this.lastKnownState='unverified';
    try{
      const nav=await verify(snapshot,signal,permit);
      this.assertCurrent(snapshot);
      const account=z.object({isLogin:z.literal(true),mid:z.union([NumberIdSchema,z.number().int().positive().safe().transform(String)])}).safeParse(nav);
      if(!account.success)throw new Error('BILI_LOGIN_REQUIRED');
      if(account.data.mid!==snapshot.uid)throw new Error('BILI_ACCOUNT_MISMATCH');
      const identity:BiliIdentity={uid:snapshot.uid,fingerprint:snapshot.fingerprint,at:this.now(),expiresAt:this.now()+this.ttlMs,nav};
      if(this.currentFingerprint!==snapshot.fingerprint)throw new Error('BILI_SESSION_CHANGED');
      this.verified=identity;this.lastResult={at:identity.at,kind:'success',code:null,uid:identity.uid};
      return identity;
    }catch(error){
      const code=codeOf(error);
      this.lastResult={at:this.now(),kind:'failure',code,uid:snapshot.uid};
      if(code==='BILI_LOGIN_REQUIRED'){this.verified=null;this.lastKnownState='expired';}
      else if(code==='BILI_ACCOUNT_MISMATCH'){this.verified=null;this.lastKnownState='mismatch';}
      else if(NETWORK_CODES.has(code)||code==='BILI_CANCELLED'){this.lastKnownState=this.verified?'verified':'interrupted';}
      else this.lastKnownState='interrupted';
      throw error;
    }
  }
  invalidate(reason:'expired'|'mismatch'|'interrupted'):void{
    this.verified=null;this.lastKnownState=reason;
    const inflight=this.inflight;if(inflight&&!inflight.settled){this.inflight=null;inflight.controller.abort();}
  }
  status():CredentialStatus{
    const read=this.read();
    const verified=this.verified;
    const state:CredentialStatus['engine']=this.inflight&&!this.inflight.settled?'verifying':verified?'verified':this.lastKnownState;
    const iso=(value:number|null):string|null=>value===null?null:new Date(value).toISOString();
    const note=read.state==='not-configured'?'尚未配置本地凭据文件；只使用匿名接口。'
      :read.state==='invalid'?'凭据文件未通过本地检查：'+read.code
        :verified?'当前进程内登录校验有效；缓存到期后会重新核对。'
          :'凭据已配置但当前进程尚未取得有效登录校验。';
    return {configured:!!this.setting,credentialState:read.state,expectedUid:this.setting?.expectedUid??null,uid:read.state==='ready'?read.snapshot.uid:null,
      engine:state,verifiedUid:verified?.uid??null,verifiedAt:iso(verified?.at??null),expiresAt:iso(verified?.expiresAt??null),credentialGeneration:this.currentGeneration,
      lastResult:this.lastResult?{at:new Date(this.lastResult.at).toISOString(),kind:this.lastResult.kind,code:this.lastResult.code,uid:this.lastResult.uid}:null,note};
  }
  /** Read-only view for management responses; never includes the cookie, file path or fingerprint. */
  dispose():void{
    const inflight=this.inflight;if(inflight&&!inflight.settled){this.inflight=null;inflight.controller.abort();}
    this.verified=null;
  }
}
