import { createHash,randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { setTimeout } from 'node:timers/promises';
import { z } from 'zod';
import { BvidSchema,NumberIdSchema } from './config.js';
import type { BiliConfig } from './config.js';
import type { BiliStore } from './store.js';
import { BiliCredentials,verifiedLoginUid } from './login-state.js';
import type { CredentialSnapshot,CredentialStatus } from './login-state.js';
import { biliUrl,nativeTransport,boundedBytes,boundedJson } from './http.js';
import type { HttpTransport,HttpResponse } from './http.js';
import { parseRetryAfter } from './diagnostics.js';
import type { BiliAttempt,BiliFailureKind,BiliScope,RouteState } from './diagnostics.js';
import { BiliBrowserResultSchema } from '@dafeiyu/contracts';
import type { BiliBrowserResult } from '@dafeiyu/contracts';
import type { BiliBrowserPort,BiliBrowserRequest } from '@dafeiyu/contracts';

const page=z.number().int().min(1).max(1000),size=z.number().int().min(1).max(20);
const endpoints={
  nav:{path:'/x/web-interface/nav',schema:z.strictObject({}),signed:false},
  discover:{path:'/x/web-interface/popular',schema:z.strictObject({pn:page,ps:size}),signed:false},
  search:{path:'/x/web-interface/search/type',schema:z.strictObject({search_type:z.literal('video'),keyword:z.string().trim().min(1).max(100),page, page_size:size,order:z.enum(['totalrank','pubdate','click'])}),signed:false},
  video:{path:'/x/web-interface/view',schema:z.strictObject({bvid:BvidSchema}),signed:false},
  comments:{path:'/x/v2/reply',schema:z.strictObject({type:z.literal(1),oid:NumberIdSchema,pn:page,ps:size,sort:z.union([z.literal(0),z.literal(2)])}),signed:false},
  replies:{path:'/x/v2/reply/reply',schema:z.strictObject({type:z.literal(1),oid:NumberIdSchema,root:NumberIdSchema,pn:page,ps:size}),signed:false},
  player:{path:'/x/player/wbi/v2',schema:z.strictObject({bvid:BvidSchema,cid:NumberIdSchema}),signed:true},
  play:{path:'/x/player/wbi/playurl',schema:z.strictObject({bvid:BvidSchema,cid:NumberIdSchema,qn:z.literal(64),fnval:z.literal(4048),fourk:z.literal(0)}),signed:true},
  danmaku:{path:'/x/v2/dm/web/seg.so',schema:z.strictObject({type:z.literal(1),oid:NumberIdSchema,segment_index:page}),signed:false}
} as const;
export type Endpoint=keyof typeof endpoints;
const MIXIN=[46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
export function wbiQuery(params:Readonly<Record<string,string|number>>,img:string,sub:string,seconds:number){const stem=(raw:string)=>{const part=new URL(raw).pathname.split('/').at(-1)?.split('.')[0];if(!part||!/^[a-f0-9]{32}$/i.test(part))throw new Error('BILI_WBI_UNAVAILABLE');return part;};
  const raw=stem(img)+stem(sub),key=MIXIN.map(n=>raw[n]).join('').slice(0,32),all={...params,wts:seconds},query=Object.entries(all).sort(([a],[b])=>a<b?-1:1).map(([k,v])=>encodeURIComponent(k)+'='+encodeURIComponent(String(v).replace(/[!'()*]/g,''))).join('&');return query+'&w_rid='+createHash('md5').update(query+key).digest('hex');}
const headers={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',Referer:'https://www.bilibili.com/',Accept:'application/json'};
const id=z.union([NumberIdSchema,z.number().int().positive().safe().transform(String)]);
const WBI=z.object({wbi_img:z.object({img_url:z.string(),sub_url:z.string()})});

/** One shared rule for every browser section; search pages are not video pages. */
export function browserBindingMatches(request:BiliBrowserRequest,value:BiliBrowserResult,expectedUid:string|null):boolean{
  const url=request.section==='discover'?(request.feed==='popular'?'https://www.bilibili.com/v/popular/all':'https://www.bilibili.com/'):request.section==='search'?null:`https://www.bilibili.com/video/${request.bvid??`av${request.aid}`}/`;
  const bvidMatches=request.section==='search'?true:request.aid===undefined?value.bvid===(request.bvid??null):value.bvid===null||BvidSchema.safeParse(value.bvid).success;
  let urlMatches=value.url===url;
  if(url===null){try{const target=new URL(value.url);urlMatches=target.origin==='https://search.bilibili.com'&&['/all','/all/'].includes(target.pathname)
    &&target.searchParams.get('keyword')===request.keyword&&(target.searchParams.get('order')??'totalrank')===(request.order??'totalrank')
    &&Number(target.searchParams.get('page')??1)===(request.page??1)&&value.keyword===request.keyword&&value.order===(request.order??'totalrank')&&value.page===(request.page??1);
  }catch{return false;}}
  return value.accountUid===expectedUid&&bvidMatches&&value.section===request.section&&urlMatches&&!(request.section==='discover'&&value.feed!==(request.feed??'home'));
}
export interface BiliClientOptions {readonly now?:()=>number;readonly credentialTtlMs?:number;readonly instanceGeneration?:number}
export class BiliClient {
  private readonly materials=new Map<string,{value:unknown;at:number;bytes:number}>();
  private materialHits=0;
  private readonly credentials:BiliCredentials;
  private readonly instanceGeneration:number;
  get cacheStats(){return {entries:this.materials.size,bytes:[...this.materials.values()].reduce((sum,row)=>sum+row.bytes,0),hits:this.materialHits};}
  async material(key:string,ttlMs:number,read:()=>Promise<unknown>,signal:AbortSignal,guard:()=>void,cacheable:(value:unknown)=>boolean=()=>true):Promise<unknown>{
    guard();signal.throwIfAborted();const stamp=this.accountStamp(),id=stamp+':'+key,old=this.materials.get(id);
    if(old&&Date.now()-old.at<ttlMs){this.materialHits++;return structuredClone(old.value);}
    const value=await read();guard();signal.throwIfAborted();if(this.accountStamp()!==stamp)throw new Error('BILI_SESSION_CHANGED');
    const bytes=Buffer.byteLength(JSON.stringify(value));
    if(cacheable(value)&&bytes<=this.config.maxResponseBytes){
      this.materials.delete(id);while(this.materials.size&&(this.materials.size>=32||this.cacheStats.bytes+bytes>16*1024**2))this.materials.delete(this.materials.keys().next().value!);
      this.materials.set(id,{value:structuredClone(value),at:Date.now(),bytes});
    }return value;
  }
  private readonly context=new AsyncLocalStorage<{taskId:string|null;runId:string;operationId:string}>();
  constructor(readonly config:BiliConfig,private readonly store:BiliStore,private readonly transport:HttpTransport=nativeTransport,options:BiliClientOptions={}){
    this.instanceGeneration=options.instanceGeneration??0;
    this.credentials=new BiliCredentials(config.session,{...(options.credentialTtlMs===undefined?{}:{ttlMs:options.credentialTtlMs}),...(options.now?{now:options.now}:{})});
  }
  withContext<T>(context:{taskId:string|null;runId:string;operationId:string},work:()=>T):T{return this.context.run({taskId:context.taskId,runId:context.runId,operationId:context.operationId},work);}
  accountStatus():CredentialStatus{return this.credentials.status();}
  accountStamp(){const read=this.credentials.read();return createHash('sha256').update(read.state==='ready'?read.snapshot.fingerprint:read.state).digest('hex');}
  /** Route scope for one attempt; a verified account never matches an anonymous pause. */
  private scopeFor(endpoint:string,auth:'anonymous'|'configured-session',transport:'http'|'dsh-browser'):{scope:BiliScope;uid:string|null}{
    if(transport==='dsh-browser')return {scope:'browser',uid:null};
    if(endpoint==='media'||endpoint==='subtitle')return {scope:'resource',uid:null};
    if(auth==='configured-session'){const uid=this.config.session?.expectedUid??null;return uid?{scope:'verified-http',uid}:{scope:'shared',uid:null};}
    return {scope:'anonymous-http',uid:null};
  }
  httpRoute(endpoint?:string){
    const account=this.accountStatus(),route:BiliScope=this.config.session?'verified-http':'anonymous-http',uid=this.config.session?.expectedUid??null;
    const http=this.store.diagnostics.route({scope:route,uid,endpoint:endpoint??null}),shared=this.store.diagnostics.route({scope:'shared'});
    return {account,route,http,shared,backoffUntil:Math.max(this.store.clock.blockedUntil,http.until??0,shared.until??0)||null};
  }
  status(){
    const now=Date.now(),{account,route,http,shared}=this.httpRoute();
    const browser=this.store.diagnostics.route({scope:'browser'},now),resource=this.store.diagnostics.route({scope:'resource'},now);
    const describe=(state:RouteState)=>({state:state.held?'diagnostic-required':state.reason==='cooldown'?'cooldown':'available',kind:state.kind,endpoint:state.endpoint,waitUntil:state.until===null?null:new Date(state.until).toISOString()});
    const pause=shared.available?http:shared,held=http.held||shared.held;
    return {account,http:{identity:account.credentialState==='not-configured'?'anonymous':'configured-session',route,...describe(http)},
      browser:{configured:!!this.config.browser,...describe(browser)},resource:describe(resource),
      pauses:this.store.diagnostics.pauses.map(pauseState=>({scope:pauseState.scope,uid:pauseState.uid,endpoint:pauseState.endpoint,kind:pauseState.kind,failures:pauseState.failures,held:pauseState.held,until:new Date(pauseState.until).toISOString(),updatedAt:new Date(pauseState.updatedAt).toISOString()})),
      pause:{scope:route,kind:pause.kind,endpoint:pause.endpoint,failures:this.store.diagnostics.pauses.reduce((max,pauseState)=>Math.max(max,pauseState.failures),0),held,waitUntil:pause.until===null?null:new Date(pause.until).toISOString(),automaticProbe:false},
      note:'登录有效与接口可用分别判断：登录校验成功不会解除视频、评论等接口的风控；匿名HTTP暂停不影响已验证账号读取；媒体与字幕资源单独记录。'};
  }
  /** Login/verification challenges on a verified or shared scope must not silently switch channels. */
  fallbackAllowed(){const {account,route}=this.httpRoute();
    if(account.configured&&(account.credentialState!=='ready'||['expired','mismatch'].includes(account.engine)))return false;
    return !this.store.diagnostics.pauses.some(pause=>(pause.scope==='shared'||pause.scope===route)&&(['login','permission','verification'].includes(pause.kind)||route==='verified-http'&&pause.kind==='risk'));}
  async browserRead(port:BiliBrowserPort,request:BiliBrowserRequest,signal:AbortSignal,guard:()=>void){
    if(!this.config.browser)throw new Error('BILI_BROWSER_NOT_CONFIGURED');
    const auth='configured-session' as const,record:BiliAttempt={id:randomUUID(),at:Date.now(),sentAt:null,endedAt:Date.now(),endpoint:request.section==='discover'?'discover':request.section==='comments'?'comments':'video',transport:'dsh-browser',auth,origin:'task',taskId:request.taskId,runId:request.runId,operationId:request.operationId,networkSent:false,httpStatus:null,platformCode:null,contentType:null,retryAfter:null,retryAt:null,waitSource:null,outcome:'failed',errorCode:null,kind:null};
    const routing={auth,transport:'dsh-browser' as const,endpoint:record.endpoint};
    try{await this.slot(record.id,signal,guard,routing);record.sentAt=Date.now();record.networkSent=null;const value=BiliBrowserResultSchema.parse(await port.read(request,signal));guard();signal.throwIfAborted();
      if(!browserBindingMatches(request,value,this.config.browser.expectedUid))throw new Error('BILI_BROWSER_BINDING_MISMATCH');
      if(request.section==='frame'&&(!value.frame||request.positionMs===undefined||Math.abs(value.frame.positionMs-request.positionMs)>500||value.frame.positionMs>=value.frame.durationMs))throw new Error('BILI_BROWSER_BINDING_MISMATCH');
      if(request.section==='frames'){
        const points=request.pointsMs??[],seen=new Set<number>();
        for(const frame of value.frames??[]){const point=frame.requestedMs??points.find(point=>Math.abs(point-frame.positionMs)<=500);
          if(point===undefined||!points.includes(point)||seen.has(point)||Math.abs(point-frame.positionMs)>500||frame.positionMs>=frame.durationMs)throw new Error('BILI_BROWSER_BINDING_MISMATCH');seen.add(point);}
        for(const failure of value.frameErrors??[]){if(!points.includes(failure.positionMs)||seen.has(failure.positionMs))throw new Error('BILI_BROWSER_BINDING_MISMATCH');seen.add(failure.positionMs);}
      }
      record.outcome='success';this.store.diagnostics.success(record.id,record.endpoint,{scope:'browser',uid:null});return value;
    }catch(error){record.errorCode=error instanceof Error&&/^[A-Z][A-Z0-9_]{0,99}$/.test(error.message)?error.message:'BILI_BROWSER_READ_FAILED';record.kind=record.networkSent!==false?'response':'local';
      if(record.errorCode==='BILI_BROWSER_CHALLENGE'||['BILI_BROWSER_ACCOUNT_MISMATCH','BILI_BROWSER_BINDING_MISMATCH'].includes(record.errorCode)){record.kind=record.errorCode==='BILI_BROWSER_CHALLENGE'?'verification':'login';const retry=this.store.diagnostics.failure(record.endpoint,record.kind,Date.now(),this.config.retry,null,'browser',null);record.retryAt=retry.at;record.waitSource=retry.source;}
      if(record.networkSent===false){record.outcome='blocked';record.retryAt=this.store.clock.blockedUntil||null;record.waitSource='existing-state';}throw error;}
    finally{record.endedAt=Date.now();this.store.diagnostics.release(record.id);this.store.diagnostics.record(record);}
  }
  private async fetchNav(credential:CredentialSnapshot|null,signal:AbortSignal,permit?:string,guard?:()=>void):Promise<unknown>{
    const check=()=>{signal.throwIfAborted();guard?.();if(credential)this.credentials.assertCurrent(credential);};
    const url=biliUrl('https://api.bilibili.com'+endpoints.nav.path,'api');
    return this.json('nav',url,credential?.cookie??null,signal,check,credential===null,permit?{permit}:{});
  }
  /** Verify the configured login with one request; callers share one in-flight check per credential generation. */
  verificationPermit(endpoint:string):string{
    const read=this.credentials.read();if(read.state!=='ready')throw new Error(read.state==='invalid'?read.code:'BILI_SESSION_NOT_CONFIGURED');
    return this.store.diagnostics.authorizeProbe({scope:'verified-http',uid:read.snapshot.uid,endpoint,
      credentialGeneration:read.snapshot.generation,instanceGeneration:this.instanceGeneration}).id;
  }
  async verifyLogin(caller:AbortSignal,permit?:string,force=true):Promise<CredentialStatus>{
    const read=this.credentials.read();
    if(read.state==='not-configured')return this.credentials.status();
    if(read.state==='invalid')throw new Error(read.code);
    const timeout=AbortSignal.timeout(this.config.timeoutMs),signal=AbortSignal.any([caller,timeout]);
    try{await this.credentials.identity(read.snapshot,(snapshot,shared,probe)=>this.fetchNav(snapshot,shared,probe),signal,{force,...(permit?{permit}:{})});}
    catch(error){if(timeout.aborted&&!caller.aborted)throw new Error('BILI_VERIFICATION_TIMEOUT');throw error;}
    return this.credentials.status();
  }
  async probeRead(endpoint:'video'|'search'|'comments'|'discover',input:unknown,options:{signal:AbortSignal;guard?:()=>void;permit?:string}){
    return this.read(endpoint,input,options.signal,options.guard??(()=>{}),options.permit?{permit:options.permit}:{});
  }
  dispose(){this.credentials.dispose();}
  private async slot(id:string,signal:AbortSignal,guard:()=>void,routing:{auth:'anonymous'|'configured-session';transport:'http'|'dsh-browser';endpoint:string},permit?:string){guard();signal.throwIfAborted();
    const query={...this.scopeFor(routing.endpoint,routing.auth,routing.transport),endpoint:routing.endpoint};
    if(routing.transport==='http'){this.store.diagnostics.acquireProbe(id,Date.now(),this.config.timeoutMs,permit,query,
      {credentialGeneration:this.accountStatus().credentialGeneration,instanceGeneration:this.instanceGeneration});this.store.diagnostics.assertAvailable(query);}
    else this.store.diagnostics.assertAvailable({scope:'browser',uid:null});
    const wait=this.store.reserveRequest(Date.now(),this.config.minIntervalMs,this.config.timeoutMs);if(wait)await setTimeout(wait,undefined,{signal});guard();signal.throwIfAborted();}
  private async request<T>(endpoint:BiliAttempt['endpoint'],url:URL,cookie:string|null,signal:AbortSignal,guard:()=>void,consume:(response:HttpResponse,record:BiliAttempt,reject:(kind:BiliFailureKind,code:string,backoff?:boolean)=>never)=>Promise<T>,extra:Readonly<Record<string,string>>={},options:{allowWhole?:boolean;permit?:string}={}):Promise<T>{
    const context=this.context.getStore(),auth=cookie?'configured-session'as const:'anonymous'as const;
    const record:BiliAttempt={id:randomUUID(),at:Date.now(),sentAt:null,endedAt:Date.now(),endpoint,transport:'http',auth,origin:context?'task':'maintenance',taskId:context?.taskId??null,runId:context?.runId??null,operationId:context?.operationId??null,networkSent:false,httpStatus:null,platformCode:null,contentType:null,retryAfter:null,retryAt:null,waitSource:null,outcome:'failed',errorCode:null,kind:null};
    const routing={auth,transport:'http' as const,endpoint},query={...this.scopeFor(endpoint,auth,'http'),endpoint};
    let response:HttpResponse|undefined;
    const reject=(kind:BiliFailureKind,code:string,backoff=false):never=>{record.kind=kind;record.errorCode=code;
      if(backoff){const supplied=parseRetryAfter(response?.headers['retry-after'],Date.now()),policy={...this.config.retry,...(this.config.backoffMs===undefined?{}:{riskDelayMs:this.config.backoffMs,rateDelaysMs:[this.config.backoffMs]})};
        const failureEndpoint=kind==='login'&&query.scope==='verified-http'?'nav':endpoint;
        const scope=['permission','verification'].includes(kind)?'shared':query.scope;
        const retry=this.store.diagnostics.failure(failureEndpoint,kind,Date.now(),policy,supplied?.at??null,scope,query.uid);record.retryAt=retry.at;record.waitSource=retry.source;}
      throw new Error(code);};
    try{await this.slot(record.id,signal,guard,routing,options.permit);record.networkSent=null;record.sentAt=Date.now();response=await this.transport(url,{...headers,...extra,...(cookie?{Cookie:cookie}:{})},signal);
      record.networkSent=true;record.httpStatus=response.status;const mime=response.headers['content-type']?.split(';')[0]?.trim().toLowerCase();record.contentType=mime&&/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mime)&&mime.length<=100?mime:null;
      record.retryAfter=parseRetryAfter(response.headers['retry-after'],Date.now())?.raw??null;guard();signal.throwIfAborted();
      if(response.status>=400&&record.contentType==='application/json'){try{const body=z.object({code:z.number().int().safe()}).safeParse(boundedJson(await boundedBytes(response,16384,signal,guard)));if(body.success)record.platformCode=body.data.code;}catch{/* HTTP status remains evidence even when an error body is absent or malformed. */}}
      if(response.status===412||response.status===429)reject(response.status===429?'rate-limit':'risk','BILI_BACKOFF',true);
      if(response.status===401||response.status===403)reject(response.status===401?'login':'permission','BILI_ACCESS_DENIED',true);
      const expected=extra.Range?206:200;if(response.status!==expected&&!(extra.Range&&options.allowWhole&&response.status===200))reject(response.status>=500?'network':'response',response.status>=300&&response.status<400?'BILI_REDIRECT_DENIED':'BILI_HTTP_FAILED',response.status>=500);
      const result=await consume(response,record,reject);if(record.outcome!=='headers-received')record.outcome='success';this.store.diagnostics.success(record.id,endpoint,query);return result;
    }catch(error){response?.close();const code=error instanceof Error&&/^[A-Z][A-Z0-9_]{0,99}$/.test(error.message)?error.message:signal.aborted?'BILI_CANCELLED':record.networkSent===null?'BILI_HTTP_FAILED':'BILI_REQUEST_FAILED';record.errorCode??=code;
      record.kind??=record.networkSent===false?'local':signal.aborted?'cancelled':record.httpStatus===null?'network':'response';
      if(record.kind==='network'&&record.retryAt===null&&!signal.aborted){const retry=this.store.diagnostics.failure(endpoint,'network',Date.now(),{...this.config.retry,rateDelaysMs:[2000,5000,10000]},null,query.scope,query.uid);record.retryAt=retry.at;record.waitSource=retry.source;}
      if(record.networkSent===false){record.outcome='blocked';record.retryAt=this.store.clock.blockedUntil||null;record.waitSource='existing-state';}
      if(endpoint!=='nav'&&cookie&&record.kind==='login')this.credentials.invalidate('expired');
      // Never forward transport text: it may contain platform bodies or connection details.
      throw new Error(code);
    }finally{record.endedAt=Date.now();this.store.diagnostics.release(record.id);this.store.diagnostics.record(record);}
  }
  private async json(endpoint:Endpoint,url:URL,cookie:string|null,signal:AbortSignal,guard:()=>void,anonymousNav=false,options:{permit?:string}={}){return this.request(endpoint,url,cookie,signal,guard,async(response,record,reject)=>{
    const raw=boundedJson(await boundedBytes(response,this.config.maxResponseBytes,signal,guard)),envelope=z.object({code:z.number().int().safe(),data:z.unknown().optional()}).parse(raw);record.platformCode=envelope.code;
    if([-352,-412,-509,-799].includes(envelope.code))reject('risk','BILI_BACKOFF',true);
    if(envelope.code!==0&&!(anonymousNav&&envelope.code===-101))reject(envelope.code===-101?'login':'response',envelope.code===-101?'BILI_LOGIN_REQUIRED':envelope.code===-404||envelope.code===62002?'BILI_NOT_FOUND':'BILI_PLATFORM_ERROR',envelope.code===-101);
    if(endpoint==='nav'&&cookie){try{verifiedLoginUid(envelope.data,this.config.session!.expectedUid);}catch(error){reject('login',error instanceof Error?error.message:'BILI_LOGIN_REQUIRED',true);}}
    return envelope.data;},undefined,options);}
  private wbiKeys(nav:unknown){const keys=WBI.safeParse(nav);if(!keys.success)throw new Error('BILI_WBI_UNAVAILABLE');return {img:keys.data.wbi_img.img_url,sub:keys.data.wbi_img.sub_url};}
  async read(endpoint:Endpoint,input:unknown,caller:AbortSignal,guard:()=>void,options:{permit?:string}={}){
    if(!Object.hasOwn(endpoints,endpoint))throw new Error('BILI_ENDPOINT_DENIED');
    const spec=endpoints[endpoint],params=z.record(z.string(),z.union([z.string(),z.number()])).parse(spec.schema.parse(input));
    const credential=this.credentials.read();
    if(credential.state==='invalid')throw new Error(credential.code);
    const snapshot=credential.state==='ready'?credential.snapshot:null;
    const signal=AbortSignal.any([caller,AbortSignal.timeout(this.config.timeoutMs)]);
    const checked=()=>{guard();signal.throwIfAborted();if(snapshot)this.credentials.assertCurrent(snapshot);};
    checked();
    let nav:unknown=null;
    if(snapshot){
      // One login check per credential generation; every read then reuses its result and WBI keys.
      const identity=await this.credentials.identity(snapshot,(value,shared,permit)=>this.fetchNav(value,shared,permit),signal,options.permit?{permit:options.permit}:{});
      checked();nav=identity.nav;
    }
    if(!snapshot&&spec.signed)nav=await this.fetchNav(null,signal,undefined,checked);
    if(endpoint==='nav'){if(nav===null)nav=await this.fetchNav(null,signal,undefined,checked);return nav;}
    const url=biliUrl('https://api.bilibili.com'+spec.path,'api');
    if(spec.signed){const keys=this.wbiKeys(nav);url.search=wbiQuery(params,keys.img,keys.sub,Math.floor(Date.now()/1000));}
    else url.search=new URLSearchParams(Object.entries(params).map(([k,v])=>[k,String(v)])).toString();
    const cookie=snapshot?.cookie??null;
    if(endpoint==='danmaku')return this.request(endpoint,url,cookie,signal,checked,response=>boundedBytes(response,this.config.maxResponseBytes,signal,checked),undefined,options);
    return this.json(endpoint,url,cookie,signal,checked,false,options);
  }
  async external(urlValue:string,kind:'media'|'subtitle',range:{start:number;end:number}|null,caller:AbortSignal,guard:()=>void,options:{allowWhole?:boolean;etag?:string}={}){const url=biliUrl(urlValue,kind),signal=AbortSignal.any([caller,AbortSignal.timeout(this.config.timeoutMs)]);
    return this.request(kind,url,null,signal,guard,async(response,record)=>{if(response.headers['content-encoding']&&response.headers['content-encoding']!=='identity')throw new Error('BILI_ENCODING_UNSUPPORTED');record.outcome='headers-received';return {response,signal};},{...(range?{Range:`bytes=${range.start}-${range.end}`} : {}),...(options.etag?{'If-Match':options.etag}:{})},options.allowWhole===undefined?{}:{allowWhole:options.allowWhole});}
}
