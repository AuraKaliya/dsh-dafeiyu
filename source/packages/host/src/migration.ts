import { DatabaseSync, backup } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, realpathSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, readdir, copyFile, writeFile, rename } from 'node:fs/promises';
import { join, resolve, dirname, relative, isAbsolute, sep } from 'node:path';
import { z } from 'zod';
import { Journal } from '@dafeiyu/journal';
import { MemoryStore,MEMORY_SCHEMA_VERSION } from '@dafeiyu/memory/store';
import { RuntimeStore, RuntimeIdentitySchema,RUNTIME_SCHEMA_VERSION } from '@dafeiyu/core/runtime-store';
import type { RuntimeIdentity } from '@dafeiyu/core/runtime-store';
import { QqStore, QQ_SCHEMA_VERSION } from '@dafeiyu/qq';
import { ActivityStore,ACTIVITY_SCHEMA_VERSION } from '@dafeiyu/activity/store';
import { MediaStore,MEDIA_SCHEMA_VERSION } from '@dafeiyu/media';
import { BiliStore,BILI_SCHEMA_VERSION } from '@dafeiyu/bilibili';
import { ExecutorStore,EXECUTOR_SCHEMA_VERSION } from '@dafeiyu/server-executor/store';
import { BiliOwnerStore,BILI_OWNER_SCHEMA_VERSION,BiliOwnerIdentitySchema } from '@dafeiyu/bilibili/channel';
import { ExecutorFileSnapshotSchema,executorFilesSnapshot,executorSnapshotPath,copyExecutorSnapshot,verifyExecutorBackup } from './executor-snapshot.js';
import type { ExecutorFileSnapshot } from './executor-snapshot.js';
import { MediaFileSnapshotSchema,mediaFilesSnapshot,mediaSnapshotPath,copyMediaSnapshot,verifyMediaBackup } from './media-snapshot.js';
import type { MediaFileSnapshot } from './media-snapshot.js';
import { inspectStorage } from './storage-inspection.js';
import type { StorageKind, StorageInspection } from './storage-inspection.js';

export interface MigrationBundle { coreDir:string; memoryDir:string; sessionsDir:string; backupDir:string; identity:RuntimeIdentity; qqFiles?:readonly string[]|undefined;activity?:boolean|undefined;media?:boolean|undefined;bilibili?:boolean|undefined;executor?:boolean|undefined;biliOwner?:boolean|undefined;biliOwnerIdentity?:{accountUid:string;ownerUid:string}|undefined;
  provenance?:{sourceRevision:string;dirty:boolean;configHash:string}|undefined }
interface RowsSnapshot {table:string;hash:string;rows:number}
interface FilePlan {kind:StorageKind;file:string;before:StorageInspection;rows:RowsSnapshot[];targetVersion:number}
export interface MigrationPlan {schemaVersion:1;id:string;createdAt:string;engineHash:string;bundle:MigrationBundle;files:FilePlan[];sessions:{relative:string;hash:string}[];mediaFiles?:MediaFileSnapshot[]|undefined;executorFiles?:ExecutorFileSnapshot[]|undefined}
interface Manifest {plan:MigrationPlan;phase:'backed-up'|'applying'|'complete'|'failed';completed:string[];error:string|null}
const kindSchema=z.enum(['journal','memory','runtime','delivery','analysis','working','feedback','retrieval','qq','activity','media','bilibili','executor','bili-owner']);
const inspectionSchema=z.strictObject({kind:kindSchema,exists:z.boolean(),version:z.number().int().nonnegative(),applicationId:z.number().int().nonnegative(),supported:z.boolean(),activeOwner:z.boolean(),integrity:z.boolean(),identityMatches:z.boolean()});
const rowsSchema=z.strictObject({table:z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),hash:z.string().regex(/^[a-f0-9]{64}$/),rows:z.number().int().nonnegative()});
const bundleSchema=z.strictObject({coreDir:z.string().min(1),memoryDir:z.string().min(1),sessionsDir:z.string().min(1),backupDir:z.string().min(1),identity:RuntimeIdentitySchema,qqFiles:z.array(z.string().min(1)).max(20).optional(),activity:z.boolean().optional(),media:z.boolean().optional(),bilibili:z.boolean().optional(),executor:z.boolean().optional(),biliOwner:z.boolean().optional(),biliOwnerIdentity:BiliOwnerIdentitySchema.pick({accountUid:true,ownerUid:true}).optional(),
  provenance:z.strictObject({sourceRevision:z.string().min(1).max(80),dirty:z.boolean(),configHash:z.string().regex(/^[a-f0-9]{64}$/)}).optional()});
