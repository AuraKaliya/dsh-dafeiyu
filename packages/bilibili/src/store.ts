import { DatabaseSync } from 'node:sqlite';
import { existsSync,mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import { z } from 'zod';
import {BiliCommentCursorSchema} from '@dafeiyu/contracts';
import { configureSqlite } from '@dafeiyu/journal';
import { PersonaSourceRefSchema,PersonaRequestIdSchema,MediaSourceDescriptionSchema,ResourceProofSchema,ExecutionScopeSchema,RunOriginSchema,BiliReadingRecordSchema,BiliReadingIndexSchema } from '@dafeiyu/contracts';
import type { ResourceProof,ExecutionContext,MediaSourceDescription,PersonaSourceRef,Json } from '@dafeiyu/contracts';
import { boundedReadingView } from './reading-view.js';
import { BILI_SCENE,BvidSchema } from './config.js';
import { BiliDiagnostics,initializeBiliDiagnostics } from './diagnostics.js';

export const BILI_APPLICATION_ID=0x44464236,BILI_SCHEMA_VERSION=6;
export const BILI_TABLES=['bili_metadata','bili_clock','bili_requests','bili_sources','bili_revisions','bili_pages','bili_media','bili_outbox','bili_http_attempts','bili_http_control','bili_reading','bili_reading_legacy','bili_reading_receipts','bili_reading_history','bili_comment_cursors','bili_auth_meta','bili_verifications'] as const;
const identitySchema=z.strictObject({agentId:z.string().min(1).max(100),profileId:z.string().min(1).max(100)});
const jsonValue=z.json();
function canonical(v:Json):string{return v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k]!)).join(',')+'}';}
export const biliHash=(value:unknown)=>createHash('sha256').update(canonical(jsonValue.parse(value))).digest('hex');
export const biliOwner=(context:Pick<ExecutionContext,'scope'|'intentVersion'>)=>biliHash([context.scope,context.intentVersion]);
export const BiliPageSchema=z.strictObject({id:z.uuid(),owner:z.string().length(64),kind:z.enum(['discover','search','video','comments','subtitles','danmaku','media','browser']),
  sourceKey:z.string().min(1).max(240),sourceVersion:z.number().int().positive(),fetchedAt:z.iso.datetime(),data:z.json(),coverage:z.array(z.string().max(500)).max(24),
  fields:z.array(z.strictObject({id:z.string().max(80),text:z.string().min(1).max(1000)})).max(100),parents:z.array(ResourceProofSchema).max(4).optional(),cacheKey:z.string().length(64).optional()});
export type BiliPage=z.infer<typeof BiliPageSchema>;
const uid=z.string().regex(/^[1-9]\d{0,19}$/),errorCode=z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/);
/** Historical metadata: last result only, never proof of a live login and never a cookie. */
export const BiliAuthMetaSchema=z.strictObject({credentialUid:uid.nullable(),lastVerifiedUid:uid.nullable(),lastVerifiedAt:z.iso.datetime().nullable(),
  lastResult:z.strictObject({at:z.iso.datetime(),kind:z.enum(['success','failure']),code:errorCode.nullable(),uid:uid.nullable()}).nullable(),updatedAt:z.iso.datetime()});
export type BiliAuthMeta=z.infer<typeof BiliAuthMetaSchema>;
/** Verification operations are bounded records; the credential itself is never stored. */
export const BiliVerificationSchema=z.strictObject({id:z.uuid(),at:z.iso.datetime(),updatedAt:z.iso.datetime(),state:z.enum(['pending','completed','failed','interrupted']),
  kind:z.enum(['login','read']),endpoint:z.enum(['nav','video','search','comments','discover']).nullable(),uid:uid.nullable(),credentialGeneration:z.number().int().nonnegative(),
  instanceGeneration:z.number().int().nonnegative(),target:z.json().nullable(),result:z.json().nullable(),errorCode:errorCode.nullable()});
