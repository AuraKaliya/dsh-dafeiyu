import { existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,readdirSync } from 'node:fs';
import { dirname,join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash,randomUUID } from 'node:crypto';
import { z } from 'zod';
import { inspectRuntimeMigration,migrateRuntimeStorage } from '@dafeiyu/core';
import { claim,resource } from '@dafeiyu/host';
import { HostConfigSchema,DSH_TOOL_ACTIONS } from '@dafeiyu/contracts';
import { loadHostConfig,initializeProfile,initializeAdditionalStores,inspectHost,ManagedHost,pluginConfig,BILI_OWNER_NATIVE_ACTIONS,ProfileManifestSchema,layoutPaths,writeManifest } from '@dafeiyu/host';
import type { HostRuntimeOptions } from '@dafeiyu/host';
import { QQ_ACTIONS,QQ_TASK_ACTIONS,QQ_MEDIA_ACTIONS,QQ_STICKER_ACTIONS,QQ_PROGRESS_ACTIONS } from '@dafeiyu/qq';
import { biliActionIds,inspectBiliMigration,migrateBiliStorage } from '@dafeiyu/bilibili';
import { BiliOwnerStore,BILI_OWNER_TASK_ACTIONS,BILI_PUBLIC_SCENE,biliOwnerScene,createBiliOwnerProductionPorts } from '@dafeiyu/bilibili/channel';
import { BILI_OWNER_AUTH_HASH } from '@dafeiyu/bilibili/channel/production-config';
import { ACTIVITY_ACTIONS } from '@dafeiyu/activity';
import { MEDIA_ACTIONS } from '@dafeiyu/media';
import { readInstallationSettings,checkInstallationFiles } from './settings.js';
import type { InstallationSettings } from './settings.js';
import {attachLocalOwnerControl} from './local-owner.js';

const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const metadataSchema=z.strictObject({schemaVersion:z.literal(1),instanceId:z.uuid(),profileId:z.string(),agentId:z.string(),createdAt:z.iso.datetime(),identityHash:z.string().length(64),
  biliOwner:z.strictObject({accountUid:z.string(),ownerUid:z.string(),since:z.iso.datetime()}).nullable()});
export type InstallationMetadata=z.infer<typeof metadataSchema>;
const memoryActions=['dafeiyu_memory_record','dafeiyu_memory_revise','dafeiyu_memory_delete','dafeiyu_memory_restore','dafeiyu_memory_search','dafeiyu_memory_open','dafeiyu_memory_deleted_search','dafeiyu_memory_deleted_open','dafeiyu_timeline_search','dafeiyu_source_open'];
const growthActions=['dafeiyu_recent_state_unpublish','dafeiyu_recent_state_save','dafeiyu_recent_state_status','dafeiyu_recent_state_publish','dafeiyu_qq_expression_save','dafeiyu_qq_expression_status','dafeiyu_memory_experience','dafeiyu_memory_pending','dafeiyu_memory_reflect','dafeiyu_memory_self_status','dafeiyu_memory_self_update','dafeiyu_memory_self_withdraw'];
const taskActions=['dafeiyu_task_intent','dafeiyu_task_object','dafeiyu_execution_source_open','dafeiyu_execution_contribute','dafeiyu_execution_select','dafeiyu_execution_source_state','dafeiyu_execution_contribution_state'];
const maintenanceActions=['dafeiyu_memory_maintenance_request','dafeiyu_memory_maintenance_status','dafeiyu_memory_consolidate','dafeiyu_memory_maintenance_result','dafeiyu_experience_read','dafeiyu_experience_review'];
const mediaActions=['dafeiyu_media_acquire','dafeiyu_media_inspect','dafeiyu_media_read','dafeiyu_media_select'];
const identityHash=(s:InstallationSettings)=>hash(JSON.stringify({profile:s.instanceName}));

