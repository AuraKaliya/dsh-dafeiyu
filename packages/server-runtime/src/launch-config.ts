import { createHash } from 'node:crypto';
import { createReadStream,existsSync,readFileSync,statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname,join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { WindowsProcessControlOptionsSchema,WINDOWS_PROCESS_PROBE_PATH } from '@dafeiyu/server-executor/windows-process';
import type { PreparedHostConfig } from '@dafeiyu/host';
import { BiliOwnerProductionConfigSchema,loadBiliOwnerProductionBinding } from '@dafeiyu/channel-bili-owner/production-config';
import { RuntimeHashSchema,RuntimePathSchema,runtimeBytesHash,runtimeCheck,runtimeFreeze,runtimeDigest,runtimePathIdentity,readRuntimeJson } from './runtime-files.js';
import { RuntimeIdentitySchema } from './types.js';
import { ExecutorRouteSchema } from '@dafeiyu/server-executor/protocol';

/** Fixed imports used by ManagedHost. A manifest pins them; it never chooses a module to import. */
export const SERVER_SDK_PACKAGES=[
  '@deepseek-ai/cordis','@deepseek-ai/dsh-agent','@deepseek-ai/dsh-agent-loop','@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-session-projection','@deepseek-ai/dsh-session-persistence-jsonl','@deepseek-ai/dsh-session-query-sqlite',
  '@deepseek-ai/dsh-system-prompt','@deepseek-ai/dsh-tools','@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-credentials','@deepseek-ai/dsh-credentials-local','@deepseek-ai/dsh-llm-deepseek','@deepseek-ai/dsh-llm-deepseek-api-key',
] as const;
export const SERVER_RUNTIME_FILES=['package.json','bin/dafeiyu-server.mjs','lib/index.js','lib/cli.js','lib/launch-config.js','lib/launch-state.js','lib/production.js','lib/model-admission.js','lib/shared-budget.js','lib/call-gate.js','lib/lifecycle.js','lib/types.js','lib/runtime-files.js'] as const;
const pin=z.strictObject({path:RuntimePathSchema,hash:RuntimeHashSchema});
const sdkPin=z.strictObject({name:z.enum(SERVER_SDK_PACKAGES),version:z.string().min(1).max(80),entry:pin,package:pin});
export const ServerCoordinationSchema=z.strictObject({path:RuntimePathSchema,parentIdentity:RuntimeHashSchema});
export type ServerCoordination=z.infer<typeof ServerCoordinationSchema>;
export const ServerLaunchManifestSchema=z.strictObject({schemaVersion:z.literal(1),
  host:z.strictObject({path:RuntimePathSchema,fileHash:RuntimeHashSchema,preparedHash:RuntimeHashSchema}),
  accounting:z.strictObject({id:RuntimeIdentitySchema,profileId:RuntimeIdentitySchema,agentId:RuntimeIdentitySchema,route:ExecutorRouteSchema}),windows:WindowsProcessControlOptionsSchema,coordination:ServerCoordinationSchema,
  biliOwner:BiliOwnerProductionConfigSchema.optional(),
  maximumCallMs:z.number().int().min(1).max(3600000),drainTimeoutMs:z.number().int().min(1).max(3600000),
  sdkPins:z.array(sdkPin).length(SERVER_SDK_PACKAGES.length),
  runtimePins:z.array(z.strictObject({file:z.enum(SERVER_RUNTIME_FILES),hash:RuntimeHashSchema})).length(SERVER_RUNTIME_FILES.length),
});
export type ServerLaunchManifest=z.infer<typeof ServerLaunchManifestSchema>;
const samePath=(a:string,b:string)=>process.platform==='win32'?resolve(a).toLowerCase()===resolve(b).toLowerCase():resolve(a)===resolve(b);
const packageShape=z.object({name:z.string(),version:z.string()});
const runtimeRoot=fileURLToPath(new URL('../',import.meta.url));

function fixedPackage(entry:string,name:string):string {
  let at=dirname(entry);
  for(let count=0;count<12;count++){
    const file=join(at,'package.json');
    if(existsSync(file))try{if(packageShape.parse(JSON.parse(readFileSync(file,'utf8'))).name===name)return file;}catch{/* Not the owning package. */}
    const parent=dirname(at);if(parent===at)break;at=parent;
  }
  throw new Error('RUNTIME_SDK_PACKAGE_MISSING');
}
export function resolvedServerSdkFiles():readonly {name:typeof SERVER_SDK_PACKAGES[number];version:string;entry:string;package:string}[]{
  const require=createRequire(import.meta.url),hostRequire=createRequire(require.resolve('@dafeiyu/host'));
  return SERVER_SDK_PACKAGES.map(name=>{
    const entry=hostRequire.resolve(name),file=fixedPackage(entry,name),data=readRuntimeJson(file,packageShape);
    runtimeCheck(data.version===(name==='@deepseek-ai/cordis'?'4.0.5':'0.2.1-rc.2'),'RUNTIME_SDK_VERSION_CHANGED');
    return {name,version:data.version,entry,package:file};
  });
}
/** Bounded content check, including BigInt physical identity. No executable is started. */
export function inspectLaunchPin(value:{path:string;hash:string},maximumBytes=32*1024*1024):void {
  const identity=runtimePathIdentity(value.path,'file'),size=statSync(value.path).size;
  runtimeCheck(size>0&&size<=maximumBytes,'RUNTIME_PIN_SIZE_INVALID');
  const bytes=readFileSync(value.path);
  runtimeCheck(bytes.length===size&&runtimeBytesHash(bytes)===value.hash&&runtimePathIdentity(value.path,'file')===identity,'RUNTIME_PIN_CHANGED');
}
async function inspectExecutable(value:{path:string;hash:string}):Promise<void>{
  const identity=runtimePathIdentity(value.path,'file');runtimeCheck(statSync(value.path).size<=512*1024*1024,'RUNTIME_PROGRAM_TOO_LARGE');
  const hash=createHash('sha256');for await(const bytes of createReadStream(value.path))hash.update(bytes);
  runtimeCheck(hash.digest('hex')===value.hash&&runtimePathIdentity(value.path,'file')===identity,'RUNTIME_PROGRAM_CHANGED');
}
export interface LaunchEnvelope {readonly file:string;readonly hash:string;readonly home:string;readonly manifest:ServerLaunchManifest;guard():void}
/** Safe to call before importing Host. It does not resolve credentials, open databases or create a home. */
export function loadServerLaunchEnvelope(file:string):LaunchEnvelope {
  RuntimePathSchema.parse(file);const identity=runtimePathIdentity(file,'file');runtimeCheck(statSync(file).size>0&&statSync(file).size<=65536,'RUNTIME_MANIFEST_SIZE_INVALID');const hash=runtimeBytesHash(readFileSync(file));
  const manifest=runtimeFreeze(readRuntimeJson(file,ServerLaunchManifestSchema,hash));
  const expected=resolvedServerSdkFiles();
  runtimeCheck(new Set(manifest.sdkPins.map(item=>item.name)).size===SERVER_SDK_PACKAGES.length&&new Set(manifest.runtimePins.map(item=>item.file)).size===SERVER_RUNTIME_FILES.length,'RUNTIME_PIN_SET_INVALID');
  const guard=()=>{
    runtimeCheck(runtimePathIdentity(file,'file')===identity,'RUNTIME_MANIFEST_CHANGED');inspectLaunchPin({path:file,hash},65536);inspectLaunchPin({path:manifest.host.path,hash:manifest.host.fileHash},262144);
    for(const item of expected){const declared=manifest.sdkPins.find(part=>part.name===item.name)!;
      runtimeCheck(declared.version===item.version&&samePath(item.entry,declared.entry.path)&&samePath(item.package,declared.package.path),'RUNTIME_SDK_LAYOUT_CHANGED');
      inspectLaunchPin(declared.entry);inspectLaunchPin(declared.package,65536);
    }
    for(const item of manifest.runtimePins)inspectLaunchPin({path:join(runtimeRoot,item.file),hash:item.hash});
  };guard();
  const host=readRuntimeJson(manifest.host.path,z.object({paths:z.object({core:z.string().min(1)})}),manifest.host.fileHash),core=RuntimePathSchema.parse(resolve(dirname(manifest.host.path),host.paths.core));
  // Uninitialized Host paths may not exist for inspect. Validate the nearest existing parent without creating it.
  let parent=core;while(!existsSync(parent)){const next=dirname(parent);runtimeCheck(next!==parent,'RUNTIME_HOME_PARENT_MISSING');parent=next;}
  runtimePathIdentity(parent,'directory');const home=join(core,'dsh-home');
  return Object.freeze({file,hash,home,manifest,guard});
}

/** Full read-only preflight, run only after the thin bin has bound DSH_HOME. */
export async function prepareServerLaunch(envelope:LaunchEnvelope):Promise<{envelope:LaunchEnvelope;host:PreparedHostConfig;guard:()=>void}>{
  const {loadHostConfig,pluginConfig}=await import('@dafeiyu/host'),{loadPinnedHeadlessManifest}=await import('@dafeiyu/server-executor');
  envelope.guard();runtimeCheck(!!process.env.DSH_HOME&&samePath(process.env.DSH_HOME,envelope.home),'RUNTIME_DSH_HOME_NOT_BOUND');
  const manifest=envelope.manifest,host=loadHostConfig(manifest.host.path),accounting=manifest.accounting,model=pluginConfig(host,'model-deepseek'),executor=pluginConfig(host,'server-executor');
  runtimeCheck(host.hash===manifest.host.preparedHash&&host.config.profileId===accounting.profileId&&host.config.agent.id===accounting.agentId,'RUNTIME_PROFILE_BINDING_MISMATCH');
  runtimeCheck(host.config.persona.kind!=='test'&&!!model&&!!executor,'RUNTIME_PRODUCTION_PROFILE_REQUIRED');
  runtimeCheck(executor.budgetAuthorizationId===accounting.id&&runtimeDigest(executor.route)===runtimeDigest(accounting.route),'RUNTIME_PROFILE_BUDGET_MISMATCH');
  runtimeCheck(samePath(process.execPath,manifest.windows.nodePath),'RUNTIME_PROCESS_BINDING_MISMATCH');
  runtimeCheck(samePath(executor.command.nodePath,manifest.windows.nodePath)&&executor.command.nodeHash===manifest.windows.nodeHash,'RUNTIME_PROCESS_PROGRAM_MISMATCH');
  const coordinationGuard=()=>{
    runtimeCheck(runtimePathIdentity(dirname(manifest.coordination.path),'directory')===manifest.coordination.parentIdentity,'RUNTIME_COORDINATION_CHANGED');
    if(existsSync(manifest.coordination.path))runtimePathIdentity(manifest.coordination.path,'file');
  };coordinationGuard();
  const owner=pluginConfig(host,'channel-bili-owner');
  runtimeCheck(!!owner===!!manifest.biliOwner,'RUNTIME_BILI_OWNER_BINDING_REQUIRED');
  const bili=manifest.biliOwner?loadBiliOwnerProductionBinding(manifest.biliOwner):undefined;
  await Promise.all([inspectExecutable({path:manifest.windows.nodePath,hash:manifest.windows.nodeHash}),inspectExecutable({path:manifest.windows.powershellPath,hash:manifest.windows.powershellHash})]);
  inspectLaunchPin({path:WINDOWS_PROCESS_PROBE_PATH,hash:manifest.windows.probeHash});runtimePathIdentity(manifest.windows.temporaryDirectory,'directory');
  inspectLaunchPin({path:executor.command.entryPath,hash:executor.command.entryHash});
  const child=await loadPinnedHeadlessManifest(executor.command.profilePath,executor.command.profileHash);
  runtimeCheck(child.manifest.mode==='production'&&runtimeDigest(child.manifest.route)===runtimeDigest(accounting.route)&&!!executor.command.env.DSH_HOME&&samePath(child.manifest.home,executor.command.env.DSH_HOME),'RUNTIME_CHILD_PROFILE_MISMATCH');
  runtimeCheck(!!child.manifest.modelCredential&&samePath(child.manifest.modelCredential.credentialStore.path,model.credentialStore)&&child.manifest.modelCredential.baseURL===model.baseURL,'RUNTIME_MODEL_CREDENTIAL_MISMATCH');
  const guard=()=>{envelope.guard();child.guard();coordinationGuard();bili?.guard();runtimeCheck(loadHostConfig(host.file).hash===host.hash,'RUNTIME_CONFIG_CHANGED');};guard();
  return {envelope,host,guard};
}
