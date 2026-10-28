import {RELEASE_VERSION} from '@dafeiyu/contracts';
import { existsSync,readFileSync,readdirSync,mkdirSync,writeFileSync,renameSync,statSync } from 'node:fs';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { initializeCoreStorage,readFoundation } from '@dafeiyu/core';
import { RUNTIME_SCHEMA_VERSION } from '@dafeiyu/core/runtime-store';
import { initializeMemoryStorage } from '@dafeiyu/memory';
import { MEMORY_SCHEMA_VERSION } from '@dafeiyu/memory/store';
import { QqStore, QQ_SCHEMA_VERSION } from '@dafeiyu/qq';
import { ActivityStore,ACTIVITY_SCHEMA_VERSION } from '@dafeiyu/activity/store';
import { MediaStore,MEDIA_SCHEMA_VERSION } from '@dafeiyu/media';
import { BiliStore,BILI_SCHEMA_VERSION } from '@dafeiyu/bilibili';
import { ExecutorStore,EXECUTOR_SCHEMA_VERSION } from '@dafeiyu/server-executor/store';
import { BILI_OWNER_SCHEMA_VERSION,BILI_OWNER_VERSION,initializeBiliOwnerStorage,inspectBiliOwnerStorage } from '@dafeiyu/bilibili/channel';
import { executorFilesSnapshot } from '@dafeiyu/server-executor';
import { inspectStorage } from './storage-inspection.js';
import type { StorageKind,StorageInspection } from './storage-inspection.js';
import { claim,conflict } from './coordination.js';
import { assertPaths,pluginConfig } from './configuration.js';
import type { PreparedHostConfig } from './configuration.js';
import { pathIdentity,physicalPath,within } from './paths.js';

export const ProfileManifestSchema=z.strictObject({schemaVersion:z.literal(1),profileId:z.string(),agentId:z.string(),id:z.uuid(),state:z.enum(['initializing','initialized','failed']),createdAt:z.iso.datetime(),
  paths:z.record(z.string(),z.string()),requiredStores:z.array(z.string())});
export type ProfileManifest=z.infer<typeof ProfileManifestSchema>;
export interface HostInspection {readonly schemaVersion:1;readonly profileId:string;readonly agentId:string;readonly configHash:string;readonly foundationHash:string;
  readonly ready:boolean;readonly canInitialize:boolean;readonly codes:readonly string[];readonly occupied:boolean;
  readonly stores:readonly (StorageInspection&{name:string})[];readonly plugins:readonly {id:string;enabled:boolean;required:boolean;version:string|null;state:'configured'|'disabled'}[];readonly order:readonly string[]}
const target:Partial<Record<StorageKind,number>>={journal:1,memory:MEMORY_SCHEMA_VERSION,runtime:RUNTIME_SCHEMA_VERSION,activity:ACTIVITY_SCHEMA_VERSION,media:MEDIA_SCHEMA_VERSION,bilibili:BILI_SCHEMA_VERSION,executor:EXECUTOR_SCHEMA_VERSION,'bili-owner':BILI_OWNER_SCHEMA_VERSION,analysis:1,working:1,qq:QQ_SCHEMA_VERSION,query:8,retrieval:2};
export function layoutPaths(config:PreparedHostConfig){return Object.fromEntries(config.resources.map((resource,index)=>[String(index),resource.identity]));}
export const manifestFile=(config:PreparedHostConfig)=>join(config.paths.core,'host-profile.json');
export function readManifest(config:PreparedHostConfig):ProfileManifest|null{if(!existsSync(manifestFile(config)))return null;
  try{const value=ProfileManifestSchema.parse(JSON.parse(readFileSync(manifestFile(config),'utf8')));if(value.profileId!==config.config.profileId||value.agentId!==config.config.agent.id||JSON.stringify(value.paths)!==JSON.stringify(layoutPaths(config)))throw new Error('HOST_PROFILE_IDENTITY_MISMATCH');return value;}
  catch(error){if(error instanceof Error&&error.message==='HOST_PROFILE_IDENTITY_MISMATCH')throw error;throw new Error('HOST_PROFILE_MANIFEST_INVALID');}}