/** Program-only fictional provider seam, never accepted in installation JSON. */
export interface InstallationOptions {readonly scripted?:boolean;readonly foundationTemplate?:string;readonly initializeModules?:boolean}
export function installationProfile(settings:InstallationSettings,meta:InstallationMetadata,foundationFile:string,settingsFile:string,options:InstallationOptions={}) {
  const root=settings.dataDir,bili=settings.bilibili,activity=settings.activity.enabled;
  const resources=bili?.capabilities?[BILI_PUBLIC_SCENE]:[];
  const biliActions=bili?.capabilities?biliActionIds(!!bili.browser):[];
  const enabledMediaActions=settings.qq.media?.sendEnabled?MEDIA_ACTIONS:mediaActions;
  const stickerActions=settings.qq.stickers.enabled?[...QQ_STICKER_ACTIONS]:[];
  const {service:oneBotService,...qqHostConfig}=settings.qq;
  const actions=[...taskActions,...growthActions,...maintenanceActions,...QQ_ACTIONS,...QQ_PROGRESS_ACTIONS,...stickerActions,...(settings.dshTools?DSH_TOOL_ACTIONS:[]),...(activity?ACTIVITY_ACTIONS:[]),...biliActions,...(settings.media?[...QQ_MEDIA_ACTIONS,...enabledMediaActions]:[])];
  const conversation=[...memoryActions,...growthActions,...QQ_ACTIONS,...QQ_TASK_ACTIONS,...(settings.dshTools?['dsh_tool_list']:[]),...stickerActions,...(settings.media?[...QQ_MEDIA_ACTIONS,...enabledMediaActions]:[]),...(bili?.channel?BILI_OWNER_TASK_ACTIONS:[])];
  const plugins:unknown[]=[{id:options.scripted?'model-scripted':'model-deepseek',required:true,config:options.scripted?{}:{credentialStore:settings.model.credentialStore,...(settings.model.auth?{auth:settings.model.auth}:{}),...(settings.model.baseURL?{baseURL:settings.model.baseURL}:{}),...(settings.model.inlineTransport?{inlineTransport:settings.model.inlineTransport}:{})}},
    {id:'timeline',required:true,config:{execution:true}},{id:'memory-growth',required:true,config:{context:{},maintenance:{}}},
    {id:'qq',required:true,config:{...qqHostConfig,joinedGroups:undefined,capabilities:{enabled:true},tasks:{enabled:true,policyId:'qq-task',deliverResults:true,explorationResources:resources},...(settings.media?{media:{enabled:true,...settings.qq.media}}:{}),groupSync:{enabled:true,mode:settings.qq.joinedGroups?'joined':'allowlist'}}}];
  if(activity)plugins.push({id:'activity',required:true,config:Object.fromEntries(Object.entries(settings.activity).filter(([key])=>key!=='enabled'))});
  if(settings.media){const media=structuredClone(settings.media),base=dirname(settingsFile),absolute=(value:unknown)=>typeof value==='string'?resolve(base,value):value;
    for(const key of ['ffmpeg','ffprobe'])if(media[key])media[key]=absolute(media[key]) as string;
    for(const section of ['documents','tts']){const value=media[section];if(value&&typeof value==='object'&&!Array.isArray(value)){const key=section==='documents'?'python':'powershell';if(value[key])value[key]=absolute(value[key]) as string;}}
    if(media.audio&&typeof media.audio==='object'&&!Array.isArray(media.audio))for(const section of ['whisper','events']){const value=media.audio[section];if(value&&typeof value==='object'&&!Array.isArray(value)){
      for(const key of ['node','python','moduleDirectory'])if(value[key])value[key]=absolute(value[key]) as string;
      for(const key of ['model','labels']){const nested=value[key];if(nested&&typeof nested==='object'&&!Array.isArray(nested)&&nested.path)nested.path=absolute(nested.path) as string;}}}
    plugins.push({id:'media',required:true,config:media});}
  if(bili)plugins.push({id:'bilibili',required:true,config:{...(bili.capabilities?{capabilities:{...bili.requestPolicy,...(bili.browser?{browser:bili.browser}:{}),...(bili.session?{session:bili.session}:{})}}:{}),...(bili.channel?{channel:{accountUid:bili.channel.accountUid,ownerUid:bili.channel.ownerUid,tasks:{enabled:bili.capabilities}}}:{})}});
  const policies:unknown[]=[{id:'conversation',producers:['channel-qq',...(bili?.channel?['channel-bili-owner']:[])],actions:conversation,allowLocalWrite:true},
    {id:'qq-task',producers:['qq-tasks'],actions,allowLocalWrite:true,resources},
    {id:'local-task',producers:['host-cli'],actions,allowLocalWrite:true,resources:[...resources,{channel:'qq',account:settings.qq.botId,kind:'private',id:settings.qq.ownerId}]}];
  if(activity)policies.push({id:'activity-explore',producers:['activity'],actions:[...growthActions,...memoryActions,...(settings.activity.plans?ACTIVITY_ACTIONS:[ACTIVITY_ACTIONS[3]]),...(settings.activity.maintenance?maintenanceActions:[]),...(settings.activity.allowedCapabilities.includes('bilibili')?biliActions:[]),...(settings.activity.allowedCapabilities.includes('media')&&settings.media?mediaActions:[]),...(settings.activity.allowedCapabilities.includes('dsh-tools')&&settings.dshTools?DSH_TOOL_ACTIONS:[])],allowLocalWrite:true,resources},{id:'activity-maintenance',producers:['activity'],actions:[...maintenanceActions,...growthActions],allowLocalWrite:true,resources});
  if(settings.localOwnerControl)policies.push({id:'conversation-local-owner-tasks',producers:['local-owner-tasks'],actions:['local_owner_task_submit',...(settings.dshTools?['dsh_tool_list']:[])],allowLocalWrite:true},
    {id:'local-owner-task',producers:['local-owner-tasks'],actions,allowLocalWrite:true,resources,
    externalActions:settings.dshTools?[{extensionId:'dsh-tools',actionId:'dsh_tool_call',actionVersion:'1'}]:[]});
  for(const policy of policies){const entry=z.object({id:z.string()}).parse(policy);if(['qq-task','activity-explore'].includes(entry.id))Object.assign(policy!,{externalActions:[...(settings.dshTools&&(entry.id!=='activity-explore'||settings.activity.allowedCapabilities.includes('dsh-tools'))?[{extensionId:'dsh-tools',actionId:'dsh_tool_call',actionVersion:'1'}]:[]),{extensionId:'qq-progress',actionId:'qq_progress',actionVersion:'1'}]});}
  if(bili?.channel&&bili.capabilities)policies.push({id:'bili-owner-task',producers:['bili-owner-tasks'],actions:[...BILI_OWNER_NATIVE_ACTIONS],allowLocalWrite:true,resources:[BILI_PUBLIC_SCENE,biliOwnerScene(bili.channel)]});
  return HostConfigSchema.parse(JSON.parse(JSON.stringify({schemaVersion:1,profileId:meta.profileId,agent:{id:meta.agentId},paths:{core:join(root,'core'),memory:join(root,'memory'),sessions:join(root,'sessions'),query:join(root,'query.sqlite'),channels:{qq:join(root,'qq',hash(JSON.stringify([settings.qq.botId,settings.qq.ownerId])).slice(0,24))}},
    modelRoutes:{chat:options.scripted?{provider:'local-test',model:'scripted'}:{provider:settings.model.auth==='dsh-account'?'deepseek-account':'deepseek-official',model:settings.model.model,...(settings.model.reasoningEffort?{reasoningEffort:settings.model.reasoningEffort}:{})}},
    persona:{fixedFile:foundationFile,kind:options.scripted?'test':'formal',...(settings.growthMaxBytes===undefined?{}:{growthRegion:{maxBytes:settings.growthMaxBytes}})},...(settings.taskTimeoutMs||settings.phaseTimeouts?{runtime:{...(settings.taskTimeoutMs?{taskTimeoutMs:settings.taskTimeoutMs}:{}),...(settings.phaseTimeouts?{phaseTimeouts:settings.phaseTimeouts}:{})}}:{}),context:{...settings.contextSelection,maxTokens:settings.contextCapacity.maxTokens,assembly:settings.context??{},regions:{'memory:qq-expression':{priority:420},...settings.contextSelection?.regions}},plugins,authorityPolicies:policies})));
}

