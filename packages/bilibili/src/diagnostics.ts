import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export const BiliRetryPolicySchema=z.strictObject({
  rateDelaysMs:z.array(z.number().int().min(1000).max(3600000)).min(1).max(8).default([10000,30000,60000]),
  riskDelayMs:z.number().int().min(1000).max(3600000).default(30000),
});
export type BiliRetryPolicy=z.infer<typeof BiliRetryPolicySchema>;
export type BiliFailureKind='rate-limit'|'risk'|'login'|'permission'|'verification'|'network'|'response'|'cancelled'|'local';
const failureKind=z.enum(['rate-limit','risk','login','permission','verification','network','response','cancelled','local']);
export const BiliScopeSchema=z.enum(['anonymous-http','verified-http','browser','resource','shared']);
export type BiliScope=z.infer<typeof BiliScopeSchema>;
const pauseSchema=z.strictObject({scope:BiliScopeSchema,uid:z.string().regex(/^[1-9]\d{0,19}$/).nullable(),endpoint:z.string().max(40).nullable(),kind:failureKind,
  failures:z.number().int().nonnegative(),held:z.boolean(),until:z.number().nonnegative(),updatedAt:z.number().int().nonnegative()});
const permitSchema=z.strictObject({id:z.uuid(),scope:BiliScopeSchema,uid:z.string().regex(/^[1-9]\d{0,19}$/).nullable(),endpoint:z.string().max(40).nullable(),
  credentialGeneration:z.number().int().nonnegative(),instanceGeneration:z.number().int().nonnegative(),expiresAt:z.number().nonnegative(),used:z.boolean()});