export const MigrationPlanSchema=z.strictObject({schemaVersion:z.literal(1),id:z.uuid(),createdAt:z.iso.datetime(),engineHash:z.string().regex(/^[a-f0-9]{64}$/),bundle:bundleSchema,
  files:z.array(z.strictObject({kind:kindSchema,file:z.string().min(1),before:inspectionSchema,rows:z.array(rowsSchema),targetVersion:z.number().int().nonnegative()})),
  sessions:z.array(z.strictObject({relative:z.string().min(1),hash:z.string().regex(/^[a-f0-9]{64}$/)})),mediaFiles:z.array(MediaFileSnapshotSchema).max(100000).optional(),executorFiles:z.array(ExecutorFileSnapshotSchema).max(100000).optional()});
const manifestSchema=z.strictObject({plan:MigrationPlanSchema,phase:z.enum(['backed-up','applying','complete','failed']),completed:z.array(z.string()),error:z.string().nullable()});
function currentEngineHash():string {
  const journal=fileURLToPath(import.meta.resolve('@dafeiyu/journal')),memory=fileURLToPath(import.meta.resolve('@dafeiyu/memory/store'));
  const contracts=fileURLToPath(import.meta.resolve('@dafeiyu/contracts'));
  const core=fileURLToPath(import.meta.resolve('@dafeiyu/core/runtime-store'));
  const qq=fileURLToPath(import.meta.resolve('@dafeiyu/qq'));
  const activity=fileURLToPath(import.meta.resolve('@dafeiyu/activity/store'));
  const media=fileURLToPath(import.meta.resolve('@dafeiyu/media/store'));
  const bili=fileURLToPath(import.meta.resolve('@dafeiyu/bilibili/store'));
  const executor=fileURLToPath(import.meta.resolve('@dafeiyu/server-executor/store'));
  const biliOwner=fileURLToPath(import.meta.resolve('@dafeiyu/bilibili/channel'));
  const files=[fileURLToPath(import.meta.url),
    ...[dirname(core),dirname(journal),dirname(memory),dirname(contracts),dirname(qq),dirname(activity),dirname(media),dirname(bili),dirname(executor),dirname(biliOwner),dirname(fileURLToPath(import.meta.url))].flatMap(directory=>readdirSync(directory).filter(name=>name.endsWith('.js')).sort().map(name=>join(directory,name)))];
  const hash=createHash('sha256');hash.update(JSON.stringify({node:process.versions.node,sqlite:process.versions.sqlite}));
  for(const file of files)hash.update(readFileSync(file));return hash.digest('hex');
}
const loadedEngineHash=currentEngineHash();
const ignoredTables=new Set(['ownership','runtime_ownership','memory_schema_migrations','journal_schema_migrations']);
const quote=(value:string)=>`"${value.replaceAll('"','""')}"`;
function concretePath(file:string):string {const absolute=resolve(file);if(existsSync(absolute))return realpathSync.native(absolute);const parent=dirname(absolute);return parent===absolute?absolute:join(concretePath(parent),relative(parent,absolute));}
function pathKey(file:string):string {const value=concretePath(file);return process.platform==='win32'?value.toLowerCase():value;}
function isWithin(file:string,directory:string):boolean {const value=relative(pathKey(directory),pathKey(file));return value===''||(!value.startsWith('..'+sep)&&value!=='..'&&!isAbsolute(value));}
async function fileHash(file:string):Promise<string>{const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
function stableRow(row:Record<string,unknown>):string{return JSON.stringify(row,(_key,value:unknown)=>typeof value==='bigint'?{bigint:value.toString()}:value instanceof Uint8Array?{bytes:Buffer.from(value).toString('base64')}:value);}
function rowsSnapshot(file:string,only?:readonly string[]):RowsSnapshot[]{
  if(!existsSync(file))return [];
  const db=new DatabaseSync(file,{readOnly:true});
  try{const tables=only??db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>String(row.name)).filter(name=>!ignoredTables.has(name));
    return tables.map(table=>{const hash=createHash('sha256');let rows=0;for(const row of db.prepare(`SELECT * FROM ${quote(table)} ORDER BY rowid`).iterate()){hash.update(stableRow(row));hash.update('\n');rows++;}return {table,hash:hash.digest('hex'),rows};});
  }finally{db.close();}
}
function assertRows(file:FilePlan):void {const current=rowsSnapshot(file.file,file.rows.map(row=>row.table));if(JSON.stringify(current)!==JSON.stringify(file.rows))throw new Error('MIGRATION_SOURCE_ROWS_CHANGED');}
function assertInspection(value:StorageInspection):void {if(!value.supported||!value.integrity||!value.identityMatches)throw new Error('MIGRATION_STORE_UNSUPPORTED');if(value.activeOwner)throw new Error('MIGRATION_ACTIVE_OWNER');}
function assertAgentBindings(files:readonly FilePlan[],agentId:string):void {
  for(const file of files){if(!file.before.exists||!['journal','memory'].includes(file.kind))continue;
    const db=new DatabaseSync(file.file,{readOnly:true});
    try{const ids=file.kind==='journal'
      ?db.prepare("SELECT DISTINCT json_extract(body,'$.agentId') AS agent FROM events").all().map(row=>row.agent)
      :db.prepare('SELECT DISTINCT agent_id AS agent FROM memory_items').all().map(row=>row.agent);
      const known=ids.filter((value):value is string=>typeof value==='string'&&value.length>0);
      if(known.length&&!known.includes(agentId))throw new Error('MIGRATION_AGENT_BINDING_MISMATCH');
    }finally{db.close();}
  }
}
async function sessionsSnapshot(directory:string):Promise<{relative:string;hash:string}[]>{
  if(!existsSync(directory))return [];
  const result:{relative:string;hash:string}[]=[];
  const visit=async(folder:string)=>{for(const entry of await readdir(folder,{withFileTypes:true})){const file=join(folder,entry.name);if(entry.isSymbolicLink())throw new Error('SESSION_LINK_UNSUPPORTED');if(entry.isDirectory())await visit(file);else if(entry.isFile()&&(entry.name.endsWith('.jsonl')||entry.name.endsWith('.jsonl.gz')))result.push({relative:relative(directory,file),hash:await fileHash(file)});}};
  await visit(directory);return result.sort((a,b)=>a.relative<b.relative?-1:a.relative>b.relative?1:0);
}