export interface InstallationMigration{code:'INSTALL_MIGRATED'|'INSTALL_CURRENT'|'INSTALL_NO_STORE';version:number;backup:string|null;runtimeVersion?:number;backups?:readonly string[]}
/** Explicit Bili -> v6 and Runtime v1/v2 -> v3 migrations for installed storage. Never runs implicitly. */
export function migrateInstallation(settingsFile:string):InstallationMigration{
  const settings=readInstallationSettings(settingsFile),core=join(settings.dataDir,'core'),file=join(core,'bilibili.sqlite'),runtime=join(core,'runtime.sqlite');
  if(!existsSync(file)&&!existsSync(runtime))return {code:'INSTALL_NO_STORE',version:0,backup:null};
  const profile=z.object({agentId:z.string().min(1).max(100),profileId:z.string().min(1).max(100)}).parse(JSON.parse(readFileSync(join(core,'host-profile.json'),'utf8')));
  const lease=claim([resource(core,'directory')],profile);
  try{
    const stamp=Date.now(),backup=join(settings.dataDir,'backups','bilibili-'+stamp+'.sqlite');
    const result=existsSync(file)?migrateBiliStorage(file,profile,{backup}):{migrated:false,version:0,backup:undefined};
    const engine=migrateRuntimeStorage(runtime,profile,join(settings.dataDir,'backups','runtime-'+stamp+'.sqlite'));
    const backups=[result.backup,engine.backup].filter((value):value is string=>typeof value==='string');
    return {code:result.migrated||engine.migrated?'INSTALL_MIGRATED':'INSTALL_CURRENT',version:result.version,backup:result.backup??null,
      ...(existsSync(runtime)?{runtimeVersion:engine.version,backups}:{})};
  }finally{lease.release();}
}

