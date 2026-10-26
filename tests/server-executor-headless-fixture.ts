import assert from 'node:assert/strict';
import { mkdtemp,mkdir,readFile,writeFile,appendFile,readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash,randomUUID } from 'node:crypto';
import { dirname,join,resolve } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import type { ExecutionBudgetRequest } from '../packages/server-executor/lib/budget.js';
import { headlessProfilePackage,headlessProfilePatch,loadPinnedHeadlessManifest } from '../packages/server-executor/lib/headless-manifest.js';
import type { HeadlessLaunchManifest } from '../packages/server-executor/lib/headless-manifest.js';
import type { ExecutorNodeRunOptions,ExecutorProcessControl } from '../packages/server-executor/lib/runner.js';
import { ScriptedExecutorBudget } from './server-executor-fixture.js';
import { testTempDir } from './test-temp.js';

const installed=String.raw`D:\DSH\DSH Desktop\resources\app\node_modules\@deepseek-ai`,hash='0'.repeat(64);
async function digest(file:string){const result=createHash('sha256');for await(const chunk of createReadStream(file))result.update(chunk);return result.digest('hex');}
const pin=async(path:string)=>({path,hash:await digest(path)});
async function terminateFixture(child:ChildProcess):Promise<boolean>{
  const done=()=>child.exitCode!==null||child.signalCode!==null;if(done())return true;child.ref();
  return new Promise<boolean>(resolveDone=>{const stop=()=>{clearTimeout(timer);child.removeListener('exit',stop);resolveDone(done());},timer=setTimeout(stop,2500);child.once('exit',stop);if(done())stop();else child.kill('SIGKILL');});
}
export async function headlessFixture(mode:'normal'|'missing'='normal'){
  const root=await mkdtemp(join(testTempDir(),'executor-headless-')),home=join(root,'dsh-home'),profileName='dafeiyu-executor-'+randomUUID(),profileDir=join(home,'profiles',profileName),manifestPath=join(root,'headless-manifest.json'),scenarioPath=join(root,'fixture-scenario.json');
  await mkdir(profileDir,{recursive:true});await writeFile(scenarioPath,JSON.stringify({mode}));await writeFile(join(root,'permits.ndjson'),'');await writeFile(join(root,'.env'),'EXECUTOR_UNEXPECTED_ENV=SYNTHETIC_DO_NOT_LOAD\n');
  const lib=resolve('packages/server-executor/lib'),installAnchor=join(installed,'dsh','package.json'),entry=join(lib,'headless-launcher.js'),route={provider:'local-test',model:'scripted',reasoningEffort:null,contextWindow:131072,maxOutputTokens:256,maxRequestBytes:2000000};
  const runtimeFiles=[installAnchor,scenarioPath,...(await readdir(lib)).filter(file=>file.endsWith('.js')).map(file=>join(lib,file)),
    ...(await readdir(join(installed,'dsh','lib'))).filter(file=>file.endsWith('.js')).map(file=>join(installed,'dsh','lib',file)),
    ...(await readdir(join(installed,'dsh-headless','lib'))).filter(file=>file.endsWith('.js')).map(file=>join(installed,'dsh-headless','lib',file)),join(installed,'dsh-llm','lib','index.js'),join(installed,'dsh-tools','lib','index.js')];
  const manifest:HeadlessLaunchManifest={schemaVersion:1,sdkVersion:'0.2.1-rc.2',mode:'offline',home,profileName,installAnchor,
    profileBoot:await pin(join(installed,'dsh','lib','profile-boot.js')),appBoot:await pin(join(installed,'dsh-app-boot','lib','index.js')),launchEnvironment:await pin(join(installed,'dsh-launch-environment','lib','index.js')),
    basePatch:await pin(join(installed,'dsh-base','cordis.patch.yml')),headlessPatch:await pin(join(installed,'dsh-headless','cordis.patch.yml')),
    profilePackage:{path:join(profileDir,'package.json'),hash},profilePatch:{path:join(profileDir,'cordis.patch.yml'),hash},budgetPlugin:await pin(join(lib,'headless-plugin.js')),
    runtimePins:await Promise.all(runtimeFiles.map(pin)),offlineProvider:await pin(resolve('tests/fixtures/server-executor-headless-provider.mjs')),route,allowedTools:['read','write','edit','pwsh']};
  await writeFile(manifest.profilePackage.path,headlessProfilePackage());await writeFile(manifest.profilePatch.path,headlessProfilePatch(manifest,manifestPath));manifest.profilePackage.hash=await digest(manifest.profilePackage.path);manifest.profilePatch.hash=await digest(manifest.profilePatch.path);
  await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');const manifestHash=await digest(manifestPath),validated=await loadPinnedHeadlessManifest(manifestPath,manifestHash),nodeHash=await digest(process.execPath);
  class Port extends ScriptedExecutorBudget {override async reserve(input:ExecutionBudgetRequest,signal:AbortSignal){const permit=await super.reserve(input,signal);await appendFile(join(root,'permits.ndjson'),JSON.stringify({callId:input.callId,reservationId:permit.reservationId})+'\n');return permit;}}
  const port=new Port(),creation='simulated-headless-creation-'+randomUUID();let child:ChildProcess|undefined;
  const control:ExecutorProcessControl={identify:async value=>{child=value;if(!value.pid)throw new Error('EXECUTOR_PROCESS_IDENTITY_UNPROVEN');return {pid:value.pid,creationId:creation,executableHash:nodeHash};},terminate:async value=>({verified:await terminateFixture(value)})};
  const options:ExecutorNodeRunOptions={command:{nodePath:process.execPath,nodeHash,entryPath:entry,entryHash:await digest(entry),cwd:root,args:[manifestPath],profilePath:manifestPath,profileHash:manifestHash,
    env:{...(process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{}),...(process.env.WINDIR?{WINDIR:process.env.WINDIR}:{}),TEMP:root,TMP:root,DSH_HOME:home,DSH_TELEMETRY_DISABLED:'1',DSH_PERMISSION_MODE:'danger-full-access'}},
    jobId:randomUUID(),nonce:'d'.repeat(64),input:'Execute the fictional local fixture steps using the allowed tools, then report the outcome.',authorizationId:'fictional-original-budget',route,deadline:Date.now()+45000,
    budget:port,processControl:control,guard:validated.guard,beforeSpawn:()=>{},onReady:()=>{},allowedTools:validated.allowedTools,handshakeTimeoutMs:20000,cancelGraceMs:300};
  return {root,home,manifest,manifestPath,manifestHash,validated,port,options,cleanup:async()=>{if(child){const ended=await terminateFixture(child);if(!ended)child.unref();assert.equal(ended,true,'HEADLESS_FIXTURE_CLEANUP_UNCONFIRMED');}},
    observed:async()=>(await readFile(join(root,'provider-observed.ndjson'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line) as {call:number;purpose:string;tools:string[];unexpectedEnv:boolean})};
}
export async function publicFixtureFiles(root:string):Promise<string[]>{const result:string[]=[];for(const entry of await readdir(root,{withFileTypes:true})){const path=join(root,entry.name);if(entry.isDirectory())result.push(...await publicFixtureFiles(path));else if(entry.isFile())result.push(path);}return result;}
