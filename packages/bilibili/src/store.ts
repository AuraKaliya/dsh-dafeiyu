import { DatabaseSync } from 'node:sqlite';
import { existsSync,mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import { z } from 'zod';
import { configureSqlite } from '@dafeiyu/journal';
import { PersonaSourceRefSchema,MediaSourceDescriptionSchema,ResourceProofSchema,ExecutionScopeSchema,RunOriginSchema } from '@dafeiyu/contracts';
import type { ResourceProof,ExecutionContextV3,MediaSourceDescription,PersonaSourceRef } from '@dafeiyu/contracts';
import { BILI_SCENE } from './config.js';

export const BILI_APPLICATION_ID=0x44464236,BILI_SCHEMA_VERSION=1;
export const BILI_TABLES=['bili_metadata','bili_clock','bili_requests','bili_sources','bili_revisions','bili_pages','bili_media','bili_outbox'] as const;
const identitySchema=z.strictObject({agentId:z.string().min(1).max(100),profileId:z.string().min(1).max(100)});
function canonical(value:unknown):string{const v=z.json().parse(value);return v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';}
export const biliHash=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
export const biliOwner=(context:Pick<ExecutionContextV3,'scope'|'intentVersion'>)=>biliHash([context.scope,context.intentVersion]);
export const BiliPageSchema=z.strictObject({id:z.uuid(),owner:z.string().length(64),kind:z.enum(['discover','search','video','comments','subtitles','danmaku','media']),
  sourceKey:z.string().min(1).max(240),sourceVersion:z.number().int().positive(),fetchedAt:z.iso.datetime(),data:z.json(),coverage:z.array(z.string().max(500)).max(24),
  fields:z.array(z.strictObject({id:z.string().max(80),text:z.string().min(1).max(1000)})).max(100)});
export type BiliPage=z.infer<typeof BiliPageSchema>;
const requestState=z.enum(['pending','completed','failed','interrupted']);
export class BiliStore {
  private readonly db:DatabaseSync;
  readonly identity:z.infer<typeof identitySchema>;
  constructor(file:string,identity:z.infer<typeof identitySchema>,create=false){this.identity=identitySchema.parse(identity);
    if(!existsSync(file)&&!create)throw new Error('BILI_MIGRATION_REQUIRED');if(create)mkdirSync(dirname(file),{recursive:true});this.db=new DatabaseSync(file);
    try{this.db.exec('PRAGMA busy_timeout=5000;');const version=Number(this.db.prepare('PRAGMA user_version').get()?.user_version),app=Number(this.db.prepare('PRAGMA application_id').get()?.application_id);
      if(!version&&!app&&create&&!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table'").get()){configureSqlite(this.db);this.atomic(()=>this.initialize());}
      else if(version!==1||app!==BILI_APPLICATION_ID)throw new Error('BILI_SCHEMA_UNSUPPORTED');
      if(biliHash(JSON.parse(String(this.db.prepare('SELECT body FROM bili_metadata WHERE id=1').get()?.body)))!==biliHash(this.identity))throw new Error('BILI_IDENTITY_MISMATCH');
      for(const t of BILI_TABLES)this.db.prepare(`SELECT * FROM ${t} LIMIT 0`).all();configureSqlite(this.db);
    }catch(e){this.db.close();throw e;}}
  private initialize(){this.db.exec(`CREATE TABLE bili_metadata(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL);
    CREATE TABLE bili_clock(id INTEGER PRIMARY KEY CHECK(id=1),next_at INTEGER NOT NULL,blocked_until INTEGER NOT NULL,error TEXT);
    INSERT INTO bili_clock VALUES(1,0,0,NULL);
    CREATE TABLE bili_requests(owner TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,state TEXT NOT NULL,page_id TEXT,error TEXT,PRIMARY KEY(owner,request_id));
    CREATE TABLE bili_sources(key TEXT PRIMARY KEY,version INTEGER NOT NULL,available INTEGER NOT NULL);
    CREATE TABLE bili_revisions(key TEXT NOT NULL REFERENCES bili_sources(key),version INTEGER NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(key,version));
    CREATE TABLE bili_pages(id TEXT PRIMARY KEY,owner TEXT NOT NULL,body TEXT NOT NULL,hash TEXT NOT NULL,observation TEXT);
    CREATE TABLE bili_media(key TEXT PRIMARY KEY,description TEXT NOT NULL,hash TEXT NOT NULL,locator TEXT NOT NULL,expires_at INTEGER NOT NULL);
    CREATE TABLE bili_outbox(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,body TEXT NOT NULL,delivered INTEGER NOT NULL DEFAULT 0);
    PRAGMA application_id=${BILI_APPLICATION_ID};PRAGMA user_version=1;`);
    for(const table of ['bili_metadata','bili_revisions'])this.db.exec(`CREATE TRIGGER ${table}_immutable BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Immutable Bili history');END;CREATE TRIGGER ${table}_retain BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Retain Bili history');END;`);
    this.db.exec("CREATE TRIGGER bili_page_immutable BEFORE UPDATE OF id,owner,body,hash ON bili_pages BEGIN SELECT RAISE(ABORT,'Immutable Bili page');END;");this.db.prepare('INSERT INTO bili_metadata VALUES(1,?)').run(JSON.stringify(this.identity));}
  private atomic<T>(fn:()=>T){this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  private check(context:ExecutionContextV3){if(context.agentId!==this.identity.agentId||context.scope.agentId!==this.identity.agentId||context.scope.kind!=='task')throw new Error('SCOPE_DENIED');context.signal.throwIfAborted();return biliOwner(context);}
  begin(context:ExecutionContextV3,requestId:string,input:unknown){const owner=this.check(context),fingerprint=biliHash(input);return this.atomic(()=>{
    const old=this.db.prepare('SELECT * FROM bili_requests WHERE owner=? AND request_id=?').get(owner,requestId);if(old){if(old.fingerprint!==fingerprint)throw new Error('IDEMPOTENCY_CONFLICT');const state=requestState.parse(old.state);if(state==='completed')return this.page(owner,String(old.page_id));throw new Error(state==='pending'?'BILI_REQUEST_PENDING':String(old.error));}
    this.db.prepare("INSERT INTO bili_requests VALUES(?,?,?,'pending',NULL,NULL)").run(owner,requestId,fingerprint);this.audit(context,'bilibili.request.started',{requestId});return null;});}
  private source(key:string,hash:string){const current=this.db.prepare('SELECT s.version,s.available,r.hash FROM bili_sources s JOIN bili_revisions r ON r.key=s.key AND r.version=s.version WHERE s.key=?').get(key);
    if(current?.available===1&&current.hash===hash)return Number(current.version);const version=current?Number(current.version)+1:1;
    this.db.prepare('INSERT INTO bili_sources VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET version=excluded.version,available=1').run(key,version);this.db.prepare('INSERT INTO bili_revisions VALUES(?,?,?)').run(key,version,hash);return version;}
  complete(context:ExecutionContextV3,requestId:string,value:Omit<BiliPage,'id'|'owner'|'fetchedAt'|'sourceVersion'>,now=Date.now()){const owner=this.check(context);return this.atomic(()=>{
    const sourceVersion=this.source(value.sourceKey,biliHash({kind:value.kind,data:value.data,coverage:value.coverage,fields:value.fields}));const page=BiliPageSchema.parse({...value,id:randomUUID(),owner,sourceVersion,fetchedAt:new Date(now).toISOString()});
    this.db.prepare('INSERT INTO bili_pages VALUES(?,?,?,?,NULL)').run(page.id,owner,JSON.stringify(page),biliHash(page));
    if(this.db.prepare("UPDATE bili_requests SET state='completed',page_id=? WHERE owner=? AND request_id=? AND state='pending'").run(page.id,owner,requestId).changes!==1)throw new Error('BILI_REQUEST_STATE_CONFLICT');this.audit(context,'bilibili.request.completed',{requestId,pageId:page.id,kind:page.kind});return page;});}
  fail(context:ExecutionContextV3,requestId:string,error:string){z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/).parse(error);const owner=biliOwner(context);this.atomic(()=>{if(this.db.prepare("UPDATE bili_requests SET state='failed',error=? WHERE owner=? AND request_id=? AND state='pending'").run(error,owner,requestId).changes)this.audit(context,'bilibili.request.failed',{requestId,error});});}
  page(owner:string,id:string){const row=this.db.prepare('SELECT body,hash FROM bili_pages WHERE id=? AND owner=?').get(z.uuid().parse(id),owner);if(!row)throw new Error('BILI_PAGE_UNAVAILABLE');const page=BiliPageSchema.parse(JSON.parse(String(row.body)));if(page.owner!==owner||biliHash(page)!==row.hash)throw new Error('BILI_STATE_CORRUPT');if(!this.sourceCurrent(page.sourceKey,page.sourceVersion))throw new Error('SOURCE_STALE');return page;}
  pages(owner:string){return this.db.prepare('SELECT id FROM bili_pages WHERE owner=? ORDER BY rowid DESC LIMIT 64').all(owner).flatMap(r=>{try{return [this.page(owner,String(r.id))];}catch{return [];}});}
  sourceCurrent(key:string,version:number){const row=this.db.prepare('SELECT version,available FROM bili_sources WHERE key=?').get(key);return row?.version===version&&row.available===1;}
  unavailable(key:string){this.db.prepare('UPDATE bili_sources SET available=0 WHERE key=?').run(key);}
  proof(page:BiliPage):ResourceProof{return {provider:'bilibili',scene:BILI_SCENE,key:page.id,version:page.sourceVersion,hash:biliHash(page),roots:['bilibili:'+page.sourceKey],detail:{owner:page.owner}};}
  current(raw:ResourceProof){try{const proof=ResourceProofSchema.parse(raw),detail=z.object({owner:z.string()}).parse(proof.detail),page=this.page(detail.owner,proof.key);return biliHash(proof)===biliHash(this.proof(page));}catch{return false;}}
  bindObservation(page:BiliPage,source:PersonaSourceRef){const value=JSON.stringify(PersonaSourceRefSchema.parse(source)),old=this.db.prepare('SELECT observation FROM bili_pages WHERE id=?').get(page.id);if(!old)throw new Error('BILI_PAGE_UNAVAILABLE');if(old.observation&&old.observation!==value)throw new Error('BILI_OBSERVATION_CONFLICT');this.db.prepare('UPDATE bili_pages SET observation=? WHERE id=?').run(value,page.id);}
  observation(page:BiliPage){const row=this.db.prepare('SELECT observation FROM bili_pages WHERE id=?').get(page.id);return row?.observation?PersonaSourceRefSchema.parse(JSON.parse(String(row.observation))):null;}
  registerMedia(key:string,description:MediaSourceDescription,locator:unknown,expiresAt:number){const body=MediaSourceDescriptionSchema.parse(description);this.db.prepare('INSERT INTO bili_media VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET description=excluded.description,hash=excluded.hash,locator=excluded.locator,expires_at=excluded.expires_at').run(key,JSON.stringify(body),biliHash(body),JSON.stringify(z.json().parse(locator)),z.number().int().positive().parse(expiresAt));}
  media(key:string,now=Date.now()){const row=this.db.prepare('SELECT * FROM bili_media WHERE key=?').get(key);if(!row||Number(row.expires_at)<=now)return null;const description=MediaSourceDescriptionSchema.parse(JSON.parse(String(row.description)));if(biliHash(description)!==row.hash)throw new Error('BILI_STATE_CORRUPT');return {description,locator:z.json().parse(JSON.parse(String(row.locator))),expiresAt:Number(row.expires_at)};}
  reserveRequest(now:number,interval:number,timeout:number){return this.atomic(()=>{const state=this.clock;if(state.blockedUntil>now)throw new Error('BILI_BACKOFF');const at=Math.max(now,state.nextAt);if(at-now>=timeout)throw new Error('BILI_RATE_LIMITED');this.db.prepare('UPDATE bili_clock SET next_at=? WHERE id=1').run(at+interval);return at-now;});}
  backoff(now:number,duration:number,error='BILI_BACKOFF'){this.db.prepare('UPDATE bili_clock SET blocked_until=max(blocked_until,?),error=? WHERE id=1').run(now+duration,error);}
  get clock(){const row=this.db.prepare('SELECT * FROM bili_clock WHERE id=1').get()!;return {nextAt:Number(row.next_at),blockedUntil:Number(row.blocked_until),error:row.error===null?null:String(row.error)};}
  private audit(context:ExecutionContextV3,type:string,data:Record<string,string>){const body={scope:ExecutionScopeSchema.parse(context.scope),origin:RunOriginSchema.parse(context.origin),runId:context.runId,operationId:context.operationId,type,at:new Date().toISOString(),data};this.db.prepare('INSERT INTO bili_outbox(id,body) VALUES(?,?)').run(randomUUID(),JSON.stringify(body));}
  drain(write:(body:unknown,id:string)=>void){for(const row of this.db.prepare('SELECT id,body FROM bili_outbox WHERE delivered=0 ORDER BY seq LIMIT 256').all()){write(JSON.parse(String(row.body)),String(row.id));this.db.prepare('UPDATE bili_outbox SET delivered=1 WHERE id=?').run(String(row.id));}}
  recover(){return Number(this.db.prepare("UPDATE bili_requests SET state='interrupted',error='BILI_PROCESS_INTERRUPTED' WHERE state='pending'").run().changes);}
  get counts(){return {pages:Number(this.db.prepare('SELECT count(*) AS n FROM bili_pages').get()?.n),requests:Number(this.db.prepare('SELECT count(*) AS n FROM bili_requests').get()?.n),pending:Number(this.db.prepare("SELECT count(*) AS n FROM bili_requests WHERE state='pending'").get()?.n)};}
  close(){this.db.close();}
}
