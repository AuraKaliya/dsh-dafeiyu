import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync,readFileSync } from 'node:fs';
import { writeFile,readdir,mkdtemp } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { parseServerCommand,classifyServerRuntimeStop } from '../packages/server-runtime/lib/cli.js';
import { loadServerLaunchEnvelope,resolvedServerSdkFiles,SERVER_RUNTIME_FILES,ServerLaunchManifestSchema } from '../packages/server-runtime/lib/launch-config.js';
import type { ServerLaunchManifest } from '../packages/server-runtime/lib/launch-config.js';
import { runtimeBytesHash,runtimePathIdentity } from '../packages/server-runtime/lib/runtime-files.js';
import { testTempDir } from './test-temp.js';

async function launchFixture(){
  const root=await mkdtemp(join(testTempDir(),'launch-config-')),file=join(root,'launch.json'),hostPath=join(root,'host.json'),hostBytes=JSON.stringify({paths:{core:'./data/core'}})+'\n';
  await writeFile(hostPath,hostBytes);
  const pin=(path:string)=>({path,hash:runtimeBytesHash(readFileSync(path))});
  const manifest:ServerLaunchManifest={schemaVersion:1,host:{path:hostPath,fileHash:runtimeBytesHash(hostBytes),preparedHash:'1'.repeat(64)},accounting:{id:'fixture-accounting',profileId:'fixture',agentId:'dafeiyu',route:{provider:'deepseek-official',model:'deepseek-flash',reasoningEffort:'max',contextWindow:1000000,maxOutputTokens:2048,maxRequestBytes:2000000}},
    coordination:{path:join(root,'host-coordination.sqlite'),parentIdentity:runtimePathIdentity(root,'directory')},
    windows:{powershellPath:join(process.env.SystemRoot??'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),powershellHash:'a'.repeat(64),nodePath:process.execPath,nodeHash:'c'.repeat(64),expectedOwnerSid:'S-1-5-21-123-456-789-1001',probeHash:'b'.repeat(64),temporaryDirectory:root},
    maximumCallMs:1000,drainTimeoutMs:1000,
    sdkPins:resolvedServerSdkFiles().map(value=>({name:value.name,version:value.version,entry:pin(value.entry),package:pin(value.package)})),
    runtimePins:SERVER_RUNTIME_FILES.map(file=>({file,hash:pin(resolve('packages/server-runtime',file)).hash}))};
  const save=()=>writeFile(file,JSON.stringify(manifest)+'\n');await save();return {root,database:join(root,'must-not-create.sqlite'),claim:join(root,'must-not-create.json'),manifest,file,hostPath,save};
}

test('fixed server commands reject duplicate, unknown and missing options before a production entry can be selected',()=>{
  assert.equal(parseServerCommand(['start','--manifest','launch.json']).mode,'start');
  assert.throws(()=>parseServerCommand(['operator-init','--manifest','launch.json','--authorization','approval.json']),/RUNTIME_ARGUMENT_INVALID/);
  for(const args of [[],['init'],['start','--manifest'],['start','--manifest','one','--manifest','two'],['start','--manifest','one','--adapter','x'],['inspect','--manifest','one','--authorization','x'],['run','--manifest','one'],['operator-amend','--manifest','one']])assert.throws(()=>parseServerCommand(args),/^Error: RUNTIME_ARGUMENT_/);
});

test('early fixed launch envelope verifies actual public SDK entries and only derives a child home without filesystem initialization',async()=>{
  const f=await launchFixture(),before=await readdir(f.root),envelope=loadServerLaunchEnvelope(f.file);
  assert.equal(envelope.home,join(f.root,'data/core/dsh-home'));assert.equal(envelope.manifest.accounting.id,'fixture-accounting');assert.ok(Object.isFrozen(envelope.manifest));envelope.guard();
  assert.deepEqual(await readdir(f.root),before);assert.equal(existsSync(f.database),false);assert.equal(existsSync(f.claim),false);assert.equal(existsSync(join(f.root,'data')),false);
});

test('launch pins cannot choose arbitrary modules, omit an SDK role, or accept a changed public input',async()=>{
  const f=await launchFixture();assert.equal(ServerLaunchManifestSchema.safeParse({...f.manifest,factoryModule:'arbitrary.js'}).success,false);
  f.manifest.sdkPins[1]=f.manifest.sdkPins[0]!;await f.save();assert.throws(()=>loadServerLaunchEnvelope(f.file),/RUNTIME_PIN_SET_INVALID/);
  const g=await launchFixture();g.manifest.sdkPins[0]={...g.manifest.sdkPins[0]!,entry:{path:g.hostPath,hash:g.manifest.host.fileHash}};await g.save();assert.throws(()=>loadServerLaunchEnvelope(g.file),/RUNTIME_SDK_LAYOUT_CHANGED/);
  const h=await launchFixture(),envelope=loadServerLaunchEnvelope(h.file);await writeFile(h.hostPath,'{}\n');assert.throws(envelope.guard,/RUNTIME_PIN_CHANGED/);
  assert.equal(existsSync(h.database),false);assert.equal(existsSync(h.claim),false);
});

test('release pins cover the actual billing, lifecycle, schema and status modules; a missing role or wrong digest is refused',async()=>{
  for(const required of ['lib/lifecycle.js','lib/types.js','lib/call-gate.js','lib/launch-state.js'] as const){
    assert.ok(SERVER_RUNTIME_FILES.includes(required));const f=await launchFixture();
    const item=f.manifest.runtimePins.find(item=>item.file===required)!;item.hash='0'.repeat(64);await f.save();assert.throws(()=>loadServerLaunchEnvelope(f.file),/RUNTIME_PIN_CHANGED/);
    assert.equal(existsSync(f.database),false);
  }
  const f=await launchFixture();f.manifest.runtimePins[1]=f.manifest.runtimePins[0]!;await f.save();assert.throws(()=>loadServerLaunchEnvelope(f.file),/RUNTIME_PIN_SET_INVALID/);
});

test('actual thin bin rejects extra runtime injection without reading the supplied manifest or creating a home',async()=>{
  const f=await launchFixture(),before=await readdir(f.root);
  const result=await new Promise<{code:number|null;stdout:string}>((accept,reject)=>{
    const child=spawn(process.execPath,[resolve('packages/server-runtime/bin/dafeiyu-server.mjs'),'start','--manifest',join(f.root,'absent.json'),'--factory','arbitrary.mjs'],{cwd:f.root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,TEMP:f.root,TMP:f.root}});let stdout='';
    child.stdout.setEncoding('utf8');child.stdout.on('data',value=>{stdout+=String(value);});child.once('error',reject);child.once('exit',code=>accept({code,stdout}));
  });assert.equal(result.code,1);assert.deepEqual(JSON.parse(result.stdout),{status:'failed',code:'RUNTIME_ARGUMENT_INVALID'});assert.deepEqual(await readdir(f.root),before);assert.equal(existsSync(f.database),false);
});

test('removed operating money fields and commands cannot return through the launch schema',async()=>{
 const f=await launchFixture();assert.equal(ServerLaunchManifestSchema.safeParse({...f.manifest,funding:{amount:100}}).success,false);
 assert.equal(ServerLaunchManifestSchema.safeParse({...f.manifest,operationsAuthorization:'ignored.json'}).success,false);
 for(const mode of ['operator-init','operator-amend'])assert.throws(()=>parseServerCommand([mode,'--manifest',f.file]),/RUNTIME_ARGUMENT_INVALID/);
 assert.deepEqual(classifyServerRuntimeStop('RUNTIME_USAGE_UNKNOWN'),{kind:'accounting-stop',code:'RUNTIME_USAGE_UNKNOWN',reason:'unknown-cost'});
 const {runServerCommand}=await import('../packages/server-runtime/lib/cli.js');await assert.rejects(runServerCommand({mode:'start',manifest:f.file}),/RUNTIME_ACCOUNTING_PORT_REQUIRED/);
 assert.equal(existsSync(f.database),false);
});
