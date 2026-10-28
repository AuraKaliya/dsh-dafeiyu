import assert from 'node:assert/strict';
import childProcess,{ChildProcess} from 'node:child_process';
import { Socket } from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
import { createHash,randomUUID } from 'node:crypto';
import { createReadStream,existsSync } from 'node:fs';
import { mkdir,mkdtemp,readdir,realpath,writeFile } from 'node:fs/promises';
import { dirname,join,resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { ManagedHost,HostRuntimeOptions } from '@dafeiyu/host';
import type { ModelBudgetAuthority,ProductionRuntimeResources } from '@dafeiyu/server-runtime';
import type { HeadlessLaunchManifest,WindowsProbeOptions } from '@dafeiyu/server-executor';
import { testTempDir } from './test-temp.js';

const scenario=z.enum(['assembled','node-pin','probe-pin','owner-sid','metadata','credential-pin']).parse(process.argv[2]);
assert.equal(process.platform,'win32');
const root=await mkdtemp(join(testTempDir(),'production-factory-')),configFile=join(root,'host.json'),coordination=join(root,'coordination.sqlite');
process.env.DSH_HOME=join(root,'core/dsh-home');process.env.DSH_TELEMETRY_DISABLED='1';
// Only this child process changes its environment; no actual credential value is inspected.
for(const key of ['DEEPSEEK_API_KEY','OPENAI_API_KEY','ANTHROPIC_API_KEY'])delete process.env[key];

const previousFetch=globalThis.fetch,previousConnect=Socket.prototype.connect,previousSpawn=childProcess.spawn;
let fetchAttempts=0,socketAttempts=0,unexpectedSpawns=0,forcedCleanup=0,modelStreams=0,reserveAttempts=0,settleAttempts=0,installed=false;
const helpers:ChildProcess[]=[];
globalThis.fetch=async()=>{fetchAttempts++;throw new Error('LOCAL_FACTORY_NETWORK_FORBIDDEN');};
Socket.prototype.connect=function(){socketAttempts++;throw new Error('LOCAL_FACTORY_SOCKET_FORBIDDEN');};
// Preserve the actual native spawn/ChildProcess objects. Observe only the fixed proof helper.
childProcess.spawn=new Proxy(previousSpawn,{apply(target,thisArg,args:unknown[]){
  const command=args[0];if(typeof command!=='string'||!/[\\/]System32[\\/]WindowsPowerShell[\\/]v1\.0[\\/]powershell\.exe$/i.test(command)){unexpectedSpawns++;throw new Error('LOCAL_FACTORY_CHILD_FORBIDDEN');}
  const result:unknown=Reflect.apply(target,thisArg,args);assert.ok(result instanceof ChildProcess);helpers.push(result);return result;
}});syncBuiltinESMExports();

async function hashFile(file:string){const digest=createHash('sha256');for await(const bytes of createReadStream(file))digest.update(bytes);return digest.digest('hex');}
const pin=async(path:string)=>({path,hash:await hashFile(path)});
function ended(child:ChildProcess){return child.exitCode!==null||child.signalCode!==null;}
async function cleanupOwnedHelper(child:ChildProcess){
  if(ended(child))return;forcedCleanup++;
  await new Promise<void>((done,reject)=>{const finish=()=>{clearTimeout(timer);child.removeListener('exit',finish);done();},timer=setTimeout(()=>{child.removeListener('exit',finish);reject(new Error('LOCAL_FACTORY_HELPER_CLEANUP_UNCONFIRMED'));},3000);
    child.once('exit',finish);if(ended(child))finish();else child.kill('SIGTERM');});
}

let runtime:ProductionRuntimeResources|undefined,host:ManagedHost|undefined;
try{
  // Keep all DSH/Host value imports below the fixed, isolated DSH_HOME binding.
  const {ManagedHost:Host,loadHostConfig,initializeProfile,owners}=await import('@dafeiyu/host');
  const {createProductionRuntime}=await import('@dafeiyu/server-runtime');
  const {WINDOWS_PROCESS_PROBE_PATH,inspectWindowsHost,WindowsProcessControl,HeadlessLaunchManifestSchema,headlessProfilePackage,headlessProfilePatch,loadPinnedHeadlessManifest}=await import('@dafeiyu/server-executor');
  const systemRoot=process.env.SystemRoot??'C:\\Windows',nodePath=await realpath(process.execPath),powershellPath=await realpath(join(systemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'));
  const windows:WindowsProbeOptions={nodePath,nodeHash:await hashFile(nodePath),powershellPath,powershellHash:await hashFile(powershellPath),probeHash:await hashFile(WINDOWS_PROCESS_PROBE_PATH),temporaryDirectory:root,probeTimeoutMs:5000};
  const observed=await inspectWindowsHost(windows),admin=observed.parent.elevated&&observed.parent.administratorsEnabled&&!observed.parent.restricted;
  assert.equal(observed.parent.pid,process.pid);assert.equal(observed.parent.executableHash,windows.nodeHash);assert.ok(BigInt(observed.parent.creationId)>0n);

  const credential=join(root,'synthetic-model.credentials.yaml'),credentialText='version: 1\nrefs:\n  DEEPSEEK_API_KEY: SYNTHETIC_FACTORY_CREDENTIAL_NEVER_REAL_0123456789\nrecords: {}\n';
  await writeFile(credential,credentialText,{mode:0o600});
  const installedSdk=String.raw`D:\DSH\DSH Desktop\resources\app\node_modules\@deepseek-ai`,lib=resolve('packages/server-executor/lib'),entry=join(lib,'headless-launcher.js');
  const home=join(root,'unused-child-home'),profileName='dafeiyu-executor-'+randomUUID(),profileDirectory=join(home,'profiles',profileName),manifestPath=join(root,'child-manifest.json');await mkdir(profileDirectory,{recursive:true});
  const route={provider:'deepseek-official',model:'deepseek-flash',reasoningEffort:'max',contextWindow:1000000,maxOutputTokens:2048,maxRequestBytes:2000000};
  const installAnchor=join(installedSdk,'dsh/package.json'),credentialPackages=['dsh-credentials','dsh-credentials-local','dsh-llm-deepseek','dsh-llm-deepseek-api-key'];
  const runtimeFiles=[installAnchor,...(await readdir(lib)).filter(name=>name.endsWith('.js')).map(name=>join(lib,name)),
    ...(await readdir(join(installedSdk,'dsh/lib'))).filter(name=>name.endsWith('.js')).map(name=>join(installedSdk,'dsh/lib',name)),
    ...(await readdir(join(installedSdk,'dsh-headless/lib'))).filter(name=>name.endsWith('.js')).map(name=>join(installedSdk,'dsh-headless/lib',name)),
    join(installedSdk,'dsh-llm/lib/index.js'),join(installedSdk,'dsh-tools/lib/index.js'),
    ...credentialPackages.flatMap(name=>['package.json','lib/index.js'].map(file=>join(installedSdk,name,file)))];
  const manifest:HeadlessLaunchManifest=HeadlessLaunchManifestSchema.parse({schemaVersion:1,sdkVersion:'0.2.1-rc.2',mode:'production',home,profileName,installAnchor,
    profileBoot:await pin(join(installedSdk,'dsh/lib/profile-boot.js')),appBoot:await pin(join(installedSdk,'dsh-app-boot/lib/index.js')),launchEnvironment:await pin(join(installedSdk,'dsh-launch-environment/lib/index.js')),
    basePatch:await pin(join(installedSdk,'dsh-base/cordis.patch.yml')),headlessPatch:await pin(join(installedSdk,'dsh-headless/cordis.patch.yml')),
    profilePackage:{path:join(profileDirectory,'package.json'),hash:'0'.repeat(64)},profilePatch:{path:join(profileDirectory,'cordis.patch.yml'),hash:'0'.repeat(64)},budgetPlugin:await pin(join(lib,'headless-plugin.js')),
    runtimePins:await Promise.all([...new Set(runtimeFiles)].map(pin)),modelCredential:{credentialStore:await pin(credential),credentialName:'DEEPSEEK_API_KEY',baseURL:'https://api.deepseek.com/anthropic'},route,allowedTools:['read','write','edit','pwsh']});
  await writeFile(manifest.profilePackage.path,headlessProfilePackage());await writeFile(manifest.profilePatch.path,headlessProfilePatch(manifest,manifestPath));
  manifest.profilePackage.hash=await hashFile(manifest.profilePackage.path);manifest.profilePatch.hash=await hashFile(manifest.profilePatch.path);await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
  const manifestHash=await hashFile(manifestPath),pinned=await loadPinnedHeadlessManifest(manifestPath,manifestHash);

  const nodeHash=scenario==='node-pin'?'0'.repeat(64):windows.nodeHash;
  const command={nodePath,nodeHash,entryPath:entry,entryHash:await hashFile(entry),cwd:root,args:[manifestPath],profilePath:manifestPath,profileHash:manifestHash,
    env:{SystemRoot:systemRoot,WINDIR:systemRoot,TEMP:root,TMP:root,DSH_HOME:home,DSH_TELEMETRY_DISABLED:'1' as const,DSH_PERMISSION_MODE:'danger-full-access' as const}};
  const authorizationId='synthetic-factory-deny-not-7c',config={schemaVersion:1,profileId:'production-factory-fixture',agent:{id:'dafeiyu'},paths:{core:'./core',memory:'./memory',sessions:'./sessions',query:'./query.sqlite',channels:{}},
    persona:{fixedFile:'./persona.md',kind:'formal'},modelRoutes:{chat:{provider:route.provider,model:route.model,reasoningEffort:route.reasoningEffort}},runtime:{turnTimeoutMs:3000,shutdownGraceMs:500},
    plugins:[{id:'model-deepseek',required:true,config:{credentialStore:credential,credentialName:'DEEPSEEK_API_KEY',baseURL:'https://api.deepseek.com/anthropic',inlineTransport:{contextWindow:route.contextWindow,maxOutputTokens:scenario==='metadata'?4096:route.maxOutputTokens}}},
      {id:'timeline',required:true,config:{execution:true}},{id:'memory',required:true,config:{}},
      {id:'server-executor',required:true,config:{command,route,budgetAuthorizationId:authorizationId,resultOwner:{account:'12345678',ownerId:'87654321'},maxExecutionMs:10000}}],authorityPolicies:[]};
  await writeFile(join(root,'persona.md'),'这是本机零模型装配夹具中的公开虚构底色；不代表服务器人格或真实经历。');await writeFile(configFile,JSON.stringify(config));
  const prepared=loadHostConfig(configFile);assert.equal(initializeProfile(prepared,coordination).ready,true);
  const expiresAt=Date.now()+120000;
  // The acceptance label exercises the fixed production branch only. This is NOT 7C,
  // not a money authorization, and cannot dispatch even a single scripted/paid request.
  const authority:ModelBudgetAuthority={kind:'acceptance',authorizationId,route,guard:()=>{assert.ok(Date.now()<expiresAt);},remainingMs:()=>expiresAt-Date.now(),
    reserve:async()=>{reserveAttempts++;throw new Error('LOCAL_FACTORY_MODEL_DISPATCH_FORBIDDEN');},
    settle:async()=>{settleAttempts++;throw new Error('LOCAL_FACTORY_NO_RESERVATION_EXISTS');}};
  if(scenario==='credential-pin')await writeFile(credential,credentialText.replace('0123456789','9876543210'));
  const expected:Partial<Record<typeof scenario,string>>={'node-pin':'EXECUTOR_PROGRAM_CHANGED','probe-pin':'EXECUTOR_PROGRAM_CHANGED','owner-sid':'EXECUTOR_PROCESS_OWNER_MISMATCH','credential-pin':'EXECUTOR_CREDENTIAL_STORE_CHANGED',metadata:'RUNTIME_PROVIDER_DEFAULT_MISMATCH'};
  const phases:string[]=[];let outcome='assembled',code:string|null=null;
  try{
    runtime=await createProductionRuntime(prepared,{authority,windows:{...windows,nodeHash,probeHash:scenario==='probe-pin'?'0'.repeat(64):windows.probeHash,expectedOwnerSid:scenario==='owner-sid'?'S-1-0-0':observed.parent.ownerSid},maximumCallMs:3000,drainTimeoutMs:5000,guard:pinned.guard});
    assert.ok(runtime.hostOptions.serverExecutorDependencies?.processControl instanceof WindowsProcessControl);
    assert.equal(runtime.parentProof.parent.creationId,observed.parent.creationId);assert.equal(runtime.parentProof.parent.ownerSid,observed.parent.ownerSid);assert.equal(runtime.parentProof.parent.pid,process.pid);
    const install=runtime.hostOptions.installModelAdmission;assert.ok(install);
    const options:HostRuntimeOptions={...runtime.hostOptions,coordination,mode:'single-run',onPhase:phase=>{phases.push(phase);if(phase==='binding')assert.equal(installed,true);},
      installModelAdmission:async(ctx,actual)=>{assert.equal(ctx.get('dafeiyu'),undefined);ctx.on('llm/stream',async function*(request,next){modelStreams++;yield* next();},{global:true,prepend:true});await install(ctx,actual);installed=true;}};
    host=await Host.start(prepared,options);assert.equal(scenario,'assembled');assert.equal(installed,true);assert.equal(host.snapshot().phase,'ready');assert.equal(host.snapshot().services.executor?.mode,'production');
    assert.equal(host.ctx.agents.list().length,0);assert.ok(!host.snapshot().plugins.some(plugin=>['channel-qq','channel-bili-owner','activity','bilibili'].includes(plugin.id)&&plugin.state==='ready'));
  }catch(error){
    assert.ok(error instanceof Error);code=error.message;
    if(!admin&&code==='EXECUTOR_ADMIN_TOKEN_REQUIRED'&&(scenario==='assembled'||scenario==='metadata'))outcome='admin-denied';
    else{assert.equal(code,expected[scenario]);outcome='expected-denial';}
    if(scenario==='metadata'&&outcome!=='admin-denied'){assert.equal(installed,false);assert.equal(phases.includes('binding'),false);}
  }finally{if(runtime)await runtime.close(host);else await host?.close();}
  assert.equal(owners(coordination).length,0);assert.equal(modelStreams,0);assert.equal(reserveAttempts,0);assert.equal(settleAttempts,0);assert.equal(fetchAttempts,0);assert.equal(socketAttempts,0);assert.equal(unexpectedSpawns,0);
  assert.ok(helpers.length>=1);assert.ok(helpers.every(ended));assert.equal(existsSync(join(root,'operations-budget.sqlite')),false);assert.equal(existsSync(join(root,'evaluation.sqlite')),false);
  const db=new DatabaseSync(join(prepared.paths.core,'executor.sqlite'),{readOnly:true});try{assert.equal(db.prepare('SELECT count(*) AS n FROM executor_jobs').get()?.n,0);assert.equal(db.prepare('SELECT count(*) AS n FROM executor_budget_links').get()?.n,0);}finally{db.close();}
  const credentialHash=await hashFile(credential);assert.ok(!JSON.stringify({phases,outcome,code}).includes('SYNTHETIC_FACTORY_CREDENTIAL'));
  console.log(JSON.stringify({passed:true,scenario,outcome,code,realDsh:true,realWindowsProof:true,realModel:false,actualHttp:false,realPlatform:false,serverAccess:false,
    funding:'synthetic-deny-dispatch-not-7c',fundingDatabaseInitialized:false,credentials:'synthetic-only',credentialHash,hostOpened:!!host,installed,modelStreams,reserveAttempts,settleAttempts,fetchAttempts,socketAttempts,businessChildren:unexpectedSpawns,
    proofHelpers:helpers.length,proofHelpersClosed:helpers.every(ended),parentProof:observed}));
}finally{
  try{for(const child of helpers)await cleanupOwnedHelper(child);assert.equal(forcedCleanup,0,'Production lifecycle must close its own proof helpers');}
  finally{globalThis.fetch=previousFetch;Socket.prototype.connect=previousConnect;childProcess.spawn=previousSpawn;syncBuiltinESMExports();}
}