/** Plan captures metadata and row digests only; it neither constructs services nor changes source schemas. */
export async function planMigration(input:MigrationBundle):Promise<MigrationPlan>{
  const bundle:MigrationBundle={coreDir:concretePath(input.coreDir),memoryDir:concretePath(input.memoryDir),sessionsDir:concretePath(input.sessionsDir),backupDir:concretePath(input.backupDir),identity:RuntimeIdentitySchema.parse(input.identity),
    ...(input.qqFiles?{qqFiles:input.qqFiles.map(concretePath)}:{}),...(input.activity!==undefined?{activity:z.boolean().parse(input.activity)}:{}),...(input.media!==undefined?{media:z.boolean().parse(input.media)}:{}),...(input.bilibili!==undefined?{bilibili:z.boolean().parse(input.bilibili)}:{}),...(input.executor!==undefined?{executor:z.boolean().parse(input.executor)}:{}),...(input.biliOwner!==undefined?{biliOwner:z.boolean().parse(input.biliOwner)}:{}),...(input.biliOwnerIdentity?{biliOwnerIdentity:bundleSchema.shape.biliOwnerIdentity.parse(input.biliOwnerIdentity)}:{}),...(input.provenance?{provenance:bundleSchema.shape.provenance.parse(input.provenance)}:{})};
  if(isWithin(bundle.backupDir,bundle.sessionsDir))throw new Error('BACKUP_INSIDE_SESSION_SOURCE');
  const items:{kind:StorageKind;file:string;target?:number}[]=[{kind:'journal',file:join(bundle.coreDir,'journal.sqlite'),target:2},{kind:'memory',file:join(bundle.memoryDir,'memory.sqlite'),target:MEMORY_SCHEMA_VERSION},
    {kind:'runtime',file:join(bundle.coreDir,'runtime.sqlite'),target:RUNTIME_SCHEMA_VERSION},{kind:'delivery',file:join(bundle.coreDir,'delivery.sqlite')},
    ...(['analysis','working','feedback'] as const).map(kind=>({kind,file:join(bundle.memoryDir,kind+'.sqlite')})),...(bundle.qqFiles??[]).map(file=>({kind:'qq' as const,file,target:QQ_SCHEMA_VERSION}))];
  if(bundle.activity||existsSync(join(bundle.coreDir,'activity.sqlite')))items.push({kind:'activity',file:join(bundle.coreDir,'activity.sqlite'),target:ACTIVITY_SCHEMA_VERSION});
  if(bundle.media||existsSync(join(bundle.coreDir,'media.sqlite')))items.push({kind:'media',file:join(bundle.coreDir,'media.sqlite'),target:MEDIA_SCHEMA_VERSION});
  if(bundle.bilibili||existsSync(join(bundle.coreDir,'bilibili.sqlite')))items.push({kind:'bilibili',file:join(bundle.coreDir,'bilibili.sqlite'),target:BILI_SCHEMA_VERSION});
  if(bundle.executor||existsSync(join(bundle.coreDir,'executor.sqlite')))items.push({kind:'executor',file:join(bundle.coreDir,'executor.sqlite'),target:EXECUTOR_SCHEMA_VERSION});
  if(bundle.biliOwner||existsSync(join(bundle.coreDir,'bili-owner.sqlite')))items.push({kind:'bili-owner',file:join(bundle.coreDir,'bili-owner.sqlite'),target:BILI_OWNER_SCHEMA_VERSION});
  if(items.some(item=>item.kind==='executor')&&isWithin(bundle.backupDir,join(bundle.coreDir,'results')))throw new Error('BACKUP_INSIDE_EXECUTOR_SOURCE');
  if(items.some(item=>item.kind==='media')&&(isWithin(bundle.backupDir,join(bundle.coreDir,'media'))||isWithin(bundle.backupDir,join(bundle.coreDir,'media-analysis'))))throw new Error('BACKUP_INSIDE_MEDIA_SOURCE');
  if(new Set(items.map(item=>pathKey(item.file))).size!==items.length)throw new Error('ALIASED_DATABASE_PATH');
  const files:FilePlan[]=items.map(item=>{const before=inspectStorage(item.file,item.kind,bundle.identity);assertInspection(before);
    return {kind:item.kind,file:concretePath(item.file),before,rows:before.exists?rowsSnapshot(item.file):[],targetVersion:item.target??before.version};});
  if(!files.find(file=>file.kind==='journal')?.before.exists||!files.find(file=>file.kind==='memory')?.before.exists)throw new Error('LEGACY_BUNDLE_REQUIRED_USE_INIT_FOR_NEW_PROFILE');
  assertAgentBindings(files,bundle.identity.agentId);
  if(currentEngineHash()!==loadedEngineHash)throw new Error('MIGRATION_CODE_CHANGED');
  return {schemaVersion:1,id:randomUUID(),createdAt:new Date().toISOString(),engineHash:loadedEngineHash,bundle,files,sessions:await sessionsSnapshot(bundle.sessionsDir),...(items.some(item=>item.kind==='media')?{mediaFiles:await mediaFilesSnapshot(bundle.coreDir)}:{}),...(items.some(item=>item.kind==='executor')?{executorFiles:executorFilesSnapshot(bundle.coreDir)}:{})};
}
function samePlan(a:MigrationPlan,b:MigrationPlan):boolean{return JSON.stringify(a)===JSON.stringify(b);}
async function saveManifest(file:string,value:Manifest):Promise<void>{const temp=file+'.tmp';await writeFile(temp,JSON.stringify(value,null,2)+'\n');await rename(temp,file);}
async function saveMarker(file:string,value:{id:string;complete:boolean;manifest:string}):Promise<void>{const temp=file+'.tmp';await writeFile(temp,JSON.stringify(value)+'\n');await rename(temp,file);}
function checkPlan(plan:MigrationPlan):void {
  z.literal(1).parse(plan.schemaVersion);z.uuid().parse(plan.id);RuntimeIdentitySchema.parse(plan.bundle.identity);
  if([plan.bundle.coreDir,plan.bundle.memoryDir,plan.bundle.sessionsDir,plan.bundle.backupDir].some(path=>concretePath(path)!==path))throw new Error('MIGRATION_PATH_CHANGED');
  if(isWithin(plan.bundle.backupDir,plan.bundle.sessionsDir))throw new Error('BACKUP_INSIDE_SESSION_SOURCE');
  if(plan.files.some(file=>concretePath(file.file)!==file.file))throw new Error('MIGRATION_PATH_CHANGED');
  const expected=new Map<string,StorageKind>([[pathKey(join(plan.bundle.coreDir,'journal.sqlite')),'journal'],[pathKey(join(plan.bundle.coreDir,'runtime.sqlite')),'runtime'],[pathKey(join(plan.bundle.coreDir,'delivery.sqlite')),'delivery'],
    [pathKey(join(plan.bundle.memoryDir,'memory.sqlite')),'memory'],...(['analysis','working','feedback'] as const).map(kind=>[pathKey(join(plan.bundle.memoryDir,kind+'.sqlite')),kind] as const),...(plan.bundle.qqFiles??[]).map(file=>[pathKey(file),'qq'] as const)]);
  if(plan.bundle.activity||existsSync(join(plan.bundle.coreDir,'activity.sqlite')))expected.set(pathKey(join(plan.bundle.coreDir,'activity.sqlite')),'activity');
  if(plan.bundle.media||existsSync(join(plan.bundle.coreDir,'media.sqlite')))expected.set(pathKey(join(plan.bundle.coreDir,'media.sqlite')),'media');
  if(plan.bundle.bilibili||existsSync(join(plan.bundle.coreDir,'bilibili.sqlite')))expected.set(pathKey(join(plan.bundle.coreDir,'bilibili.sqlite')),'bilibili');
  if(plan.bundle.executor||existsSync(join(plan.bundle.coreDir,'executor.sqlite')))expected.set(pathKey(join(plan.bundle.coreDir,'executor.sqlite')),'executor');
  if(plan.bundle.biliOwner||existsSync(join(plan.bundle.coreDir,'bili-owner.sqlite')))expected.set(pathKey(join(plan.bundle.coreDir,'bili-owner.sqlite')),'bili-owner');
  if(plan.files.length!==expected.size||plan.files.some(file=>expected.get(pathKey(file.file))!==file.kind))throw new Error('MIGRATION_PLAN_PATH_MISMATCH');
  if(!plan.files.find(file=>file.kind==='journal')?.before.exists||!plan.files.find(file=>file.kind==='memory')?.before.exists)throw new Error('LEGACY_BUNDLE_REQUIRED_USE_INIT_FOR_NEW_PROFILE');
  if(new Set(plan.files.map(file=>pathKey(file.file))).size!==plan.files.length)throw new Error('ALIASED_DATABASE_PATH');
  for(const file of plan.files){const target=file.kind==='journal'?2:file.kind==='memory'?MEMORY_SCHEMA_VERSION:file.kind==='runtime'?RUNTIME_SCHEMA_VERSION:file.kind==='qq'?QQ_SCHEMA_VERSION:file.kind==='activity'?ACTIVITY_SCHEMA_VERSION:file.kind==='media'?MEDIA_SCHEMA_VERSION:file.kind==='bilibili'?BILI_SCHEMA_VERSION:file.kind==='executor'?EXECUTOR_SCHEMA_VERSION:file.kind==='bili-owner'?BILI_OWNER_SCHEMA_VERSION:file.before.version;
    if(file.before.kind!==file.kind||file.targetVersion!==target||new Set(file.rows.map(row=>row.table)).size!==file.rows.length)throw new Error('MIGRATION_PLAN_SCHEMA_MISMATCH');assertInspection(file.before);}
  if(plan.sessions.some(item=>isAbsolute(item.relative)||!isWithin(join(plan.bundle.sessionsDir,item.relative),plan.bundle.sessionsDir)))throw new Error('MIGRATION_SESSION_PATH_ESCAPE');
  if(plan.files.some(file=>file.kind==='media')&&plan.mediaFiles===undefined)throw new Error('MIGRATION_MEDIA_SNAPSHOT_REQUIRED');
  for(const file of plan.mediaFiles??[])mediaSnapshotPath(plan.bundle.coreDir,file.relative);
  if(new Set(plan.mediaFiles?.map(file=>file.relative)).size!==(plan.mediaFiles?.length??0))throw new Error('MIGRATION_MEDIA_DUPLICATE');
  if(plan.mediaFiles&&(isWithin(plan.bundle.backupDir,join(plan.bundle.coreDir,'media'))||isWithin(plan.bundle.backupDir,join(plan.bundle.coreDir,'media-analysis'))))throw new Error('BACKUP_INSIDE_MEDIA_SOURCE');
  if(plan.files.some(file=>file.kind==='executor')!==(plan.executorFiles!==undefined))throw new Error('MIGRATION_EXECUTOR_SNAPSHOT_REQUIRED');
  for(const file of plan.executorFiles??[])executorSnapshotPath(plan.bundle.coreDir,file.relative);
  if(new Set(plan.executorFiles?.map(file=>file.relative)).size!==(plan.executorFiles?.length??0))throw new Error('MIGRATION_EXECUTOR_DUPLICATE');
  if(plan.executorFiles&&isWithin(plan.bundle.backupDir,join(plan.bundle.coreDir,'results')))throw new Error('BACKUP_INSIDE_EXECUTOR_SOURCE');
}

