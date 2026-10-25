import { existsSync,readFileSync,readdirSync,mkdirSync,writeFileSync,renameSync,statSync } from 'node:fs';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { initializeCoreStorage } from '@dafeiyu/core';
import { RUNTIME_SCHEMA_VERSION } from '@dafeiyu/core/runtime-store';
import { initializeMemoryStorage } from '@dafeiyu/memory';
import { QqStore, QQ_SCHEMA_VERSION } from '@dafeiyu/channel-qq';
import { ActivityStore,ACTIVITY_SCHEMA_VERSION } from '@dafeiyu/activity/store';
import { MediaStore,MEDIA_SCHEMA_VERSION } from '@dafeiyu/media';
import { inspectStorage } from './storage-inspection.js';
import type { StorageKind,StorageInspection } from './storage-inspection.js';
import { claim,conflict } from './coordination.js';
import { assertPaths,pluginConfig } from './configuration.js';
import type { PreparedHostConfig } from './configuration.js';
import { pathIdentity,physicalPath,within } from './paths.js';

export const ProfileManifestSchema=z.strictObject({schemaVersion:z.literal(1),profileId:z.string(),agentId:z.string(),id:z.uuid(),state:z.enum(['initializing','initialized','failed']),createdAt:z.iso.datetime(),
  paths:z.record(z.string(),z.string()),requiredStores:z.array(z.string()),mode:z.enum(['init','migrated'])});
export type ProfileManifest=z.infer<typeof ProfileManifestSchema>;
export interface HostInspection {readonly schemaVersion:1;readonly profileId:string;readonly agentId:string;readonly configHash:string;readonly foundationHash:string;
  readonly ready:boolean;readonly canInitialize:boolean;readonly codes:readonly string[];readonly occupied:boolean;
  readonly stores:readonly (StorageInspection&{name:string})[];readonly plugins:readonly {id:string;enabled:boolean;required:boolean;version:string|null;state:'configured'|'disabled'}[];readonly order:readonly string[]}
const target:Partial<Record<StorageKind,number>>={journal:2,memory:11,runtime:RUNTIME_SCHEMA_VERSION,activity:ACTIVITY_SCHEMA_VERSION,media:MEDIA_SCHEMA_VERSION,delivery:1,analysis:1,working:1,feedback:1,qq:QQ_SCHEMA_VERSION,query:8,retrieval:2};
export function layoutPaths(config:PreparedHostConfig){return Object.fromEntries(config.resources.map((resource,index)=>[String(index),resource.identity]));}
export const manifestFile=(config:PreparedHostConfig)=>join(config.paths.core,'host-profile.json');
export function readManifest(config:PreparedHostConfig):ProfileManifest|null{if(!existsSync(manifestFile(config)))return null;
  try{const value=ProfileManifestSchema.parse(JSON.parse(readFileSync(manifestFile(config),'utf8')));if(value.profileId!==config.config.profileId||value.agentId!==config.config.agent.id||JSON.stringify(value.paths)!==JSON.stringify(layoutPaths(config)))throw new Error('HOST_PROFILE_IDENTITY_MISMATCH');return value;}
  catch(error){if(error instanceof Error&&error.message==='HOST_PROFILE_IDENTITY_MISMATCH')throw error;throw new Error('HOST_PROFILE_MANIFEST_INVALID');}}
export function writeManifest(config:PreparedHostConfig,value:ProfileManifest){const file=manifestFile(config),temp=file+'.'+randomUUID()+'.tmp';writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{flag:'wx'});renameSync(temp,file);}
export function storageFiles(config:PreparedHostConfig){return [
  {name:'journal',kind:'journal' as const,file:join(config.paths.core,'journal.sqlite')},
  {name:'runtime',kind:'runtime' as const,file:join(config.paths.core,'runtime.sqlite')},
  {name:'delivery',kind:'delivery' as const,file:join(config.paths.core,'delivery.sqlite')},
  {name:'activity',kind:'activity' as const,file:join(config.paths.core,'activity.sqlite')},
  {name:'media',kind:'media' as const,file:join(config.paths.core,'media.sqlite')},
  ...(['memory','analysis','working','feedback','retrieval'] as const).map(kind=>({name:kind,kind,file:join(config.paths.memory,kind+'.sqlite')})),
  ...Object.entries(config.paths.channels).map(([id,directory])=>({name:id,kind:'qq' as const,file:join(directory,'qq.sqlite')})),
  {name:'query',kind:'query' as const,file:config.paths.query}];}
