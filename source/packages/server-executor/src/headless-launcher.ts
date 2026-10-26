import { pathToFileURL,fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { headlessFileHash,loadPinnedHeadlessManifest } from './headless-manifest.js';
import { executorError } from './protocol.js';

function moduleObject(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object')throw new Error('EXECUTOR_DSH_ABI_CHANGED');return value as Record<string,unknown>;}
/** Fixed wrapper over the installed public CLI profile boot, not another Agent loop or HTTP model client. */
export async function launchPinnedHeadless(manifestPath:string):Promise<void>{
  const pinned=await loadPinnedHeadlessManifest(manifestPath,headlessFileHash(manifestPath)),{manifest}=pinned;
  if(process.env.DSH_HOME!==manifest.home||process.env.DSH_TELEMETRY_DISABLED!=='1'||!process.connected)throw new Error('EXECUTOR_HEADLESS_ENVIRONMENT');
  const boot=moduleObject(await import(pathToFileURL(manifest.appBoot.path).href)),profileBoot=moduleObject(await import(pathToFileURL(manifest.profileBoot.path).href)),environment=moduleObject(await import(pathToFileURL(manifest.launchEnvironment.path).href));
  if(typeof boot.loadProfileDirectory!=='function'||typeof boot.readProfilePatches!=='function'||typeof profileBoot.runProfile!=='function'||typeof environment.createLaunchEnvironmentSnapshot!=='function')throw new Error('EXECUTOR_DSH_ABI_CHANGED');
  const profile=moduleObject(boot.loadProfileDirectory('dafeiyu-executor',resolve(manifest.home,'profiles',manifest.profileName),manifest.installAnchor));
  if(!Array.isArray(profile.skippedBundles)||profile.skippedBundles.length!==0||!Array.isArray(profile.layers)||profile.layers.length!==2)throw new Error('EXECUTOR_DSH_BUNDLE_MISSING');
  pinned.guard();
  // The snapshot has only the already whitelisted child environment. No .env readers, login stores or key copies.
  const values=Object.fromEntries(['SystemRoot','WINDIR','PATH','TEMP','TMP','DSH_HOME','DSH_TELEMETRY_DISABLED','DSH_PERMISSION_MODE'].flatMap(key=>process.env[key]===undefined?[]:[[key,process.env[key]]]));
  const launchEnvironment=environment.createLaunchEnvironmentSnapshot([{source:'process',values}]);
  await profileBoot.runProfile({environment:launchEnvironment,profile:manifest.profileName,patchFiles:[],args:['--json','-'],resolvedProfile:{profile,installAnchor:manifest.installAnchor}});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const manifestPath=process.argv[2];if(!manifestPath||process.argv.length!==3)throw new Error('EXECUTOR_HEADLESS_ARGUMENTS');
  void launchPinnedHeadless(manifestPath).catch(error=>{
    process.stdout.write(JSON.stringify({type:'error',code:executorError(error,'EXECUTOR_HEADLESS_STARTUP_FAILED')})+'\n');
    if(error&&typeof error==='object'&&'entries'in error&&Array.isArray(error.entries))for(const item of (error.entries as unknown[]).slice(0,16)){
      if(!item||typeof item!=='object'||!('entry'in item)||!item.entry||typeof item.entry!=='object'||!('options'in item.entry)||!item.entry.options||typeof item.entry.options!=='object'||!('id'in item.entry.options))continue;
      const id=item.entry.options.id;if(typeof id==='string'&&/^[a-zA-Z0-9_-]{1,60}$/.test(id))process.stdout.write(JSON.stringify({type:'error',code:'EXECUTOR_BOOT_ENTRY_'+id.toUpperCase().replaceAll('-','_')})+'\n');
    }
    process.exitCode=1;if(process.connected)process.disconnect();
  });
}
