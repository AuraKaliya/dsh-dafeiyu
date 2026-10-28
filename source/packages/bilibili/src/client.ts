import { readFileSync,lstatSync } from 'node:fs';
import { createHash,randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { setTimeout } from 'node:timers/promises';
import { z } from 'zod';
import { BvidSchema,NumberIdSchema } from './config.js';
import type { BiliConfig } from './config.js';
import type { BiliStore } from './store.js';
import { biliUrl,nativeTransport,boundedBytes,boundedJson } from './http.js';
import type { HttpTransport,HttpResponse } from './http.js';
import { parseRetryAfter } from './diagnostics.js';
import type { BiliAttempt,BiliFailureKind } from './diagnostics.js';
import { BiliBrowserResultSchema } from '@dafeiyu/contracts';
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
export class BiliClient {
  private readonly context=new AsyncLocalStorage<{taskId:string|null;runId:string;operationId:string}>();
  constructor(readonly config:BiliConfig,private readonly store:BiliStore,private readonly transport:HttpTransport=nativeTransport){}
  withContext<T>(context:{taskId:string|null;runId:string;operationId:string},work:()=>T):T{return this.context.run({taskId:context.taskId,runId:context.runId,operationId:context.operationId},work);}
  accountStamp(){return createHash('sha256').update(this.session()?.hash??'anonymous').digest('hex');}
  private anonymousHttpCondition(){const state=this.store.diagnostics.state;if(!state.failures||!['risk','rate-limit','network'].includes(state.kind??''))return false;
    const cause=this.store.diagnostics.conditionAttempt();
    return cause?.transport==='http'&&cause.auth==='anonymous';}
  status(){const state=this.store.diagnostics.state,waitUntil=this.store.clock.blockedUntil,waiting=waitUntil>Date.now(),httpOnly=this.anonymousHttpCondition();
    return {http:{identity:this.config.session?'configured-session':'anonymous',state:state.held?'diagnostic-required':waiting?'cooldown':'available'},
      browser:{configured:!!this.config.browser,state:!this.config.browser?'not-configured':state.held&&!httpOnly?'diagnostic-required':waiting?'cooldown':'identity-check-required'},
      pause:{scope:httpOnly?'anonymous-http':'shared-or-unknown',kind:state.kind,endpoint:state.endpoint,failures:state.failures,held:state.held,waitUntil:waiting?new Date(waitUntil).toISOString():null,automaticProbe:!state.held&&state.failures>0},
      note:'诊断暂停不会因等待自动解除；probeId为空不是死锁。匿名HTTP故障保留，计时等待仍对所有通道有效；等待结束后仅可核验已配置浏览器的独立登录身份。登录/权限/验证挑战或来源不明的暂停仍共享。页面读取不等于音画理解。'};}
  async browserRead(port:BiliBrowserPort,request:BiliBrowserRequest,signal:AbortSignal,guard:()=>void){
    if(!this.config.browser)throw new Error('BILI_BROWSER_NOT_CONFIGURED');
    const record:BiliAttempt={id:randomUUID(),at:Date.now(),sentAt:null,endedAt:Date.now(),endpoint:request.section==='discover'?'discover':request.section==='comments'?'comments':'video',transport:'dsh-browser',auth:'configured-session',origin:'task',taskId:request.taskId,runId:request.runId,operationId:request.operationId,networkSent:false,httpStatus:null,platformCode:null,contentType:null,retryAfter:null,retryAt:null,waitSource:null,outcome:'failed',errorCode:null,kind:null};
    try{await this.slot(record.id,signal,guard,true);record.sentAt=Date.now();record.networkSent=null;const value=BiliBrowserResultSchema.parse(await port.read(request,signal));guard();signal.throwIfAborted();
      const url=request.section==='discover'?(request.feed==='popular'?'https://www.bilibili.com/v/popular/all':'https://www.bilibili.com/'):`https://www.bilibili.com/video/${request.bvid}/`;
      if(value.accountUid!==this.config.browser.expectedUid||value.bvid!==(request.bvid??null)||value.section!==request.section||value.url!==url||request.section==='discover'&&value.feed!==(request.feed??'home'))throw new Error('BILI_BROWSER_BINDING_MISMATCH');
      if(request.section==='frame'&&(!value.frame||request.positionMs===undefined||Math.abs(value.frame.positionMs-request.positionMs)>500||value.frame.positionMs>=value.frame.durationMs))throw new Error('BILI_BROWSER_BINDING_MISMATCH');
      record.outcome='success';return value;
    }catch(error){record.errorCode=error instanceof Error&&/^[A-Z][A-Z0-9_]{0,99}$/.test(error.message)?error.message:'BILI_BROWSER_READ_FAILED';record.kind=record.networkSent!==false?'response':'local';
      if(record.errorCode==='BILI_BROWSER_CHALLENGE'||['BILI_BROWSER_ACCOUNT_MISMATCH','BILI_BROWSER_BINDING_MISMATCH'].includes(record.errorCode)){record.kind=record.errorCode==='BILI_BROWSER_CHALLENGE'?'verification':'login';const retry=this.store.diagnostics.failure(record.endpoint,record.kind,Date.now(),this.config.retry,null);record.retryAt=retry.at;record.waitSource=retry.source;}
      if(record.networkSent===false){record.outcome='blocked';record.retryAt=this.store.clock.blockedUntil||null;record.waitSource='existing-state';}throw error;}
    finally{record.endedAt=Date.now();this.store.diagnostics.release(record.id);this.store.diagnostics.record(record);}
  }
  private session(){const setting=this.config.session;if(!setting)return null;try{if(!/^[a-zA-Z]:[\\/][^:\x00]+$/.test(setting.file))throw new Error('BILI_SESSION_INVALID');const stat=lstatSync(setting.file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16384)throw new Error('BILI_SESSION_INVALID');const bytes=readFileSync(setting.file);if(bytes.length>16384)throw new Error('BILI_SESSION_INVALID');
    const value=z.strictObject({uid:NumberIdSchema,SESSDATA:z.string().min(1).max(4096).regex(/^[^;\s\x00-\x1f\x7f]+$/),bili_jct:z.string().regex(/^[a-fA-F0-9]{32}$/).optional(),buvid3:z.string().max(200).regex(/^[a-zA-Z0-9_-]+$/).optional()}).parse(boundedJson(bytes));if(value.uid!==setting.expectedUid)throw new Error('BILI_ACCOUNT_MISMATCH');
    return {hash:createHash('sha256').update(bytes).digest('hex'),cookie:'SESSDATA='+value.SESSDATA+(value.buvid3?'; buvid3='+value.buvid3:'')};
  }catch(e){throw new Error(e instanceof Error&&e.message==='BILI_ACCOUNT_MISMATCH'?e.message:'BILI_SESSION_INVALID');}}
  private async slot(id:string,signal:AbortSignal,guard:()=>void,browser=false){guard();signal.throwIfAborted();
    if(!browser||!this.anonymousHttpCondition())this.store.diagnostics.assertAvailable();
    const wait=this.store.reserveRequest(Date.now(),this.config.minIntervalMs,this.config.timeoutMs);if(wait)await setTimeout(wait,undefined,{signal});guard();signal.throwIfAborted();
    if(!browser||!this.anonymousHttpCondition())this.store.diagnostics.acquireProbe(id,Date.now(),this.config.timeoutMs);
    else if(this.store.clock.blockedUntil>Date.now())throw new Error('BILI_BACKOFF');}
  private async request<T>(endpoint:BiliAttempt['endpoint'],url:URL,cookie:string|null,signal:AbortSignal,guard:()=>void,consume:(response:HttpResponse,record:BiliAttempt,reject:(kind:BiliFailureKind,code:string,backoff?:boolean)=>never)=>Promise<T>,extra:Readonly<Record<string,string>>={},allowWhole=false):Promise<T>{
    const context=this.context.getStore(),record:BiliAttempt={id:randomUUID(),at:Date.now(),sentAt:null,endedAt:Date.now(),endpoint,transport:'http',auth:cookie?'configured-session':'anonymous',origin:context?'task':'maintenance',taskId:context?.taskId??null,runId:context?.runId??null,operationId:context?.operationId??null,networkSent:false,httpStatus:null,platformCode:null,contentType:null,retryAfter:null,retryAt:null,waitSource:null,outcome:'failed',errorCode:null,kind:null};
    let response:HttpResponse|undefined;
    const reject=(kind:BiliFailureKind,code:string,backoff=false):never=>{record.kind=kind;record.errorCode=code;
      if(backoff){const supplied=parseRetryAfter(response?.headers['retry-after'],Date.now()),policy={...this.config.retry,...(this.config.backoffMs===undefined?{}:{riskDelayMs:this.config.backoffMs,rateDelaysMs:[this.config.backoffMs]})};
        const retry=this.store.diagnostics.failure(endpoint,kind,Date.now(),policy,supplied?.at??null);record.retryAt=retry.at;record.waitSource=retry.source;}
      throw new Error(code);};
    try{await this.slot(record.id,signal,guard);record.networkSent=null;record.sentAt=Date.now();response=await this.transport(url,{...headers,...extra,...(cookie?{Cookie:cookie}:{})},signal);
      record.networkSent=true;record.httpStatus=response.status;const mime=response.headers['content-type']?.split(';')[0]?.trim().toLowerCase();record.contentType=mime&&/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mime)&&mime.length<=100?mime:null;
      record.retryAfter=parseRetryAfter(response.headers['retry-after'],Date.now())?.raw??null;guard();signal.throwIfAborted();
      if(response.status>=400&&record.contentType==='application/json'){try{const body=z.object({code:z.number().int().safe()}).safeParse(boundedJson(await boundedBytes(response,16384,signal,guard)));if(body.success)record.platformCode=body.data.code;}catch{/* HTTP status remains evidence even when an error body is absent or malformed. */}}
      if(response.status===412||response.status===429)reject(response.status===429?'rate-limit':'risk','BILI_BACKOFF',true);
      if(response.status===401||response.status===403)reject(response.status===401?'login':'permission','BILI_ACCESS_DENIED',true);
      const expected=extra.Range?206:200;if(response.status!==expected&&!(extra.Range&&allowWhole&&response.status===200))reject(response.status>=500?'network':'response',response.status>=300&&response.status<400?'BILI_REDIRECT_DENIED':'BILI_HTTP_FAILED',response.status>=500);
      const result=await consume(response,record,reject);if(record.outcome!=='headers-received')record.outcome='success';this.store.diagnostics.success(record.id,endpoint);return result;
    }catch(error){response?.close();const code=error instanceof Error&&/^[A-Z][A-Z0-9_]{0,99}$/.test(error.message)?error.message:signal.aborted?'BILI_CANCELLED':'BILI_REQUEST_FAILED';record.errorCode??=code;
      record.kind??=record.networkSent===false?'local':signal.aborted?'cancelled':record.httpStatus===null?'network':'response';
      if(record.kind==='network'&&record.retryAt===null&&!signal.aborted){const retry=this.store.diagnostics.failure(endpoint,'network',Date.now(),{...this.config.retry,rateDelaysMs:[2000,5000,10000]},null);record.retryAt=retry.at;record.waitSource=retry.source;}
      if(record.networkSent===false){record.outcome='blocked';record.retryAt=this.store.clock.blockedUntil||null;record.waitSource='existing-state';}
      throw error;
    }finally{record.endedAt=Date.now();this.store.diagnostics.release(record.id);this.store.diagnostics.record(record);}
  }
  private async json(endpoint:Endpoint,url:URL,cookie:string|null,signal:AbortSignal,guard:()=>void,anonymousNav=false){return this.request(endpoint,url,cookie,signal,guard,async(response,record,reject)=>{
    const raw=boundedJson(await boundedBytes(response,this.config.maxResponseBytes,signal,guard)),envelope=z.object({code:z.number().int().safe(),data:z.unknown().optional()}).parse(raw);record.platformCode=envelope.code;
    if([-352,-412,-509,-799].includes(envelope.code))reject('risk','BILI_BACKOFF',true);
    if(envelope.code!==0&&!(anonymousNav&&envelope.code===-101))reject(envelope.code===-101?'login':'response',envelope.code===-101?'BILI_LOGIN_REQUIRED':envelope.code===-404||envelope.code===62002?'BILI_NOT_FOUND':'BILI_PLATFORM_ERROR',envelope.code===-101);return envelope.data;});}
  async read(endpoint:Endpoint,input:unknown,caller:AbortSignal,guard:()=>void){if(!Object.hasOwn(endpoints,endpoint))throw new Error('BILI_ENDPOINT_DENIED');const spec=endpoints[endpoint],params=z.record(z.string(),z.union([z.string(),z.number()])).parse(spec.schema.parse(input)),session=this.session(),signal=AbortSignal.any([caller,AbortSignal.timeout(this.config.timeoutMs)]);
    const checked=()=>{guard();signal.throwIfAborted();if(this.session()?.hash!==session?.hash)throw new Error('BILI_SESSION_CHANGED');};checked();
    let nav:unknown;if(session||spec.signed||endpoint==='nav'){nav=await this.json('nav',biliUrl('https://api.bilibili.com'+endpoints.nav.path,'api'),session?.cookie??null,signal,checked,!session);if(session){const account=z.object({isLogin:z.literal(true),mid:id}).parse(nav);if(account.mid!==this.config.session!.expectedUid)throw new Error('BILI_ACCOUNT_MISMATCH');}}
    if(endpoint==='nav')return nav;const url=biliUrl('https://api.bilibili.com'+spec.path,'api');
    if(spec.signed){const keys=z.object({wbi_img:z.object({img_url:z.string(),sub_url:z.string()})}).parse(nav).wbi_img;url.search=wbiQuery(params,keys.img_url,keys.sub_url,Math.floor(Date.now()/1000));}else url.search=new URLSearchParams(Object.entries(params).map(([k,v])=>[k,String(v)])).toString();
    if(endpoint==='danmaku')return this.request(endpoint,url,session?.cookie??null,signal,checked,response=>boundedBytes(response,this.config.maxResponseBytes,signal,checked));
    return this.json(endpoint,url,session?.cookie??null,signal,checked);
  }
  async external(urlValue:string,kind:'media'|'subtitle',range:{start:number;end:number}|null,caller:AbortSignal,guard:()=>void,options:{allowWhole?:boolean;etag?:string}={}){const url=biliUrl(urlValue,kind),signal=AbortSignal.any([caller,AbortSignal.timeout(this.config.timeoutMs)]);
    return this.request(kind,url,null,signal,guard,async(response,record)=>{if(response.headers['content-encoding']&&response.headers['content-encoding']!=='identity')throw new Error('BILI_ENCODING_UNSUPPORTED');record.outcome='headers-received';return {response,signal};},{...(range?{Range:`bytes=${range.start}-${range.end}`} : {}),...(options.etag?{'If-Match':options.etag}:{})},options.allowWhole);}
}