const packages:Record<string,string>={core:'@dafeiyu/core',memory:'@dafeiyu/memory',activity:'@dafeiyu/activity',media:'@dafeiyu/media',timeline:'@dafeiyu/timeline','channel-qq':'@dafeiyu/channel-qq','channel-simulator':'@dafeiyu/channel-simulator','model-deepseek':'@deepseek-ai/dsh-llm-deepseek-api-key','model-scripted':'@deepseek-ai/dsh-llm'};
const versions:Record<string,string>={core:'0.15.0',memory:'0.15.0',activity:'0.1.0',media:'0.1.0',timeline:'0.8.0','channel-qq':'0.3.0','channel-simulator':'0.4.0','model-deepseek':'0.2.1-rc.2','model-scripted':'0.2.1-rc.2'};
export function packageVersion(id:string):string|null{try{const name=packages[id];if(!name)return null;let directory=dirname(fileURLToPath(import.meta.resolve(name)));
    for(let i=0;i<5;i++){const file=join(directory,'package.json');if(existsSync(file)){const body=z.object({name:z.string(),version:z.string()}).parse(JSON.parse(readFileSync(file,'utf8')));if(body.name===name)return body.version;}directory=dirname(directory);}return null;}catch{return null;}}
function empty(config:PreparedHostConfig){return config.resources.every(item=>!existsSync(item.path)||item.kind==='directory'&&readdirSync(item.path).length===0);}
function migrated(config:PreparedHostConfig):boolean{const file=join(config.paths.core,'migration-state.json');if(!existsSync(file))return false;
  try{const marker=z.object({complete:z.boolean(),manifest:z.string()}).parse(JSON.parse(readFileSync(file,'utf8')));if(!marker.complete)throw new Error('HOST_MIGRATION_INCOMPLETE');
    const manifest=z.object({phase:z.literal('complete'),plan:z.object({bundle:z.object({coreDir:z.string(),memoryDir:z.string(),sessionsDir:z.string(),identity:z.object({profileId:z.string(),agentId:z.string()})})})}).parse(JSON.parse(readFileSync(marker.manifest,'utf8'))),bundle=manifest.plan.bundle;
    return pathIdentity(bundle.coreDir)===pathIdentity(config.paths.core)&&pathIdentity(bundle.memoryDir)===pathIdentity(config.paths.memory)&&pathIdentity(bundle.sessionsDir)===pathIdentity(config.paths.sessions)&&bundle.identity.profileId===config.config.profileId&&bundle.identity.agentId===config.config.agent.id;
  }catch(error){if(error instanceof Error&&error.message==='HOST_MIGRATION_INCOMPLETE')throw error;throw new Error('HOST_MIGRATION_PROOF_INVALID');}}
