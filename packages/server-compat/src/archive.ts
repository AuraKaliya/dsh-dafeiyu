import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue,SQLOutputValue } from 'node:sqlite';
import { z } from 'zod';
import type { Json } from '@dafeiyu/contracts';
import { ArchiveLocationSchema,archiveIdentity,assertArchiveIdentity,check,digest,existingArchiveUri,freeze,objectValue,sanitizeJson,sanitizeText } from './safety.js';
import type { ArchiveIdentity,ArchiveLocation } from './safety.js';
import { schemaFingerprint,validateArchiveSchema } from './schema.js';

const identifier=z.string().regex(/^[a-zA-Z0-9._:-]{1,200}$/),hash=z.string().regex(/^[a-f0-9]{64}$/),gitHash=z.string().regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/);
const at=z.iso.datetime(),count=z.number().int().nonnegative().safe(),day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const cycleStates=['waiting','memory','memory_pending','archiving','writing_notes','committing','complete','failed'] as const;
const cycleState=z.enum(cycleStates),cycleKind=z.enum(['daily','manual']);
const visibleEvents=new Set(['user/message','assistant/message','tool/call','tool/result','turn/start','turn/end','compaction']);
export const HostArchiveRecordSchema=z.strictObject({id:identifier,kind:z.enum(['event','maintenance','version-notes','version','migration']),
  route:z.string().min(1).max(500).nullable(),actor:z.string().min(1).max(200).nullable(),occurredAt:at.nullable(),audience:z.enum(['owner','conversation']),
  source:z.strictObject({id:z.string().min(1).max(500),hash}),payload:z.strictObject({type:z.enum(['user/message','assistant/message','tool/call','tool/result','turn/start','turn/end','compaction','maintenance','version-notes','version','migration']),data:z.json()}),text:z.string().max(65536).optional()})
  .refine(value=>value.audience!=='conversation'||value.route!==null,'Conversation records require their route')
  .refine(value=>value.kind==='event'?visibleEvents.has(value.payload.type):value.kind===value.payload.type,'Record kind must match its visible envelope');
export type HostArchiveRecord=z.infer<typeof HostArchiveRecordSchema>;
export interface ArchiveRecordRef {readonly id:string;readonly key:string;readonly hash:string;readonly created:boolean}
export interface CycleSnapshot {readonly id:string;readonly day:string;readonly kind:string;readonly state:string;readonly updatedAt:string;readonly payload:Readonly<Record<string,Json>>;readonly token:string}
export interface VersionSnapshot {readonly id:string;readonly cycleId:string;readonly baseCommit:string;readonly treeId:string;readonly commitHash:string|null;readonly state:string;
  readonly title:string|null;readonly notes:string|null;readonly plan:Readonly<Record<string,Json>>;readonly createdAt:string;readonly token:string}
export interface ExistingArchiveOptions {readonly profileId:string;readonly knownSecrets?:readonly string[];readonly clock?:()=>number}
const patchSchema=z.strictObject({attempts:count.optional(),retryAt:count.nullable().optional(),memoryDone:z.boolean().optional(),memory_finished_at:at.optional(),
  memoryPasses:z.array(z.json()).max(10000).optional(),maintenance:z.record(z.string(),z.json()).optional(),versionId:identifier.optional(),versionAttempt:count.optional(),
  version:identifier.optional(),commit:gitHash.optional(),error:z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/).nullable().optional(),finished_at:at.optional()});
export type CyclePatch=z.infer<typeof patchSchema>;
const prepareSchema=z.strictObject({id:identifier,cycleId:identifier,expectedCycleToken:hash,baseCommit:z.union([z.literal(''),gitHash]),treeId:gitHash,plan:z.record(z.string(),z.json())});
export type PrepareArchiveVersion=z.infer<typeof prepareSchema>;
const notesSchema=z.strictObject({id:identifier,expectedToken:hash,title:z.string().trim().min(1).max(100),notes:z.string().trim().min(1).max(32768),
  evidenceRefs:z.array(z.string().min(1).max(1000)).min(1).max(100),run:z.strictObject({runId:z.uuid(),closedEventId:z.uuid(),resultHash:hash})});
