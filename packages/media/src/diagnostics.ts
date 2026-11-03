import {z} from 'zod';
import type {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import type {ExecutionContext} from '@dafeiyu/contracts';

export const MediaStageSchema=z.enum(['source','download','probe','decode','vision','audio','document','persist']);
export type MediaStage=z.infer<typeof MediaStageSchema>;
export const MediaFailureSchema=z.strictObject({stage:MediaStageSchema,code:z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/),
  category:z.enum(['input','permission','resource','transport','dependency','cancelled','unknown']),scope:z.enum(['operation','resource','capability']),
  retry:z.enum(['correct-input','refresh-source','after-cooldown','after-recovery','none']),errorType:z.string().max(80),systemCode:z.string().max(80).nullable(),sites:z.array(z.string().max(160)).max(4)});
export type MediaFailure=z.infer<typeof MediaFailureSchema>;
const systems=new Set(['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EAI_AGAIN','ENETUNREACH','EHOSTUNREACH','EPIPE','ENOENT','EACCES','EPERM','EMFILE','ABORT_ERR','UND_ERR_SOCKET','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT']);
export class MediaStageError extends Error {constructor(readonly diagnostic:MediaFailure,cause:unknown,readonly diagnosticId?:string){super(diagnostic.code,{cause});}}
export function mediaFailure(error:unknown,stage:MediaStage):MediaFailure{
  if(error instanceof MediaStageError)return error.diagnostic;
  const name=error instanceof Error?error.name:'UnknownError',message=error instanceof Error?error.message:'';
  const cause=error instanceof Error?error.cause:undefined;
  const rawCode=error&&typeof error==='object'&&'code'in error?error.code:cause&&typeof cause==='object'&&'code'in cause?cause.code:null;
  const systemCode=typeof rawCode==='string'&&systems.has(rawCode)?rawCode:null;
  const code=/^(?:MEDIA|BILI|MODEL|SOURCE|RESOURCE|DEPENDENCY|INVALID|SCOPE|OBSERVATION|PRIVATE)_[A-Z0-9_]{1,80}$/.test(message)?message:
    systemCode?`MEDIA_${systemCode}`:error instanceof z.ZodError?'INVALID_INPUT':'MEDIA_UNEXPECTED_FAILURE';
  const network=!!systemCode&&(['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EAI_AGAIN','ENETUNREACH','EHOSTUNREACH','EPIPE'].includes(systemCode)||systemCode.startsWith('UND_ERR_'))||/HTTP_(ECONN|ETIMEDOUT)|TIMEOUT/.test(code);
  const cancelled=/CANCELLED|ABORT|PARENT_EXITED/.test(code),permission=/SCOPE_DENIED|NOT_EXPOSED|PRIVATE_INPUT|ACCESS_REVOKED/.test(code),input=/INVALID_INPUT|INTERVAL_INVALID|MODE_MISMATCH|PIXEL_LIMIT|SIZE_LIMIT/.test(code);
  const dependency=/NOT_CONFIGURED|WORKER_START_FAILED|MEMORY_GUARD_UNAVAILABLE/.test(code)||systemCode==='ENOENT'&&stage!=='download';
  const category=cancelled?'cancelled':permission?'permission':input?'input':dependency?'dependency':network?'transport':code==='MEDIA_UNEXPECTED_FAILURE'?'unknown':'resource';
  const sites=error instanceof Error?(error.stack??'').split('\n').slice(1).flatMap(line=>{const match=/([^/\\()\s]+\.(?:m?js|ts):\d+:\d+)/.exec(line);return match?[match[1]!]:[];}).slice(0,4):[];
  return MediaFailureSchema.parse({stage,code,category,scope:permission||input||cancelled?'operation':dependency?'capability':'resource',retry:cancelled||permission?'none':input?'correct-input':dependency?'after-recovery':network?'after-cooldown':'refresh-source',errorType:/^[A-Za-z][A-Za-z0-9]{0,79}$/.test(name)?name:'Error',systemCode,sites});
}
export async function mediaStage<T>(stage:MediaStage,work:()=>Promise<T>):Promise<T>{try{return await work();}catch(error){throw new MediaStageError(mediaFailure(error,stage),error);}}

export const MEDIA_DIAGNOSTIC_TABLES=['media_diagnostics','media_health'] as const;
export function createMediaDiagnosticSchema(db:DatabaseSync){db.exec('CREATE TABLE media_diagnostics(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,operation_id TEXT NOT NULL,at INTEGER NOT NULL,body TEXT NOT NULL); CREATE INDEX media_diagnostics_run ON media_diagnostics(run_id,at); CREATE TABLE media_health(key TEXT PRIMARY KEY,generation INTEGER NOT NULL,body TEXT NOT NULL);');}
const healthSchema=z.strictObject({key:z.string(),generation:z.number().int().positive(),diagnosticId:z.uuid(),until:z.number().int().nonnegative().nullable(),code:z.string(),stage:MediaStageSchema});
export class MediaDiagnostics {
  constructor(private readonly db:DatabaseSync){}
  record(context:Pick<ExecutionContext,'runId'|'operationId'>,error:unknown,stage:MediaStage,key?:string,now=Date.now()){
    const failure=mediaFailure(error,stage),id=randomUUID();this.db.prepare('INSERT INTO media_diagnostics VALUES(?,?,?,?,?)').run(id,context.runId,context.operationId,now,JSON.stringify(failure));
    if(key&&!['input','permission','cancelled'].includes(failure.category)){
      const prior=this.health(key),body=healthSchema.parse({key,generation:(prior?.generation??0)+1,diagnosticId:id,until:failure.retry==='after-recovery'?null:now+1800000,code:failure.code,stage:failure.stage});
      this.db.prepare('INSERT INTO media_health VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET generation=excluded.generation,body=excluded.body').run(key,body.generation,JSON.stringify(body));
    }
    return {id,...failure};
  }
  health(key:string){const row=this.db.prepare('SELECT body FROM media_health WHERE key=?').get(key);return row?healthSchema.parse(JSON.parse(String(row.body))):null;}
  check(key:string,now=Date.now()){const held=this.health(key);if(held&&(held.until===null||now<held.until))throw new MediaStageError({...mediaFailure(new Error('MEDIA_DEPENDENCY_PAUSED'),held.stage),category:'dependency',scope:'resource',retry:held.until===null?'after-recovery':'after-cooldown'},null,held.diagnosticId);}
  restore(key:string,generation:number,now=Date.now()){const old=this.health(key);if(!old||old.generation!==generation)return false;const body={...old,until:now};return Number(this.db.prepare('UPDATE media_health SET body=? WHERE key=? AND generation=?').run(JSON.stringify(body),key,generation).changes)===1;}
  list(){return this.db.prepare('SELECT body FROM media_health ORDER BY key').all().map(row=>healthSchema.parse(JSON.parse(String(row.body))));}
  recent(limit=20){return this.db.prepare('SELECT id,run_id,operation_id,at,body FROM media_diagnostics ORDER BY at DESC LIMIT ?').all(limit).map(row=>({id:String(row.id),runId:String(row.run_id),operationId:String(row.operation_id),at:Number(row.at),...MediaFailureSchema.parse(JSON.parse(String(row.body)))}));}
}