export function inspectHost(config:PreparedHostConfig,coordination?:string,ownInstanceId?:string):HostInspection{
  assertPaths(config);const codes:string[]=[],identity={agentId:config.config.agent.id,profileId:config.config.profileId};let occupied=false,manifest:ProfileManifest|null=null,hasMigration=false;
  try{const found=conflict(config.resources,coordination);occupied=!!found&&found.instanceId!==ownInstanceId;if(occupied)codes.push('HOST_ALREADY_OWNED');}catch{codes.push('HOST_COORDINATION_UNAVAILABLE');}
  try{manifest=readManifest(config);hasMigration=migrated(config);if(manifest&&manifest.state!=='initialized')codes.push('HOST_INITIALIZATION_INCOMPLETE');}catch(error){codes.push(error instanceof Error?error.message:'HOST_PROFILE_MANIFEST_INVALID');}
  if(pluginConfig(config,'activity')&&manifest&&!manifest.requiredStores.includes('activity')&&!activityMigrated(config))codes.push('HOST_MIGRATION_REQUIRED');
  if(pluginConfig(config,'media')&&manifest&&!manifest.requiredStores.includes('media')&&!mediaMigrated(config))codes.push('HOST_MIGRATION_REQUIRED');
  const stores=storageFiles(config).map(item=>{
    const concrete=physicalPath(item.file);if(concrete!==item.file&&!within(concrete,dirname(item.file)))codes.push('HOST_STORAGE_PATH_CHANGED');
    const inspection=inspectStorage(item.file,item.kind,identity);
    if(inspection.activeOwner){codes.push('HOST_STORE_OWNED');occupied=true;}if(!inspection.supported||!inspection.integrity)codes.push('HOST_STORAGE_UNSUPPORTED');if(!inspection.identityMatches)codes.push('HOST_PROFILE_IDENTITY_MISMATCH');
    if(inspection.exists&&target[item.kind]!==undefined&&inspection.version!==target[item.kind])codes.push('HOST_MIGRATION_REQUIRED');
    if(!inspection.exists&&(manifest?.requiredStores.includes(item.name)||['journal','runtime'].includes(item.kind)||item.kind==='memory'&&config.plugins.some(p=>p.id==='memory'&&p.enabled)))codes.push('HOST_INITIALIZATION_REQUIRED');
    if(!inspection.exists&&item.kind==='activity'&&pluginConfig(config,'activity'))codes.push(manifest?'HOST_MIGRATION_REQUIRED':'HOST_INITIALIZATION_REQUIRED');
    if(!inspection.exists&&item.kind==='media'&&pluginConfig(config,'media'))codes.push(manifest?'HOST_MIGRATION_REQUIRED':'HOST_INITIALIZATION_REQUIRED');
    if(inspection.exists&&inspection.supported&&['memory','journal'].includes(item.kind)){
      const db=new DatabaseSync(item.file,{readOnly:true});try{const sql=item.kind==='memory'?'SELECT DISTINCT agent_id AS id FROM memory_items':"SELECT DISTINCT json_extract(body,'$.agentId') AS id FROM events";
        if(db.prepare(sql).all().some(row=>row.id!==identity.agentId))codes.push('HOST_AGENT_BINDING_MISMATCH');}finally{db.close();}}
    return {name:item.name,...inspection};});
  if(!manifest&&!hasMigration)codes.push('HOST_INITIALIZATION_REQUIRED');
  const model=pluginConfig(config,'model-deepseek');if(model&&(!existsSync(model.credentialStore)||!statSync(model.credentialStore).isFile()))codes.push('HOST_CREDENTIAL_FILE_MISSING');
  const media=pluginConfig(config,'media');if(media){const files=[media.ffmpeg,media.ffprobe,...(media.documents?[media.documents.python]:[]),...(media.tts?[media.tts.powershell]:[]),...(media.audio?.whisper?[media.audio.whisper.node,join(media.audio.whisper.moduleDirectory,'package.json'),media.audio.whisper.model.path]:[]),...(media.audio?.events?[media.audio.events.python,media.audio.events.model.path,media.audio.events.labels.path]:[])];
    if(files.some(file=>!existsSync(file)||!statSync(file).isFile()))codes.push('HOST_MEDIA_DEPENDENCY_MISSING');}
  const plugins=config.plugins.map(p=>{const version=packageVersion(p.id);if(p.enabled&&!version)codes.push('HOST_PACKAGE_UNAVAILABLE');else if(p.enabled&&version!==versions[p.id])codes.push('HOST_PACKAGE_VERSION_MISMATCH');return {id:p.id,enabled:p.enabled,required:p.required,version,state:p.enabled?'configured' as const:'disabled' as const};});
  const [major,minor]=process.versions.node.split('.').map(Number);if(major!==24||minor!<13)codes.push('HOST_NODE_VERSION_UNSUPPORTED');
  return {schemaVersion:1,...identity,configHash:config.hash,foundationHash:config.foundation.hash,ready:codes.length===0,canInitialize:!occupied&&empty(config),codes:[...new Set(codes)],occupied,stores,plugins,order:config.order};
}
export function initializeProfile(config:PreparedHostConfig,coordination?:string):HostInspection{
  assertPaths(config);if(!empty(config))throw new Error('HOST_INIT_REQUIRES_EMPTY_DIRECTORIES');
  const lease=claim(config.resources,{profileId:config.config.profileId,agentId:config.config.agent.id},coordination);
  let manifest:ProfileManifest|undefined;
  try{assertPaths(config);if(!empty(config))throw new Error('HOST_INIT_REQUIRES_EMPTY_DIRECTORIES');for(const item of config.resources)mkdirSync(item.kind==='directory'?item.path:dirname(item.path),{recursive:true});
    manifest={schemaVersion:1,profileId:config.config.profileId,agentId:config.config.agent.id,id:randomUUID(),state:'initializing',createdAt:new Date().toISOString(),paths:layoutPaths(config),requiredStores:storageFiles(config).filter(item=>!['query','retrieval'].includes(item.kind)&&(item.kind!=='activity'||!!pluginConfig(config,'activity'))&&(item.kind!=='media'||!!pluginConfig(config,'media'))).map(item=>item.name),mode:'init'};writeManifest(config,manifest);
    initializeCoreStorage(config.paths.core,config.config.agent.id,config.config.profileId);initializeMemoryStorage(config.paths.memory);
    const activity=pluginConfig(config,'activity');if(activity){const store=new ActivityStore(join(config.paths.core,'activity.sqlite'),{agentId:config.config.agent.id,profileId:config.config.profileId},activity,true);store.close();}
    if(pluginConfig(config,'media'))new MediaStore(join(config.paths.core,'media.sqlite'),{agentId:config.config.agent.id,profileId:config.config.profileId},true).close();
    for(const directory of Object.values(config.paths.channels)){const qq=new QqStore(join(directory,'qq.sqlite'));qq.close();}
    manifest={...manifest,state:'initialized'};writeManifest(config,manifest);
  }catch(error){if(manifest)writeManifest(config,{...manifest,state:'failed'});throw error;}finally{lease.release();}
  return inspectHost(config,coordination);
}
/** Only a completed explicit migration may supply an existing profile's first Host binding. */
export function bindMigratedProfile(config:PreparedHostConfig){const existing=readManifest(config);if(existing){const required=[...existing.requiredStores];
    if(pluginConfig(config,'activity')&&!required.includes('activity')){if(!activityMigrated(config))throw new Error('HOST_MIGRATION_REQUIRED');required.push('activity');}
    if(pluginConfig(config,'media')&&!required.includes('media')){if(!mediaMigrated(config))throw new Error('HOST_MIGRATION_REQUIRED');required.push('media');}
    if(required.length!==existing.requiredStores.length)writeManifest(config,{...existing,requiredStores:required,mode:'migrated'});return;}if(!migrated(config))throw new Error('HOST_INITIALIZATION_REQUIRED');
  writeManifest(config,{schemaVersion:1,profileId:config.config.profileId,agentId:config.config.agent.id,id:randomUUID(),state:'initialized',createdAt:new Date().toISOString(),paths:layoutPaths(config),requiredStores:storageFiles(config).filter(item=>existsSync(item.file)&&!['query','retrieval'].includes(item.kind)).map(item=>item.name),mode:'migrated'});}