/** Moving a data directory keeps identity; the manifest only stores resolved paths. */
export function relocateProfileManifest(prepared:ReturnType<typeof loadHostConfig>){const manifest=join(prepared.paths.core,'host-profile.json');if(!existsSync(manifest))return false;const value=ProfileManifestSchema.parse(JSON.parse(readFileSync(manifest,'utf8')));if(value.profileId!==prepared.config.profileId||value.agentId!==prepared.config.agent.id)return false;const paths=layoutPaths(prepared);if(JSON.stringify(value.paths)===JSON.stringify(paths))return false;writeManifest(prepared,{...value,paths});return true;}
export function prepareInstallation(settingsFile:string,options:InstallationOptions={}) {
  const settings=readInstallationSettings(settingsFile),root=settings.dataDir,metaFile=join(root,'installation.json');
  const runtimeStore=join(root,'core','runtime.sqlite');
  if(existsSync(runtimeStore)){const profile=z.object({agentId:z.string(),profileId:z.string()}).parse(JSON.parse(readFileSync(join(root,'core','host-profile.json'),'utf8')));
    if(inspectRuntimeMigration(runtimeStore,profile).state==='upgradable')throw new Error('INSTALL_MIGRATION_REQUIRED');}
  const biliStore=join(root,'core','bilibili.sqlite');
  if(existsSync(biliStore)){try{const profile=z.object({agentId:z.string(),profileId:z.string()}).parse(JSON.parse(readFileSync(join(root,'core','host-profile.json'),'utf8')));if(inspectBiliMigration(biliStore,profile).state==='upgradable')throw new Error('INSTALL_MIGRATION_REQUIRED');}catch(error){if(error instanceof Error&&error.message==='INSTALL_MIGRATION_REQUIRED')throw error;}}
  checkInstallationFiles(settings,options.scripted);
  let meta:InstallationMetadata;
  if(existsSync(metaFile)){
    meta=metadataSchema.parse(JSON.parse(readFileSync(metaFile,'utf8')));
    if(meta.identityHash!==identityHash(settings)||meta.profileId!==settings.instanceName)throw new Error('INSTALL_IDENTITY_CHANGED_USE_NEW_DIRECTORY');
  }else{
    if(existsSync(root)&&readdirSync(root).length)throw new Error('INSTALL_REQUIRES_EMPTY_DIRECTORY');
    mkdirSync(root,{recursive:true});const instanceId=randomUUID();meta={schemaVersion:1,instanceId,profileId:settings.instanceName,agentId:'dafeiyu-'+instanceId,createdAt:new Date().toISOString(),identityHash:identityHash(settings),biliOwner:null};
    writeFileSync(metaFile,JSON.stringify(meta,null,2)+'\n',{flag:'wx'});
  }
  const newBili=settings.bilibili?.channel;
  if(newBili){
    if(meta.biliOwner&&(meta.biliOwner.accountUid!==newBili.accountUid||meta.biliOwner.ownerUid!==newBili.ownerUid))throw new Error('INSTALL_IDENTITY_CHANGED_USE_NEW_DIRECTORY');
    if(!meta.biliOwner){meta={...meta,biliOwner:{accountUid:newBili.accountUid,ownerUid:newBili.ownerUid,since:new Date().toISOString()}};
      const temp=metaFile+'.'+randomUUID()+'.tmp';writeFileSync(temp,JSON.stringify(meta,null,2)+'\n',{flag:'wx'});renameSync(temp,metaFile);}
  }
  const configuration=join(root,'configuration');mkdirSync(configuration,{recursive:true});
  const foundation=settings.foundationFile??join(configuration,'foundation.md');
  if(!settings.foundationFile&&!existsSync(foundation))writeFileSync(foundation,readFileSync(options.foundationTemplate??fileURLToPath(new URL('../assets/foundation.md',import.meta.url))),{flag:'wx'});
  const profile=installationProfile(settings,meta,foundation,resolve(settingsFile),options),file=join(configuration,'host.json'),bytes=JSON.stringify(profile,null,2)+'\n';
  if(!existsSync(file)||readFileSync(file,'utf8')!==bytes){
    if(existsSync(file)&&inspectHost(loadHostConfig(file)).occupied)throw new Error('HOST_STORE_OWNED');
    const temporary=file+'.'+randomUUID()+'.tmp';writeFileSync(temporary,bytes,{flag:'wx'});renameSync(temporary,file);
  }
  const prepared=loadHostConfig(file);relocateProfileManifest(prepared);let inspection=inspectHost(prepared);
  if(inspection.canInitialize)inspection=initializeProfile(prepared);
  else if(options.initializeModules)inspection=initializeAdditionalStores(prepared);
  if(pluginConfig(prepared,'channel-bili-owner')&&!inspection.occupied&&inspection.codes.every(code=>code==='HOST_BILI_OWNER_HANDOVER_REQUIRED')){
    const owner=settings.bilibili!.channel!,store=new BiliOwnerStore(join(prepared.paths.core,'bili-owner.sqlite'),{agentId:meta.agentId,profileId:meta.profileId,accountUid:owner.accountUid,ownerUid:owner.ownerUid});
    try{if(!store.bindingReady())store.initializeFresh({requestId:'installation:'+meta.instanceId,since:Date.parse(meta.biliOwner!.since),cutoverHash:hash(JSON.stringify(meta.biliOwner))});}finally{store.close();}inspection=inspectHost(prepared);
  }
  return {settings,meta,prepared,inspection};
}