export type BiliVerification=z.infer<typeof BiliVerificationSchema>;
const requestState=z.enum(['pending','completed','failed','interrupted']);
export class BiliStore {
  private readonly db:DatabaseSync;
  readonly diagnostics:BiliDiagnostics;
  private readonly checking=new Set<string>();
  readonly identity:z.infer<typeof identitySchema>;
  constructor(file:string,identity:z.infer<typeof identitySchema>,create=false,private readonly maxPages=4096){this.identity=identitySchema.parse(identity);z.number().int().min(1).max(65536).parse(maxPages);
    if(!existsSync(file)&&!create)throw new Error('BILI_INITIALIZATION_REQUIRED');if(create)mkdirSync(dirname(file),{recursive:true});this.db=new DatabaseSync(file);
    try{this.db.exec('PRAGMA busy_timeout=5000;');const version=Number(this.db.prepare('PRAGMA user_version').get()?.user_version),app=Number(this.db.prepare('PRAGMA application_id').get()?.application_id);
      if(!version&&!app&&create&&!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table'").get()){configureSqlite(this.db);this.atomic(()=>this.initialize());}
      else if(app===BILI_APPLICATION_ID&&[2,3,4,5].includes(version))throw new Error('BILI_MIGRATION_REQUIRED');
      else if(version!==BILI_SCHEMA_VERSION||app!==BILI_APPLICATION_ID)throw new Error('BILI_SCHEMA_UNSUPPORTED');
      if(biliHash(JSON.parse(String(this.db.prepare('SELECT body FROM bili_metadata WHERE id=1').get()?.body)))!==biliHash(this.identity))throw new Error('BILI_IDENTITY_MISMATCH');
      for(const t of BILI_TABLES)this.db.prepare(`SELECT * FROM ${t} LIMIT 0`).all();configureSqlite(this.db);
      this.diagnostics=new BiliDiagnostics(this.db);
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
    CREATE TABLE bili_reading(owner TEXT NOT NULL,bvid TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(owner,bvid));
    CREATE TABLE bili_reading_legacy(bvid TEXT PRIMARY KEY,body TEXT NOT NULL,updated_at INTEGER NOT NULL);
    CREATE TABLE bili_reading_receipts(owner TEXT NOT NULL,request_id TEXT NOT NULL,bvid TEXT NOT NULL,version INTEGER NOT NULL,PRIMARY KEY(owner,request_id));
    CREATE TABLE bili_reading_history(owner TEXT NOT NULL,bvid TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL,fingerprint TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(owner,bvid,version));
    CREATE TABLE bili_comment_cursors(id TEXT PRIMARY KEY,owner TEXT NOT NULL,hash TEXT NOT NULL,body TEXT NOT NULL,UNIQUE(owner,hash));
    CREATE TABLE bili_auth_meta(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL);
    CREATE TABLE bili_verifications(id TEXT PRIMARY KEY,at INTEGER NOT NULL,state TEXT NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL);
    CREATE INDEX bili_reading_updated ON bili_reading(owner,updated_at DESC);
    CREATE INDEX bili_verifications_recent ON bili_verifications(at DESC);
    PRAGMA application_id=${BILI_APPLICATION_ID};PRAGMA user_version=6;`);
    initializeBiliDiagnostics(this.db);
    for(const table of ['bili_metadata','bili_revisions'])this.db.exec(`CREATE TRIGGER ${table}_immutable BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Immutable Bili history');END;CREATE TRIGGER ${table}_retain BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Retain Bili history');END;`);
    this.db.exec("CREATE TRIGGER bili_page_immutable BEFORE UPDATE OF id,owner,body,hash ON bili_pages BEGIN SELECT RAISE(ABORT,'Immutable Bili page');END;");this.db.prepare('INSERT INTO bili_metadata VALUES(1,?)').run(JSON.stringify(this.identity));}
  private atomic<T>(fn:()=>T){this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  private check(context:ExecutionContext){if(context.agentId!==this.identity.agentId||context.scope.agentId!==this.identity.agentId||context.scope.kind!=='task')throw new Error('SCOPE_DENIED');context.signal.throwIfAborted();return biliOwner(context);}
  begin(context:ExecutionContext,requestId:string,input:unknown,reusing=false){const owner=this.check(context),fingerprint=biliHash(input);return this.atomic(()=>{
    const old=this.db.prepare('SELECT * FROM bili_requests WHERE owner=? AND request_id=?').get(owner,requestId);if(old){if(old.fingerprint!==fingerprint)throw new Error('IDEMPOTENCY_CONFLICT');const state=requestState.parse(old.state);if(state==='completed')return this.page(owner,String(old.page_id));throw new Error(state==='pending'?'BILI_REQUEST_PENDING':String(old.error));}
    if(!reusing&&this.counts.pages>=this.maxPages)throw new Error('BILI_PAGE_CAPACITY');this.db.prepare("INSERT INTO bili_requests VALUES(?,?,?,'pending',NULL,NULL)").run(owner,requestId,fingerprint);this.audit(context,'bilibili.request.started',{requestId});return null;});}
  cachedPage(context:ExecutionContext,cacheKey:string,ttlMs:number){
    const owner=this.check(context),row=this.db.prepare("SELECT id FROM bili_pages WHERE owner=? AND json_extract(body,'$.cacheKey')=? ORDER BY rowid DESC LIMIT 1").get(owner,cacheKey);
    if(!row)return null;try{const page=this.page(owner,String(row.id));return Date.now()-Date.parse(page.fetchedAt)<ttlMs&&this.current(this.proof(page))?page:null;}catch{return null;}
  }
  reusePage(context:ExecutionContext,requestId:string,page:BiliPage){return this.atomic(()=>{
    const owner=this.check(context);if(page.owner!==owner||!this.valid(this.proof(page)))throw new Error('SOURCE_STALE');
    if(this.db.prepare("UPDATE bili_requests SET state='completed',page_id=? WHERE owner=? AND request_id=? AND state='pending'").run(page.id,owner,requestId).changes!==1)throw new Error('BILI_REQUEST_STATE_CONFLICT');
    this.audit(context,'bilibili.request.cache-hit',{requestId,pageId:page.id});return page;
  });}
  private source(key:string,hash:string){const current=this.db.prepare('SELECT s.version,s.available,r.hash FROM bili_sources s JOIN bili_revisions r ON r.key=s.key AND r.version=s.version WHERE s.key=?').get(key);
    if(current?.available===1&&current.hash===hash)return Number(current.version);const version=current?Number(current.version)+1:1;
    this.db.prepare('INSERT INTO bili_sources VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET version=excluded.version,available=1').run(key,version);this.db.prepare('INSERT INTO bili_revisions VALUES(?,?,?)').run(key,version,hash);return version;}
  complete(context:ExecutionContext,requestId:string,value:Omit<BiliPage,'id'|'owner'|'fetchedAt'|'sourceVersion'>,now=Date.now(),related?:(page:BiliPage)=>void){const owner=this.check(context);return this.atomic(()=>{
    if(this.counts.pages>=this.maxPages)throw new Error('BILI_PAGE_CAPACITY');
    const sourceVersion=this.source(value.sourceKey,biliHash({kind:value.kind,data:value.data,coverage:value.coverage,fields:value.fields}));const page=BiliPageSchema.parse({...value,id:randomUUID(),owner,sourceVersion,fetchedAt:new Date(now).toISOString()});
    this.db.prepare('INSERT INTO bili_pages VALUES(?,?,?,?,NULL)').run(page.id,owner,JSON.stringify(page),biliHash(page));related?.(page);
    if(this.db.prepare("UPDATE bili_requests SET state='completed',page_id=? WHERE owner=? AND request_id=? AND state='pending'").run(page.id,owner,requestId).changes!==1)throw new Error('BILI_REQUEST_STATE_CONFLICT');this.audit(context,'bilibili.request.completed',{requestId,pageId:page.id,kind:page.kind});return page;});}
  fail(context:ExecutionContext,requestId:string,error:string){z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/).parse(error);const owner=biliOwner(context);this.atomic(()=>{if(this.db.prepare("UPDATE bili_requests SET state='failed',error=? WHERE owner=? AND request_id=? AND state='pending'").run(error,owner,requestId).changes)this.audit(context,'bilibili.request.failed',{requestId,error});});}
  page(owner:string,id:string):BiliPage{const row=this.db.prepare('SELECT body,hash FROM bili_pages WHERE id=? AND owner=?').get(z.uuid().parse(id),owner);if(!row)throw new Error('BILI_PAGE_UNAVAILABLE');const page=BiliPageSchema.parse(JSON.parse(String(row.body)));if(page.owner!==owner||biliHash(page)!==row.hash)throw new Error('BILI_STATE_CORRUPT');if(!this.sourceKnown(page.sourceKey,page.sourceVersion)||page.parents?.some(p=>!this.valid(p)))throw new Error('SOURCE_STALE');return page;}
  pages(owner:string){return this.db.prepare('SELECT id FROM bili_pages WHERE owner=? ORDER BY rowid DESC LIMIT 64').all(owner).flatMap(r=>{try{return [this.page(owner,String(r.id))];}catch{return [];}});}
  videoPages(owner:string,bvid:string){
    BvidSchema.parse(bvid);
    const video=this.db.prepare("SELECT id,json_extract(body,'$.data.aid') AS aid FROM bili_pages WHERE owner=? AND json_extract(body,'$.kind')='video' AND json_extract(body,'$.data.bvid')=? ORDER BY rowid DESC LIMIT 1").get(owner,bvid);
    const rows=this.db.prepare("SELECT id FROM bili_pages WHERE owner=? AND (json_extract(body,'$.data.bvid')=? OR (? IS NOT NULL AND json_extract(body,'$.data.cursor.aid')=?)) ORDER BY rowid DESC LIMIT 63").all(owner,bvid,video?.aid??null,video?.aid??null);
    const ids=[...new Set([...rows.map(row=>String(row.id)),...(video?[String(video.id)]:[])])];
    return ids.flatMap(id=>{try{const page=this.page(owner,id);return this.observation(page)?[page]:[];}catch{return [];}});
  }
  sourceCurrent(key:string,version:number){const row=this.db.prepare('SELECT version,available FROM bili_sources WHERE key=?').get(key);return row?.version===version&&row.available===1;}
  private sourceKnown(key:string,version:number){const row=this.db.prepare('SELECT version,available FROM bili_sources WHERE key=?').get(key);return row?.available===1&&!!this.db.prepare('SELECT 1 FROM bili_revisions WHERE key=? AND version=?').get(key,version);}
  unavailable(key:string){this.db.prepare('UPDATE bili_sources SET available=0 WHERE key=?').run(key);}
  proof(page:BiliPage):ResourceProof{const frame=page.kind==='browser'&&page.sourceKey.startsWith('browser-frame:')?z.object({bvid:BvidSchema,section:z.literal('frame')}).safeParse(page.data):null;
    return {provider:'bilibili',scene:BILI_SCENE,key:page.id,version:page.sourceVersion,hash:biliHash(page),roots:[frame?.success?'bilibili:video:'+frame.data.bvid:'bilibili:'+page.sourceKey],detail:{owner:page.owner}};}
  valid(raw:ResourceProof):boolean{if(this.checking.has(raw.key)||this.checking.size>=64)return false;this.checking.add(raw.key);try{const proof=ResourceProofSchema.parse(raw),detail=z.object({owner:z.string()}).parse(proof.detail),page=this.page(detail.owner,proof.key);return biliHash(proof)===biliHash(this.proof(page));}catch{return false;}finally{this.checking.delete(raw.key);}}
  current(raw:ResourceProof):boolean{if(this.checking.has(raw.key)||this.checking.size>=64)return false;this.checking.add(raw.key);try{const proof=ResourceProofSchema.parse(raw),detail=z.object({owner:z.string()}).parse(proof.detail),page=this.page(detail.owner,proof.key);if(!this.sourceCurrent(page.sourceKey,page.sourceVersion))return false;return biliHash(proof)===biliHash(this.proof(page));}catch{return false;}finally{this.checking.delete(raw.key);}}
  bindObservation(page:BiliPage,source:PersonaSourceRef){const value=JSON.stringify(PersonaSourceRefSchema.parse(source)),old=this.db.prepare('SELECT observation FROM bili_pages WHERE id=?').get(page.id);if(!old)throw new Error('BILI_PAGE_UNAVAILABLE');if(old.observation&&old.observation!==value)throw new Error('BILI_OBSERVATION_CONFLICT');this.db.prepare('UPDATE bili_pages SET observation=? WHERE id=?').run(value,page.id);}
  observation(page:BiliPage){const row=this.db.prepare('SELECT observation FROM bili_pages WHERE id=?').get(page.id);return row?.observation?PersonaSourceRefSchema.parse(JSON.parse(String(row.observation))):null;}
  registerMedia(key:string,description:MediaSourceDescription,locator:unknown,expiresAt:number){const body=MediaSourceDescriptionSchema.parse(description),location=JSON.stringify(z.json().parse(locator));
    if(body.kind==='image'&&Number(this.db.prepare('SELECT coalesce(sum(length(locator)),0) AS bytes FROM bili_media').get()!.bytes)+Buffer.byteLength(location)>64*1024*1024)throw new Error('BILI_BROWSER_FRAME_STORAGE_LIMIT');
    this.db.prepare('INSERT INTO bili_media VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET description=excluded.description,hash=excluded.hash,locator=excluded.locator,expires_at=excluded.expires_at').run(key,JSON.stringify(body),biliHash(body),location,z.number().int().positive().parse(expiresAt));}
  media(key:string,now=Date.now(),historical=false){const row=this.db.prepare('SELECT * FROM bili_media WHERE key=?').get(key);if(!row||!historical&&Number(row.expires_at)<=now)return null;const description=MediaSourceDescriptionSchema.parse(JSON.parse(String(row.description)));if(biliHash(description)!==row.hash)throw new Error('BILI_STATE_CORRUPT');return {description,locator:z.json().parse(JSON.parse(String(row.locator))),expiresAt:Number(row.expires_at)};}
  reserveRequest(now:number,interval:number,timeout:number){return this.atomic(()=>{const state=this.clock;if(state.blockedUntil>now)throw new Error('BILI_BACKOFF');const at=Math.max(now,state.nextAt);if(at-now>=timeout)throw new Error('BILI_RATE_LIMITED');this.db.prepare('UPDATE bili_clock SET next_at=? WHERE id=1').run(at+interval);return at-now;});}
  backoff(now:number,duration:number,error='BILI_BACKOFF'){this.db.prepare('UPDATE bili_clock SET blocked_until=max(blocked_until,?),error=? WHERE id=1').run(now+duration,error);}
  get clock(){const row=this.db.prepare('SELECT * FROM bili_clock WHERE id=1').get()!;return {nextAt:Number(row.next_at),blockedUntil:Number(row.blocked_until),error:row.error===null?null:String(row.error)};}
  epoch(){return biliHash([this.db.prepare('PRAGMA data_version').get(),this.db.prepare('SELECT total_changes() AS changes').get(),this.db.prepare('SELECT count(*) AS expired FROM bili_media WHERE expires_at<=?').get(Date.now())]);}
  private audit(context:ExecutionContext,type:string,data:Record<string,string>){const body={scope:ExecutionScopeSchema.parse(context.scope),origin:RunOriginSchema.parse(context.origin),runId:context.runId,operationId:context.operationId,type,at:new Date().toISOString(),data};this.db.prepare('INSERT INTO bili_outbox(id,body) VALUES(?,?)').run(randomUUID(),JSON.stringify(body));}
  drain(write:(body:unknown,id:string)=>void){for(const row of this.db.prepare('SELECT id,body FROM bili_outbox WHERE delivered=0 ORDER BY seq LIMIT 256').all()){write(JSON.parse(String(row.body)),String(row.id));this.db.prepare('UPDATE bili_outbox SET delivered=1 WHERE id=?').run(String(row.id));}}
  recover(){return Number(this.db.prepare("UPDATE bili_requests SET state='interrupted',error='BILI_PROCESS_INTERRUPTED' WHERE state='pending'").run().changes);}
  get counts(){return {pages:Number(this.db.prepare('SELECT count(*) AS n FROM bili_pages').get()?.n),requests:Number(this.db.prepare('SELECT count(*) AS n FROM bili_requests').get()?.n),pending:Number(this.db.prepare("SELECT count(*) AS n FROM bili_requests WHERE state='pending'").get()?.n)};}
  reading(context:Pick<ExecutionContext,'scope'|'intentVersion'>,bvid:string){const owner=biliOwner(context),row=this.db.prepare('SELECT body FROM bili_reading WHERE owner=? AND bvid=?').get(owner,BvidSchema.parse(bvid));return row?BiliReadingRecordSchema.parse(JSON.parse(String(row.body))):null;}
  saveCommentCursor(context:ExecutionContext,raw:unknown){const owner=this.check(context),cursor=BiliCommentCursorSchema.parse(raw),hash=biliHash(cursor);
    const prior=this.db.prepare('SELECT id FROM bili_comment_cursors WHERE owner=? AND hash=?').get(owner,hash);if(prior)return String(prior.id);
    const id=randomUUID();this.db.prepare('INSERT INTO bili_comment_cursors VALUES(?,?,?,?)').run(id,owner,hash,JSON.stringify(cursor));return id;
  }
  commentCursor(context:ExecutionContext,id:string){const row=this.db.prepare('SELECT body FROM bili_comment_cursors WHERE id=? AND owner=?').get(z.uuid().parse(id),this.check(context));
    if(!row)throw new Error('BILI_CURSOR_UNAVAILABLE');return BiliCommentCursorSchema.parse(JSON.parse(String(row.body)));
  }
  readingVersion(context:Pick<ExecutionContext,'scope'|'intentVersion'>,bvid:string,version:number){
    const owner=biliOwner(context),row=this.db.prepare('SELECT body FROM bili_reading_history WHERE owner=? AND bvid=? AND version=?').get(owner,BvidSchema.parse(bvid),version);
    if(!row)return null;const record=BiliReadingRecordSchema.parse(JSON.parse(String(row.body)));
    for(const source of record.sources)if(source.startsWith('page:'))this.page(owner,source.slice(5));return record;
  }
  saveReading(context:ExecutionContext,requestId:string,value:unknown,requestInput:unknown=value){const owner=this.check(context),id=PersonaRequestIdSchema.parse(requestId);return this.atomic(()=>{
    const fingerprint=biliHash(jsonValue.parse(requestInput));
    const receipt=this.db.prepare('SELECT bvid,version FROM bili_reading_receipts WHERE owner=? AND request_id=?').get(owner,id);
    if(receipt){
      const history=this.db.prepare('SELECT body,fingerprint FROM bili_reading_history WHERE owner=? AND bvid=? AND version=?').get(owner,String(receipt.bvid),Number(receipt.version));
      if(history){if(String(history.fingerprint)!==fingerprint)throw new Error('BILI_READING_REQUEST_CONFLICT');return BiliReadingRecordSchema.parse(JSON.parse(String(history.body)));}
      throw new Error('BILI_READING_RECEIPT_UNAVAILABLE');
    }
    const base=BiliReadingRecordSchema.parse({...z.record(z.string(),z.json()).parse(value),updatedAt:new Date().toISOString()}),prior=this.db.prepare('SELECT version FROM bili_reading WHERE owner=? AND bvid=?').get(owner,base.bvid),version=(prior?Number(prior.version):0)+1,record={...base,version};
    this.db.prepare('INSERT INTO bili_reading(owner,bvid,version,body,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(owner,bvid) DO UPDATE SET version=excluded.version,body=excluded.body,updated_at=excluded.updated_at').run(owner,record.bvid,version,JSON.stringify(record),Date.now());
    this.db.prepare('INSERT INTO bili_reading_history(owner,bvid,version,body,fingerprint,created_at) VALUES(?,?,?,?,?,?)').run(owner,record.bvid,version,JSON.stringify(record),fingerprint,Date.now());
    this.db.prepare('INSERT INTO bili_reading_receipts(owner,request_id,bvid,version) VALUES(?,?,?,?)').run(owner,id,record.bvid,version);
    return record;});}
  readingView(context:Pick<ExecutionContext,'scope'|'intentVersion'>,limit=8){
    const owner=biliOwner(context),total=Number(this.db.prepare('SELECT count(*) AS n FROM bili_reading WHERE owner=?').get(owner)?.n??0);
    const rows=this.db.prepare('SELECT body FROM bili_reading WHERE owner=? ORDER BY updated_at DESC LIMIT ?').all(owner,Math.max(1,Math.min(8,limit)));
    const records=rows.flatMap(row=>{try{
      const record=BiliReadingRecordSchema.parse(JSON.parse(String(row.body)));
      for(const source of record.sources)if(source.startsWith('page:'))this.page(owner,source.slice(5));
      return [record];
    }catch{return [];}});
    const closed=Number(this.db.prepare("SELECT count(*) AS n FROM bili_reading WHERE owner=? AND json_extract(body,'$.status')='closed'").get(owner)?.n??0);
    const view=boundedReadingView(records,Math.max(1,Math.min(8,limit)),total,closed);
    const pending=this.db.prepare("SELECT body FROM bili_reading WHERE owner=? AND json_extract(body,'$.status')!='closed' ORDER BY updated_at DESC LIMIT 1").get(owner);
    if(pending){const record=BiliReadingRecordSchema.parse(JSON.parse(String(pending.body)));try{if(this.readingVersion(context,record.bvid,record.version??1))return {...view,open:boundedReadingView([record]).open};}catch{}}
    return view;
  }
  readingSummary(context:ExecutionContext,limit=8){const owner=biliOwner(context),total=Number(this.db.prepare('SELECT count(*) AS n FROM bili_reading WHERE owner=?').get(owner)?.n ?? 0),rows=this.db.prepare('SELECT body FROM bili_reading WHERE owner=? ORDER BY updated_at DESC LIMIT ?').all(owner,Math.max(1,Math.min(8,limit))),records=rows.flatMap(row=>{try{return [BiliReadingRecordSchema.parse(JSON.parse(String(row.body)))];}catch{return [];}}),recent=records.map(record=>({bvid:record.bvid,title:record.title,status:record.status,conclusion:record.conclusion===null?null:Array.from(record.conclusion).slice(0,300).join('')})),highlights=records.filter(record=>record.conclusion!==null).slice(0,8).map(record=>({bvid:record.bvid,reason:Array.from(record.conclusion!).slice(0,200).join('')})),open=records.find(record=>record.status!=='closed');return BiliReadingIndexSchema.parse({total,recent,highlights,next:open?.nextStep??null});}
  /** Historical auth metadata only: it never authorises a request after a restart. */
  get authMeta(){const row=this.db.prepare('SELECT body FROM bili_auth_meta WHERE id=1').get();return row?BiliAuthMetaSchema.parse(JSON.parse(String(row.body))):null;}
  saveAuthMeta(value:unknown){const body=BiliAuthMetaSchema.parse(value);this.db.prepare('INSERT INTO bili_auth_meta VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(JSON.stringify(body));return body;}
  beginVerification(value:unknown){const record=BiliVerificationSchema.parse(value);this.atomic(()=>{
    this.db.prepare('INSERT INTO bili_verifications VALUES(?,?,?,?,?)').run(record.id,Date.parse(record.at),record.state,record.kind,JSON.stringify(record));
    this.db.prepare('DELETE FROM bili_verifications WHERE id IN (SELECT id FROM bili_verifications ORDER BY at DESC LIMIT -1 OFFSET 50)').run();});return record;}
  updateVerification(id:string,value:unknown){const record=BiliVerificationSchema.parse(value);this.db.prepare('UPDATE bili_verifications SET state=?,body=? WHERE id=?').run(record.state,JSON.stringify(record),z.uuid().parse(id));return record;}
  verification(id:string){const row=this.db.prepare('SELECT body FROM bili_verifications WHERE id=?').get(z.uuid().parse(id));return row?BiliVerificationSchema.parse(JSON.parse(String(row.body))):null;}
  verifications(limit=10){return this.db.prepare('SELECT body FROM bili_verifications ORDER BY at DESC LIMIT ?').all(Math.max(1,Math.min(50,limit))).map(row=>BiliVerificationSchema.parse(JSON.parse(String(row.body))));}
  /** A restart must not replay unfinished network probes; their records stay as interrupted history. */
  interruptVerifications(){const now=new Date().toISOString();for(const record of this.verifications(50)){if(record.state==='pending')this.updateVerification(record.id,{...record,state:'interrupted',updatedAt:now,errorCode:'BILI_VERIFICATION_INTERRUPTED'});}}
  close(){this.db.close();}
}