function activityMigrated(config:PreparedHostConfig):boolean{try{
  if(!migrated(config))return false;const marker=z.object({manifest:z.string()}).parse(JSON.parse(readFileSync(join(config.paths.core,'migration-state.json'),'utf8')));
  const proof=z.object({phase:z.literal('complete'),plan:z.object({bundle:z.object({activity:z.literal(true)}),files:z.array(z.object({kind:z.string(),file:z.string()}))})}).parse(JSON.parse(readFileSync(marker.manifest,'utf8')));
  return proof.plan.files.some(item=>item.kind==='activity'&&pathIdentity(item.file)===pathIdentity(join(config.paths.core,'activity.sqlite')));
}catch{return false;}}
function mediaMigrated(config:PreparedHostConfig):boolean{try{if(!migrated(config))return false;const marker=z.object({manifest:z.string()}).parse(JSON.parse(readFileSync(join(config.paths.core,'migration-state.json'),'utf8')));
  const proof=z.object({phase:z.literal('complete'),plan:z.object({bundle:z.object({media:z.literal(true)}),files:z.array(z.object({kind:z.string(),file:z.string()}))})}).parse(JSON.parse(readFileSync(marker.manifest,'utf8')));
  return proof.plan.files.some(item=>item.kind==='media'&&pathIdentity(item.file)===pathIdentity(join(config.paths.core,'media.sqlite')));
}catch{return false;}}