export type ArchiveVersionNotes=z.infer<typeof notesSchema>;
type Row=Record<string,SQLOutputValue>;
function watermark(value:unknown):bigint{check(typeof value==='string'&&/^(0|[1-9][0-9]{0,18})$/.test(value)||typeof value==='number'&&Number.isSafeInteger(value)&&value>=0,'ARCHIVE_WATERMARK_INVALID');
  const number=BigInt(value);check(number<=9223372036854775807n,'ARCHIVE_WATERMARK_INVALID');return number;}
function rowToken(row:Row):string{return digest(JSON.stringify(Object.fromEntries(Object.keys(row).sort().map(key=>[key,row[key]])),(_key,value:unknown)=>
  typeof value==='bigint'?{integer:value.toString()}:value instanceof Uint8Array?{bytes:Buffer.from(value).toString('base64')}:value));}
function string(row:Row,key:string):string{check(typeof row[key]==='string','ARCHIVE_ROW_INVALID');return row[key];}
function nullableString(row:Row,key:string):string|null{const value=row[key];check(value===null||typeof value==='string','ARCHIVE_ROW_INVALID');return value;}
function cycleSnapshot(row:Row):CycleSnapshot{
  const payload=objectValue(JSON.parse(string(row,'payload'))),id=string(row,'id'),state=string(row,'state'),kind=string(row,'kind'),date=string(row,'day');
  check(payload.id===id&&payload.state===state&&payload.kind===kind&&payload.day===date,'ARCHIVE_ROW_INVALID');
  return freeze({id,day:date,kind,state,updatedAt:string(row,'updated_at'),payload,token:rowToken(row)});
}
function versionSnapshot(row:Row):VersionSnapshot{return freeze({id:string(row,'id'),cycleId:string(row,'cycle_id'),baseCommit:string(row,'base_commit'),treeId:string(row,'tree_id'),
  commitHash:nullableString(row,'commit_hash'),state:string(row,'state'),title:nullableString(row,'title'),notes:nullableString(row,'notes'),plan:objectValue(JSON.parse(string(row,'plan'))),createdAt:string(row,'created_at'),token:rowToken(row)});}
const transitions:Record<z.infer<typeof cycleState>,readonly z.infer<typeof cycleState>[]>= {
  waiting:['memory','failed'],memory:['memory_pending','archiving','failed'],memory_pending:['memory','failed'],archiving:['writing_notes','failed'],
  writing_notes:['committing','failed'],committing:['complete','failed'],complete:[],failed:['memory','archiving'],
};