/** Applies only closed fictional/explicitly selected local bundles. No automatic rollback overwrites newer data. */
export async function applyMigration(rawPlan:MigrationPlan,options:{afterStep?:(kind:StorageKind)=>void}={}):Promise<{manifest:string;complete:boolean}>{
  const plan:MigrationPlan=MigrationPlanSchema.parse(rawPlan);
  checkPlan(plan);
  if(!existsSync(join(plan.bundle.coreDir,'journal.sqlite'))||!existsSync(join(plan.bundle.memoryDir,'memory.sqlite')))throw new Error('MIGRATION_SOURCE_CHANGED');
  const lease=new Journal(join(plan.bundle.coreDir,'migration-lock.sqlite'));
  try{return await applyLocked(plan,options);}finally{lease.close();}
}
async function applyLocked(plan:MigrationPlan,options:{afterStep?:(kind:StorageKind)=>void}):Promise<{manifest:string;complete:boolean}>{
  checkPlan(plan);const destination=join(plan.bundle.backupDir,plan.id),file=join(destination,'manifest.json'),marker=join(plan.bundle.coreDir,'migration-state.json');
  let manifest:Manifest|undefined;
  if(existsSync(file)){manifest=manifestSchema.parse(JSON.parse(await readFile(file,'utf8')));if(!samePlan(manifest.plan,plan)||manifest.completed.some(value=>!plan.files.some(item=>item.file===value)))throw new Error('MIGRATION_PLAN_CHANGED');}
  if(manifest?.phase==='complete'){if(!verifyMigration(plan).passed)throw new Error('MIGRATION_COMPLETION_MISMATCH');await saveMarker(marker,{id:plan.id,complete:true,manifest:file});return {manifest:file,complete:true};}
  if(plan.engineHash!==loadedEngineHash||currentEngineHash()!==loadedEngineHash)throw new Error('MIGRATION_CODE_CHANGED');
  assertAgentBindings(plan.files,plan.bundle.identity.agentId);
  if(existsSync(marker)){const old=z.strictObject({id:z.uuid(),complete:z.boolean(),manifest:z.string()}).parse(JSON.parse(await readFile(marker,'utf8')));if(!old.complete&&old.id!==plan.id)throw new Error('ANOTHER_MIGRATION_INCOMPLETE');}
  for(const item of plan.files){const current=inspectStorage(item.file,item.kind,plan.bundle.identity);assertInspection(current);
    if(item.before.exists){if(!current.exists||current.version<item.before.version||current.version>item.targetVersion||!manifest&&current.version!==item.before.version)throw new Error('MIGRATION_SOURCE_CHANGED');assertRows(item);
      if(!manifest&&JSON.stringify(rowsSnapshot(item.file))!==JSON.stringify(item.rows))throw new Error('MIGRATION_SNAPSHOT_INCOMPLETE');}
    else if(current.exists&&!(manifest&&((item.kind==='runtime'&&current.version===RUNTIME_SCHEMA_VERSION&&rowsSnapshot(item.file).filter(row=>!['runtime_metadata'].includes(row.table)).every(row=>row.rows===0))||
      (item.kind==='activity'&&current.version===ACTIVITY_SCHEMA_VERSION&&rowsSnapshot(item.file).filter(row=>!['activity_metadata','activity_clock'].includes(row.table)).every(row=>row.rows===0))||
      (item.kind==='media'&&current.version===MEDIA_SCHEMA_VERSION&&rowsSnapshot(item.file).filter(row=>row.table!=='media_metadata').every(row=>row.rows===0))||
      (item.kind==='bilibili'&&current.version===BILI_SCHEMA_VERSION&&rowsSnapshot(item.file).filter(row=>!['bili_metadata','bili_clock'].includes(row.table)).every(row=>row.rows===0))||
      (item.kind==='executor'&&current.version===EXECUTOR_SCHEMA_VERSION&&rowsSnapshot(item.file).filter(row=>!['executor_metadata','executor_clock'].includes(row.table)).every(row=>row.rows===0))||
      (item.kind==='bili-owner'&&current.version===BILI_OWNER_SCHEMA_VERSION&&rowsSnapshot(item.file).filter(row=>!['bili_owner_binding','bili_owner_poll'].includes(row.table)).every(row=>row.rows===0)))))throw new Error('MIGRATION_SOURCE_APPEARED');}
  const sessions=await sessionsSnapshot(plan.bundle.sessionsDir);if(JSON.stringify(sessions)!==JSON.stringify(plan.sessions))throw new Error('MIGRATION_SESSION_CHANGED');
  if(plan.mediaFiles&&JSON.stringify(await mediaFilesSnapshot(plan.bundle.coreDir))!==JSON.stringify(plan.mediaFiles))throw new Error('MIGRATION_MEDIA_CHANGED');
  if(plan.executorFiles&&JSON.stringify(executorFilesSnapshot(plan.bundle.coreDir))!==JSON.stringify(plan.executorFiles))throw new Error('MIGRATION_EXECUTOR_CHANGED');
  if(!manifest){
    if(existsSync(destination))throw new Error('MIGRATION_BACKUP_ALREADY_EXISTS');await mkdir(destination,{recursive:true});
    for(const [index,item]of plan.files.entries())if(item.before.exists){const source=new DatabaseSync(item.file,{readOnly:true});try{await backup(source,join(destination,`${index}-${item.kind}.sqlite`));}finally{source.close();}}
    for(const session of plan.sessions){const target=join(destination,'sessions',session.relative);await mkdir(dirname(target),{recursive:true});await copyFile(join(plan.bundle.sessionsDir,session.relative),target);}
    if(plan.mediaFiles)await copyMediaSnapshot(plan.bundle.coreDir,join(destination,'media-files'),plan.mediaFiles);
    if(plan.executorFiles)copyExecutorSnapshot(plan.bundle.coreDir,join(destination,'executor-files'),plan.executorFiles);
    manifest={plan,phase:'backed-up',completed:[],error:null};await saveManifest(file,manifest);
  }
  for(const [index,item]of plan.files.entries())if(item.before.exists){const stored=join(destination,`${index}-${item.kind}.sqlite`);
    if(!existsSync(stored)||JSON.stringify(rowsSnapshot(stored))!==JSON.stringify(item.rows))throw new Error('MIGRATION_BACKUP_INVALID');}
  for(const session of plan.sessions)if(await fileHash(join(destination,'sessions',session.relative))!==session.hash)throw new Error('MIGRATION_BACKUP_INVALID');
  if(plan.mediaFiles)await verifyMediaBackup(join(destination,'media-files'),plan.mediaFiles);
  if(plan.executorFiles)verifyExecutorBackup(join(destination,'executor-files'),plan.executorFiles);
  await saveMarker(marker,{id:plan.id,complete:false,manifest:file});
  manifest.phase='applying';manifest.error=null;await saveManifest(file,manifest);
  try{
    for(const item of plan.files){
      if(manifest.completed.includes(item.file))continue;
      if(currentEngineHash()!==loadedEngineHash)throw new Error('MIGRATION_CODE_CHANGED');
      const current=inspectStorage(item.file,item.kind,plan.bundle.identity);assertInspection(current);
      if(item.kind==='journal'){const store=new Journal(item.file);store.close();}
      else if(item.kind==='memory'){const store=new MemoryStore(item.file);store.close();}
      else if(item.kind==='runtime'){const store=new RuntimeStore(item.file,plan.bundle.identity,{create:true,migrate:true});store.close();}
      else if(item.kind==='qq'&&item.before.exists){const store=new QqStore(item.file,{migrate:true});store.close();}
      else if(item.kind==='activity'){const store=new ActivityStore(item.file,plan.bundle.identity,{},true);store.close();}
      else if(item.kind==='media'){const store=new MediaStore(item.file,plan.bundle.identity,true,true);store.close();}
      else if(item.kind==='bilibili'){new BiliStore(item.file,plan.bundle.identity,true).close();}
      // Existing v1 executor evidence is already current; no configureSqlite or recovery writes are needed.
      else if(item.kind==='executor'&&!current.exists){new ExecutorStore(item.file,plan.bundle.identity,true).close();}
      // Schema only. Handover/import is a separate trusted operation after the migration manifest is bound.
      else if(item.kind==='bili-owner'&&!current.exists){if(!plan.bundle.biliOwnerIdentity)throw new Error('HOST_BILI_OWNER_IDENTITY_REQUIRED');new BiliOwnerStore(item.file,{...plan.bundle.identity,...plan.bundle.biliOwnerIdentity},true).close();}
      const after=inspectStorage(item.file,item.kind,plan.bundle.identity);assertInspection(after);
      if((item.before.exists||item.kind==='runtime'||item.kind==='activity'||item.kind==='media'||item.kind==='bilibili'||item.kind==='executor'||item.kind==='bili-owner')&&after.version!==item.targetVersion)throw new Error('MIGRATION_TARGET_VERSION');
      if(item.before.exists)assertRows(item);
      manifest.completed.push(item.file);await saveManifest(file,manifest);options.afterStep?.(item.kind);
    }
    if(currentEngineHash()!==loadedEngineHash)throw new Error('MIGRATION_CODE_CHANGED');
    if(JSON.stringify(await sessionsSnapshot(plan.bundle.sessionsDir))!==JSON.stringify(plan.sessions))throw new Error('MIGRATION_SESSION_CHANGED');
    if(plan.mediaFiles&&JSON.stringify(await mediaFilesSnapshot(plan.bundle.coreDir))!==JSON.stringify(plan.mediaFiles))throw new Error('MIGRATION_MEDIA_CHANGED');
    if(plan.executorFiles&&JSON.stringify(executorFilesSnapshot(plan.bundle.coreDir))!==JSON.stringify(plan.executorFiles))throw new Error('MIGRATION_EXECUTOR_CHANGED');
    manifest.phase='complete';await saveManifest(file,manifest);await saveMarker(marker,{id:plan.id,complete:true,manifest:file});return {manifest:file,complete:true};
  }catch{manifest.phase='failed';manifest.error='MIGRATION_APPLY_FAILED';await saveManifest(file,manifest);throw new Error('MIGRATION_APPLY_FAILED_BACKUP_RETAINED');}
}

