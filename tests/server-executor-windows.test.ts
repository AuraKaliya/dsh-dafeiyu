import test from 'node:test';
import assert from 'node:assert/strict';
import { ChildProcess,spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp,realpath,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { once } from 'node:events';
import { z } from 'zod';
import {
  WINDOWS_PROCESS_PROBE_PATH,inspectWindowsHost,createWindowsProcessControl,
  WindowsNativeProcessProofSchema,WindowsExecutionProofSchema,WindowsProcessControlOptionsSchema,
} from '../packages/server-executor/lib/windows-process.js';
import type { WindowsProbeOptions,WindowsProcessControl } from '../packages/server-executor/lib/windows-process.js';
import { testTempDir } from './test-temp.js';

const windows={skip:process.platform!=='win32'};
async function hashFile(file:string){const hash=createHash('sha256');for await(const bytes of createReadStream(file))hash.update(bytes);return hash.digest('hex');}
async function fixture(){
  const directory=await mkdtemp(join(testTempDir(),'executor-windows-')),systemRoot=process.env.SystemRoot??'C:\\Windows';
  const powershellPath=await realpath(join(systemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe')),nodePath=await realpath(process.execPath);
  const options:WindowsProbeOptions={powershellPath,powershellHash:await hashFile(powershellPath),nodePath,nodeHash:await hashFile(nodePath),
    probeHash:await hashFile(WINDOWS_PROCESS_PROBE_PATH),temporaryDirectory:directory,probeTimeoutMs:5000};
  return {directory,systemRoot,options};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
function admin(proof:Awaited<ReturnType<typeof inspectWindowsHost>>){return proof.parent.elevated&&proof.parent.administratorsEnabled&&!proof.parent.restricted;}
async function childFixture(f:Fixture,descendant=false){
  const file=join(f.directory,descendant?'tree.mjs':'child.mjs');
  await writeFile(file,descendant?[
    "import {spawn} from 'node:child_process';",
    "const nested=spawn(process.execPath,['-e','setTimeout(()=>{},15000)'],{windowsHide:true,stdio:'ignore',env:{SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP}});",
    "nested.once('spawn',()=>process.send?.({kind:'fixture-ready',pid:nested.pid}));",
    "let stopping=false;process.on('message',message=>{if(message?.kind!=='stop-descendant'||stopping)return;stopping=true;if(nested.exitCode!==null||nested.signalCode!==null){process.send?.({kind:'descendant-stopped'});return;}nested.once('exit',()=>process.send?.({kind:'descendant-stopped'}));nested.kill();});",
    "process.on('disconnect',()=>{nested.kill();process.exit(0);});setTimeout(()=>{nested.kill();process.exit(0);},30000);",
  ].join('\n'):"process.send?.({kind:'fixture-ready',pid:process.pid});setTimeout(()=>{},30000);\n");
  const child=spawn(f.options.nodePath,[file],{cwd:f.directory,windowsHide:true,shell:false,stdio:['ignore','ignore','ignore','ipc'],
    env:{SystemRoot:f.systemRoot,WINDIR:f.systemRoot,TEMP:f.directory,TMP:f.directory}});
  const ready=message(child,'fixture-ready');void ready.catch(()=>{});
  try{await once(child,'spawn');const value=await ready;return {child,pid:z.object({pid:z.number().int().positive()}).parse(value).pid};}
  catch(error){await stopChild(child);throw error;}
}
function message(child:ChildProcess,kind:string):Promise<unknown>{
  return new Promise((accept,reject)=>{
    const cleanup=()=>{clearTimeout(timer);child.removeListener('message',receive);child.removeListener('error',failed);child.removeListener('exit',failed);};
    const failed=()=>{cleanup();reject(new Error('FIXTURE_CHILD_EXITED'));},timer=setTimeout(()=>{cleanup();reject(new Error('FIXTURE_MESSAGE_TIMEOUT'));},10000);
    const receive=(value:unknown)=>{const parsed=z.object({kind:z.string()}).safeParse(value);if(!parsed.success||parsed.data.kind!==kind)return;cleanup();accept(value);};
    child.on('message',receive);child.once('error',failed);child.once('exit',failed);
  });
}
async function stopDescendant(child:ChildProcess){if(!child.connected||child.exitCode!==null||child.signalCode!==null)return;const stopped=message(child,'descendant-stopped');child.send({kind:'stop-descendant'});await stopped;}
/** Cleanup only uses the actual ChildProcess returned by this test's spawn. */
async function stopChild(child:ChildProcess|undefined){if(!child||child.exitCode!==null||child.signalCode!==null)return;
  await new Promise<void>((done,reject)=>{const timer=setTimeout(()=>{child.removeListener('exit',exit);reject(new Error('FIXTURE_CHILD_CLEANUP_UNCONFIRMED'));},3000);
    const exit=()=>{clearTimeout(timer);done();};child.once('exit',exit);child.kill();});
}

test('Windows host observation reads the actual local token and native creation time without a model or CLI',windows,async()=>{
  const f=await fixture(),proof=await inspectWindowsHost(f.options);
  WindowsNativeProcessProofSchema.parse(Object.fromEntries(Object.entries(proof.parent).filter(([key])=>key!=='executableHash')));
  assert.equal(proof.parent.pid,process.pid);assert.ok(BigInt(proof.parent.creationId)>0n);assert.ok(Date.parse(proof.parent.creationTimeUtc)<=Date.now());
  assert.equal(proof.parent.executablePath.toLowerCase(),f.options.nodePath.toLowerCase());assert.equal(proof.parent.executableHash,f.options.nodeHash);
  assert.match(proof.parent.ownerSid,/^S-1-/);assert.equal(typeof proof.parent.elevated,'boolean');assert.equal(typeof proof.parent.administratorsEnabled,'boolean');
  assert.equal(proof.scope,'current-machine-only');assert.equal('commandLine'in proof.parent,false);assert.equal('environment'in proof.parent,false);
});

test('trusted executable/probe hash changes and caller-selected script paths are rejected before creating an authority',windows,async()=>{
  const f=await fixture();await assert.rejects(inspectWindowsHost({...f.options,nodeHash:'0'.repeat(64)}),/EXECUTOR_PROGRAM_CHANGED/);
  await assert.rejects(inspectWindowsHost({...f.options,probeHash:'0'.repeat(64)}),/EXECUTOR_PROGRAM_CHANGED/);
  assert.equal(WindowsProcessControlOptionsSchema.safeParse({...f.options,expectedOwnerSid:'S-1-5-18',probePath:join(f.directory,'replacement.ps1')}).success,false);
  await assert.rejects(createWindowsProcessControl({...f.options,expectedOwnerSid:'S-1-0-0'}),/EXECUTOR_PROCESS_OWNER_MISMATCH/);
});

test('production control requires the real local admin token and attests the exact spawned Node child',windows,async()=>{
  const f=await fixture(),host=await inspectWindowsHost(f.options),options={...f.options,expectedOwnerSid:host.parent.ownerSid};
  if(!admin(host)){await assert.rejects(createWindowsProcessControl(options),/EXECUTOR_ADMIN_TOKEN_REQUIRED/);return;}
  const control=await createWindowsProcessControl(options);let child:ChildProcess|undefined;
  try{child=(await childFixture(f)).child;const proof=WindowsExecutionProofSchema.parse(await control.prove(child)),identity=await control.identify(child);
    assert.equal(proof.child.pid,child.pid);assert.equal(proof.child.parentPid,process.pid);assert.equal(proof.child.ownerSid,host.parent.ownerSid);
    assert.equal(proof.parent.elevated,true);assert.equal(proof.child.elevated,true);assert.equal(proof.child.administratorsEnabled,true);assert.equal(proof.child.restricted,false);
    assert.deepEqual(identity,{pid:proof.child.pid,creationId:proof.child.creationId,executableHash:f.options.nodeHash});
    assert.equal(proof.treeContainment,'not-enforced');assert.ok(Object.isFrozen(control.parentEvidence()));
  }finally{try{await stopChild(child);}finally{await control.close();}}
});

test('a cloned handle or changed creation identity cannot authorize process termination',windows,async context=>{
  const f=await fixture(),host=await inspectWindowsHost(f.options);if(!admin(host)){context.skip('Actual local token is not an unrestricted elevated administrator');return;}
  const control=await createWindowsProcessControl({...f.options,expectedOwnerSid:host.parent.ownerSid});let child:ChildProcess|undefined;
  try{child=(await childFixture(f)).child;const identity=await control.identify(child);
    await assert.rejects(control.prove({pid:child.pid} as ChildProcess),/EXECUTOR_CHILD_HANDLE_REQUIRED/);
    await assert.rejects(control.terminate(child,{...identity,creationId:(BigInt(identity.creationId)+1n).toString()}),/EXECUTOR_PROCESS_IDENTITY_CHANGED/);
    assert.equal(child.exitCode,null);assert.equal(child.signalCode,null);assert.equal(control.terminationEvidence(child),null);
  }finally{try{await stopChild(child);}finally{await control.close();}}
});

test('root-handle termination records an observed exit but never certifies a complete process tree or rollback',windows,async context=>{
  const f=await fixture(),host=await inspectWindowsHost(f.options);if(!admin(host)){context.skip('Actual local token is not an unrestricted elevated administrator');return;}
  const control=await createWindowsProcessControl({...f.options,expectedOwnerSid:host.parent.ownerSid});let child:ChildProcess|undefined;
  try{child=(await childFixture(f)).child;const identity=await control.identify(child),result=await control.terminate(child,identity),evidence=control.terminationEvidence(child);
    assert.deepEqual(result,{verified:false});assert.ok(evidence);assert.equal(evidence.rootIdentityRechecked,true);assert.equal(evidence.rootExitObserved,true);
    assert.equal(evidence.wholeTreeVerified,false);assert.equal(evidence.gap,'EXECUTOR_PROCESS_TREE_UNCONTAINED');assert.deepEqual(evidence.process,identity);
    await assert.rejects(control.identify(child),/EXECUTOR_PROCESS_NOT_RUNNING/);
  }finally{try{await stopChild(child);}finally{await control.close();}}
});

test('native descendant observations retain their scope and do not become whole-tree containment proof',windows,async context=>{
  const f=await fixture(),host=await inspectWindowsHost(f.options);if(!admin(host)){context.skip('Actual local token is not an unrestricted elevated administrator');return;}
  let control:WindowsProcessControl|undefined,child:ChildProcess|undefined,descendantStopped=false;
  try{control=await createWindowsProcessControl({...f.options,expectedOwnerSid:host.parent.ownerSid});const fixtureChild=await childFixture(f,true);child=fixtureChild.child;
    const proof=await control.prove(child);assert.ok(proof.descendants.some(value=>value.pid===fixtureChild.pid&&value.parentPid===child?.pid&&value.alive));
    await stopDescendant(child);descendantStopped=true;const identity=await control.identify(child);assert.deepEqual(await control.terminate(child,identity),{verified:false});
    assert.equal(control.terminationEvidence(child)?.wholeTreeVerified,false);
  }finally{try{if(child&&!descendantStopped)await stopDescendant(child);}finally{try{await stopChild(child);}finally{await control?.close();}}}
});