export function writeManifest(config:PreparedHostConfig,value:ProfileManifest){const file=manifestFile(config),temp=file+'.'+randomUUID()+'.tmp';writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{flag:'wx'});renameSync(temp,file);}
export function storageFiles(config:PreparedHostConfig){return [
  {name:'journal',kind:'journal' as const,file:join(config.paths.core,'journal.sqlite')},
  {name:'runtime',kind:'runtime' as const,file:join(config.paths.core,'runtime.sqlite')},
  {name:'activity',kind:'activity' as const,file:join(config.paths.core,'activity.sqlite')},
  {name:'media',kind:'media' as const,file:join(config.paths.core,'media.sqlite')},
  {name:'bilibili',kind:'bilibili' as const,file:join(config.paths.core,'bilibili.sqlite')},
  {name:'executor',kind:'executor' as const,file:join(config.paths.core,'executor.sqlite')},
  {name:'bili-owner',kind:'bili-owner' as const,file:join(config.paths.core,'bili-owner.sqlite')},
  ...(['memory','analysis','working','retrieval'] as const).map(kind=>({name:kind,kind,file:join(config.paths.memory,kind+'.sqlite')})),
  ...Object.entries(config.paths.channels).map(([id,directory])=>({name:id,kind:'qq' as const,file:join(directory,'qq.sqlite')})),
  {name:'query',kind:'query' as const,file:config.paths.query}];}
const packages:Record<string,string>={core:'@dafeiyu/core',memory:'@dafeiyu/memory',activity:'@dafeiyu/activity',media:'@dafeiyu/media',bilibili:'@dafeiyu/bilibili','server-executor':'@dafeiyu/server-executor',timeline:'@dafeiyu/timeline','channel-qq':'@dafeiyu/qq','channel-bili-owner':'@dafeiyu/bilibili','channel-simulator':'@dafeiyu/channel-simulator','model-deepseek':'@deepseek-ai/dsh-llm-deepseek-api-key','model-scripted':'@deepseek-ai/dsh-llm'};
const versions:Record<string,string>={core:RELEASE_VERSION,memory:RELEASE_VERSION,activity:RELEASE_VERSION,media:RELEASE_VERSION,bilibili:RELEASE_VERSION,'server-executor':RELEASE_VERSION,timeline:RELEASE_VERSION,'channel-qq':RELEASE_VERSION,'channel-bili-owner':BILI_OWNER_VERSION,'channel-simulator':RELEASE_VERSION,'model-deepseek':'0.2.1-rc.2','model-scripted':'0.2.1-rc.2'};
export function packageVersion(id:string):string|null{try{const name=packages[id];if(!name)return null;let directory=dirname(fileURLToPath(import.meta.resolve(name)));
    for(let i=0;i<5;i++){const file=join(directory,'package.json');if(existsSync(file)){const body=z.object({name:z.string(),version:z.string(),dafeiyuPackages:z.record(z.string(),z.string()).optional()}).parse(JSON.parse(readFileSync(file,'utf8')));if(body.name===name)return body.version;
      // The public single-package build uses Node package imports instead of private workspace dependencies.
      if(name.startsWith('#dafeiyu/')&&body.name==='dsh-dafeiyu')return body.dafeiyuPackages?.[name]??null;}directory=dirname(directory);}return null;}catch{return null;}}