/** Program-only persistence adapter. It exposes no model tool, generic SQL, file initializer or Git operation. */
export class ExistingArchive {
  private closed=false;
  private readonly secrets:readonly string[];
  private readonly clock:()=>number;
  private constructor(private readonly db:DatabaseSync,private readonly location:ArchiveLocation,private readonly identity:ArchiveIdentity,
    private readonly schemaHash:string,readonly profileId:string,options:ExistingArchiveOptions){
    this.clock=options.clock??Date.now;this.secrets=Object.freeze([...(options.knownSecrets??[])].filter(value=>value.length>=12));
  }
  static openExisting(raw:ArchiveLocation,options:ExistingArchiveOptions):ExistingArchive{
    const location=ArchiveLocationSchema.parse(raw),profileId=z.string().regex(/^[a-zA-Z0-9._-]{1,120}$/).parse(options.profileId),identity=archiveIdentity(location);
    // First perform the complete validation through a read-only connection.
    const probe=new DatabaseSync(existingArchiveUri(location.database,false),{readOnly:true,allowExtension:false});let schemaHash:string;
    try{probe.exec('BEGIN');schemaHash=validateArchiveSchema(probe);assertArchiveIdentity(location,identity);probe.exec('COMMIT');}finally{probe.close();}
    const db=new DatabaseSync(existingArchiveUri(location.database,true),{allowExtension:false,timeout:1000});
    try{db.exec('BEGIN IMMEDIATE');assertArchiveIdentity(location,identity);check(validateArchiveSchema(db)===schemaHash,'ARCHIVE_SCHEMA_CHANGED');db.exec('COMMIT');
      return new ExistingArchive(db,freeze({...location}),freeze(identity),schemaHash,profileId,options);
    }catch(error){db.close();throw error;}
  }
  private guard():void{check(!this.closed,'ARCHIVE_CLOSED');assertArchiveIdentity(this.location,this.identity);check(schemaFingerprint(this.db)===this.schemaHash,'ARCHIVE_SCHEMA_CHANGED');}
  private transaction<T>(work:()=>T):T{
    this.guard();this.db.exec('BEGIN IMMEDIATE');
    try{this.guard();const result=work();this.guard();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  private row(sql:string,...params:SQLInputValue[]):Row|undefined{const statement=this.db.prepare(sql);statement.setReadBigInts(true);return statement.get(...params);}
  private now(previous?:string):string{const current=this.clock();check(Number.isSafeInteger(current)&&current>=0&&current<=8640000000000000,'ARCHIVE_CLOCK_INVALID');
    const earlier=previous===undefined?-1:Date.parse(previous);check(Number.isFinite(earlier),'ARCHIVE_ROW_INVALID');return new Date(Math.max(current,earlier+1)).toISOString();}
  private cleanObject(raw:unknown):Record<string,Json>{return objectValue(sanitizeJson(raw,this.secrets));}
  private append(raw:HostArchiveRecord):ArchiveRecordRef{
    const input=HostArchiveRecordSchema.parse(raw),key=`host:${this.profileId}:${input.id}`,payload=this.cleanObject(input.payload),json=JSON.stringify(payload),contentHash=digest(json);
    const body=sanitizeText(input.text??json,this.secrets),source=JSON.stringify(input.source),kind='host_'+input.kind;
    // Identifiers are metadata, never a channel for a masked credential or private block.
    for(const value of [key,source,input.route??'',input.actor??''])check(sanitizeText(value,this.secrets)===value,'ARCHIVE_PRIVATE_METADATA');
    const previous=this.row('SELECT * FROM records WHERE source_key=?',key);
    if(previous){check(previous.hash===contentHash&&previous.payload===json&&previous.body===body&&previous.kind===kind&&previous.route===input.route&&previous.actor===input.actor&&previous.occurred_at===input.occurredAt&&previous.source===source&&previous.audience===input.audience,'ARCHIVE_SOURCE_CONFLICT');
      return {id:String(previous.id),key,hash:contentHash,created:false};}
    const statement=this.db.prepare('INSERT INTO records(source_key,kind,route,actor,occurred_at,captured_at,source,audience,body,payload,hash) VALUES(?,?,?,?,?,?,?,?,?,?,?)');statement.setReadBigInts(true);
    const result=statement.run(key,kind,input.route,input.actor,input.occurredAt,this.now(),source,input.audience,body,json,contentHash);
    return {id:String(result.lastInsertRowid),key,hash:contentHash,created:true};
  }
  appendHostRecord(raw:HostArchiveRecord):ArchiveRecordRef{return freeze(this.transaction(()=>this.append(raw)));}
  range(after='0'):{after:string;through:string;counts:Readonly<Record<string,string>>}{
    this.guard();check(/^(0|[1-9][0-9]{0,18})$/.test(after)&&BigInt(after)<=9223372036854775807n,'ARCHIVE_WATERMARK_INVALID');
    this.db.exec('BEGIN');try{const through=String(this.row('SELECT coalesce(max(id),0) AS n FROM records')?.n??0n),statement=this.db.prepare('SELECT kind,count(*) AS n FROM records WHERE id>? AND id<=? GROUP BY kind ORDER BY kind');statement.setReadBigInts(true);
      check(BigInt(after)<=BigInt(through),'ARCHIVE_WATERMARK_INVALID');const counts=Object.fromEntries(statement.all(BigInt(after),BigInt(through)).map(row=>[String(row.kind),String(row.n)]));this.db.exec('COMMIT');return freeze({after,through,counts});
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  getCycle(id:string):CycleSnapshot|null{this.guard();const row=this.row('SELECT * FROM cycles WHERE id=?',identifier.parse(id));return row?cycleSnapshot(row):null;}
  createCycle(raw:{id:string;day:string;kind:'daily'|'manual'}):CycleSnapshot{
    const input=z.strictObject({id:identifier,day,kind:cycleKind}).parse(raw);
    check(input.kind==='daily'?input.id===`daily-${input.day}`:input.id.startsWith('manual-'),'ARCHIVE_CYCLE_ID_INVALID');
    check(Number.isFinite(Date.parse(input.day+'T00:00:00.000Z'))&&new Date(input.day+'T00:00:00.000Z').toISOString().slice(0,10)===input.day,'ARCHIVE_CYCLE_DAY_INVALID');
    return this.transaction(()=>{const existing=this.row('SELECT * FROM cycles WHERE id=?',input.id);if(existing){const snapshot=cycleSnapshot(existing);check(snapshot.day===input.day&&snapshot.kind===input.kind,'ARCHIVE_CYCLE_CONFLICT');return snapshot;}
      const time=this.now(),payload={...input,state:'waiting',attempts:0,started_at:time};
      this.db.prepare('INSERT INTO cycles(id,day,kind,state,updated_at,payload) VALUES(?,?,?,?,?,?)').run(input.id,input.day,input.kind,'waiting',time,JSON.stringify(payload));
      return cycleSnapshot(this.row('SELECT * FROM cycles WHERE id=?',input.id)!);});
  }
  transitionCycle(raw:{id:string;expectedToken:string;state:z.infer<typeof cycleState>;patch?:CyclePatch}):CycleSnapshot{
    const input=z.strictObject({id:identifier,expectedToken:hash,state:cycleState,patch:patchSchema.optional()}).parse(raw);
    return this.transaction(()=>{const row=this.row('SELECT * FROM cycles WHERE id=?',input.id);check(row,'ARCHIVE_CYCLE_MISSING');const before=cycleSnapshot(row);
      check(before.token===input.expectedToken,'ARCHIVE_CAS_CONFLICT');check(before.state!=='complete','ARCHIVE_CYCLE_COMPLETE');check(cycleKind.safeParse(before.kind).success,'ARCHIVE_LEGACY_CYCLE_UNSUPPORTED');
      const state=cycleState.safeParse(before.state);check(state.success&&transitions[state.data].includes(input.state),'ARCHIVE_CYCLE_TRANSITION');
      if(before.state==='failed')check(input.state===(before.payload.memoryDone===true?'archiving':'memory'),'ARCHIVE_CYCLE_TRANSITION');
      const patch=this.cleanObject(input.patch??{}),payload:Record<string,Json>={...before.payload,...patch,state:input.state};
      check(patch.memoryDone!==true||before.payload.memoryDone===true||input.state==='archiving','ARCHIVE_MAINTENANCE_ORDER');
      check(input.state==='complete'||!['commit','version','finished_at'].some(key=>Object.hasOwn(patch,key)),'ARCHIVE_COMMIT_ORDER');
      check(typeof payload.attempts==='number'&&Number.isSafeInteger(payload.attempts)&&payload.attempts>=Number(before.payload.attempts??0),'ARCHIVE_CYCLE_REGRESSION');
      check(patch.versionAttempt===undefined||typeof patch.versionAttempt==='number'&&patch.versionAttempt>=Number(before.payload.versionAttempt??0),'ARCHIVE_CYCLE_REGRESSION');
      check(before.payload.memoryDone!==true||payload.memoryDone===true,'ARCHIVE_CYCLE_REGRESSION');
      if(['archiving','writing_notes','committing','complete'].includes(input.state))check(payload.memoryDone===true&&objectValue(payload.maintenance).complete===true,'ARCHIVE_MAINTENANCE_INCOMPLETE');
      if(input.state==='committing'||input.state==='complete'){
        const versionId=typeof payload.versionId==='string'?payload.versionId:before.id,versionRow=this.row('SELECT * FROM versions WHERE id=? AND cycle_id=?',versionId,before.id);check(versionRow,'ARCHIVE_VERSION_MISSING');const version=versionSnapshot(versionRow);
        check(version.notes!==null&&['notes_ready','commit_prepared','committed'].includes(version.state),'ARCHIVE_NOTES_MISSING');
        if(input.state==='complete')check(version.state==='committed'&&version.commitHash!==null&&payload.commit===version.commitHash&&payload.version===version.id&&typeof payload.finished_at==='string','ARCHIVE_COMMIT_INCOMPLETE');
      }
      const time=this.now(before.updatedAt);this.db.prepare('UPDATE cycles SET state=?,updated_at=?,payload=? WHERE id=?').run(input.state,time,JSON.stringify(payload),before.id);
      return cycleSnapshot(this.row('SELECT * FROM cycles WHERE id=?',before.id)!);});
  }
  getVersion(id:string):VersionSnapshot|null{this.guard();const row=this.row('SELECT * FROM versions WHERE id=?',identifier.parse(id));return row?versionSnapshot(row):null;}
  prepareVersion(raw:PrepareArchiveVersion):VersionSnapshot{
    const input=prepareSchema.parse(raw),plan=this.cleanObject(input.plan);z.array(z.string().min(1).max(1000)).min(1).max(10000).parse(plan.evidenceRefs);
    return this.transaction(()=>{const cycleRow=this.row('SELECT * FROM cycles WHERE id=?',input.cycleId);check(cycleRow,'ARCHIVE_CYCLE_MISSING');const cycle=cycleSnapshot(cycleRow);
      check(cycle.token===input.expectedCycleToken,'ARCHIVE_CAS_CONFLICT');check(cycle.state==='writing_notes'&&cycle.payload.memoryDone===true&&objectValue(cycle.payload.maintenance).complete===true,'ARCHIVE_VERSION_PREPARATION_ORDER');
      check(input.id===(cycle.payload.versionId??cycle.id),'ARCHIVE_VERSION_ID_INVALID');
      const old=this.row('SELECT * FROM versions WHERE id=?',input.id);if(old){const existing=versionSnapshot(old);
        check(existing.cycleId===input.cycleId&&existing.baseCommit===input.baseCommit&&JSON.stringify(existing.plan)===JSON.stringify(plan)&&(!['prepared','notes_ready'].includes(existing.state)||existing.treeId===input.treeId),'ARCHIVE_VERSION_CONFLICT');return existing;}
      const through=watermark(plan.recordHighWatermark),current=this.row('SELECT coalesce(max(id),0) AS n FROM records')?.n??0n;
      check(typeof current==='bigint'||typeof current==='number','ARCHIVE_ROW_INVALID');
      check(through<=BigInt(current),'ARCHIVE_WATERMARK_INVALID');
      for(const row of this.db.prepare("SELECT plan FROM versions WHERE state='committed'").iterate()){
        const previous=objectValue(JSON.parse(String(row.plan)));check(through>=watermark(previous.recordHighWatermark??0),'ARCHIVE_WATERMARK_REGRESSION');
      }
      this.db.prepare('INSERT INTO versions(id,cycle_id,base_commit,tree_id,commit_hash,state,title,notes,plan,created_at) VALUES(?,?,?,?,NULL,\'prepared\',NULL,NULL,?,?)')
        .run(input.id,input.cycleId,input.baseCommit,input.treeId,JSON.stringify(plan),this.now());
      return versionSnapshot(this.row('SELECT * FROM versions WHERE id=?',input.id)!);});
  }
  private versionForUpdate(id:string,token:string,state:string):VersionSnapshot{
    const row=this.row('SELECT * FROM versions WHERE id=?',id);check(row,'ARCHIVE_VERSION_MISSING');const version=versionSnapshot(row);
    check(version.token===token,'ARCHIVE_CAS_CONFLICT');check(version.state!=='committed','ARCHIVE_VERSION_COMMITTED');check(version.state===state,'ARCHIVE_VERSION_TRANSITION');return version;
  }
  /** Caller must verify the referenced real Run; a reference persisted here is not an execution grant. */
  saveVersionNotes(raw:ArchiveVersionNotes):VersionSnapshot{
    const input=notesSchema.parse(raw);return this.transaction(()=>{const version=this.versionForUpdate(input.id,input.expectedToken,'prepared');
      const cycle=this.row('SELECT * FROM cycles WHERE id=?',version.cycleId);check(cycle&&cycle.state==='writing_notes','ARCHIVE_NOTES_ORDER');
      const allowed=z.array(z.string()).parse(version.plan.evidenceRefs);check(input.evidenceRefs.every(ref=>allowed.includes(ref)),'ARCHIVE_NOTES_EVIDENCE_INVALID');
      const title=sanitizeText(input.title,this.secrets),notes=sanitizeText(input.notes,this.secrets);
      this.append({id:`version-notes:${input.id}`,kind:'version-notes',route:null,actor:null,occurredAt:null,audience:'owner',source:{id:`${input.run.runId}:${input.run.closedEventId}`,hash:input.run.resultHash},
        payload:{type:'version-notes',data:{versionId:version.id,run:input.run,evidenceRefs:input.evidenceRefs,notesHash:digest(notes)}},text:title});
      this.db.prepare("UPDATE versions SET state='notes_ready',title=?,notes=? WHERE id=?").run(title,notes,input.id);
      return versionSnapshot(this.row('SELECT * FROM versions WHERE id=?',input.id)!);});
  }
  markCommitPrepared(raw:{id:string;expectedToken:string;treeId:string;commitHash:string}):VersionSnapshot{
    const input=z.strictObject({id:identifier,expectedToken:hash,treeId:gitHash,commitHash:gitHash}).parse(raw);
    return this.transaction(()=>{const version=this.versionForUpdate(input.id,input.expectedToken,'notes_ready');check(version.notes!==null,'ARCHIVE_NOTES_MISSING');
      const cycle=this.row('SELECT * FROM cycles WHERE id=?',version.cycleId);check(cycle&&cycle.state==='committing','ARCHIVE_COMMIT_ORDER');
      this.db.prepare("UPDATE versions SET state='commit_prepared',tree_id=?,commit_hash=? WHERE id=?").run(input.treeId,input.commitHash,input.id);
      return versionSnapshot(this.row('SELECT * FROM versions WHERE id=?',input.id)!);});
  }
  /** This stores the caller's verified Git CAS result; it never invokes Git or invents a commit. */
  markCommitted(raw:{id:string;expectedToken:string;commitHash:string}):VersionSnapshot{
    const input=z.strictObject({id:identifier,expectedToken:hash,commitHash:gitHash}).parse(raw);
    return this.transaction(()=>{const version=this.versionForUpdate(input.id,input.expectedToken,'commit_prepared');check(version.commitHash===input.commitHash&&version.notes!==null,'ARCHIVE_COMMIT_MISMATCH');
      const cycle=this.row('SELECT * FROM cycles WHERE id=?',version.cycleId);check(cycle&&cycle.state==='committing','ARCHIVE_COMMIT_ORDER');
      this.db.prepare("UPDATE versions SET state='committed' WHERE id=?").run(input.id);return versionSnapshot(this.row('SELECT * FROM versions WHERE id=?',input.id)!);});
  }
  close():void{if(this.closed)return;this.closed=true;this.db.close();}
}
export function openExistingArchive(location:ArchiveLocation,options:ExistingArchiveOptions):ExistingArchive{return ExistingArchive.openExisting(location,options);}