export function verifyMigration(plan:MigrationPlan):{passed:boolean;stores:StorageInspection[];executorEvidencePreserved?:boolean;biliOwnerEvidencePreserved?:boolean} {
  plan=MigrationPlanSchema.parse(plan);checkPlan(plan);const stores=plan.files.map(item=>inspectStorage(item.file,item.kind,plan.bundle.identity));
  let executorPreserved=true;
  if(plan.executorFiles){try{
    if(JSON.stringify(executorFilesSnapshot(plan.bundle.coreDir))!==JSON.stringify(plan.executorFiles))throw new Error('MIGRATION_EXECUTOR_CHANGED');
    const destination=join(plan.bundle.backupDir,plan.id);verifyExecutorBackup(join(destination,'executor-files'),plan.executorFiles);
    for(const [index,item]of plan.files.entries())if(item.kind==='executor'&&item.before.exists){assertRows(item);const stored=join(destination,`${index}-executor.sqlite`);
      assertInspection(inspectStorage(stored,'executor',plan.bundle.identity));if(!existsSync(stored)||JSON.stringify(rowsSnapshot(stored))!==JSON.stringify(item.rows))throw new Error('MIGRATION_EXECUTOR_BACKUP_INVALID');}
  }catch{executorPreserved=false;}}
  const hasBiliOwner=plan.files.some(item=>item.kind==='bili-owner');let biliOwnerPreserved=true;
  if(hasBiliOwner){try{const destination=join(plan.bundle.backupDir,plan.id);
    for(const [index,item]of plan.files.entries())if(item.before.exists){assertRows(item);const stored=join(destination,`${index}-${item.kind}.sqlite`),inspection=inspectStorage(stored,item.kind,plan.bundle.identity);
      if(!inspection.exists||!inspection.supported||!inspection.integrity||!inspection.identityMatches||JSON.stringify(rowsSnapshot(stored))!==JSON.stringify(item.rows))throw new Error('MIGRATION_BILI_OWNER_BACKUP_INVALID');}
  }catch{biliOwnerPreserved=false;}}
  const passed=executorPreserved&&biliOwnerPreserved&&stores.every((value,index)=>value.supported&&value.integrity&&value.identityMatches&&!value.activeOwner
    &&(plan.files[index]!.before.exists||value.kind==='runtime'||value.kind==='activity'||value.kind==='media'||value.kind==='bilibili'||value.kind==='executor'||value.kind==='bili-owner'?value.exists&&value.version===plan.files[index]!.targetVersion:true));
  return {passed,stores,...(plan.executorFiles?{executorEvidencePreserved:executorPreserved}:{}),...(hasBiliOwner?{biliOwnerEvidencePreserved:biliOwnerPreserved}:{})};
}