function empty(config:PreparedHostConfig){return config.resources.every(item=>!existsSync(item.path)||item.kind==='directory'&&readdirSync(item.path).length===0);}
export function inspectHost(config:PreparedHostConfig,coordination?:string,ownInstanceId?:string):HostInspection{
  assertPaths(config);const codes:string[]=[],identity={agentId:config.config.agent.id,profileId:config.config.profileId};let occupied=false,manifest:ProfileManifest|null=null;
  try{const found=conflict(config.resources,coordination);occupied=!!found&&found.instanceId!==ownInstanceId;if(occupied)codes.push('HOST_ALREADY_OWNED');}catch{codes.push('HOST_COORDINATION_UNAVAILABLE');}
  try{manifest=readManifest(config);if(manifest&&manifest.state!=='initialized')codes.push('HOST_INITIALIZATION_INCOMPLETE');}catch(error){codes.push(error instanceof Error?error.message:'HOST_PROFILE_MANIFEST_INVALID');}
  const stores=storageFiles(config).map(item=>{
    const concrete=physicalPath(item.file);if(concrete!==item.file&&!within(concrete,dirname(item.file)))codes.push('HOST_STORAGE_PATH_CHANGED');
    const inspection=inspectStorage(item.file,item.kind,identity);
    if(inspection.activeOwner){codes.push('HOST_STORE_OWNED');occupied=true;}if(!inspection.supported||!inspection.integrity)codes.push('HOST_STORAGE_UNSUPPORTED');if(!inspection.identityMatches)codes.push('HOST_PROFILE_IDENTITY_MISMATCH');
    if(inspection.exists&&target[item.kind]!==undefined&&inspection.version!==target[item.kind])codes.push('HOST_STORAGE_INVALID');
    if(!inspection.exists&&(manifest?.requiredStores.includes(item.name)||['journal','runtime'].includes(item.kind)||item.kind==='memory'&&config.plugins.some(p=>p.id==='memory'&&p.enabled)))codes.push('HOST_INITIALIZATION_REQUIRED');
    if(!inspection.exists&&item.kind==='activity'&&pluginConfig(config,'activity'))codes.push('HOST_INITIALIZATION_REQUIRED');
    if(!inspection.exists&&item.kind==='media'&&pluginConfig(config,'media'))codes.push('HOST_INITIALIZATION_REQUIRED');
    if(!inspection.exists&&item.kind==='bilibili'&&pluginConfig(config,'bilibili'))codes.push('HOST_INITIALIZATION_REQUIRED');
    if(!inspection.exists&&item.kind==='executor'&&pluginConfig(config,'server-executor'))codes.push('HOST_INITIALIZATION_REQUIRED');
    if(!inspection.exists&&item.kind==='bili-owner'&&pluginConfig(config,'channel-bili-owner'))codes.push('HOST_INITIALIZATION_REQUIRED');
    if(item.kind==='bili-owner'&&inspection.exists&&inspection.supported&&inspection.identityMatches&&pluginConfig(config,'channel-bili-owner')&&!inspectBiliOwnerStorage(item.file,{...identity,accountUid:pluginConfig(config,'channel-bili-owner')!.accountUid,ownerUid:pluginConfig(config,'channel-bili-owner')!.ownerUid}).bindingReady)codes.push('HOST_BILI_OWNER_HANDOVER_REQUIRED');
    if(item.kind==='executor'&&inspection.exists&&inspection.supported){try{executorFilesSnapshot(config.paths.core);}catch{codes.push('HOST_EXECUTOR_ARCHIVE_INVALID');}}
    return {name:item.name,...inspection};});
  if(!manifest)codes.push('HOST_INITIALIZATION_REQUIRED');
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
    manifest={schemaVersion:1,profileId:config.config.profileId,agentId:config.config.agent.id,id:randomUUID(),state:'initializing',createdAt:new Date().toISOString(),paths:layoutPaths(config),requiredStores:storageFiles(config).filter(item=>!['query','retrieval'].includes(item.kind)&&(item.kind!=='activity'||!!pluginConfig(config,'activity'))&&(item.kind!=='media'||!!pluginConfig(config,'media'))&&(item.kind!=='bilibili'||!!pluginConfig(config,'bilibili'))&&(item.kind!=='executor'||!!pluginConfig(config,'server-executor'))&&(item.kind!=='bili-owner'||!!pluginConfig(config,'channel-bili-owner'))).map(item=>item.name)};writeManifest(config,manifest);
    const seed=readFoundation(config.paths.foundation);if(seed.version!==config.foundation.hash)throw new Error('HOST_FOUNDATION_CHANGED');
    initializeCoreStorage(config.paths.core,config.config.agent.id,config.config.profileId);initializeMemoryStorage(config.paths.memory,{agentId:config.config.agent.id,seed});
    const activity=pluginConfig(config,'activity');if(activity){const store=new ActivityStore(join(config.paths.core,'activity.sqlite'),{agentId:config.config.agent.id,profileId:config.config.profileId},activity,true);store.close();}
    if(pluginConfig(config,'media'))new MediaStore(join(config.paths.core,'media.sqlite'),{agentId:config.config.agent.id,profileId:config.config.profileId},true).close();
    if(pluginConfig(config,'bilibili'))new BiliStore(join(config.paths.core,'bilibili.sqlite'),{agentId:config.config.agent.id,profileId:config.config.profileId},true).close();
    if(pluginConfig(config,'server-executor'))new ExecutorStore(join(config.paths.core,'executor.sqlite'),{agentId:config.config.agent.id,profileId:config.config.profileId},true).close();
    if(pluginConfig(config,'channel-bili-owner'))initializeBiliOwnerStorage(config.paths.core,{agentId:config.config.agent.id,profileId:config.config.profileId,accountUid:pluginConfig(config,'channel-bili-owner')!.accountUid,ownerUid:pluginConfig(config,'channel-bili-owner')!.ownerUid});
    for(const directory of Object.values(config.paths.channels)){const qq=new QqStore(join(directory,'qq.sqlite'));qq.close();}
    manifest={...manifest,state:'initialized'};writeManifest(config,manifest);
  }catch(error){if(manifest)writeManifest(config,{...manifest,state:'failed'});throw error;}finally{lease.release();}
  return inspectHost(config,coordination);
}
