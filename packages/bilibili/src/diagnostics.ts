import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

export const BiliRetryPolicySchema=z.strictObject({
  rateDelaysMs:z.array(z.number().int().min(1000).max(3600000)).min(1).max(8).default([10000,30000,60000]),
  riskDelayMs:z.number().int().min(1000).max(3600000).default(30000),
});
export type BiliRetryPolicy=z.infer<typeof BiliRetryPolicySchema>;
export type BiliFailureKind='rate-limit'|'risk'|'login'|'permission'|'verification'|'network'|'response'|'cancelled'|'local';
const controlSchema=z.strictObject({failures:z.number().int().nonnegative(),kind:z.string().max(40).nullable(),endpoint:z.string().max(40).nullable(),held:z.boolean(),probeId:z.string().nullable(),probeUntil:z.number().nonnegative()});
const initial=()=>({failures:0,kind:null,endpoint:null,held:false,probeId:null,probeUntil:0});
export const AttemptSchema=z.strictObject({id:z.uuid(),at:z.number().int().nonnegative(),sentAt:z.number().int().nonnegative().nullable().default(null),endedAt:z.number().int().nonnegative(),
  endpoint:z.enum(['nav','discover','search','video','comments','replies','player','play','danmaku','media','subtitle']),
  transport:z.enum(['http','dsh-browser']).default('http'),auth:z.enum(['anonymous','configured-session']),origin:z.enum(['task','maintenance']),taskId:z.uuid().nullable(),runId:z.uuid().nullable(),operationId:z.uuid().nullable(),
  networkSent:z.boolean().nullable(),httpStatus:z.number().int().min(100).max(599).nullable(),platformCode:z.number().int().safe().nullable(),
  contentType:z.string().max(100).nullable(),retryAfter:z.string().max(80).nullable(),retryAt:z.number().nonnegative().nullable(),
  waitSource:z.enum(['platform','local-policy','existing-state']).nullable(),outcome:z.enum(['success','headers-received','failed','blocked']),
  errorCode:z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/).nullable(),kind:z.enum(['rate-limit','risk','login','permission','verification','network','response','cancelled','local']).nullable(),
});
export type BiliAttempt=z.infer<typeof AttemptSchema>;
export function initializeBiliDiagnostics(db:DatabaseSync){
  db.exec('CREATE TABLE bili_http_attempts(id TEXT PRIMARY KEY,at INTEGER NOT NULL,body TEXT NOT NULL);CREATE TABLE bili_http_control(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL);');
  db.prepare('INSERT INTO bili_http_control VALUES(1,?)').run(JSON.stringify(initial()));
}
/** Retry-After is either integer seconds or an HTTP date; credentials/free text are never retained. */
export function parseRetryAfter(raw:string|undefined,now:number):{raw:string;at:number}|null{
  if(!raw||raw.length>80)return null;const value=raw.trim();
  if(/^\d{1,9}$/.test(value))return {raw:value,at:now+Number(value)*1000};
  if(!/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value))return null;
  const at=Date.parse(value);return Number.isFinite(at)?{raw:value,at:Math.max(now,at)}:null;
}
export class BiliDiagnostics {
  constructor(private readonly db:DatabaseSync){}
  private atomic<T>(work:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const value=work();this.db.exec('COMMIT');return value;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  get state(){return controlSchema.parse(JSON.parse(String(this.db.prepare('SELECT body FROM bili_http_control WHERE id=1').get()?.body)));}
  private set(value:z.infer<typeof controlSchema>){this.db.prepare('UPDATE bili_http_control SET body=? WHERE id=1').run(JSON.stringify(controlSchema.parse(value)));}
  assertAvailable(){if(this.state.held)throw new Error('BILI_DIAGNOSTIC_REQUIRED');}
  acquireProbe(id:string,now:number,timeout:number){this.atomic(()=>{const s=this.state;if(s.held)throw new Error('BILI_DIAGNOSTIC_REQUIRED');
    if(Number(this.db.prepare('SELECT blocked_until FROM bili_clock WHERE id=1').get()?.blocked_until)>now)throw new Error('BILI_BACKOFF');
    if(s.failures){if(s.probeId&&s.probeUntil>now)throw new Error('BILI_PROBE_BUSY');this.set({...s,probeId:id,probeUntil:now+timeout+5000});}});}
  release(id:string){this.atomic(()=>{const s=this.state;if(s.probeId===id)this.set({...s,probeId:null,probeUntil:0});});}
  success(id:string,endpoint:string){this.atomic(()=>{const s=this.state;if(s.probeId===id&&s.endpoint===endpoint){this.set(initial());this.db.prepare('UPDATE bili_clock SET error=NULL WHERE id=1').run();}});}
  failure(endpoint:string,kind:BiliFailureKind,now:number,policy:BiliRetryPolicy,platformAt:number|null){return this.atomic(()=>{
    const s=this.state,failures=s.failures+1,limit=kind==='risk'?2:policy.rateDelaysMs.length+1;
    const held=kind==='login'||kind==='permission'||kind==='verification'||failures>=limit;
    const delay=kind==='risk'?policy.riskDelayMs:policy.rateDelaysMs[Math.min(failures-1,policy.rateDelaysMs.length-1)]!;
    const at=platformAt??now+delay;
    this.set({failures,kind,endpoint,held,probeId:null,probeUntil:0});
    this.db.prepare('UPDATE bili_clock SET blocked_until=max(blocked_until,?),error=? WHERE id=1').run(at,held?'BILI_DIAGNOSTIC_REQUIRED':'BILI_BACKOFF');
    return {at,held,source:platformAt===null?'local-policy' as const:'platform' as const};
  });}
  /** Trusted maintenance only, after resolving the diagnosed condition. Not a model tool. */
  resolveHold(){this.atomic(()=>{if(Number(this.db.prepare('SELECT blocked_until FROM bili_clock WHERE id=1').get()?.blocked_until)>Date.now())throw new Error('BILI_BACKOFF');this.set(initial());this.db.prepare('UPDATE bili_clock SET error=NULL WHERE id=1').run();});}
  record(raw:BiliAttempt){const value=AttemptSchema.parse(raw);this.atomic(()=>{this.db.prepare('INSERT INTO bili_http_attempts VALUES(?,?,?)').run(value.id,value.at,JSON.stringify(value));
    this.db.prepare('DELETE FROM bili_http_attempts WHERE at<? OR id IN (SELECT id FROM bili_http_attempts ORDER BY at DESC,rowid DESC LIMIT -1 OFFSET 5000)').run(value.at-7*86400000);});}
  recent(limit=20):BiliAttempt[]{return this.db.prepare('SELECT body FROM bili_http_attempts ORDER BY at DESC,rowid DESC LIMIT ?').all(z.number().int().min(1).max(100).parse(limit)).map(r=>AttemptSchema.parse(JSON.parse(String(r.body))));}
}