const probeSchema=z.strictObject({id:z.string().max(100),scope:BiliScopeSchema,uid:z.string().regex(/^[1-9]\d{0,19}$/).nullable(),endpoint:z.string().max(40).nullable(),until:z.number().nonnegative(),permitId:z.uuid().nullable()});
const controlSchema=z.strictObject({version:z.literal(2),pauses:z.array(pauseSchema).max(24),probe:probeSchema.nullable(),permit:permitSchema.nullable()});
export type BiliPause=z.infer<typeof pauseSchema>;
export type BiliControlState=z.infer<typeof controlSchema>;
export const initialControls=()=>({version:2 as const,pauses:[],probe:null,permit:null});
export const AttemptSchema=z.strictObject({id:z.uuid(),at:z.number().int().nonnegative(),sentAt:z.number().int().nonnegative().nullable().default(null),endedAt:z.number().int().nonnegative(),
  endpoint:z.enum(['nav','discover','search','video','comments','replies','player','play','danmaku','media','subtitle']),
  transport:z.enum(['http','dsh-browser']).default('http'),auth:z.enum(['anonymous','configured-session']),origin:z.enum(['task','maintenance']),taskId:z.uuid().nullable(),runId:z.uuid().nullable(),operationId:z.uuid().nullable(),
  networkSent:z.boolean().nullable(),httpStatus:z.number().int().min(100).max(599).nullable(),platformCode:z.number().int().safe().nullable(),
  contentType:z.string().max(100).nullable(),retryAfter:z.string().max(80).nullable(),retryAt:z.number().nonnegative().nullable(),
  waitSource:z.enum(['platform','local-policy','existing-state']).nullable(),outcome:z.enum(['success','headers-received','failed','blocked']),
  errorCode:z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/).nullable(),kind:failureKind.nullable(),
});
export type BiliAttempt=z.infer<typeof AttemptSchema>;
export function initializeBiliDiagnostics(db:DatabaseSync){
  db.exec('CREATE TABLE bili_http_attempts(id TEXT PRIMARY KEY,at INTEGER NOT NULL,body TEXT NOT NULL);CREATE TABLE bili_http_control(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL);');
  db.prepare('INSERT INTO bili_http_control VALUES(1,?)').run(JSON.stringify(initialControls()));
}
/** Retry-After is either integer seconds or an HTTP date; credentials/free text are never retained. */
export function parseRetryAfter(raw:string|undefined,now:number):{raw:string;at:number}|null{
  if(!raw||raw.length>80)return null;const value=raw.trim();
  if(/^\d{1,9}$/.test(value))return {raw:value,at:now+Number(value)*1000};
  if(!/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value))return null;
  const at=Date.parse(value);return Number.isFinite(at)?{raw:value,at:Math.max(now,at)}:null;
}
export interface PauseQuery {readonly scope:BiliScope;readonly uid?:string|null;readonly endpoint?:string|null}
export interface RouteState {readonly available:boolean;readonly held:boolean;readonly until:number|null;readonly kind:BiliFailureKind|null;readonly endpoint:string|null;readonly reason:string|null;readonly pauses:readonly BiliPause[]}
const matches=(pause:BiliPause,query:PauseQuery):boolean=>{
  if(pause.scope==='shared')return true;
  if(pause.scope!==query.scope)return false;
  if(pause.uid!==null&&query.uid!==undefined&&query.uid!==null&&pause.uid!==query.uid)return false;
  const endpoint=query.endpoint??null;
  return pause.endpoint===null||endpoint===null||pause.endpoint===endpoint;
};
const recoverablePause=(pause:BiliPause,scope:BiliScope,endpoint:string|null|undefined)=>pause.scope===scope&&pause.endpoint===endpoint&&(scope==='verified-http'?pause.kind==='login'&&endpoint==='nav':scope==='browser'&&(pause.kind==='login'||pause.kind==='verification'));
/** Scoped pauses, bounded probe permits and truthful recovery evidence. */
export class BiliDiagnostics {
  constructor(private readonly db:DatabaseSync){}
  private atomic<T>(work:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const value=work();this.db.exec('COMMIT');return value;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  get state():BiliControlState{
    return controlSchema.parse(JSON.parse(String(this.db.prepare('SELECT body FROM bili_http_control WHERE id=1').get()?.body)));
  }
  private set(value:BiliControlState){this.db.prepare('UPDATE bili_http_control SET body=? WHERE id=1').run(JSON.stringify(controlSchema.parse(value)));}
  get pauses():readonly BiliPause[]{return this.state.pauses;}
  route(query:PauseQuery,now=Date.now()):RouteState{
    const pauses=this.state.pauses.filter(pause=>matches(pause,query));
    const blocked=pauses.filter(pause=>pause.held||pause.until>now);
    const held=blocked.some(pause=>pause.held);
    const latest=[...blocked].sort((a,b)=>(a.held===b.held?b.until-a.until:a.held?-1:1))[0]??null;
    return {available:blocked.length===0,held,until:latest?latest.until:null,kind:latest?.kind??null,endpoint:latest?.endpoint??null,
      reason:held?'diagnostic-required':blocked.length?'cooldown':null,pauses};
  }
  /** Only an explicit account recheck may test its own login-expired pause. */
  private permitCovers(state:BiliControlState,query:PauseQuery,now:number):boolean{
    const permit=state.permit;if(!permit||permit.expiresAt<=now)return false;
    return permit.used&&state.probe?.permitId===permit.id&&permit.scope===query.scope&&permit.uid===query.uid&&permit.endpoint===query.endpoint;
  }
  assertAvailable(query:PauseQuery,now=Date.now()):void{
    const state=this.state,permitCovered=this.permitCovers(state,query,now);
    for(const pause of state.pauses){
      if(!matches(pause,query))continue;
      if(recoverablePause(pause,query.scope,query.endpoint)&&permitCovered){
        if(pause.until>now)throw new Error('BILI_BACKOFF');
        continue;
      }
      if(pause.held)throw new Error('BILI_DIAGNOSTIC_REQUIRED');
      if(pause.until>now)throw new Error('BILI_BACKOFF');
    }
  }
  /** Short-lived, single-use, UID/credential/instance-bound management probe authorisation. */
  authorizeProbe(input:{scope:BiliScope;uid:string|null;endpoint:string|null;credentialGeneration:number;instanceGeneration:number;ttlMs?:number;now?:number}):{id:string;expiresAt:number}{
    if(input.scope!=='verified-http'||!input.uid||!input.endpoint)throw new Error('BILI_PROBE_NOT_PERMITTED');
    const now=input.now??Date.now(),state=this.state;
    const blocking=state.pauses.filter(pause=>matches(pause,{scope:input.scope,uid:input.uid,endpoint:input.endpoint})&&(pause.held||pause.until>now));
    if(Number(this.db.prepare('SELECT blocked_until FROM bili_clock WHERE id=1').get()?.blocked_until)>now)throw new Error('BILI_BACKOFF');
    if(blocking.some(pause=>pause.scope!=='verified-http'||pause.kind!=='login'||pause.endpoint!=='nav'))throw new Error('BILI_PROBE_NOT_PERMITTED');
    const permit={id:randomUUID(),scope:input.scope,uid:input.uid,endpoint:input.endpoint,credentialGeneration:input.credentialGeneration,instanceGeneration:input.instanceGeneration,
      expiresAt:now+(input.ttlMs??60_000),used:false};
    this.atomic(()=>{const s=this.state;if(s.probe?.permitId&&s.probe.until>now)throw new Error('BILI_PROBE_BUSY');this.set({...s,permit,probe:null});});
    return {id:permit.id,expiresAt:permit.expiresAt};
  }
  get permit(){return this.state.permit;}
  /** Owner verification of one browser endpoint; this never clears a hold before an actual successful read. */
  authorizeBrowserProbe(input:{uid:string;endpoint:string;instanceGeneration:number;now?:number;ttlMs?:number}){
    const uid=z.string().regex(/^[1-9]\d{0,19}$/).parse(input.uid),endpoint=z.enum(['video','comments','search','discover']).parse(input.endpoint),now=input.now??Date.now();
    const blocking=this.state.pauses.filter(pause=>matches(pause,{scope:'browser',uid,endpoint})&&(pause.held||pause.until>now));
    if(Number(this.db.prepare('SELECT blocked_until FROM bili_clock WHERE id=1').get()?.blocked_until)>now||blocking.some(pause=>pause.until>now))throw new Error('BILI_BACKOFF');
    if(blocking.some(pause=>!recoverablePause(pause,'browser',endpoint)))throw new Error('BILI_PROBE_NOT_PERMITTED');
    const permit={id:randomUUID(),scope:'browser' as const,uid,endpoint,credentialGeneration:0,instanceGeneration:input.instanceGeneration,expiresAt:now+(input.ttlMs??60000),used:false};
    this.atomic(()=>{const s=this.state;if(s.probe?.permitId&&s.probe.until>now)throw new Error('BILI_PROBE_BUSY');this.set({...s,permit,probe:null});});return {id:permit.id,expiresAt:permit.expiresAt};
  }
  dropPermit(id:string):void{this.atomic(()=>{const s=this.state;if(s.permit?.id===id)this.set({...s,permit:null});});}
  acquireProbe(id:string,now:number,timeout:number,permitId?:string,query?:PauseQuery,binding?:{credentialGeneration:number;instanceGeneration:number}):void{
    this.atomic(()=>{
      const s=this.state,relevant=query?s.pauses.filter(pause=>matches(pause,query)):s.pauses;
      let permit=null;
      if(permitId){
        const candidate=s.permit;
        if(!candidate||candidate.id!==permitId||candidate.used||candidate.expiresAt<=now)throw new Error('BILI_PROBE_EXPIRED');
        if(!query||candidate.scope!==query.scope||candidate.uid!==query.uid||candidate.endpoint!==query.endpoint||!binding
          ||candidate.credentialGeneration!==binding.credentialGeneration||candidate.instanceGeneration!==binding.instanceGeneration)throw new Error('BILI_PROBE_NOT_PERMITTED');
        permit={...candidate,used:true};
      }
      if(relevant.some(pause=>pause.held)&&!permit)throw new Error('BILI_DIAGNOSTIC_REQUIRED');
      if(permit&&relevant.some(pause=>pause.held&&!recoverablePause(pause,permit.scope,permit.endpoint)))throw new Error('BILI_PROBE_NOT_PERMITTED');
      if(s.probe?.permitId&&s.probe.until>now&&s.probe.id!==id)throw new Error('BILI_PROBE_BUSY');
      const paused=relevant.filter(pause=>pause.failures>0);
      if(paused.length&&s.probe&&s.probe.until>now&&s.probe.id!==id)throw new Error('BILI_PROBE_BUSY');
      const maxUntil=relevant.reduce((max,pause)=>Math.max(max,pause.until),0);
      if(maxUntil>now)throw new Error('BILI_BACKOFF');
      const scope=permit?.scope??query?.scope??'shared',uid=permit?.uid??query?.uid??null,endpoint=permit?.endpoint??query?.endpoint??null;
      this.set({...s,permit,probe:{id,scope,uid,endpoint,until:now+timeout+5000,permitId:permit?.id??null}});
    });
  }
  release(id:string):void{this.atomic(()=>{const s=this.state;if(s.probe?.id===id)this.set({...s,probe:null});});}
  /** A restarted process must not inherit a probe lease or management permit from the previous one. */
  clearRuntimeLeases():void{this.atomic(()=>{const s=this.state;if(s.probe!==null||s.permit!==null)this.set({...s,probe:null,permit:null});this.refreshClock(s.pauses);});}
  /** A successful attempt clears only its own endpoint pause; a shared or anonymous hold is kept separately. */
  success(id:string,endpoint:string,query?:PauseQuery,startedAt?:number):void{
    this.atomic(()=>{
      const s=this.state,probe=s.probe;
      if(!probe||probe.id!==id||(probe.endpoint!==null&&probe.endpoint!==endpoint))return;
      const scope=query?.scope??probe.scope;
      const pauses=s.pauses.filter(pause=>{
        if(pause.endpoint!==endpoint||startedAt!==undefined&&pause.updatedAt>=startedAt)return true;
        return !(pause.scope===scope&&(pause.uid===(query?.uid??probe.uid)||scope==='browser'&&pause.uid===null&&probe.permitId!==null));
      });
      this.set({...s,pauses,probe:null});
      this.refreshClock(s.pauses);
    });
  }
  failure(endpoint:string,kind:BiliFailureKind,now:number,policy:BiliRetryPolicy,platformAt:number|null,scope:BiliScope='shared',uid:string|null=null){return this.atomic(()=>{
    const s=this.state,existing=s.pauses.find(pause=>pause.scope===scope&&pause.uid===uid&&pause.endpoint===endpoint);
    const failures=(existing?.failures??0)+1;
    const limit=kind==='risk'?2:policy.rateDelaysMs.length+1;
    const held=kind==='login'||kind==='permission'||kind==='verification'||failures>=limit||existing?.held===true;
    const delay=kind==='risk'?policy.riskDelayMs:policy.rateDelaysMs[Math.min(failures-1,policy.rateDelaysMs.length-1)]!;
    const at=platformAt??now+delay,until=Math.max(existing?.until??0,at);
    const next:BiliPause={scope,uid,endpoint,kind,failures,held,until,updatedAt:now};
    const pauses=[...s.pauses.filter(pause=>pause!==existing),next].sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,24);
    this.set({...s,pauses});
    this.refreshClock(s.pauses);
    return {at,held,source:platformAt===null?'local-policy' as const:'platform' as const,scope};
  });}
  private refreshClock(previous:readonly BiliPause[]=[]){
    const pauses=this.state.pauses,current=Number(this.db.prepare('SELECT blocked_until FROM bili_clock WHERE id=1').get()?.blocked_until??0);
    // Media CDN failures hold their resource endpoint. API/browser pauses retain the shared request cooldown.
    const global=pauses.filter(pause=>pause.scope!=='resource'),derived=[...previous,...pauses].some(pause=>pause.until===current);
    const until=global.reduce((max,pause)=>Math.max(max,pause.until),derived?0:current),anyHeld=global.some(pause=>pause.held);
    this.db.prepare('UPDATE bili_clock SET blocked_until=?,error=? WHERE id=1').run(until,anyHeld?'BILI_DIAGNOSTIC_REQUIRED':until>Date.now()?'BILI_BACKOFF':null);
  }
  /** Latest failed attempt that evidences one pause; migration uses the same rule. */
  conditionAttempt(pause?:Pick<BiliPause,'kind'|'endpoint'>):BiliAttempt|null{
    const target=pause??this.state.pauses[0];if(!target||!target.kind)return null;
    const row=this.db.prepare("SELECT body FROM bili_http_attempts WHERE json_extract(body,'$.outcome')='failed' AND json_extract(body,'$.kind')=? AND (? IS NULL OR json_extract(body,'$.endpoint')=?) ORDER BY at DESC,rowid DESC LIMIT 1").get(target.kind,target.endpoint,target.endpoint);
    return row?AttemptSchema.parse(JSON.parse(String(row.body))):null;
  }
  completeBody(raw:BiliAttempt){const value=AttemptSchema.parse(raw);this.atomic(()=>{
    const row=this.db.prepare('SELECT body FROM bili_http_attempts WHERE id=?').get(value.id);if(!row)return;
    const before=AttemptSchema.parse(JSON.parse(String(row.body)));if(before.endpoint!=='media'||before.outcome!=='headers-received')return;
    const completed=AttemptSchema.parse({...before,endedAt:value.endedAt,outcome:value.outcome,errorCode:value.errorCode,kind:value.kind});
    this.db.prepare('UPDATE bili_http_attempts SET body=? WHERE id=?').run(JSON.stringify(completed),value.id);
  });}
  record(raw:BiliAttempt){const value=AttemptSchema.parse(raw);this.atomic(()=>{this.db.prepare('INSERT INTO bili_http_attempts VALUES(?,?,?)').run(value.id,value.at,JSON.stringify(value));
    const active=this.conditionAttempt()?.id??'';
    this.db.prepare('DELETE FROM bili_http_attempts WHERE id<>? AND (at<? OR id IN (SELECT id FROM bili_http_attempts WHERE id<>? ORDER BY at DESC,rowid DESC LIMIT -1 OFFSET ?))').run(active,value.at-7*86400000,active,active?4999:5000);});}
  recent(limit=20):BiliAttempt[]{return this.db.prepare('SELECT body FROM bili_http_attempts ORDER BY at DESC,rowid DESC LIMIT ?').all(z.number().int().min(1).max(100).parse(limit)).map(r=>AttemptSchema.parse(JSON.parse(String(r.body))));}
}
