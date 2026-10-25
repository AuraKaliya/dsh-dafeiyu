import { DatabaseSync } from 'node:sqlite';
import { existsSync,mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { z } from 'zod';
import { configureSqlite } from '@dafeiyu/journal';
import { MediaAssetRefSchema,MediaAssetRecordSchema,MediaSourceDescriptionSchema,MediaCoverageSchema,ExecutionScopeSchema,SourceDependencySchema,PersonaSourceRefSchema,redactJson } from '@dafeiyu/contracts';
import type { MediaAssetRef,MediaAssetRecord,MediaSourceDescription,MediaAccess,MediaCoverage,ResourceProof } from '@dafeiyu/contracts';
import { MediaReplyStore,migrateMediaReplies,MEDIA_REPLY_TABLES } from './reply-store.js';

export const MEDIA_APPLICATION_ID=0x44464d35;
export const MEDIA_SCHEMA_VERSION=2;
const MEDIA_BASE_TABLES=['media_metadata','media_sources','media_source_revisions','media_assets','media_asset_revisions','media_blobs','media_requests','media_leases','media_jobs','media_exposures','media_outbox'] as const;
export const MEDIA_TABLES=[...MEDIA_BASE_TABLES,...MEDIA_REPLY_TABLES] as const;
const identity=z.strictObject({agentId:z.string().min(1).max(100),profileId:z.string().min(1).max(100)});
const scopeKey=(scope:MediaAssetRecord['scope'])=>scope.kind==='task'?scope.scopeKey:scope.route;
function canonical(raw:unknown):string {const v=z.json().parse(raw);if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';}
export const mediaHash=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
const emptyCoverage:MediaCoverage={acquiredBytes:0,processed:[],exposed:false,gaps:[],completeness:'unknown'};
const sourceRecord=z.strictObject({id:z.uuid(),version:z.number().int().positive(),deleted:z.boolean(),description:MediaSourceDescriptionSchema});
export type StoredMediaSource=z.infer<typeof sourceRecord>;
const exposureSchema=z.strictObject({schemaVersion:z.literal(1),id:z.uuid(),scope:ExecutionScopeSchema,taskEpoch:z.number().int().positive().nullable(),sourceId:z.uuid(),sourceVersion:z.number().int().positive(),
  assets:z.array(MediaAssetRefSchema).min(1).max(8),coverage:MediaCoverageSchema,text:z.string().min(1).max(8000),occurredAt:z.iso.datetime(),detail:z.json()});
export type MediaExposure=z.infer<typeof exposureSchema>;

export class MediaStore {
  private readonly db:DatabaseSync;
  private closed=false;
  readonly identity:z.infer<typeof identity>;
  readonly replies:MediaReplyStore;
  constructor(file:string,who:z.infer<typeof identity>,create=false,migrate=false){
    this.identity=identity.parse(who);if(!existsSync(file)&&!create)throw new Error('MEDIA_MIGRATION_REQUIRED');if(create)mkdirSync(dirname(file),{recursive:true});
    this.db=new DatabaseSync(file);try{this.db.exec('PRAGMA busy_timeout=5000;');const version=Number(this.db.prepare('PRAGMA user_version').get()?.user_version),app=Number(this.db.prepare('PRAGMA application_id').get()?.application_id);
      const empty=Number(this.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get()?.n)===0;
      if(!version&&!app&&empty&&create){configureSqlite(this.db);this.atomic(()=>{this.initialize();migrateMediaReplies(this.db);});}
      else if(![1,MEDIA_SCHEMA_VERSION].includes(version)||app!==MEDIA_APPLICATION_ID)throw new Error('MEDIA_SCHEMA_UNSUPPORTED');
      else if(version<MEDIA_SCHEMA_VERSION&&!migrate)throw new Error('MEDIA_MIGRATION_REQUIRED');
      const row=this.db.prepare('SELECT body FROM media_metadata WHERE id=1').get();if(!row||canonical(JSON.parse(String(row.body)))!==canonical(this.identity))throw new Error('MEDIA_IDENTITY_MISMATCH');
      for(const table of MEDIA_BASE_TABLES)this.db.prepare(`SELECT * FROM ${table} LIMIT 0`).all();configureSqlite(this.db);this.atomic(()=>migrateMediaReplies(this.db));
      for(const table of MEDIA_TABLES)this.db.prepare(`SELECT * FROM ${table} LIMIT 0`).all();this.replies=new MediaReplyStore(this.db,work=>this.atomic(work),mediaHash,ref=>{this.assetWitness(ref);});
    }catch(error){this.db.close();throw error;}
  }
  private initialize(){this.db.exec(`
    CREATE TABLE media_metadata(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL);
    CREATE TABLE media_sources(id TEXT PRIMARY KEY,provider TEXT NOT NULL,source_key TEXT NOT NULL,version INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,UNIQUE(provider,source_key));
    CREATE TABLE media_source_revisions(id TEXT NOT NULL REFERENCES media_sources(id),version INTEGER NOT NULL,body TEXT NOT NULL,body_hash TEXT NOT NULL,PRIMARY KEY(id,version));
    CREATE TABLE media_assets(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,scope_key TEXT NOT NULL,version INTEGER NOT NULL,state TEXT NOT NULL);
    CREATE INDEX media_scope ON media_assets(agent_id,scope_key);
    CREATE TABLE media_asset_revisions(id TEXT NOT NULL REFERENCES media_assets(id),version INTEGER NOT NULL,body TEXT NOT NULL,body_hash TEXT NOT NULL,PRIMARY KEY(id,version));
    CREATE TABLE media_blobs(sha256 TEXT PRIMARY KEY,bytes INTEGER NOT NULL,present INTEGER NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE media_requests(scope_key TEXT NOT NULL,producer TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,receipt TEXT NOT NULL,PRIMARY KEY(scope_key,producer,request_id));
    CREATE TABLE media_leases(id TEXT PRIMARY KEY,asset_id TEXT NOT NULL REFERENCES media_assets(id),asset_version INTEGER NOT NULL,owner TEXT NOT NULL,expires_at INTEGER NOT NULL,released INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE media_jobs(id TEXT PRIMARY KEY,scope_key TEXT NOT NULL,run_id TEXT NOT NULL,operation_id TEXT NOT NULL,body TEXT NOT NULL,body_hash TEXT NOT NULL,state TEXT NOT NULL,result TEXT,error TEXT);
    CREATE TABLE media_exposures(id TEXT PRIMARY KEY,scope_key TEXT NOT NULL,run_id TEXT NOT NULL,operation_id TEXT NOT NULL,body TEXT NOT NULL,body_hash TEXT NOT NULL);
    CREATE TABLE media_outbox(id TEXT PRIMARY KEY,body TEXT NOT NULL,delivered INTEGER NOT NULL DEFAULT 0);
    PRAGMA application_id=${MEDIA_APPLICATION_ID};PRAGMA user_version=1;
  `);
    for(const table of ['media_metadata','media_source_revisions','media_asset_revisions','media_requests','media_exposures'])this.db.exec(`CREATE TRIGGER ${table}_immutable BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Immutable media record');END;CREATE TRIGGER ${table}_retain BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Retain media provenance');END;`);
    this.db.exec("CREATE TRIGGER media_job_input_immutable BEFORE UPDATE OF id,scope_key,run_id,operation_id,body,body_hash ON media_jobs BEGIN SELECT RAISE(ABORT,'Immutable media input');END;");
    this.db.prepare('INSERT INTO media_metadata VALUES(1,?)').run(JSON.stringify(this.identity));
  }
  private atomic<T>(fn:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const value=fn();this.db.exec('COMMIT');return value;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  private check(access:MediaAccess){access.guard();if(access.execution.view.scope.agentId!==this.identity.agentId)throw new Error('SCOPE_DENIED');return access.execution.view.scope;}
  private request<T>(access:MediaAccess,key:string,input:unknown,parse:(raw:unknown)=>T,fn:()=>T):T {
    const scope=this.check(access),fingerprint=mediaHash(input),old=this.db.prepare('SELECT fingerprint,receipt FROM media_requests WHERE scope_key=? AND producer=? AND request_id=?').get(scopeKey(scope),access.execution.producer,key);
    if(old){if(old.fingerprint!==fingerprint)throw new Error('IDEMPOTENCY_CONFLICT');return parse(JSON.parse(String(old.receipt)));}
    const value=fn();access.guard();this.db.prepare('INSERT INTO media_requests VALUES(?,?,?,?,?)').run(scopeKey(scope),access.execution.producer,key,fingerprint,JSON.stringify(value));return value;
  }
  private audit(access:MediaAccess,type:string,data:unknown){const id=randomUUID();this.db.prepare('INSERT INTO media_outbox(id,body) VALUES(?,?)').run(id,JSON.stringify({id,type,scope:access.execution.view.scope,runId:access.execution.view.runId,
    origin:access.execution.view.origin,operationId:access.execution.operationId,causedBy:access.execution.startedEventId,at:new Date().toISOString(),data}));}
  source(id:string):StoredMediaSource {const row=this.db.prepare('SELECT s.id,s.version,s.deleted,r.body,r.body_hash FROM media_sources s JOIN media_source_revisions r ON r.id=s.id AND r.version=s.version WHERE s.id=?').get(z.uuid().parse(id));
    if(!row)throw new Error('MEDIA_SOURCE_UNAVAILABLE');const description=MediaSourceDescriptionSchema.parse(JSON.parse(String(row.body)));if(mediaHash(description)!==row.body_hash)throw new Error('MEDIA_STATE_CORRUPT');return sourceRecord.parse({id:row.id,version:row.version,deleted:!!row.deleted,description});}
  rememberSource(access:MediaAccess,raw:MediaSourceDescription){const description=MediaSourceDescriptionSchema.parse(raw);this.check(access);if(redactJson(z.json().parse(description)).redacted)throw new Error('PRIVATE_INPUT_REJECTED');
    if(mediaHash(access.origin)!==mediaHash(description.origin))throw new Error('SCOPE_DENIED');
    return this.atomic(()=>{access.guard();const old=this.db.prepare('SELECT id FROM media_sources WHERE provider=? AND source_key=?').get(description.ref.provider,description.ref.key);
      if(old){const current=this.source(String(old.id));if(current.deleted)throw new Error('MEDIA_SOURCE_REVOKED');if(mediaHash(current.description)!==mediaHash(description))throw new Error('SOURCE_CHANGED');return current;}
      const id=randomUUID();this.db.prepare('INSERT INTO media_sources(id,provider,source_key,version) VALUES(?,?,?,1)').run(id,description.ref.provider,description.ref.key);
      this.db.prepare('INSERT INTO media_source_revisions VALUES(?,1,?,?)').run(id,JSON.stringify(description),mediaHash(description));this.audit(access,'media.source.registered',{sourceId:id,provider:description.ref.provider});return this.source(id);
    });}
  changeSource(access:MediaAccess,id:string,expectedVersion:number,deleted:boolean){return this.atomic(()=>{
    const current=this.source(id);this.check(access);if(mediaHash(access.origin)!==mediaHash(current.description.origin))throw new Error('SCOPE_DENIED');if(current.version!==expectedVersion)throw new Error('VERSION_CONFLICT');if(current.deleted===deleted)throw new Error('MEDIA_SOURCE_STATE_CONFLICT');
    this.db.prepare('UPDATE media_sources SET version=version+1,deleted=? WHERE id=?').run(Number(deleted),id);
    this.db.prepare('INSERT INTO media_source_revisions VALUES(?,?,?,?)').run(id,current.version+1,JSON.stringify(current.description),mediaHash(current.description));this.audit(access,deleted?'media.source.deleted':'media.source.restored',{sourceId:id,version:current.version+1});return this.source(id);
  });}
  private asset(id:string):MediaAssetRecord {const row=this.db.prepare('SELECT r.body,r.body_hash,a.state FROM media_assets a JOIN media_asset_revisions r ON r.id=a.id AND r.version=a.version WHERE a.id=?').get(z.uuid().parse(id));
    if(!row)throw new Error('MEDIA_ASSET_UNAVAILABLE');const value=MediaAssetRecordSchema.parse(JSON.parse(String(row.body)));if(mediaHash(value)!==row.body_hash)throw new Error('MEDIA_STATE_CORRUPT');return {...value,state:MediaAssetRecordSchema.shape.state.parse(row.state)};}
  private writeAsset(value:MediaAssetRecord){const body=MediaAssetRecordSchema.parse(value);this.db.prepare('UPDATE media_assets SET version=?,state=? WHERE id=?').run(body.version,body.state,body.id);
    this.db.prepare('INSERT INTO media_asset_revisions VALUES(?,?,?,?)').run(body.id,body.version,JSON.stringify(body),mediaHash(body));}
  read(access:MediaAccess,id:string){const scope=this.check(access),value=this.asset(id);if(value.agentId!==scope.agentId||scopeKey(value.scope)!==scopeKey(scope)||scope.kind==='task'&&value.taskEpoch!==access.execution.intentVersion)throw new Error('SCOPE_DENIED');
    const source=this.source(value.sourceId);if(mediaHash(access.origin)!==mediaHash(source.description.origin))throw new Error('SCOPE_DENIED');if(source.deleted||source.version!==value.sourceVersion||value.state==='deleted'||value.parent&&!this.contentCurrent(value.parent))throw new Error('MEDIA_SOURCE_STALE');return value;}
  reserve(access:MediaAccess,key:string,source:StoredMediaSource,processingHash:string|null=null,parent:MediaAssetRef|null=null){return this.atomic(()=>this.request(access,key,{kind:'reserve',sourceId:source.id,sourceVersion:source.version,processingHash,parent,taskEpoch:access.execution.intentVersion},v=>z.object({id:z.uuid()}).parse(v),()=>{
    const scope=this.check(access),actual=this.source(source.id);if(mediaHash(access.origin)!==mediaHash(actual.description.origin))throw new Error('SCOPE_DENIED');if(actual.deleted||actual.version!==source.version)throw new Error('MEDIA_SOURCE_STALE');if(parent)this.requireRef(access,parent);
    const now=new Date().toISOString(),value=MediaAssetRecordSchema.parse({schemaVersion:1,id:randomUUID(),version:1,agentId:scope.agentId,scope,taskEpoch:scope.kind==='task'?access.execution.intentVersion:null,
      sourceId:source.id,sourceVersion:source.version,kind:source.description.kind,state:'staging',sha256:null,bytes:null,mime:null,parent,processingHash,coverage:emptyCoverage,createdAt:now,updatedAt:now});
    this.db.prepare('INSERT INTO media_assets VALUES(?,?,?,?,?)').run(value.id,scope.agentId,scopeKey(scope),1,'staging');this.writeAsset(value);this.audit(access,'media.asset.reserved',{assetId:value.id,sourceId:source.id});return {id:value.id};
  }));}
  publish(access:MediaAccess,id:string,input:{sha256:string;bytes:number;mime:string;kind:MediaAssetRecord['kind'];coverage:MediaCoverage},verify:()=>boolean){return this.atomic(()=>{
    const current=this.read(access,id),valid=z.object({sha256:z.string().regex(/^[a-f0-9]{64}$/),bytes:z.number().int().nonnegative().safe(),mime:z.string().min(1).max(120),kind:MediaAssetRecordSchema.shape.kind,coverage:MediaCoverageSchema}).parse(input);
    if(current.state==='ready'){const ref=this.ref(current);if(ref.sha256!==valid.sha256||ref.bytes!==valid.bytes||ref.mime!==valid.mime||ref.kind!==valid.kind)throw new Error('IDEMPOTENCY_CONFLICT');return ref;}
    if(current.state!=='staging'||!verify())throw new Error('MEDIA_BLOB_UNVERIFIED');
    const blob=this.db.prepare('SELECT bytes,present FROM media_blobs WHERE sha256=?').get(valid.sha256);if(blob&&blob.bytes!==valid.bytes)throw new Error('MEDIA_BLOB_CONFLICT');if(blob?.present===0)throw new Error('MEDIA_BLOB_CLEANUP_PENDING');if(blob?.present===3&&this.blobOwner(valid.sha256)!==id)throw new Error('MEDIA_BLOB_BUSY');
    this.db.prepare('INSERT INTO media_blobs VALUES(?,?,1,?) ON CONFLICT(sha256) DO UPDATE SET present=1').run(valid.sha256,valid.bytes,new Date().toISOString());
    const value={...current,...valid,state:'ready' as const,version:current.version+1,updatedAt:new Date().toISOString()};this.writeAsset(value);this.audit(access,'media.asset.ready',{assetId:id,version:value.version,bytes:value.bytes});access.guard();return this.ref(value);
  });}
  ref(record:MediaAssetRecord):MediaAssetRef{return MediaAssetRefSchema.parse({schemaVersion:1,id:record.id,version:record.version,kind:record.kind,sha256:record.sha256,bytes:record.bytes,mime:record.mime});}
  reserveBlob(access:MediaAccess,assetId:string,sha256:string,bytes:number){return this.atomic(()=>{
    if(this.read(access,assetId).state!=='staging')throw new Error('MEDIA_ASSET_UNAVAILABLE');z.string().regex(/^[a-f0-9]{64}$/).parse(sha256);z.number().int().nonnegative().safe().parse(bytes);
    const old=this.db.prepare('SELECT bytes,present FROM media_blobs WHERE sha256=?').get(sha256);if(old&&old.bytes!==bytes)throw new Error('MEDIA_BLOB_CONFLICT');
    if(old?.present===1)return false;if(old?.present===0)throw new Error('MEDIA_BLOB_CLEANUP_PENDING');
    if(old?.present===3){if(this.blobOwner(sha256)!==assetId)throw new Error('MEDIA_BLOB_BUSY');return true;}
    this.db.prepare('INSERT INTO media_blobs VALUES(?,?,3,?) ON CONFLICT(sha256) DO UPDATE SET present=3').run(sha256,bytes,new Date().toISOString());
    this.db.prepare('INSERT INTO media_requests VALUES(?,?,?,?,?)').run('blob:'+sha256,'media',randomUUID(),sha256,JSON.stringify({assetId}));return true;
  });}
  private blobOwner(hash:string){const row=this.db.prepare("SELECT receipt FROM media_requests WHERE scope_key=? AND producer='media' ORDER BY rowid DESC LIMIT 1").get('blob:'+hash);return row?z.object({assetId:z.uuid()}).parse(JSON.parse(String(row.receipt))).assetId:null;}
  abandonBlob(assetId:string,hash:string){if(this.blobOwner(hash)!==assetId)return;this.db.prepare('UPDATE media_blobs SET present=0 WHERE sha256=? AND present=3').run(hash);}
  requireRef(access:MediaAccess,raw:MediaAssetRef){const ref=MediaAssetRefSchema.parse(raw),asset=this.read(access,ref.id);
    if(asset.state!=='ready'||mediaHash(this.ref(asset))!==mediaHash(ref)||!this.db.prepare('SELECT 1 FROM media_blobs WHERE sha256=? AND bytes=? AND present=1').get(ref.sha256,ref.bytes))throw new Error('MEDIA_ASSET_UNAVAILABLE');return asset;}
  abandon(access:MediaAccess,id:string,code:string){this.atomic(()=>{const current=this.asset(id);if(scopeKey(current.scope)!==scopeKey(access.execution.view.scope)||current.agentId!==this.identity.agentId)throw new Error('SCOPE_DENIED');
    if(current.state!=='staging')return;this.writeAsset({...current,state:'failed',version:current.version+1,updatedAt:new Date().toISOString()});this.audit(access,'media.asset.failed',{assetId:id,code});});}
  deleteAsset(access:MediaAccess,id:string,expectedVersion:number){return this.atomic(()=>{const current=this.read(access,id);if(current.version!==expectedVersion)throw new Error('VERSION_CONFLICT');
    const value={...current,state:'deleted' as const,version:current.version+1,updatedAt:new Date().toISOString()};this.writeAsset(value);this.audit(access,'media.asset.deleted',{assetId:id,version:value.version});access.guard();return {id,version:value.version};});}
  lease(access:MediaAccess,ref:MediaAssetRef,owner:string,expiresAt:number){z.string().min(1).max(200).parse(owner);z.number().int().positive().safe().parse(expiresAt);return this.atomic(()=>{
    this.requireRef(access,ref);const id=randomUUID();this.db.prepare('INSERT INTO media_leases VALUES(?,?,?,?,?,0)').run(id,ref.id,ref.version,owner,expiresAt);return id;});}
  releaseLease(id:string,owner:string){return this.db.prepare('UPDATE media_leases SET released=1 WHERE id=? AND owner=?').run(z.uuid().parse(id),owner).changes===1;}
  reclaimable(now:number){return this.db.prepare("SELECT b.sha256,b.bytes FROM media_blobs b WHERE b.present=1 AND NOT EXISTS(SELECT 1 FROM media_assets a JOIN media_asset_revisions r ON r.id=a.id AND r.version=a.version JOIN media_leases l ON l.asset_id=a.id AND l.asset_version=a.version WHERE json_extract(r.body,'$.sha256')=b.sha256 AND l.released=0 AND l.expires_at>?) ORDER BY b.created_at").all(now).map(row=>({sha256:String(row.sha256),bytes:Number(row.bytes)}));}
  beginEviction(hash:string,now:number){this.atomic(()=>{if(!this.reclaimable(now).some(blob=>blob.sha256===hash))throw new Error('MEDIA_BLOB_PINNED');
    this.db.prepare('UPDATE media_blobs SET present=0 WHERE sha256=?').run(hash);
    // Availability is separate from content/revocation version: retain a dated observation's proof.
    this.db.prepare("UPDATE media_assets SET state='evicted' WHERE state='ready' AND id IN(SELECT a.id FROM media_assets a JOIN media_asset_revisions r ON r.id=a.id AND r.version=a.version WHERE json_extract(r.body,'$.sha256')=?)").run(hash);
  });}
  evict(hash:string,now:number,remove:()=>void){this.beginEviction(hash,now);this.completeRemoval(hash,remove);}
  pendingRemoval(){return this.db.prepare('SELECT sha256,bytes FROM media_blobs WHERE present=0').all().map(row=>({sha256:String(row.sha256),bytes:Number(row.bytes)}));}
  completeRemoval(hash:string,remove:()=>void){if(!this.db.prepare('SELECT 1 FROM media_blobs WHERE sha256=? AND present=0').get(hash))throw new Error('MEDIA_CLEANUP_STATE_CONFLICT');
    remove();this.db.prepare('UPDATE media_blobs SET present=2 WHERE sha256=? AND present=0').run(hash);}
  beginJob(access:MediaAccess,id:string,input:unknown){return this.atomic(()=>{const scope=this.check(access),body=z.json().parse({scope,taskEpoch:access.execution.intentVersion,input,history:access.execution.historyDependencies??[]}),hash=mediaHash(body);
    const old=this.db.prepare('SELECT body_hash FROM media_jobs WHERE id=?').get(z.uuid().parse(id));if(old){if(old.body_hash!==hash)throw new Error('IDEMPOTENCY_CONFLICT');return;}
    this.db.prepare("INSERT INTO media_jobs(id,scope_key,run_id,operation_id,body,body_hash,state) VALUES(?,?,?,?,?,?,'running')").run(id,scopeKey(scope),access.execution.view.runId,access.execution.operationId,JSON.stringify(body),hash);
    this.audit(access,'media.job.started',{jobId:id});});}
  finishJob(access:MediaAccess,id:string,result:unknown,error:string|null){this.atomic(()=>{const scope=this.check(access);const row=this.db.prepare('SELECT state,body FROM media_jobs WHERE id=? AND scope_key=?').get(id,scopeKey(scope));if(!row)throw new Error('SCOPE_DENIED');
    if(row.state!=='running')throw new Error('MEDIA_JOB_STATE_CONFLICT');const body=z.object({history:z.array(SourceDependencySchema)}).parse(JSON.parse(String(row.body)));
    if(body.history.length&&!access.execution.validateHistory?.(body.history))throw new Error('SOURCE_STALE');if(error!==null&&!/^[A-Z0-9_]{1,100}$/.test(error))throw new Error('INVALID_INPUT');
    const value=z.json().parse(result);if(redactJson(value).redacted)throw new Error('PRIVATE_INPUT_REJECTED');this.db.prepare('UPDATE media_jobs SET state=?,result=?,error=? WHERE id=?').run(error?'failed':'completed',JSON.stringify(value),error,id);this.audit(access,'media.job.settled',{jobId:id,error});access.guard();});}
  sourceForAsset(id:string){return this.source(this.asset(id).sourceId);}
  readReceipt(access:MediaAccess,key:string,input:unknown){this.check(access);const row=this.db.prepare('SELECT fingerprint,receipt FROM media_requests WHERE scope_key=? AND producer=? AND request_id=?').get(scopeKey(access.execution.view.scope),access.execution.producer,'read:'+key);
    if(!row)return null;if(row.fingerprint!==mediaHash(input))throw new Error('IDEMPOTENCY_CONFLICT');return z.uuid().parse(JSON.parse(String(row.receipt)));}
  recordExposure(access:MediaAccess,key:string,input:unknown,source:StoredMediaSource,value:Omit<MediaExposure,'schemaVersion'|'id'|'scope'|'taskEpoch'|'sourceId'|'sourceVersion'>){return this.atomic(()=>{
    const id=this.request(access,'read:'+key,input,v=>z.uuid().parse(v),()=>{
      const body=exposureSchema.parse({...value,schemaVersion:1,id:randomUUID(),scope:access.execution.view.scope,taskEpoch:access.execution.view.scope.kind==='task'?access.execution.intentVersion:null,sourceId:source.id,sourceVersion:source.version});
      if(redactJson(z.json().parse(body)).redacted)throw new Error('PRIVATE_INPUT_REJECTED');for(const ref of body.assets)this.requireRef(access,ref);
      if(!body.coverage.exposed)throw new Error('MEDIA_IMAGE_NOT_EXPOSED');this.db.prepare('INSERT INTO media_exposures VALUES(?,?,?,?,?,?)').run(body.id,scopeKey(body.scope),access.execution.view.runId,access.execution.operationId,JSON.stringify(body),mediaHash(body));
      this.audit(access,'media.exposure.recorded',{exposureId:body.id,assets:body.assets.map(a=>a.id),coverage:body.coverage});return body.id;});return this.exposure(access,id);
  });}
  private exposureRow(id:string){const row=this.db.prepare('SELECT body,body_hash FROM media_exposures WHERE id=?').get(z.uuid().parse(id));if(!row)throw new Error('MEDIA_EXPOSURE_UNAVAILABLE');
    const body=exposureSchema.parse(JSON.parse(String(row.body)));if(mediaHash(body)!==row.body_hash)throw new Error('MEDIA_STATE_CORRUPT');return body;}
  exposure(access:MediaAccess,id:string){this.check(access);const body=this.exposureRow(id);if(body.scope.agentId!==access.execution.view.scope.agentId||scopeKey(body.scope)!==scopeKey(access.execution.view.scope)||body.taskEpoch!==(body.scope.kind==='task'?access.execution.intentVersion:null))throw new Error('SCOPE_DENIED');
    if(mediaHash(this.source(body.sourceId).description.origin)!==mediaHash(access.origin)||!this.exposureCurrent(id))throw new Error('MEDIA_SOURCE_STALE');return body;}
  exposureProof(body:MediaExposure):ResourceProof {const origin=this.source(body.sourceId).description.origin;return {provider:'media',scene:origin.scene,key:body.id,version:1,hash:mediaHash(body),roots:origin.roots,detail:{exposureId:body.id}};}
  exposureOrigin(id:string){return this.source(this.exposureRow(id).sourceId).description;}
  /** Program-only immutable witness lookup; public reads must first pass exposure(access, id). */
  exposureWitness(id:string){const body=this.exposureRow(id);if(!this.exposureCurrent(id))throw new Error('MEDIA_SOURCE_STALE');return body;}
  assetWitness(ref:MediaAssetRef){if(!this.contentCurrent(ref))throw new Error('MEDIA_SOURCE_STALE');return this.asset(ref.id);}
  bindObservation(access:MediaAccess,id:string,source:unknown){const ref=PersonaSourceRefSchema.parse(source),body=this.exposure(access,id);
    if(ref.scopeKey!==scopeKey(body.scope)||ref.agentId!==body.scope.agentId||access.execution.producer!=='media')throw new Error('SCOPE_DENIED');
    return this.atomic(()=>this.request(access,'observation:'+id,{id,ref},value=>PersonaSourceRefSchema.parse(value),()=>ref));}
  observation(id:string){const body=this.exposureRow(id),row=this.db.prepare("SELECT receipt FROM media_requests WHERE scope_key=? AND producer='media' AND request_id=?").get(scopeKey(body.scope),'observation:'+id);
    if(!row)throw new Error('MEDIA_OBSERVATION_REQUIRED');return PersonaSourceRefSchema.parse(JSON.parse(String(row.receipt)));}
  epoch(){return mediaHash([this.db.prepare('SELECT id,version,deleted FROM media_sources ORDER BY id').all(),this.db.prepare('SELECT id,version,state FROM media_assets ORDER BY id').all()]);}
  private contentCurrent(ref:MediaAssetRef,seen=new Set<string>()):boolean {if(seen.has(ref.id)||seen.size>=32)return false;seen.add(ref.id);const asset=this.asset(ref.id),source=this.source(asset.sourceId);
    return !source.deleted&&source.version===asset.sourceVersion&&(asset.state==='ready'||asset.state==='evicted')&&asset.version===ref.version&&mediaHash(this.ref(asset))===mediaHash(ref)&&(!asset.parent||this.contentCurrent(asset.parent,seen));}
  exposureCurrent(id:string){try{const body=this.exposureRow(id),source=this.source(body.sourceId);if(source.deleted||source.version!==body.sourceVersion)return false;
    return body.assets.every(ref=>{const asset=this.asset(ref.id);return this.contentCurrent(ref)&&asset.sourceId===source.id&&asset.sourceVersion===source.version;});}catch{return false;}}
  validateExposure(proof:ResourceProof,current:(source:MediaSourceDescription)=>boolean){try{const body=this.exposureRow(proof.key);return this.exposureCurrent(body.id)&&mediaHash(proof)===mediaHash(this.exposureProof(body))&&current(this.source(body.sourceId).description);}catch{return false;}}
  abortJob(access:MediaAccess,id:string,code:string){if(!/^[A-Z0-9_]{1,100}$/.test(code))throw new Error('INVALID_INPUT');this.db.prepare("UPDATE media_jobs SET state='failed',error=? WHERE id=? AND scope_key=? AND operation_id=? AND state='running'").run(code,id,scopeKey(access.execution.view.scope),access.execution.operationId);}
  recover(){return this.atomic(()=>{const jobs=Number(this.db.prepare("UPDATE media_jobs SET state='interrupted',error='PROCESS_INTERRUPTED' WHERE state='running'").run().changes);
    this.db.prepare('UPDATE media_blobs SET present=0 WHERE present=3').run();
    for(const row of this.db.prepare("SELECT id FROM media_assets WHERE state='staging'").all()){const current=this.asset(String(row.id));this.writeAsset({...current,state:'failed',version:current.version+1,updatedAt:new Date().toISOString()});}return jobs;});}
  counts(){return {sources:Number(this.db.prepare('SELECT count(*) AS n FROM media_sources').get()?.n),assets:Number(this.db.prepare('SELECT count(*) AS n FROM media_assets').get()?.n),bytes:Number(this.db.prepare('SELECT coalesce(sum(bytes),0) AS n FROM media_blobs WHERE present IN (0,1,3)').get()?.n)};}
  drain(publish:(body:unknown,id:string)=>void){for(const row of this.db.prepare('SELECT id,body FROM media_outbox WHERE delivered=0 ORDER BY rowid').all()){publish(JSON.parse(String(row.body)),String(row.id));this.db.prepare('UPDATE media_outbox SET delivered=1 WHERE id=?').run(row.id!);}}
  close(){if(this.closed)return;this.closed=true;this.db.close();}
}