function ownerPorts(settings:InstallationSettings) {
  const owner=settings.bilibili?.channel;if(!owner)return undefined;
  const root=join(settings.dataDir,'bilibili-connection'),directory=join(root,'配置文件');mkdirSync(directory,{recursive:true});
  const publicConfig=JSON.stringify({accountUid:owner.accountUid,ownerUid:owner.ownerUid});
  const manifest=JSON.stringify({schemaVersion:1,kind:'bili-owner-channel',enabled:true,accountUid:owner.accountUid,ownerUid:owner.ownerUid,generation:1,authModuleHash:BILI_OWNER_AUTH_HASH,publicConfigHash:hash(publicConfig)});
  for(const [name,bytes]of [['bilibili.json',publicConfig],['bili-owner-channel.json',manifest]]){const file=join(directory,name!);if(!existsSync(file))writeFileSync(file,bytes!,{flag:'wx'});else if(readFileSync(file,'utf8')!==bytes)throw new Error('INSTALL_BILI_BINDING_CHANGED');}
  return ()=>createBiliOwnerProductionPorts({installationRoot:root,manifestPath:join(directory,'bili-owner-channel.json'),manifestHash:hash(manifest),credentialFile:owner.sessionFile});
}
export async function startInstallation(settingsFile:string,options:InstallationOptions={},runtime:HostRuntimeOptions={}) {
  const prepared=prepareInstallation(settingsFile,options);
  if(!prepared.inspection.ready)throw new Error(prepared.inspection.codes[0]??'INSTALL_NOT_READY');
  const createBiliOwnerPorts=runtime.createBiliOwnerPorts??ownerPorts(prepared.settings);
  return ManagedHost.start(prepared.prepared,{...runtime,...(createBiliOwnerPorts?{createBiliOwnerPorts}:{}),installChannels:async(ctx,config)=>{
    await runtime.installChannels?.(ctx,config);if(prepared.settings.localOwnerControl){const close=attachLocalOwnerControl(ctx,prepared.settings,config.config.agent.id);ctx.effect(()=>close);}
  }});
}
